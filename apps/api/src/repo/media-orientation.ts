import { and, eq, isNull } from 'drizzle-orm';
import { readUprightSize, renderPlaceholder } from '@sitewright/image-pipeline';
import type { Database } from '../db/client.js';
import { content, projects } from '../db/schema.js';
import type { MediaStorage } from '../media/storage.js';

/**
 * ONE-TIME REPAIR: media stored with its EXIF orientation ignored.
 *
 * A phone photographed in portrait writes LANDSCAPE pixels plus an `Orientation` tag; every browser
 * applies that tag, so the stored ORIGINAL looks upright. sharp does not apply it unless asked — and
 * it drops metadata on encode — so before this repair the pipeline recorded the raw (sideways)
 * dimensions and generated every thumbnail sideways *without* the tag that would have let the browser
 * put it back. The visible result is an original that looks right in the media library and a hero,
 * card and gallery tile that are all on their side. Measured on one real 45k-image library: ~5% of
 * JPEGs carried a 90° orientation.
 *
 * `storeOriginal`/`generateThumbnail` now auto-orient, which fixes every future upload. This repairs
 * what is already on disk:
 *
 *   1. the recorded `width`/`height` become the UPRIGHT pair (what the browser actually paints, and
 *      what `sw-image` writes as the intrinsic size — a wrong pair is a wrong aspect box and CLS);
 *   2. the LQIP is re-rendered upright (a sideways blur behind an upright photo is visible);
 *   3. the cached thumbnails are DROPPED so the next request regenerates them oriented.
 *
 * Nothing here is destructive: every byte removed is derived and regenerates on demand, and the
 * retained original is never rewritten — its EXIF tag stays the source of truth.
 *
 * Safe to re-run: the recorded dimensions are only ever changed from one member of a transposed pair
 * to the other, so a second pass finds nothing to write. It does re-drop the derived thumbnails of
 * every tagged image, which is why the caller runs it ONCE per instance rather than every boot.
 */

/** Formats whose containers can carry an EXIF Orientation tag. Everything else is skipped unread. */
const EXIF_CAPABLE_EXT = new Set(['jpg', 'jpeg', 'tif', 'tiff', 'webp', 'avif', 'heic', 'heif']);

export interface OrientationRepairReport {
  /** Image assets whose stored file could carry an orientation tag, i.e. actually opened. */
  inspected: number;
  /** Assets whose recorded dimensions were corrected. */
  corrected: number;
  /** Cached thumbnail files deleted (they regenerate, oriented, on next request). */
  thumbsDropped: number;
  /** Assets that could not be read (missing file, unreadable header) — left exactly as they were. */
  failed: number;
}

interface StoredImageRecord {
  kind?: string;
  width?: number;
  height?: number;
  original?: string;
  placeholder?: string;
}

/** The extension of `name`, lower-cased, or '' when it has none. */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Repair every image asset on the instance whose recorded dimensions disagree with its EXIF
 * orientation. Best-effort per asset: one unreadable file never aborts the pass.
 */
export async function repairMediaOrientation(
  db: Database,
  storage: MediaStorage,
  opts: { log?: (message: string) => void; concurrency?: number } = {},
): Promise<OrientationRepairReport> {
  const report: OrientationRepairReport = { inspected: 0, corrected: 0, thumbsDropped: 0, failed: 0 };
  // Soft-deleted assets are excluded: they are in the recycle bin, invisible everywhere, and a
  // restore re-reads the row — repairing them would spend I/O on bytes nobody can see.
  const rows = await db
    .select({ id: content.id, entityId: content.entityId, data: content.data, slug: projects.slug })
    .from(content)
    .innerJoin(projects, eq(projects.id, content.projectId))
    .where(and(eq(content.kind, 'media'), isNull(content.deletedAt)));

  const candidates = rows.filter((row) => {
    const asset = row.data as StoredImageRecord;
    return (
      asset?.kind === 'image' &&
      typeof asset.original === 'string' &&
      EXIF_CAPABLE_EXT.has(extOf(asset.original)) &&
      typeof asset.width === 'number' &&
      typeof asset.height === 'number'
    );
  });

  const queue = candidates.slice();
  const worker = async (): Promise<void> => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      const asset = row.data as StoredImageRecord;
      try {
        // Header read only — sharp does not decode pixels for `metadata()`, so this stays cheap
        // across a library of tens of thousands.
        const path = storage.resolveStoredPath(row.slug, row.entityId, asset.original!);
        const upright = await readUprightSize(path);
        report.inspected += 1;
        // An untagged image (or an explicit `1`) was always handled correctly — leave it alone.
        if (!upright || !upright.orientation || upright.orientation === 1) continue;

        // EVERY cached thumbnail of a tagged image was encoded unoriented, so all of them are wrong —
        // including for orientations 2 and 4, which MIRROR without transposing and so leave the
        // dimensions (and the check below) looking perfectly fine.
        report.thumbsDropped += await storage.pruneAssetThumbnails(row.slug, row.entityId, asset.original!);

        if (upright.width === asset.width && upright.height === asset.height) continue;
        // Only a TRANSPOSE is ours to fix. Any other disagreement (a file replaced underneath the
        // record, a hand-edited row) is not an orientation bug and must not be silently overwritten.
        if (!upright.transposed || upright.width !== asset.height || upright.height !== asset.width) continue;

        await db
          .update(content)
          .set({
            data: {
              ...(row.data as Record<string, unknown>),
              width: upright.width,
              height: upright.height,
              placeholder: await renderPlaceholder(path),
            },
          })
          .where(eq(content.id, row.id));

        report.corrected += 1;
      } catch {
        report.failed += 1;
      }
    }
  };

  const lanes = Math.max(1, Math.min(8, opts.concurrency ?? 4));
  await Promise.all(Array.from({ length: lanes }, worker));

  if (report.corrected > 0) {
    opts.log?.(
      `re-oriented ${report.corrected} of ${report.inspected} images (${report.thumbsDropped} stale thumbnails dropped)`,
    );
  }
  return report;
}

// Intake for a PROJECT export zip (manifest.json + bundle.json + media/<assetId>/…). Validates the
// envelope + bundle before any project is created, and extracts media binaries to disk with the same
// zip-bomb / zip-slip defenses as the website-import upload path (bounded decompression, path
// normalization, per-entry + total byte caps).
import { openProjectZipFile, type OpenProjectZip } from './project-zip-file.js';
import {
  ExportManifestSchema,
  ProjectExportBundleSchema,
  PROJECT_EXPORT_FORMAT,
  type ExportManifest,
  type ProjectExportBundle,
} from '@sitewright/schema';
import { UploadError, normalizeZipPath } from './upload.js';
import type { MediaStorage } from '../media/storage.js';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_ENTRY_BYTES, MAX_PROJECT_ARCHIVE_BYTES } from '../limits.js';

export interface ProjectZipLimits {
  /** Max entries scanned in the archive. */
  maxEntries: number;
  /** Per-entry uncompressed byte cap (a single media file / the JSON docs). */
  maxEntryBytes: number;
  /** Total uncompressed media byte budget across the archive (zip-bomb guard). */
  maxTotalBytes: number;
}

/**
 * ★ These must track the EXPORT ceilings (apps/api/src/limits.ts) or the round trip breaks in the
 * middle: at 600 MiB of media this path refused every archive the export could produce for a real
 * large project, so a backup could be taken and never restored. Media entries are decompressed ONE
 * AT A TIME and written straight to disk, so the total is bounded by disk, not memory.
 */
export const DEFAULT_PROJECT_ZIP_LIMITS: ProjectZipLimits = {
  maxEntries: MAX_ARCHIVE_ENTRIES,
  maxEntryBytes: MAX_ARCHIVE_ENTRY_BYTES,
  maxTotalBytes: MAX_PROJECT_ARCHIVE_BYTES,
};

const decoder = new TextDecoder('utf-8');

export interface ParsedProjectZip {
  manifest: ExportManifest;
  bundle: ProjectExportBundle;
  /** The OPEN archive, retained so media binaries can be extracted after the project is created.
   *  Holds a file descriptor — the caller must `zip.close()` when the import finishes or fails. */
  zip: OpenProjectZip;
}

/**
 * Opens a project export zip FROM DISK and validates its `manifest.json` + `bundle.json` (bounded, so
 * a bomb can't blow up here). Throws {@link UploadError} on any client-fixable problem (bad zip,
 * missing docs, non-JSON, schema mismatch, newer format). Writes nothing.
 *
 * ★ Takes a PATH, not a Buffer: the archive stays on disk and entries are read one at a time, so an
 * import is bounded by its largest single file rather than by the whole archive.
 */
export async function readProjectZip(
  zipPath: string,
  limits: ProjectZipLimits = DEFAULT_PROJECT_ZIP_LIMITS,
): Promise<ParsedProjectZip> {
  const zip = await openProjectZipFile(zipPath, limits.maxEntries);
  try {
    if (!zip.entries.has('manifest.json') || !zip.entries.has('bundle.json')) {
      throw new UploadError('not a Sitewright project export (missing manifest.json or bundle.json)');
    }

    // The two JSON documents are the ONLY entries read whole — they are the project's content, which
    // is small even when its media is not (measured: 6.7 MB of content beside 2.9 GB of media).
    const manifestBytes = await zip.readEntry('manifest.json', limits.maxEntryBytes);
    const bundleBytes = await zip.readEntry('bundle.json', limits.maxEntryBytes);

    let manifestJson: unknown;
    let bundleJson: unknown;
    try {
      manifestJson = JSON.parse(decoder.decode(manifestBytes));
      bundleJson = JSON.parse(decoder.decode(bundleBytes));
    } catch {
      throw new UploadError('manifest.json / bundle.json is not valid JSON');
    }

    const manifest = ExportManifestSchema.safeParse(manifestJson);
    if (!manifest.success) throw new UploadError('invalid export manifest');
    if (manifest.data.exportFormat > PROJECT_EXPORT_FORMAT) {
      throw new UploadError('this export was made by a newer version of Sitewright');
    }
    const bundle = ProjectExportBundleSchema.safeParse(bundleJson);
    if (!bundle.success) throw new UploadError('invalid project bundle');

    return { manifest: manifest.data, bundle: bundle.data, zip };
  } catch (err) {
    zip.close(); // never leak the descriptor on a rejected archive
    throw err;
  }
}

/**
 * Extracts every `media/<assetId>/<rel>` entry to `MEDIA_ROOT/<newSlug>/<assetId>/<rel>`, bounded
 * (per-entry + total) and zip-slip-safe (path normalized, then `importAssetFile` re-validates and
 * confines). Returns the number of files written. `onProgress(done)` ticks per file.
 */
export async function extractProjectMedia(
  zip: OpenProjectZip,
  storage: MediaStorage,
  newSlug: string,
  limits: ProjectZipLimits = DEFAULT_PROJECT_ZIP_LIMITS,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const names = [...zip.entries.keys()].filter((n) => n.startsWith('media/'));
  let total = 0;
  let done = 0;
  for (const name of names) {
    const norm = normalizeZipPath(name); // rejects traversal / absolute / backslash → null
    if (!norm || !norm.startsWith('media/')) continue;
    const rest = norm.slice('media/'.length); // <assetId>/<rel…>
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) continue; // need assetId AND a file rel
    const assetId = rest.slice(0, slash);
    const rel = rest.slice(slash + 1);

    // ONE entry resident at a time. `streamEntry` enforces the per-entry bound as bytes flow, so a
    // header that under-declares its size cannot get past it.
    const parts: Buffer[] = [];
    const bytes = await zip.streamEntry(name, limits.maxEntryBytes, (chunk) => parts.push(chunk));
    total += bytes;
    if (total > limits.maxTotalBytes) throw new UploadError('archive media exceeds the total size limit');
    await storage.importAssetFile(newSlug, assetId, rel, Buffer.concat(parts));
    done += 1;
    onProgress?.(done, names.length);
  }
  return done;
}

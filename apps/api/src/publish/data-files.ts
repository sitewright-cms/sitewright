import type { ImageAsset, MediaAsset } from '@sitewright/schema';

/**
 * PUBLISH-TIME `.json` DATA FILES — the counterpart to the on-page `{{sw-json-data}}` island.
 *
 * An island is inlined into the HTML of every page that renders it and re-sent on every visit. A data
 * file ships once, is cached like any other asset, and can be fetched only when it is needed — which is
 * what a list too large to inline actually wants. The site-search index has worked this way for a
 * while; this generalises it to a project's own data.
 *
 * ★ The emitted payload is a JSON DOCUMENT, not a script body, so it needs no `</script>` escaping —
 * the browser parses it with `JSON.parse`, never as markup. That is the whole reason the two features
 * exist separately rather than one wrapping the other.
 */

/** A `website.dataFiles` entry, after schema validation. */
export interface DataFileSpec {
  path: string;
  dataset?: string;
  folder?: string;
  fields?: readonly string[];
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

/** A dataset entry as the publish bundle holds it. */
export interface DatasetEntryLike {
  values?: Record<string, unknown> | null;
}

export interface BuildDataFilesInput {
  specs: readonly DataFileSpec[];
  /** Published entries KEYED BY DATASET NAME — the shape the publish bundle already has. */
  entries: Readonly<Record<string, readonly DatasetEntryLike[]>>;
  media: readonly MediaAsset[];
  /**
   * Turns an image into the URL the PUBLISHED site serves it at, and registers it so the export
   * materializes that variant.
   *
   * ★ Without this the file carries the CMS URL (`/media/<project>/<id>-<name>`), which is a live
   * route on platform hosting and DOES NOT EXIST on a site exported to the owner's own server — the
   * export bundles media into a flat `_assets/` directory and produces only referenced variants. So
   * the URLs 404 and the files were never written: two failures that both hide behind a working
   * platform-hosted preview. Passing this makes a data file reference its images the same way a
   * rendered page does.
   *
   * Absent (tests, or a caller with no asset pipeline) → the CMS URL, which is right for a
   * platform-hosted site.
   */
  resolveAssetUrl?: (asset: MediaAsset, size: 'xs' | 'sm' | 'md' | 'lg' | 'xl') => string;
}

export interface BuiltDataFile {
  path: string;
  json: string;
  /** Rows written — surfaced in the publish log so an empty file is visible rather than mysterious. */
  rows: number;
}

export interface BuildDataFilesResult {
  files: BuiltDataFile[];
  /** Human-readable problems. A spec that resolves to nothing is reported, never silently skipped. */
  warnings: string[];
}

/**
 * A single data file's ceiling, in bytes.
 *
 * Well above any page-sized list (the largest real gallery on the instance is ~3,400 images ≈ 240 KB)
 * and far below the point where a browser fetch stops being reasonable. A file over this is REFUSED
 * with a named warning rather than truncated: half a list is valid JSON that is quietly missing rows,
 * which reads to everyone downstream as missing content rather than as a size limit.
 */
export const MAX_DATA_FILE_BYTES = 4 * 1024 * 1024;

/** Keeps only `fields` from a row. An absent/empty projection keeps the row as-is. */
function project(values: Record<string, unknown>, fields: readonly string[] | undefined): Record<string, unknown> {
  if (!fields?.length) return values;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(values, f)) {
      // eslint-disable-next-line security/detect-object-injection -- own-property-guarded, author-declared field name
      out[f] = values[f];
    }
  }
  return out;
}

/**
 * Builds every declared data file. Pure: it returns the bytes, the caller writes them, so the whole
 * thing is testable without a filesystem or a publish.
 */
/**
 * Rewrites every CMS media URL inside a value to the URL the PUBLISHED site serves it at.
 *
 * ★ A dataset row carries asset URLs just as a folder listing does — a product's `image`, a
 * download's `file`, an `<img src>` inside a rich-text cell. They have exactly the failure the folder
 * source had: `/media/<project>/<id>-<name>` is a live route on platform hosting and does not exist on
 * an exported site, and the variant was never materialized because nothing rendered it. Fixing the
 * folder source and leaving these is fixing one half of one bug.
 *
 * Walks strings anywhere in the row (nested objects, arrays, rich-text bodies) and replaces every
 * occurrence, so a URL inside markup is rewritten too — not just a field whose whole value is a URL.
 */
function rewriteAssetUrls(
  value: unknown,
  byUrl: ReadonlyMap<string, MediaAsset>,
  resolve: (asset: MediaAsset) => string,
  depth = 0,
): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') {
    if (!value.includes('/media/')) return value;
    // Match the delivery route shape; the map lookup is what decides whether it is really ours, so a
    // look-alike string in prose can never be rewritten into something that does not exist.
    return value.replace(/\/media\/[A-Za-z0-9_-]+\/(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_.-]+/g, (hit) => {
      const asset = byUrl.get(hit);
      return asset ? resolve(asset) : hit;
    });
  }
  if (Array.isArray(value)) return value.map((v) => rewriteAssetUrls(v, byUrl, resolve, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // eslint-disable-next-line security/detect-object-injection -- own-property key from Object.entries
      out[k] = rewriteAssetUrls(v, byUrl, resolve, depth + 1);
    }
    return out;
  }
  return value;
}

export function buildDataFiles({ specs, entries, media, resolveAssetUrl }: BuildDataFilesInput): BuildDataFilesResult {
  const files: BuiltDataFile[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const spec of specs) {
    // Two specs writing the same file would make the output depend on array order — the later one wins
    // silently and the earlier one's data is simply absent.
    if (seen.has(spec.path)) {
      warnings.push(`data file "${spec.path}" is declared more than once — only the first is emitted`);
      continue;
    }
    seen.add(spec.path);

    let rows: unknown[];
    if (spec.dataset) {
      const matching = Object.prototype.hasOwnProperty.call(entries, spec.dataset)
        // eslint-disable-next-line security/detect-object-injection -- own-property-guarded, author-declared dataset name
        ? (entries[spec.dataset] ?? [])
        : [];
      if (matching.length === 0) {
        warnings.push(`data file "${spec.path}": dataset "${spec.dataset}" has no published entries — emitting an empty list`);
      }
      rows = matching.map((e) => project(e.values ?? {}, spec.fields));
      if (resolveAssetUrl) {
        const size = spec.size ?? 'md';
        const byUrl = new Map(media.map((m) => [m.url, m]));
        rows = rows.map((r) => rewriteAssetUrls(r, byUrl, (asset) => resolveAssetUrl(asset, size)) as Record<string, unknown>);
      }
    } else {
      // A typed predicate, so the `width`/`height` reads below narrow to the image variant of the
      // MediaAsset union rather than needing a cast.
      const isImageInFolder = (m: MediaAsset): m is ImageAsset => m.kind === 'image' && (m.folder ?? '') === spec.folder;
      const inFolder = media.filter(isImageInFolder);
      if (inFolder.length === 0) {
        warnings.push(`data file "${spec.path}": media folder "${spec.folder}" has no images — emitting an empty list`);
      }
      const size = spec.size ?? 'md';
      rows = inFolder.map((m) => ({
        url: resolveAssetUrl ? resolveAssetUrl(m, size) : m.url,
        alt: m.alt ?? '',
        ...(typeof m.width === 'number' ? { width: m.width } : {}),
        ...(typeof m.height === 'number' ? { height: m.height } : {}),
      }));
    }

    const json = JSON.stringify(rows);
    const bytes = Buffer.byteLength(json);
    if (bytes > MAX_DATA_FILE_BYTES) {
      warnings.push(
        `data file "${spec.path}" is ${bytes} bytes, over the ${MAX_DATA_FILE_BYTES}-byte limit — not emitted (narrow it with fields=, or split the source)`,
      );
      continue;
    }
    files.push({ path: spec.path, json, rows: rows.length });
  }

  return { files, warnings };
}

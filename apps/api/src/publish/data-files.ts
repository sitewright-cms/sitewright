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
export function buildDataFiles({ specs, entries, media }: BuildDataFilesInput): BuildDataFilesResult {
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
    } else {
      // A typed predicate, so the `width`/`height` reads below narrow to the image variant of the
      // MediaAsset union rather than needing a cast.
      const isImageInFolder = (m: MediaAsset): m is ImageAsset => m.kind === 'image' && (m.folder ?? '') === spec.folder;
      const inFolder = media.filter(isImageInFolder);
      if (inFolder.length === 0) {
        warnings.push(`data file "${spec.path}": media folder "${spec.folder}" has no images — emitting an empty list`);
      }
      rows = inFolder.map((m) => ({
        url: m.url,
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

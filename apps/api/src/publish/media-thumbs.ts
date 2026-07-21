import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  THUMB_SIZES,
  DEFAULT_SIZE,
  isSizeToken,
  isThumbFormat,
  isThumbnailable,
  isSvgFile,
  thumbFileName,
  generateThumbnail,
  type SizeToken,
  type ThumbFormat,
} from '@sitewright/image-pipeline';
import type { MediaAsset } from '@sitewright/schema';
import { flatMediaName } from './asset-alias.js';

/**
 * Publish-time thumbnail materialization + FLAT media-URL rewrite.
 *
 * The rendered site references images through the DELIVERY route
 * (`/media/<slug>/<id>/<name>?size=<sm|md|lg|xl>&format=<webp|avif>`, or bare ⇒ `xl`), and raw files
 * through `/media/<slug>/<id>/file/<name>`. A dumb static host can neither run our thumbnailer nor
 * honour a `?size=` query, so at build time we:
 *  1. REWRITE every such URL to a concrete FLAT static file under a single `_assets/` directory —
 *     `_assets/<alias>-<name>-<size>.<fmt>` (a thumbnail) or `_assets/<alias>-<name>.<ext>` (an
 *     original / svg / raw file) — recording which `(asset, size, format)` combinations the output
 *     actually references, and
 *  2. GENERATE exactly those thumbnails (plus any explicitly-referenced originals) from the retained
 *     original into that same flat `_assets/` dir.
 *
 * Result: a never-previewed export is still COMPLETE (every referenced variant is produced) and
 * MINIMAL (only referenced variants of referenced assets — not an eager fan-out), and it ships as ONE
 * flat directory (fast to SFTP/FTP — one `mkdir` instead of one-folder-per-asset). The `<alias>-`
 * prefix (see `asset-alias.ts`) keeps two same-named assets from colliding in the flat namespace.
 */

/** The published directory that holds each project's bundled asset binaries (flat). */
const ASSET_DIR = '_assets';

/** A referenced-thumbnail accumulator, keyed by asset id. `thumbs` holds `"<size>:<format>"` keys. */
export type ThumbRefs = Map<string, { thumbs: Set<string>; original: boolean }>;

/** Resolves an asset id to its stable flat-file alias (see `asset-alias.ts`). */
export type AliasFn = (id: string) => string;

function bucket(refs: ThumbRefs, id: string): { thumbs: Set<string>; original: boolean } {
  let b = refs.get(id);
  if (!b) {
    b = { thumbs: new Set(), original: false };
    refs.set(id, b);
  }
  return b;
}

/** Record a referenced thumbnail `(id, size, format)`. */
export function addThumbRef(refs: ThumbRefs, id: string, size: SizeToken, format: ThumbFormat): void {
  bucket(refs, id).thumbs.add(`${size}:${format}`);
}

/** Record that an asset's raw ORIGINAL is referenced (a `size=original` link, an svg, or a favicon source). */
export function addOriginalRef(refs: ThumbRefs, id: string): void {
  bucket(refs, id).original = true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse `size`/`format` out of a raw query string (`?size=lg&format=avif`). */
function parseQuery(query: string): { size: SizeToken | 'original'; format: ThumbFormat } {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const rawSize = params.get('size');
  const rawFormat = params.get('format');
  const size: SizeToken | 'original' =
    rawSize === 'original' ? 'original' : rawSize && isSizeToken(rawSize) ? rawSize : DEFAULT_SIZE;
  const format: ThumbFormat = rawFormat && isThumbFormat(rawFormat) ? rawFormat : 'webp';
  return { size, format };
}

/**
 * Resolve one image/raw media DELIVERY path (`<id>/<name>` or `<id>/file/<name>`, no leading slug) to
 * its FLAT bundled file name (`<alias>-<name…>`). Records an ORIGINAL ref for svg (so materialize
 * copies it). Returns just the flat basename (no `_assets/` prefix). `undefined` when the shape is not
 * a recognised `<id>/…<name>` path. Used by the head/SEO `rel()` fallback (never runs `?size=`).
 */
function resolveFlatFile(rest: string, refs: ThumbRefs, alias: AliasFn): string | undefined {
  const slash = rest.indexOf('/');
  if (slash <= 0) return undefined;
  const id = rest.slice(0, slash);
  let name = rest.slice(slash + 1);
  const isRaw = name.startsWith('file/');
  if (isRaw) name = name.slice('file/'.length);
  if (!name || name.includes('/')) return undefined; // no further nesting is expected
  const a = alias(id);
  if (!isRaw && isSvgFile(name)) addOriginalRef(refs, id);
  return flatMediaName(a, name);
}

/**
 * Rewrite every `/media/<slug>/…` DELIVERY url in `html` to its FLAT page-relative bundled path
 * (`<siteRoot>_assets/<alias>-<name…>`), recording the referenced `(asset, size, format)` set into
 * `refs`. Handles image thumbnails (`?size=&format=`), `size=original`, svg, raw `/file/<name>`
 * downloads, and bare non-image refs — i.e. the single pass that both maps `?size=` → a static
 * thumbnail name AND rebases `/media/<slug>/` → `_assets/`.
 */
export function rewriteMediaUrlsFlat(
  html: string,
  projectSlug: string,
  siteRoot: string,
  refs: ThumbRefs,
  alias: AliasFn,
): string {
  const prefix = `/media/${projectSlug}/`;
  const assetRoot = `${siteRoot}${ASSET_DIR}/`;
  // <id>/[file/]<name>[?query] — char classes exclude the delimiters that end a URL token (quotes,
  // whitespace, ')', ',', '>'), so a match never runs past its own URL.
  const re = new RegExp(
    `${escapeRegExp(prefix)}([A-Za-z0-9_-]+)/(file/)?([A-Za-z0-9_.-]+)(\\?[A-Za-z0-9=&%_-]*)?`,
    'g',
  );
  return html.replace(re, (_whole, id: string, rawSeg: string | undefined, name: string, query: string | undefined) => {
    const a = alias(id);
    // RAW download (`/file/<name>`) — copied verbatim by copyMedia; drop the query.
    if (rawSeg) return `${assetRoot}${flatMediaName(a, name)}`;
    if (isSvgFile(name)) {
      addOriginalRef(refs, id);
      return `${assetRoot}${flatMediaName(a, name)}`;
    }
    if (!isThumbnailable(name)) return `${assetRoot}${flatMediaName(a, name)}`;
    const { size, format } = parseQuery(query ?? '');
    if (size === 'original') {
      addOriginalRef(refs, id);
      return `${assetRoot}${flatMediaName(a, name)}`;
    }
    addThumbRef(refs, id, size, format);
    return `${assetRoot}${flatMediaName(a, thumbFileName(name, size, format))}`;
  });
}

/**
 * Resolve a single media IMAGE url (e.g. an og:image / logo) to its bundled FLAT thumbnail path at
 * `size`, recording the ref. Non-media urls return undefined (caller handles the fallback). Used for
 * head/SEO values that are rebased BEFORE the page HTML is assembled (so the body rewrite never sees
 * them).
 */
export function resolveThumbForHead(
  src: string,
  mediaPrefix: string,
  assetRoot: string,
  size: SizeToken,
  format: ThumbFormat,
  refs: ThumbRefs,
  alias: AliasFn,
): string | undefined {
  if (!src.startsWith(mediaPrefix)) return undefined;
  const rest = src.slice(mediaPrefix.length);
  const q = rest.indexOf('?');
  const clean = q >= 0 ? rest.slice(0, q) : rest;
  const slash = clean.indexOf('/');
  if (slash < 0) return undefined;
  const id = clean.slice(0, slash);
  const name = clean.slice(slash + 1);
  if (!id || name.includes('/')) return undefined;
  const a = alias(id);
  // A vector (SVG) head/SEO image (og:image / logo) is copied verbatim — no thumbnail variant.
  if (isSvgFile(name)) {
    addOriginalRef(refs, id);
    return `${assetRoot}${flatMediaName(a, name)}`;
  }
  if (!name || !isThumbnailable(name)) return undefined;
  addThumbRef(refs, id, size, format);
  return `${assetRoot}${flatMediaName(a, thumbFileName(name, size, format))}`;
}

/**
 * Rebase a NON-image head/SEO media url (rare: a `rel()` fallback for a media value the thumbnail
 * resolver declined) to its flat bundled path. Returns undefined for a non-media / malformed url so
 * the caller can fall back to the generic internal-url rebase.
 */
export function rebaseMediaHeadUrl(
  src: string,
  mediaPrefix: string,
  assetRoot: string,
  refs: ThumbRefs,
  alias: AliasFn,
): string | undefined {
  if (!src.startsWith(mediaPrefix)) return undefined;
  const flat = resolveFlatFile(src.slice(mediaPrefix.length), refs, alias);
  return flat ? `${assetRoot}${flat}` : undefined;
}

/**
 * Generate every referenced thumbnail (and copy every referenced original) from retained originals
 * into the FLAT `<base>/_assets/` dir as `<alias>-<name…>`. Path-confined to `base`. A missing
 * original is tolerated (that image simply 404s, exactly as a missing variant did before) — any other
 * I/O error fails the build.
 */
export async function materializeImageThumbs(
  base: string,
  media: readonly MediaAsset[],
  refs: ThumbRefs,
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
  alias: AliasFn,
): Promise<void> {
  const dir = join(base, ASSET_DIR);
  if (!resolve(dir).startsWith(base + sep)) return; // defensive
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant `_assets` under base
  await mkdir(dir, { recursive: true });

  const writeConfined = async (file: string, data: Buffer): Promise<void> => {
    const target = resolve(dir, file);
    if (!target.startsWith(resolve(dir) + sep)) return; // defensive
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets
    await writeFile(target, data);
  };

  for (const [assetId, want] of refs) {
    const asset = media.find((a) => a.id === assetId && a.kind === 'image');
    if (!asset || asset.kind !== 'image') continue;
    const a = alias(assetId);
    let original: Buffer;
    try {
      original = await readMedia(assetId, asset.original);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }

    if (want.original) await writeConfined(flatMediaName(a, asset.original), original);

    for (const key of want.thumbs) {
      const [size, format] = key.split(':') as [SizeToken, ThumbFormat];
      const width = THUMB_SIZES[size];
      if (!width) continue;
      const { buffer } = await generateThumbnail(original, { width, format });
      await writeConfined(flatMediaName(a, thumbFileName(asset.original, size, format)), buffer);
    }
  }
}

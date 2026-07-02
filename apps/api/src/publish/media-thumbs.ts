import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  THUMB_SIZES,
  DEFAULT_SIZE,
  isSizeToken,
  isThumbFormat,
  isThumbnailable,
  thumbFileName,
  generateThumbnail,
  type SizeToken,
  type ThumbFormat,
} from '@sitewright/image-pipeline';
import type { MediaAsset } from '@sitewright/schema';

/**
 * Publish-time thumbnail materialization.
 *
 * The rendered site references images through the DELIVERY route
 * (`/media/<slug>/<id>/<name>?size=<sm|md|lg|xl>&format=<webp|avif>`, or bare ⇒ `xl`). A dumb
 * static host can neither run our thumbnailer nor honour a `?size=` query, so at build time we:
 *  1. REWRITE every such URL to a concrete static thumbnail file name (`<name>-<size>.<fmt>`),
 *     recording which `(asset, size, format)` combinations the output actually references, and
 *  2. GENERATE exactly those thumbnails (plus any explicitly-referenced originals) from the retained
 *     original into `_assets/<id>/`.
 *
 * Result: a never-previewed export is still COMPLETE (every referenced variant is produced) and
 * MINIMAL (only referenced variants of referenced assets — not an eager fan-out).
 *
 * The `/media/<slug>/` → `_assets/` prefix rebase is left to the caller's existing flat replace;
 * these functions only touch the trailing `<name>?query` portion and keep the `/media/<slug>/`
 * prefix so that later rebase still fires.
 */

/** A referenced-thumbnail accumulator, keyed by asset id. `thumbs` holds `"<size>:<format>"` keys. */
export type ThumbRefs = Map<string, { thumbs: Set<string>; original: boolean }>;

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

/** Record that an asset's raw ORIGINAL is referenced (a `size=original` link or a favicon source). */
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
 * Rewrite every image DELIVERY URL in `html` to its static thumbnail (or original) file name,
 * recording the referenced `(asset, size, format)` set into `refs`. Non-image `/media/…` refs
 * (fonts, CSS, JS, `/file/` downloads) and non-thumbnailable names are left untouched.
 */
export function rewriteMediaThumbUrls(html: string, projectSlug: string, refs: ThumbRefs): string {
  const prefix = `/media/${projectSlug}/`;
  // <id>/<name>[?query] — name/query char classes exclude the delimiters that end a URL token
  // (quotes, whitespace, ')', ',', '>'), so a match never runs past its own URL.
  const re = new RegExp(`${escapeRegExp(prefix)}([A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+)(\\?[A-Za-z0-9=&%_-]*)?`, 'g');
  return html.replace(re, (whole, id: string, name: string, query: string | undefined) => {
    if (!isThumbnailable(name)) return whole; // font/css/js/`file`/pdf — leave for the plain rebase
    const { size, format } = parseQuery(query ?? '');
    if (size === 'original') {
      addOriginalRef(refs, id);
      return `${prefix}${id}/${name}`; // strip query; original copied as-is at materialize
    }
    addThumbRef(refs, id, size, format);
    return `${prefix}${id}/${thumbFileName(name, size, format)}`;
  });
}

/**
 * Resolve a single media IMAGE url (e.g. an og:image / logo) to its bundled thumbnail path at
 * `size`, recording the ref. Non-media urls return undefined (caller handles the fallback). Used
 * for head/SEO values that are rebased BEFORE the page HTML is assembled (so the body rewrite
 * above never sees them).
 */
export function resolveThumbForHead(
  src: string,
  mediaPrefix: string,
  assetRoot: string,
  size: SizeToken,
  format: ThumbFormat,
  refs: ThumbRefs,
): string | undefined {
  if (!src.startsWith(mediaPrefix)) return undefined;
  const rest = src.slice(mediaPrefix.length);
  const q = rest.indexOf('?');
  const clean = q >= 0 ? rest.slice(0, q) : rest;
  const slash = clean.indexOf('/');
  if (slash < 0) return undefined;
  const id = clean.slice(0, slash);
  const name = clean.slice(slash + 1);
  if (!id || !name || name.includes('/') || !isThumbnailable(name)) return undefined;
  addThumbRef(refs, id, size, format);
  return `${assetRoot}${id}/${thumbFileName(name, size, format)}`;
}

/**
 * Generate every referenced thumbnail (and copy every referenced original) from retained originals
 * into `<base>/_assets/<id>/`. Path-confined to `base`. A missing original is tolerated (that image
 * simply 404s, exactly as a missing variant did before) — any other I/O error fails the build.
 */
export async function materializeImageThumbs(
  base: string,
  media: readonly MediaAsset[],
  refs: ThumbRefs,
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
): Promise<void> {
  const ASSET_DIR = '_assets';
  for (const [assetId, want] of refs) {
    const asset = media.find((a) => a.id === assetId && a.kind === 'image');
    if (!asset || asset.kind !== 'image') continue;
    let original: Buffer;
    try {
      original = await readMedia(assetId, asset.original);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    const dir = join(base, ASSET_DIR, assetId);
    if (!resolve(dir).startsWith(base + sep)) continue; // defensive: validated id can't escape
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets/<id>
    await mkdir(dir, { recursive: true });

    const writeConfined = async (file: string, data: Buffer): Promise<void> => {
      const target = resolve(dir, file);
      if (!target.startsWith(resolve(dir) + sep)) return; // defensive
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets/<id>
      await writeFile(target, data);
    };

    if (want.original) await writeConfined(asset.original, original);

    for (const key of want.thumbs) {
      const [size, format] = key.split(':') as [SizeToken, ThumbFormat];
      const width = THUMB_SIZES[size];
      if (!width) continue;
      const { buffer } = await generateThumbnail(original, { width, format });
      await writeConfined(thumbFileName(asset.original, size, format), buffer);
    }
  }
}

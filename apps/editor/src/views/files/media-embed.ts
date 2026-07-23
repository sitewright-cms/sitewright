import type { MediaAsset } from '@sitewright/schema';

/**
 * One copyable delivery URL for an asset, with a short human hint of what it is. `url` is always the
 * ROOT-RELATIVE `/media/…` route — exactly what you paste into page code (`<img src>`, `data-sw-src`,
 * `{{sw-image}}`); the publisher rewrites it to the flat `_assets/` layout on deploy.
 */
export interface EmbedUrl {
  /** Short label for the copy chip (e.g. `URL`, `Original`, `sm`). */
  label: string;
  /** One-line description of this variant. */
  hint: string;
  /** The root-relative delivery URL to copy. */
  url: string;
}

// Named thumbnail widths — mirrors the image pipeline's THUMB_SIZES (500/1000/1600/2400). The server
// serves each `?size=<token>` on demand; publish materializes only the referenced files. Keep in sync
// with packages/blocks/src/image-helper.ts SIZE_WIDTHS.
const SIZE_WIDTHS = { sm: 500, md: 1000, lg: 1600, xl: 2400 } as const;
const SIZE_ORDER = ['sm', 'md', 'lg', 'xl'] as const;
type SizeToken = (typeof SIZE_ORDER)[number];

/**
 * The set of copyable URLs to offer for `asset`, in the order they should be shown.
 *
 * - A raster image → the default responsive `URL`, the raw `Original` (`?size=original`), and the
 *   thumbnail `?size=` rungs up to the first that reaches the source width (no pointless upscales).
 * - An SVG image → a single `URL` (a vector scales natively; it has no `?size=` thumbnails).
 * - Any non-image file (PDF, font, stylesheet, script, …) → a single `URL` (its download/inline route).
 */
export function assetEmbedUrls(asset: MediaAsset): EmbedUrl[] {
  const base = asset.url;
  if (asset.kind !== 'image') {
    return [{ label: 'URL', hint: kindHint(asset), url: base }];
  }
  // A vector has no rasterized thumbnails — the one URL is the file itself.
  if (asset.format === 'svg') {
    return [{ label: 'URL', hint: 'vector — scales natively', url: base }];
  }
  const urls: EmbedUrl[] = [
    { label: 'URL', hint: 'responsive delivery — use this in code', url: base },
    { label: 'Original', hint: `source · ${asset.width}×${asset.height}`, url: `${base}?size=original` },
  ];
  // Rungs from `sm` up to the FIRST size that reaches/exceeds the source width — the same clamp the
  // {{sw-image}} srcset uses, so an author is never offered an upscaled thumbnail. The chip LABEL is
  // uppercased (SM/MD/LG/XL) for display; the `?size=` token stays lowercase (what the server expects).
  for (const token of SIZE_ORDER) {
    const width = Math.min(SIZE_WIDTHS[token], asset.width);
    urls.push({ label: token.toUpperCase(), hint: `${width}px wide`, url: `${base}?size=${token}` });
    if (SIZE_WIDTHS[token] >= asset.width) break;
  }
  return urls;
}

/** A short description of a non-image asset's single URL, by kind. */
function kindHint(asset: Exclude<MediaAsset, { kind: 'image' }>): string {
  switch (asset.kind) {
    case 'file':
      return `${asset.contentType} · download`;
    case 'font':
      return `font · ${asset.family}`;
    case 'stylesheet':
      return 'stylesheet';
    case 'script':
      return 'script';
    default: {
      // Exhaustiveness guard — a new asset kind must add its own hint.
      const _never: never = asset;
      return _never;
    }
  }
}

// Exposed for tests.
export const __embed = { SIZE_WIDTHS, SIZE_ORDER } as const;
export type { SizeToken };

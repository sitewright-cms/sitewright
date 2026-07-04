/**
 * The bounded, NAMED responsive size set for on-demand thumbnails.
 *
 * A fixed, named set (not an arbitrary `?w=<n>`) is the security boundary for the
 * generate-on-request endpoint: a caller can only ever materialise 4 widths × 2 formats
 * per asset, so an attacker cannot fan out unbounded encodes. Widths are the target box
 * width in CSS pixels; the source is NEVER upscaled (a size larger than the source clamps
 * to the source width).
 */
export type SizeToken = 'sm' | 'md' | 'lg' | 'xl';

/** Delivery formats a thumbnail can be encoded as. WebP is the universal default; AVIF is opt-in. */
export type ThumbFormat = 'webp' | 'avif';

/** Named width for each size token (px). */
export const THUMB_SIZES: Record<SizeToken, number> = { sm: 500, md: 1000, lg: 1600, xl: 2400 };

/** All size tokens, smallest → largest. */
export const SIZE_TOKENS: readonly SizeToken[] = ['sm', 'md', 'lg', 'xl'];

/**
 * The implicit default size of the DELIVERY route (`/media/<slug>/<id>/<name>` with no
 * `size=`). `xl` — the largest bounded width — so a copied/pasted media URL is compressed
 * by default and never serves the uncapped original. `size=original` is the explicit opt-out.
 */
export const DEFAULT_SIZE: SizeToken = 'xl';

/** All delivery formats. */
export const THUMB_FORMATS: readonly ThumbFormat[] = ['webp', 'avif'];

/**
 * Raster image extensions we thumbnail. SVG is intentionally excluded: librsvg resolves
 * remote references inside SVG (an SSRF vector), so SVGs are never routed through sharp.
 */
export const THUMBNAILABLE_EXTS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'tiff',
]);

/** Type guard: is `v` one of the named size tokens? */
export function isSizeToken(v: string): v is SizeToken {
  return Object.prototype.hasOwnProperty.call(THUMB_SIZES, v);
}

/** Type guard: is `v` a supported delivery format? */
export function isThumbFormat(v: string): v is ThumbFormat {
  return v === 'webp' || v === 'avif';
}

/** True if `filename`'s extension is a raster image we can thumbnail. */
export function isThumbnailable(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return THUMBNAILABLE_EXTS.has(filename.slice(dot + 1).toLowerCase());
}

/**
 * True if `filename` is an SVG. SVG is a `kind:'image'` asset but is NEVER thumbnailed (it is a
 * vector — it scales natively) and never routed through sharp; it is stored sanitized + served
 * inline verbatim. Callers use this to serve/materialize the SVG original instead of a raster thumb.
 */
export function isSvgFile(filename: string): boolean {
  return /\.svg$/i.test(filename);
}

/**
 * The on-disk / export file name for a thumbnail of `originalName` at `size` in `format`,
 * e.g. `photo.jpg` + `xl` + `webp` → `photo-xl.webp`. The stem is separated from the size
 * with `-` (never a `.`) so the result stays a single-extension name that matches the
 * media serve route's `SERVABLE_FILE` charset. Callers MUST pass a sanitized original name
 * (no interior dots) — the stored-original name always is.
 */
export function thumbFileName(originalName: string, size: SizeToken, format: ThumbFormat): string {
  const dot = originalName.lastIndexOf('.');
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}-${size}.${format}`;
}

// {{sw-image}} — responsive image markup for a project image. Given a DELIVERY url (the id-bearing
// `/media/<slug>/<id>/<name>` route), it resolves the asset's intrinsic dimensions + LQIP from the
// render context and emits a responsive `<img>` (WebP srcset) — or a `<picture>` with an AVIF tier
// when opted in. Rungs never exceed the source width (no upscaling), width/height prevent CLS, and a
// blur-up LQIP + loading=lazy improve perceived load. An unresolved/external url degrades to a plain
// lazy `<img>`. The server serves each `?size=` on demand; publish materializes the referenced files.
import { escapeAttr } from './escape.js';
import { safeUrl } from './url.js';
import type { RenderMedia } from './folder.js';

// Mirrors @sitewright/image-pipeline THUMB_SIZES / SIZE_TOKENS. Duplicated (not imported) so the pure,
// worker-safe blocks renderer stays free of the sharp-backed image-pipeline dependency. Keep in sync.
type SizeToken = 'sm' | 'md' | 'lg' | 'xl';
const SIZE_WIDTHS: Record<SizeToken, number> = { sm: 500, md: 1000, lg: 1600, xl: 2400 };
const SIZE_ORDER: readonly SizeToken[] = ['sm', 'md', 'lg', 'xl'];

const DEFAULT_SIZES_ATTR = '100vw';
const PLACEHOLDER_RE = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/;

export interface SwImageOptions {
  alt?: string;
  className?: string;
  /** The `sizes` attribute (how wide the image renders per breakpoint). Default `100vw`. */
  sizes?: string;
  loading?: 'lazy' | 'eager';
  /**
   * Resource priority hint. Left unset it defaults to `high` for an EAGER image (the author's
   * above-the-fold hero — the likely LCP element, so the browser should fetch it first) and is omitted
   * for a lazy image. Pass explicitly to override (e.g. `low`, or `auto` to emit nothing).
   */
  fetchpriority?: 'high' | 'low' | 'auto';
  /** 'webp' (default: single <img>) or 'avif' (a <picture> with an AVIF source above the WebP one). */
  format?: 'webp' | 'avif';
}

/**
 * The asset id inside a `/media/…` delivery url, or undefined. Handles BOTH the flat
 * `/media/<slug>/<id>-<name>` shape (id = the run before the first hyphen of the single file segment)
 * and the legacy `/media/<slug>/<id>/<file…>` shape (id = the whole 2nd segment, which may contain the
 * hyphens of an old uuid). A `?query` is ignored.
 */
export function mediaAssetId(ref: string): string | undefined {
  const path = ref.split('?')[0] ?? ref;
  const parts = path.split('/'); // ['', 'media', slug, seg, file?, …]
  if (parts[1] !== 'media' || parts.length < 4) return undefined;
  if (parts.length >= 5) return parts[3] || undefined; // legacy: a full <id> segment
  const seg = parts[3] ?? '';
  const dash = seg.indexOf('-'); // flat: <id>-<name>
  return dash > 0 ? seg.slice(0, dash) : undefined;
}

/** A display filename reduced to alt text: the trailing extension (if any) stripped. */
export function filenameAlt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** Resolve a delivery url (or the id inside it) to its project RenderMedia record, if any. */
export function resolveRenderImage(ref: string, media: readonly RenderMedia[]): RenderMedia | undefined {
  const byUrl = media.find((m) => m.url === ref);
  if (byUrl) return byUrl;
  const id = mediaAssetId(ref);
  return id ? media.find((a) => a.id === id) : undefined;
}

/**
 * Build responsive `<img>`/`<picture>` markup for image `url`, resolving intrinsic dims + LQIP from
 * `media`. Returns '' for an unsafe url.
 */
export function buildSwImage(url: string, media: readonly RenderMedia[], opts: SwImageOptions = {}): string {
  const src = safeUrl(url);
  if (!src) return '';
  const base = escapeAttr(src);
  const asset = resolveRenderImage(url, media);
  // Alt precedence: an explicit `alt` (incl. an intentional empty string) wins, then the asset's
  // stored alt, then its display FILENAME (extension stripped) — so a descriptively-named file gets
  // meaningful alt text for free (accessibility & SEO). Only a RESOLVED asset contributes the fallback.
  const alt = escapeAttr(opts.alt ?? asset?.alt ?? (asset ? filenameAlt(asset.filename) : ''));
  const cls = opts.className ? ` class="${escapeAttr(opts.className)}"` : '';
  const loading = opts.loading === 'eager' ? 'eager' : 'lazy';
  // An eager image is the author's above-the-fold hero → hint the browser it's the LCP candidate (fetch
  // it first), unless the caller overrode the priority. `auto` is the browser default, so emit nothing.
  const priority = opts.fetchpriority ?? (loading === 'eager' ? 'high' : undefined);
  const fp = priority && priority !== 'auto' ? ` fetchpriority="${priority}"` : '';

  // An SVG is a VECTOR — it scales natively, so it is served verbatim (no `?size=` thumbnail, no WebP/
  // AVIF srcset, no LQIP). Emit a plain <img>, carrying the intrinsic dims when known (no layout shift).
  if (/\.svg(?:$|\?)/i.test(src)) {
    const svgDims = asset && asset.kind === 'image' && asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : '';
    return `<img src="${base}" alt="${alt}"${svgDims} loading="${loading}" decoding="async"${fp}${cls}>`;
  }

  // Unresolved / external / dimensionless → a plain lazy <img> (no srcset/dims/LQIP available).
  if (!asset || asset.kind !== 'image' || !asset.width || !asset.height) {
    return `<img src="${base}" alt="${alt}" loading="${loading}" decoding="async"${fp}${cls}>`;
  }

  const { width, height } = asset as { width: number; height: number };
  const sizesAttr = escapeAttr(opts.sizes ?? DEFAULT_SIZES_ATTR);
  // Rungs from `sm` up to the FIRST size that reaches/exceeds the source width — so the browser can
  // fetch full source detail (that top rung is server-clamped to the source; its width descriptor is
  // the clamped value) without any rung being a pointless upscale beyond `xl` (2400, the delivery cap).
  const usable: SizeToken[] = [];
  for (const s of SIZE_ORDER) {
    usable.push(s);
    if (SIZE_WIDTHS[s] >= width) break;
  }
  const largest = usable[usable.length - 1]!;
  const descriptor = (s: SizeToken): number => Math.min(SIZE_WIDTHS[s], width);

  // WebP is the server default, so the WebP srcset needs no `&format=` (keeps the markup clean +
  // entity-free); the AVIF tier must request its format explicitly.
  const webpSrcset = usable.map((s) => `${base}?size=${s} ${descriptor(s)}w`).join(', ');
  const imgSrc = `${base}?size=${largest}`;
  const dims = `width="${width}" height="${height}"`;
  const safePlaceholder = asset.placeholder && PLACEHOLDER_RE.test(asset.placeholder) ? asset.placeholder : undefined;
  const lqip = safePlaceholder
    ? ` style="background-image:url('${safePlaceholder}');background-size:cover;background-repeat:no-repeat"`
    : '';

  if (opts.format === 'avif') {
    const avifSrcset = usable.map((s) => `${base}?size=${s}&format=avif ${descriptor(s)}w`).join(', ');
    return (
      '<picture>' +
      `<source type="image/avif" srcset="${avifSrcset}" sizes="${sizesAttr}">` +
      `<source type="image/webp" srcset="${webpSrcset}" sizes="${sizesAttr}">` +
      `<img src="${imgSrc}" alt="${alt}" ${dims} loading="${loading}" decoding="async"${fp}${cls}${lqip}>` +
      '</picture>'
    );
  }
  return (
    `<img src="${imgSrc}" srcset="${webpSrcset}" sizes="${sizesAttr}" alt="${alt}" ${dims} ` +
    `loading="${loading}" decoding="async"${fp}${cls}${lqip}>`
  );
}

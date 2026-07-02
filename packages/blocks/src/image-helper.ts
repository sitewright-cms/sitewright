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
  /** 'webp' (default: single <img>) or 'avif' (a <picture> with an AVIF source above the WebP one). */
  format?: 'webp' | 'avif';
}

/** Resolve a delivery url (or the id inside it) to its project RenderMedia record, if any. */
export function resolveRenderImage(ref: string, media: readonly RenderMedia[]): RenderMedia | undefined {
  const byUrl = media.find((m) => m.url === ref);
  if (byUrl) return byUrl;
  const m = /^\/media\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\//.exec(ref);
  const id = m?.[1];
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
  const alt = escapeAttr(opts.alt ?? asset?.alt ?? '');
  const cls = opts.className ? ` class="${escapeAttr(opts.className)}"` : '';
  const loading = opts.loading === 'eager' ? 'eager' : 'lazy';

  // Unresolved / external / dimensionless → a plain lazy <img> (no srcset/dims/LQIP available).
  if (!asset || asset.kind !== 'image' || !asset.width || !asset.height) {
    return `<img src="${base}" alt="${alt}" loading="${loading}" decoding="async"${cls}>`;
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
      `<img src="${imgSrc}" alt="${alt}" ${dims} loading="${loading}" decoding="async"${cls}${lqip}>` +
      '</picture>'
    );
  }
  return (
    `<img src="${imgSrc}" srcset="${webpSrcset}" sizes="${sizesAttr}" alt="${alt}" ${dims} ` +
    `loading="${loading}" decoding="async"${cls}${lqip}>`
  );
}

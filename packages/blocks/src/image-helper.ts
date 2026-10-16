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
const SVG_RE = /\.svg(?:$|\?)/i;

/** A RASTER project image whose intrinsic size is recorded — the only kind served as `?size=` rungs. */
export type SizedRenderImage = RenderMedia & { width: number; height: number };

/**
 * `asset` narrowed to an image that can be served responsively, or undefined: an unresolved asset, a
 * non-image, one with no recorded dimensions, or a VECTOR — an SVG scales natively and has no `?size=`
 * thumbnails. Vector-ness is read from BOTH the url being rendered and the record's filename, so an
 * SVG addressed by id through a url that doesn't end in `.svg` is still recognised.
 */
export function sizedRaster(src: string, asset: RenderMedia | undefined): SizedRenderImage | undefined {
  if (!asset || asset.kind !== 'image' || !asset.width || !asset.height) return undefined;
  if (SVG_RE.test(src) || SVG_RE.test(asset.filename)) return undefined;
  return asset as SizedRenderImage;
}

/** The `?size=` rungs of one raster image: the `<img src>` fallback plus a WebP and an AVIF srcset. */
export interface ResponsiveRungs {
  /** The `<img src>` fallback — the LARGEST usable rung (also what a lightbox link opens). */
  src: string;
  /** WebP srcset. WebP is the server default, so it needs no `&format=` (clean, entity-free markup). */
  webp: string;
  /** AVIF srcset for a `<picture>` tier — the format must be requested explicitly. */
  avif: string;
}

/**
 * The responsive rungs of a raster image at `base` whose source is `width` px wide — the ONE rung rule,
 * shared by {{sw-image}} and the `data-sw-src` directive (which rebuilds them when an editable image is
 * replaced, so a swapped photo is exactly as responsive as one written with the helper).
 *
 * Rungs run from `sm` up to the FIRST size that reaches/exceeds the source width — so the browser can
 * fetch full source detail (that top rung is server-clamped to the source; its width descriptor is the
 * clamped value) without any rung being a pointless upscale beyond `xl` (2400, the delivery cap).
 *
 * `base` is concatenated VERBATIM: the helper passes it attribute-escaped (it builds a markup string),
 * the directive passes it raw (it sets a parsed DOM attribute, which the serializer escapes).
 */
export function responsiveRungs(base: string, width: number): ResponsiveRungs {
  const usable: SizeToken[] = [];
  for (const s of SIZE_ORDER) {
    usable.push(s);
    if (SIZE_WIDTHS[s] >= width) break;
  }
  const largest = usable[usable.length - 1]!;
  const descriptor = (s: SizeToken): number => Math.min(SIZE_WIDTHS[s], width);
  return {
    src: `${base}?size=${largest}`,
    webp: usable.map((s) => `${base}?size=${s} ${descriptor(s)}w`).join(', '),
    avif: usable.map((s) => `${base}?size=${s}&format=avif ${descriptor(s)}w`).join(', '),
  };
}

/**
 * The blur-up LQIP to paint behind `asset`, or undefined — none recorded, a value that is not an inline
 * WebP data URI (it is interpolated into a CSS `url()`), or art with an ALPHA channel.
 *
 * NO BLUR-UP ON TRANSPARENT ART. The LQIP is painted as a background-image BEHIND the <img>, which
 * works only because an opaque photo covers it once decoded. On art with an alpha channel it shows
 * THROUGH the transparent pixels as a permanent coloured wash — a cut-out logo, an illustration or a
 * product shot ends up in a blurred rectangle. A clone hit this on every illustration on the page and
 * abandoned {{sw-image}} altogether, hand-authoring <img> with explicit width/height to get away from
 * it. `hasAlpha` is recorded by the image pipeline at import, so this is the actual condition rather
 * than an extension guess: an OPAQUE png keeps its placeholder, a transparent WebP correctly loses it.
 */
export function lqipPlaceholder(asset: RenderMedia): string | undefined {
  return !asset.hasAlpha && asset.placeholder && PLACEHOLDER_RE.test(asset.placeholder) ? asset.placeholder : undefined;
}

/** The inline style that paints an LQIP behind its image (`background-image` / `-size` / `-repeat`). */
export function lqipStyle(placeholder: string): string {
  return `background-image:url('${placeholder}');background-size:cover;background-repeat:no-repeat`;
}

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
  /**
   * Make the image REPLACEABLE in the editor: emits `data-sw-src="<key>"` on the `<img>`, so clicking
   * it in the preview opens the file picker and the choice is stored under that key.
   *
   * Without this, an author had to choose: a hand-written `<img data-sw-src>` that is editable but
   * ships one uncapped file to every device, or `{{sw-image}}` which is responsive but frozen. The
   * directive is a plain attribute on the element `{{sw-image}}` already emits, so an UNEDITED image
   * keeps its srcset, dimensions, LQIP and lazy-loading untouched.
   *
   * A REPLACED image: the directive (directives.ts) writes the new url into `src` — this helper emits
   * native `loading=lazy` + `src`, never the `data-src` of the lazyload runtime — and, when the new url
   * is a project raster image the render context knows, REBUILDS the art for it with the same rungs
   * this helper uses (srcset, `<picture>` sources, width/height, LQIP). An external url, an SVG or an
   * unknown asset has no rungs, so there the old art is dropped and the image ships as a plain `src`.
   */
  editable?: string;
  /**
   * Wrap the image in the `<a href><img>` pair a Lightbox gallery item is made of, with the href
   * pointing at the LARGEST usable variant while the thumbnail keeps its own responsive srcset.
   *
   * Why this belongs at RENDER time rather than in the lightbox runtime: publish materializes only the
   * `?size=` variants something actually references, so a runtime "swap the href up to xl" would link a
   * file the build never generated (a 404 on the deployed site). Emitting the href here puts `xl` in
   * the referenced set, so the build writes it.
   *
   * `sizes` should be set alongside this (e.g. `(min-width:640px) 33vw, 100vw`) so a grid thumbnail
   * picks the `sm`/`md` rung instead of the `100vw` default's largest.
   */
  lightbox?: boolean;
  /** Caption for the lightbox viewer (`data-caption` on the anchor). Only used with `lightbox`. */
  caption?: string;
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
  // The editable-leaf marker. Emitted on EVERY <img> branch below (svg, unresolved, responsive) so
  // "is this image replaceable" never depends on which branch the asset happens to take.
  const edit = opts.editable ? ` data-sw-src="${escapeAttr(opts.editable)}"` : '';

  // An SVG is a VECTOR — it scales natively, so it is served verbatim (no `?size=` thumbnail, no WebP/
  // AVIF srcset, no LQIP). Emit a plain <img>, carrying the intrinsic dims when known (no layout shift).
  if (SVG_RE.test(src)) {
    const svgDims = asset && asset.kind === 'image' && asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : '';
    return `<img src="${base}" alt="${alt}"${svgDims} loading="${loading}" decoding="async"${fp}${edit}${cls}>`;
  }

  // Unresolved / external / dimensionless (or a vector record behind a non-.svg url) → a plain lazy
  // <img> (no srcset/dims/LQIP available).
  const sized = sizedRaster(src, asset);
  if (!sized) {
    return `<img src="${base}" alt="${alt}" loading="${loading}" decoding="async"${fp}${edit}${cls}>`;
  }

  const sizesAttr = escapeAttr(opts.sizes ?? DEFAULT_SIZES_ATTR);
  const rungs = responsiveRungs(base, sized.width);
  const dims = `width="${sized.width}" height="${sized.height}"`;
  const placeholder = lqipPlaceholder(sized);
  const lqip = placeholder ? ` style="${lqipStyle(placeholder)}"` : '';

  // Gallery item: the anchor carries the FULL-detail variant (what the viewer opens), the <img> keeps
  // its responsive srcset (what the grid paints). `data-full` is what the lightbox reads first, so an
  // authored href is never second-guessed at runtime.
  const galleryWrap = (markup: string): string => {
    if (!opts.lightbox) return markup;
    const cap = opts.caption ? ` data-caption="${escapeAttr(opts.caption)}"` : '';
    return `<a href="${rungs.src}" data-full="${rungs.src}"${cap}>${markup}</a>`;
  };

  if (opts.format === 'avif') {
    return galleryWrap(
      '<picture>' +
        `<source type="image/avif" srcset="${rungs.avif}" sizes="${sizesAttr}">` +
        `<source type="image/webp" srcset="${rungs.webp}" sizes="${sizesAttr}">` +
        `<img src="${rungs.src}" alt="${alt}" ${dims} loading="${loading}" decoding="async"${fp}${edit}${cls}${lqip}>` +
        '</picture>',
    );
  }
  return galleryWrap(
    `<img src="${rungs.src}" srcset="${rungs.webp}" sizes="${sizesAttr}" alt="${alt}" ${dims} ` +
      `loading="${loading}" decoding="async"${fp}${edit}${cls}${lqip}>`,
  );
}

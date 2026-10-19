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
/** The characters that DELIMIT srcset candidates — a url carrying one could smuggle in a second candidate. */
const SRCSET_DELIMITER_RE = /[\s,]/;
const MEDIA_DIR_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const MEDIA_FILE_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Whether `url` has exactly the shape of a stored project media DELIVERY url — flat
 * `/media/<slug>/<id>-<name>` or legacy `/media/<slug>/<id>/<name>` (the media schema's url pattern,
 * minus its extension list) — and nothing else: no query, fragment, whitespace, comma, empty or extra
 * segment. Checked segment by segment, so no pattern ever backtracks over the (untrusted) input.
 */
export function isStrictMediaUrl(url: string): boolean {
  const parts = url.split('/'); // ['', 'media', slug, (id,)? file]
  if (parts.length < 4 || parts.length > 5 || parts[0] !== '' || parts[1] !== 'media') return false;
  const dirs = parts.slice(2, -1);
  return dirs.every((s) => MEDIA_DIR_SEGMENT_RE.test(s)) && MEDIA_FILE_SEGMENT_RE.test(parts[parts.length - 1]!);
}

/** Url → record and id → record lookups over one media list. */
export interface MediaIndex {
  byUrl: ReadonlyMap<string, RenderMedia>;
  byId: ReadonlyMap<string, RenderMedia>;
}

const mediaIndexCache = new WeakMap<readonly RenderMedia[], MediaIndex>();

/**
 * The lookup index of a media list, built ONCE per list and memoised on the array itself. Resolving by
 * `find` cost two full scans per miss, per image — and a page renders many images against a media list
 * that can run to tens of thousands of records. The first record wins a duplicate url/id, exactly as
 * `find` did. A render context's media list is never mutated, so the memo cannot go stale.
 */
export function mediaIndex(media: readonly RenderMedia[]): MediaIndex {
  const hit = mediaIndexCache.get(media);
  if (hit) return hit;
  const byUrl = new Map<string, RenderMedia>();
  const byId = new Map<string, RenderMedia>();
  for (const m of media) {
    if (!byUrl.has(m.url)) byUrl.set(m.url, m);
    if (m.id !== undefined && !byId.has(m.id)) byId.set(m.id, m);
  }
  const index: MediaIndex = { byUrl, byId };
  mediaIndexCache.set(media, index);
  return index;
}

/** A RASTER project image whose intrinsic size is recorded — the only kind served as `?size=` rungs. */
export type SizedRenderImage = RenderMedia & { width: number; height: number };

/**
 * `asset` narrowed to an image that can be served responsively, or undefined: an unresolved asset, a
 * non-image, one with no recorded dimensions, or a VECTOR — an SVG scales natively and has no `?size=`
 * thumbnails. Vector-ness is read from BOTH the url being rendered and the record's filename, so an
 * SVG addressed by id through a url that doesn't end in `.svg` is still recognised.
 *
 * A `src` containing whitespace or a comma never qualifies: the rungs are built by concatenating it, so
 * `/media/s/<id>/x.png 1w, https://elsewhere/p.png` (which still resolves, by its id segment) would
 * otherwise add a candidate of its own choosing to the srcset every visitor's browser picks from.
 */
export function sizedRaster(src: string, asset: RenderMedia | undefined): SizedRenderImage | undefined {
  if (!asset || asset.kind !== 'image' || !asset.width || !asset.height) return undefined;
  if (SVG_RE.test(src) || SVG_RE.test(asset.filename) || SRCSET_DELIMITER_RE.test(src)) return undefined;
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
   * So does ANY replacement of an image this helper rendered plain (its own url was an SVG, external or
   * unknown): there was no srcset to keep, and the new file ships as its bare url (the `xl` default).
   *
   * ALT on replacement: an `alt` passed here is the author's and is kept. Without one, the alt was
   * DERIVED from the old file ({@link derivedAlt}) and describes it, so the `<img>` also carries
   * {@link DERIVED_ALT_ATTR} and the directive re-derives the alt from the NEW file — on every path.
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

/**
 * The alt {{sw-image}} gives `asset` when the author passed no `alt=`: its stored alt (an intentional
 * empty one included), else its display FILENAME with the extension stripped — so a descriptively-named
 * file gets meaningful alt text for free — else '' for an unresolved (external/unknown) url. The ONE
 * rule, shared with the `data-sw-src` directive, which re-derives it when an editable image is replaced.
 */
export function derivedAlt(asset: RenderMedia | undefined): string {
  return asset ? (asset.alt ?? filenameAlt(asset.filename)) : '';
}

/**
 * Marks an editable {{sw-image}}'s `<img>` whose alt was DERIVED ({@link derivedAlt}) rather than
 * written — the one thing the directive pass cannot tell from the markup, and needs to: a derived alt
 * describes the file it came from, so when that file is replaced the alt must follow the new one, while
 * an alt the author wrote is theirs. An internal helper→directive-pass signal, never an authoring
 * directive: the pass consumes it and removes it on BOTH surfaces (directives.ts).
 */
export const DERIVED_ALT_ATTR = 'data-sw-auto-alt';

/** Resolve a delivery url (or the id inside it) to its project RenderMedia record, if any. */
export function resolveRenderImage(ref: string, media: readonly RenderMedia[]): RenderMedia | undefined {
  const index = mediaIndex(media);
  const byUrl = index.byUrl.get(ref);
  if (byUrl) return byUrl;
  const id = mediaAssetId(ref);
  return id ? index.byId.get(id) : undefined;
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
  // Alt precedence: an explicit `alt` (incl. an intentional empty string) wins, else it is DERIVED from
  // the asset (stored alt, then filename — see derivedAlt). Only a RESOLVED asset contributes.
  const alt = escapeAttr(opts.alt ?? derivedAlt(asset));
  const cls = opts.className ? ` class="${escapeAttr(opts.className)}"` : '';
  const loading = opts.loading === 'eager' ? 'eager' : 'lazy';
  // An eager image is the author's above-the-fold hero → hint the browser it's the LCP candidate (fetch
  // it first), unless the caller overrode the priority. `auto` is the browser default, so emit nothing.
  const priority = opts.fetchpriority ?? (loading === 'eager' ? 'high' : undefined);
  const fp = priority && priority !== 'auto' ? ` fetchpriority="${priority}"` : '';
  // The editable-leaf marker. Emitted on EVERY <img> branch below (svg, unresolved, responsive) so
  // "is this image replaceable" never depends on which branch the asset happens to take. A DERIVED alt
  // is flagged alongside it, so a replacement re-derives the alt instead of keeping the old file's.
  const edit = opts.editable
    ? ` data-sw-src="${escapeAttr(opts.editable)}"${opts.alt === undefined ? ` ${DERIVED_ALT_ATTR}` : ''}`
    : '';

  // An SVG is a VECTOR — it scales natively, so it is served verbatim (no `?size=` thumbnail, no WebP/
  // AVIF srcset, no LQIP). Emit a plain <img>, carrying the intrinsic dims when known (no layout shift).
  // Recognised by the url OR the resolved record's filename — an SVG addressed by id through a url that
  // doesn't end in `.svg` keeps its dims too.
  if (SVG_RE.test(src) || (asset !== undefined && SVG_RE.test(asset.filename))) {
    const svgDims = asset && asset.kind === 'image' && asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : '';
    return `<img src="${base}" alt="${alt}"${svgDims} loading="${loading}" decoding="async"${fp}${edit}${cls}>`;
  }

  // Unresolved / external / dimensionless (or a url carrying a srcset delimiter) → a plain lazy <img>
  // (no srcset/dims/LQIP available).
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

  // ONE responsive <img> for both deliveries. Under AVIF it is the <picture>'s fallback, and it keeps its own
  // WebP srcset + sizes: it used to ship as a bare `src` at the TOP rung (up to 2400px) — what a browser that
  // matches no <source> fetches, and exactly what the sizing audit (pagespeed_audit) flags as an oversized
  // image with no srcset. So AVIF looked like a performance regression and agents stopped opting in.
  const image =
    `<img src="${rungs.src}" srcset="${rungs.webp}" sizes="${sizesAttr}" alt="${alt}" ${dims} ` +
    `loading="${loading}" decoding="async"${fp}${edit}${cls}${lqip}>`;
  if (opts.format === 'avif') {
    return galleryWrap(
      '<picture>' +
        `<source type="image/avif" srcset="${rungs.avif}" sizes="${sizesAttr}">` +
        `<source type="image/webp" srcset="${rungs.webp}" sizes="${sizesAttr}">` +
        image +
        '</picture>',
    );
  }
  return galleryWrap(image);
}

// The `data-sw-*` editable-leaf directive pass — the hybrid model's core.
//
// Handlebars renders structure/loops/logic; an author marks EDITABLE leaves on real
// elements with `data-sw-*` attributes. This pass runs AFTER Handlebars (inside
// renderTemplate, in the isolated worker), parses the rendered body fragment, and binds
// each directive to its element with a single, context-correct SINK rule:
//
//   data-sw-text="key"      → element textContent          (from page.data[key]; serializer escapes)
//   data-sw-html="key"      → element innerHTML             (from page.data[key]; sanitizeRichHtml)
//   data-sw-href="key"      → anchor href                   (from page.data[key]; safeUrl)
//   data-sw-src="key"       → <img> src, OR `data-src` when the element opts into LAZY-loading (from page.data[key], OR a direct URL value — e.g. a dataset loop's {{sw-url image}}; safeUrl); a responsive image replaced by a project image gets its rungs rebuilt (ctx.media)
//   data-sw-bg="key"        → inline background-image style (safeUrl + cssUrlEscape), OR `data-bg` when LAZY (safeUrl; the lazyload runtime escapes the url() itself) (from page.data[key], OR a direct URL value — e.g. a dataset loop's {{sw-url image}})
//   data-sw-translate="key" → element textContent          (from the project TRANSLATION catalog — the pre-resolved per-locale `t` map; serializer escapes)
//
// LAZY-LOAD: when the element already carries the lazy-load attribute (`data-src` for an image,
// `data-bg` for a background — the vocabulary the lazyload.ts runtime copies into `src`/
// `background-image` on intersect), the directive writes the resolved URL THERE instead of the eager
// `src`/inline style. So an author opts an editable image into lazy-loading by adding a (possibly
// empty) `data-src`/`data-bg` attribute; data-sw-src/bg keep filling it from page.data.
//
// STORES: the text/html/href/src/bg directives read the PAGE's own store by default and the SITE-WIDE
// store on request. A BARE key (`data-sw-text="hero_h1"`, `data-sw-html="bio"`) is a top-level page.data
// property; a `page.data.<path>` key (`page.data.article_title`) is a nested page.data path; a
// `website.data.<path>` key reads the site-wide `website.data` object instead — one value shared by every
// page, and the only RICH editable leaf a chrome slot can reach (a slot is not a page, so it has no
// page.data; `data-sw-translate` is the other non-page store but it is plain text only). The value resolves to a STRING leaf
// (non-string / missing → keep the authored default). The retired `content`/`richContent` stores
// folded into page.data; `data-sw-html` is the one HTML sink and is always sanitized at render
// (`sanitizeRichHtml`), so storing raw HTML in generic page.data is safe — nothing is emitted unsanitized.
//
// `data-sw-translate` is the ONE exception: it reads the project i18n catalog (`website.translations`)
// rather than page.data, so the same key is SHARED across every page + locale. The render projection
// pre-resolves the catalog for the page's locale into a FLAT `t` map (key → string, defaultLocale
// fallback baked in, empties omitted — see resolveTranslations) and hands it here; a missing/empty key
// keeps the element's authored text (the untranslated fallback). Plain text, serializer-escaped.
//
// For the URL directives, an EMPTY stored value means "no override → keep the authored default"
// (you revert by clearing the field); only a non-empty, scheme-safe value replaces the default.
//
// Because we mutate PARSED DOM nodes (not interpolate into a string), there is no marker
// injection and no string-context escaping question — `data-sw-text` can't inject markup
// and `data-sw-html` is the one sink, gated by the sanitizer. When `preview` is set (editor
// render) the `data-sw-*` marker attributes are KEPT so the preview bridge can make them
// click-to-edit; on PUBLISH they are STRIPPED, leaving clean static HTML.
import { parseDocument } from 'htmlparser2';
import { Text, isTag, type Element } from 'domhandler';
import { findAll, removeElement } from 'domutils';
import render from 'dom-serializer';
import { sanitizeRichHtml } from './sanitize-rich.js';
import { safeUrl, cssUrlEscape } from './url.js';
import {
  isStrictMediaUrl,
  resolveRenderImage,
  sizedRaster,
  responsiveRungs,
  lqipPlaceholder,
  lqipStyle,
  type SizedRenderImage,
} from './image-helper.js';
import type { RenderMedia } from './folder.js';

/** Region keys that must never index a content map (prototype-pollution guard). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const TEXT_ATTR = 'data-sw-text';
const HTML_ATTR = 'data-sw-html';
const HREF_ATTR = 'data-sw-href';
const SRC_ATTR = 'data-sw-src';
const BG_ATTR = 'data-sw-bg';
const TRANSLATE_ATTR = 'data-sw-translate';
/**
 * Every directive attribute this pass recognizes — the canonical runtime SET. The authoring-reference
 * registry (`SW_DIRECTIVES` in @sitewright/schema) is pinned to it by a drift test, so a new/renamed
 * data-sw-* sink can't silently leave the Template reference stale. (`data-sw-entry` is NOT here — it
 * is stamped by the dataset {{#each}}, not processed by this pass.)
 */
export const DIRECTIVE_ATTRS = [TEXT_ATTR, HTML_ATTR, HREF_ATTR, SRC_ATTR, BG_ATTR, TRANSLATE_ATTR] as const;

/** The `page.data.` key prefix routes a directive to a NESTED path in the page's own `page.data` object. */
const DATA_PREFIX = 'page.data.';
/**
 * The `website.data.` key prefix routes a directive to a nested path in the SITE-WIDE `website.data`
 * store — one value shared by every page, editable in one place.
 *
 * Why this exists: the chrome slots (mainNav / footer / bottom) are not a page, so before this the ONLY
 * editable leaf reachable from them was `data-sw-translate`, which is plain TEXT. An author needing one
 * editable rich block in the footer or a global modal had to shred it into a pile of per-fragment
 * translate keys (a real clone did exactly that: one job-offer modal became six keys because the block
 * contained a list, a link and some bold). A `website.data.<path>` binding gives chrome a single
 * editable HTML region instead.
 *
 * Scoped deliberately to `website.data` — the author-owned bag — and NOT to arbitrary settings paths, so
 * a directive can never address `identity.colors` or a deploy secret.
 */
const WEBSITE_DATA_PREFIX = 'website.data.';

export interface DirectiveContext {
  /**
   * The page's own `page.data` object — the SINGLE store for every directive (text/html/href/src/bg):
   * a BARE key (`data-sw-text="k"`, `data-sw-html="bio"`) is a top-level `page.data` property; a
   * `page.data.<path>` key is a nested page.data path.
   */
  data?: Record<string, unknown>;
  /**
   * The SITE-WIDE `website.data` object — the store behind a `website.data.<path>` directive key. Shared
   * by every page and by the chrome slots, which have no page.data of their own. Absent → those keys
   * resolve to nothing and the authored default stands.
   */
  websiteData?: Record<string, unknown>;
  /**
   * The project TRANSLATION catalog pre-resolved for THIS page's locale — a flat `key → string` map
   * (defaultLocale fallback baked in, empties omitted; see resolveTranslations). The ONLY store
   * `data-sw-translate` reads (NOT page.data). Absent → every translate directive keeps its authored text.
   */
  t?: Record<string, unknown>;
  /**
   * The project's media (the slim render projection {{sw-image}} reads). Lets a `data-sw-src` override
   * that names a project RASTER image rebuild the responsive art for it — rungs, dimensions, LQIP —
   * instead of only dropping the old file's. Absent → every override takes the plain `src` swap.
   */
  media?: readonly RenderMedia[];
  /**
   * PREVIEW render: keep the `data-sw-*` marker attributes so the editor can make them
   * click-to-edit. Absent/false (PUBLISH) → strip every directive attribute from the output.
   */
  preview?: boolean;
}

/** Walks `page.data` to the STRING leaf at a dotted path (own-property per segment, proto-guarded). */
function dataLeaf(data: Record<string, unknown> | undefined, path: string): string | undefined {
  if (!data || path === '') return undefined;
  let cur: unknown = data;
  for (const seg of path.split('.')) {
    if (seg === '' || DANGEROUS_KEYS.has(seg)) return undefined;
    // Plain-object segments only (no array-index traversal) — symmetric with the editor's dataLeafGet.
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    // eslint-disable-next-line security/detect-object-injection -- own-property + DANGEROUS_KEYS guarded above
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** A top-level STRING property of `page.data` (own-property, proto-guarded) — the bare-key text/url store. */
function flatData(data: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!data || key === '' || DANGEROUS_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(data, key)) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- own-property + DANGEROUS_KEYS guarded above
  const v = data[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * The override string for a directive `key`, read from the single `page.data` store. A `page.data.<path>`
 * key reads `page.data` at that nested path; a BARE key reads a FLAT top-level `page.data` property.
 * Undefined → no override (keep the authored default).
 */
function resolveOverride(ctx: DirectiveContext, key: string): string | undefined {
  // Checked BEFORE the page.data prefix: the two are disjoint, but ordering it first keeps the
  // site-wide store readable from a chrome slot, which has no page.data at all.
  if (key.startsWith(WEBSITE_DATA_PREFIX))
    return dataLeaf(ctx.websiteData, key.slice(WEBSITE_DATA_PREFIX.length));
  if (key.startsWith(DATA_PREFIX)) return dataLeaf(ctx.data, key.slice(DATA_PREFIX.length));
  return flatData(ctx.data, key);
}

/** A direct URL/path value — `/media/…`, `./x`, `https:…`, `data:…` — vs a page.data KEY. Lets the URL
 *  directives (src/bg) carry an ALREADY-RESOLVED url, e.g. a dataset loop's `{{sw-url image}}`, so a
 *  background can be bound per-item (the validator forbids interpolating into `style`). */
const DIRECT_URL = /^(?:\/|\.{1,2}\/|https?:|data:)/i;

/** The URL for a src/bg directive: a `page.data` override if the key resolves to one, else the key itself
 *  when it is already a direct URL/path (a dataset/loop value). A bare non-URL key → undefined (default). */
function resolveUrlOverride(ctx: DirectiveContext, key: string): string | undefined {
  const stored = resolveOverride(ctx, key);
  if (stored !== undefined) return stored;
  return DIRECT_URL.test(key) ? key : undefined;
}

/**
 * Remove the declarations of a `style` attribute whose PROPERTY matches `drop`, keeping the rest.
 *
 * Splits on `;` only at nesting depth 0 and outside quotes — because a `background-image:url('data:
 * image/webp;base64,…')` contains a semicolon INSIDE its url(), and a naive `split(';')` cuts the data
 * URI in half and leaves `style="base64,…')"` behind. Same reason the property is matched against the
 * text BEFORE the first colon rather than with a `[^;]*` regex.
 */
function dropDeclarations(style: string, drop: RegExp): string {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (decl: string): void => {
    const trimmed = decl.trim();
    if (trimmed === '') return;
    const colon = trimmed.indexOf(':');
    if (colon > 0 && drop.test(trimmed.slice(0, colon).trim())) return;
    out.push(trimmed);
  };
  for (let i = 0; i < style.length; i++) {
    const ch = style[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      push(style.slice(start, i));
      start = i + 1;
    }
  }
  push(style.slice(start));
  return out.join('; ');
}

/** The declarations of the blur-up LQIP {{sw-image}} paints behind an image (see `lqipStyle`). */
const LQIP_DECLS = /^background-(image|size|repeat)$/i;

function hasAttr(el: Element, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(el.attribs, name);
}

/** The `<picture>` an `<img>` is the fallback of, if any. */
function pictureOf(el: Element): Element | undefined {
  const parent = el.parent;
  return parent && isTag(parent) && parent.name === 'picture' ? parent : undefined;
}

/** The `<source>`s competing with `el` inside its `<picture>` (none outside one). */
function pictureSources(el: Element): Element[] {
  return (pictureOf(el)?.children ?? []).filter((c): c is Element => isTag(c) && c.name === 'source');
}

/**
 * Point `el`'s LQIP at `placeholder` — or just remove it (undefined) — keeping every other declaration.
 * An element with no LQIP and nothing to add is left byte-identical.
 */
function setLqip(el: Element, placeholder: string | undefined): void {
  const style = el.attribs.style ?? '';
  if (!placeholder && !/background-image\s*:/i.test(style)) return;
  const next = [dropDeclarations(style, LQIP_DECLS), placeholder ? lqipStyle(placeholder) : '']
    .filter(Boolean)
    .join('; ');
  if (next) el.attribs.style = next;
  else delete el.attribs.style;
}

/**
 * After a `data-sw-src` override replaces an image's `src` with a url there are NO rungs for, remove the
 * OLD image's competing art.
 *
 * `{{sw-image}}` (and any hand-written responsive image) emits `srcset` + `sizes` alongside `src`, and a
 * blur-up LQIP as an inline `background-image`; `format=avif` wraps the whole thing in a `<picture>` with
 * its own `<source srcset>`. A browser picks a candidate from `srcset` — or from a matching `<source>` —
 * in PREFERENCE to `src`. So swapping only `src` left every one of those pointing at the previous file
 * and the picture never changed: clicking an editable {{sw-image}} in the editor, choosing a new photo,
 * and watching nothing happen. The override is authoritative, so everything describing the old file goes
 * — `data-srcset` too, which the lazyload runtime would otherwise swap in OVER the new `data-src`.
 *
 * This is the path for a replacement that is not a sized project raster image — an external url, an
 * SVG, an unknown asset, or a render with no media list. A project image is rebuilt instead
 * ({@link rebuildResponsiveArt}). Dropping costs this image its rungs (the browser fetches the one url
 * chosen), which is the right trade: a correctly-sized picture of the WRONG image is not an
 * optimization. The element's own width/height stay, since the replacement's are not known here.
 */
function dropStaleResponsiveArt(el: Element): void {
  delete el.attribs.srcset;
  delete el.attribs['data-srcset'];
  delete el.attribs.sizes;
  // The LQIP is painted BEHIND the image; left alone it flashes the old photo under the new one.
  setLqip(el, undefined);
  // <picture><source srcset>…<img data-sw-src> — a matching <source> outranks the <img> entirely.
  for (const source of pictureSources(el)) removeElement(source);
}

/**
 * The project image a `data-sw-src` override can REBUILD responsive art for — or undefined, and the
 * override takes the plain swap ({@link dropStaleResponsiveArt}). All of:
 *  - the element is an `<img>` that WAS responsive: a srcset / data-srcset of its own, or `<source>`s
 *    in its `<picture>`. A plain hand-written `<img data-sw-src>` never opted into rungs (it may carry
 *    a DISPLAY width/height, not the asset's), so it keeps exactly the markup its author wrote. So does
 *    an {{sw-image}} that rendered PLAIN — its default was an SVG, an external url or an unknown asset:
 *    a raster replacement there ships as the one bare url (the `xl` default), as it always has;
 *  - the url has EXACTLY the shape of a stored media url (`isStrictMediaUrl`). The override is
 *    editor-controlled page.data that has only passed `safeUrl`, and the id resolver is lenient — it
 *    reads the id segment of `/media/s/<id>/x.png 1w, https://elsewhere/p.png` too. Anything with a
 *    query, fragment, whitespace, comma, empty or extra segment never reaches the rebuild;
 *  - it resolves to a RASTER project image with recorded dimensions (not external, SVG or unknown) whose
 *    OWN url has that shape too — the rungs are built from the record's url, never the override string.
 */
function rebuildTarget(el: Element, url: string, media: readonly RenderMedia[] | undefined): SizedRenderImage | undefined {
  if (!media || el.name !== 'img' || !isStrictMediaUrl(url)) return undefined;
  if (!hasAttr(el, 'srcset') && !hasAttr(el, 'data-srcset') && pictureSources(el).length === 0) return undefined;
  const asset = sizedRaster(url, resolveRenderImage(url, media));
  return asset && isStrictMediaUrl(asset.url) ? asset : undefined;
}

/**
 * Rebuild a replaced image's art for the NEW project image — with {{sw-image}}'s own rung rule
 * (`responsiveRungs`), so a swapped photo is exactly as responsive as one written with the helper:
 * the `src` fallback (the top rung — a bare url would serve the 2400px default to every device), the
 * srcset, the `<picture>` sources, the new intrinsic width/height (the old ones size the box to the
 * previous photo's aspect — a layout shift) and the new LQIP (or none, as the helper decides). The
 * author's own attributes — `sizes`, `alt`, `class`, `loading`, `fetchpriority` — are not the art's,
 * and stay as written.
 *
 * LAZY (`data-src`): written in the lazyload runtime's vocabulary — `data-src` + `data-srcset`, which it
 * copies into `src`/`srcset` on intersect — and never as an eager `srcset`, which would fetch at load. A
 * lazy `<picture>` still loses its sources: the runtime cannot defer a `<source>`.
 */
function rebuildResponsiveArt(el: Element, asset: SizedRenderImage, lazy: boolean): void {
  // From the RECORD's canonical url (vetted by rebuildTarget), never the editor-supplied override.
  const rungs = responsiveRungs(asset.url, asset.width);
  const ownSrcset = hasAttr(el, 'srcset');
  const ownDataSrcset = hasAttr(el, 'data-srcset');
  let previous: string | undefined;
  if (lazy) {
    previous = el.attribs['data-src'];
    el.attribs['data-src'] = rungs.src;
    delete el.attribs.srcset;
    if (ownSrcset || ownDataSrcset) el.attribs['data-srcset'] = rungs.webp;
  } else {
    previous = el.attribs.src;
    el.attribs.src = rungs.src;
    if (ownSrcset) el.attribs.srcset = rungs.webp;
    if (ownDataSrcset) el.attribs['data-srcset'] = rungs.webp;
  }
  el.attribs.width = String(asset.width);
  el.attribs.height = String(asset.height);
  setLqip(el, lqipPlaceholder(asset));
  for (const source of pictureSources(el)) {
    const type = source.attribs.type;
    // An art-directed source (`media=`) is a different CROP of the old photo, and a type we don't
    // serve has no rung — both would outrank the <img> with the old file, so they go.
    const set =
      lazy || hasAttr(source, 'media') ? undefined : type === 'image/avif' ? rungs.avif : type === 'image/webp' ? rungs.webp : undefined;
    if (set) source.attribs.srcset = set;
    else removeElement(source);
  }
  // {{sw-image lightbox=true}}: `<a href data-full>` around the image, linking its own top rung. That
  // link must follow the image, or the viewer opens the PREVIOUS photo. Only a value that IS the old
  // src moves — an anchor the author pointed anywhere else is theirs, not the image's.
  const host = (pictureOf(el) ?? el).parent;
  if (previous && host && isTag(host) && host.name === 'a') {
    if (host.attribs.href === previous) host.attribs.href = rungs.src;
    if (host.attribs['data-full'] === previous) host.attribs['data-full'] = rungs.src;
  }
}

/**
 * The translated STRING for a `data-sw-translate` key, read from the pre-resolved per-locale `t` map
 * (own-property + proto-guarded). Undefined → no translation (keep the element's authored fallback text);
 * an empty cell is already omitted from `t`, so a present-but-empty value never blanks the element.
 */
function resolveTranslation(ctx: DirectiveContext, key: string): string | undefined {
  const t = ctx.t;
  if (!t || key === '' || DANGEROUS_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(t, key)) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- own-property + DANGEROUS_KEYS guarded above
  const v = t[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** Replaces an element's children with a single (serializer-escaped) text node. */
function setText(el: Element, value: string): void {
  const node = new Text(value);
  node.parent = el;
  node.prev = null;
  node.next = null;
  el.children = [node];
}

/** Replaces an element's children with the parsed nodes of an already-sanitized HTML string. */
function setHtml(el: Element, safeHtml: string): void {
  const kids = parseDocument(safeHtml, { decodeEntities: true }).children;
  let prev: (typeof kids)[number] | null = null;
  for (const kid of kids) {
    kid.parent = el;
    kid.prev = prev;
    kid.next = null;
    if (prev) prev.next = kid;
    prev = kid;
  }
  el.children = kids;
}

/**
 * Resolves the `data-sw-*` editable-leaf directives in a rendered HTML fragment. A no-op
 * (returns the input unchanged) when the fragment contains no directive — so non-editable
 * pages keep byte-identical output and pay nothing.
 */
export function resolveDirectives(html: string, ctx: DirectiveContext): string {
  if (typeof html !== 'string') return html;
  // Fast path: a non-editable, non-lazy page keeps byte-identical output and pays nothing. In PREVIEW
  // we also process pages that only carry lazy images (no directive), to eager-load them — see below.
  const hasDirective = html.includes('data-sw-');
  // Require both `<img` AND the lazy attr so a `loading="lazy"` mentioned in a <code> demo snippet
  // (the Sliders page has such chips) doesn't drag a non-editable preview page through the parse.
  const previewLazy = ctx.preview === true && html.includes('<img') && html.includes('loading="lazy"');
  if (!hasDirective && !previewLazy) return html;
  const doc = parseDocument(html, { decodeEntities: true });
  const targets = findAll(
    (el) => DIRECTIVE_ATTRS.some((attr) => Object.prototype.hasOwnProperty.call(el.attribs, attr)),
    doc.children,
  );
  for (const el of targets) {
    // Resolve a stored override per directive; when unset, the element's authored default
    // content is left in place. data-sw-html wins if both somehow appear on one element.
    // (TEXT_ATTR/HTML_ATTR are module-constant attribute names — not dynamic keys.)
    /* eslint-disable security/detect-object-injection -- constant attribute names */
    const textKey = el.attribs[TEXT_ATTR];
    if (typeof textKey === 'string') {
      const value = resolveOverride(ctx, textKey);
      if (value !== undefined) setText(el, value);
    }
    const htmlKey = el.attribs[HTML_ATTR];
    if (typeof htmlKey === 'string') {
      const value = resolveOverride(ctx, htmlKey);
      if (value !== undefined) setHtml(el, sanitizeRichHtml(value));
    }
    const hrefKey = el.attribs[HREF_ATTR];
    if (typeof hrefKey === 'string') {
      // Editable link URL: a non-empty override → href (scheme-sanitized); empty → keep the default.
      const value = resolveOverride(ctx, hrefKey);
      if (value !== undefined && value !== '') el.attribs.href = safeUrl(value, '#');
    }
    const srcKey = el.attribs[SRC_ATTR];
    if (typeof srcKey === 'string') {
      // Editable image: a non-empty override → <img src> (scheme-sanitized); empty → keep the
      // authored default (so clearing reverts, rather than producing a broken src=""). When the
      // element opts into LAZY-loading (it carries a `data-src` attr the lazyload runtime swaps into
      // `src` on intersect), fill THAT instead so data-sw-src works with deferred images. A responsive
      // image replaced by a known project raster image has its art REBUILT for the new file; any other
      // replacement drops the old file's art (see rebuildTarget).
      const value = resolveUrlOverride(ctx, srcKey);
      if (value !== undefined && value !== '') {
        const lazy = hasAttr(el, 'data-src');
        const url = safeUrl(value, '');
        const asset = rebuildTarget(el, url, ctx.media);
        if (asset) rebuildResponsiveArt(el, asset, lazy);
        else {
          el.attribs[lazy ? 'data-src' : 'src'] = url;
          dropStaleResponsiveArt(el);
        }
      }
    }
    const bgKey = el.attribs[BG_ATTR];
    if (typeof bgKey === 'string') {
      // Editable background image: a non-empty override → an inline `background-image:url('…')`,
      // scheme- AND CSS-url()-sanitized. We mutate the parsed style attribute (the serializer escapes
      // it), so there is no string-interpolation-into-style surface and no validateTemplate exception.
      // Empty → keep the authored default. (Publish rebases `/media/…` bg URLs via build.ts's
      // _assets step; a non-/media root-relative bg URL is not rebased — known sub-path-export gap.)
      const value = resolveUrlOverride(ctx, bgKey);
      if (value !== undefined && value !== '') {
        const safe = safeUrl(value, '');
        if (Object.prototype.hasOwnProperty.call(el.attribs, 'data-bg')) {
          // LAZY background: hand the resolved URL to the lazyload runtime via `data-bg` (it sets
          // `background-image` on intersect and escapes the url() itself) instead of an eager inline style.
          if (safe) el.attribs['data-bg'] = safe;
        } else {
          const css = cssUrlEscape(safe);
          if (css) {
            // Drop only the PREVIOUS background-image, keeping every other authored declaration. Parsed
            // declaration-wise rather than with `[^;]*`, which would cut an existing data-URI background
            // at the `;` inside its base64 payload and leave the tail behind as garbage CSS.
            const existing = dropDeclarations(el.attribs.style ?? '', /^background-image$/i);
            const prefix = existing ? `${existing}; ` : '';
            el.attribs.style = `${prefix}background-image:url('${css}')`;
          }
        }
      }
    }
    const trKey = el.attribs[TRANSLATE_ATTR];
    if (typeof trKey === 'string') {
      // Project translation: render the per-locale catalog value (escaped). Missing/empty → keep the
      // element's authored text (the untranslated fallback). Reads website.translations, not page.data.
      const value = resolveTranslation(ctx, trKey);
      if (value !== undefined) setText(el, value);
    }
    // Preview keeps the markers for the bridge; publish strips them for a clean artifact.
    if (!ctx.preview) {
      for (const attr of DIRECTIVE_ATTRS) {
        if (Object.prototype.hasOwnProperty.call(el.attribs, attr)) delete el.attribs[attr];
      }
    }
    /* eslint-enable security/detect-object-injection */
  }
  // Editor-only CONTROL chips ({{sw-control}}): KEPT in preview (the bridge turns each into an inline
  // editing widget), REMOVED entirely on publish so the marker + its placeholder never reach the output.
  if (!ctx.preview) {
    for (const el of findAll((e) => Object.prototype.hasOwnProperty.call(e.attribs, 'data-sw-control'), doc.children)) {
      removeElement(el);
    }
  }
  // EDITOR PREVIEW: force `loading="lazy"` images EAGER. Native lazy-load is unreliable inside the
  // preview iframe — images often never load (the viewport heuristic doesn't fire), AND when they do
  // they arrive AFTER a carousel/Embla has measured its (then-empty) slides, so the slider paints
  // blank. The editor should always show content; the published artifact keeps lazy (this pass is
  // preview-only). Native `loading` only; the data-src lazyload runtime is a separate opt-in.
  if (ctx.preview) {
    for (const img of findAll((e) => e.name === 'img' && e.attribs.loading === 'lazy', doc.children)) {
      img.attribs.loading = 'eager';
    }
  }
  // `encodeEntities: 'utf8'` escapes only the markup-significant chars (&,<,>, attr quotes) and keeps
  // non-ASCII literal — so a re-serialized data-sw-* element matches the rest of the page (e.g. German
  // "Geschäft" stays literal, not "Gesch&#xe4;ft").
  return render(doc, { encodeEntities: 'utf8' });
}

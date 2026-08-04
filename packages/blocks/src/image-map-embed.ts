// Render-time resolution of IMAGE MAP references, and the sanitizing boundary for a map's config.
//
// An author writes `{{sw-imagemap "floor-plan"}}` (or, code-first, `<div data-sw-imagemap="floor-plan">`)
// and this pass turns it into the component the runtime understands:
//
//   <div data-sw-component="image-map">
//     <img src="…" alt="…">                                   ← no-JS fallback, from artboard 1
//     <script type="application/json" data-sw-part="config">…  ← the config, as DATA
//   </div>
//
// WHY THE CONFIG IS A <script type="application/json"> BLOCK. It is large — a real map runs to
// hundreds of KB — so a data-* attribute would mean escaping the whole thing into an attribute
// value. A non-JavaScript script type is never executed and is not subject to `script-src`, which
// is why the platform already emits schema.org this way (head.ts). It is data, not code.
//
// SANITIZING. Three config values are authored MARKUP by design and reach the DOM unescaped in the
// runtime: a tooltip block's `text`, the YouTube block's `embedCode`, and an SVG region's
// `svg.html`. They are cleaned HERE, at the render sink — the same posture the platform takes for
// `data-sw-html` ("the render sink is authoritative", see ContentRepository.put). Doing it at
// render rather than on write also covers configs that arrived by import or predate the rule.
import { parseDocument } from 'htmlparser2';
import { findAll, textContent } from 'domutils';
import render from 'dom-serializer';
import type { Element } from 'domhandler';
import { isSvgShapeAttr, isSvgShapeTag } from '@sitewright/schema';
import { sanitizeSvg } from '@sitewright/image-pipeline/svg';
import { sanitizeRichHtml } from './sanitize-rich.js';
import { escapeAttr } from './escape.js';

/** The attribute an image-map reference is carried on. */
export const IMAGE_MAP_ATTR = 'data-sw-imagemap';

/** A stored map as the render surface supplies it: its config, plus the id it is addressed by. */
export interface RenderImageMap {
  id: string;
  /** The stored config object (schema: ImageMapSchema). */
  config: Record<string, unknown>;
}

export interface ImageMapEmbedContext {
  /** Stored maps keyed by entity id. ABSENT → image maps unsupported on this surface; the pass is
   *  a byte-identical no-op rather than an authoring error (mirrors resolveFormEmbeds). */
  imageMaps?: Record<string, RenderImageMap>;
  /** PREVIEW keeps the `data-sw-imagemap` marker (parity with the data-sw-* directives); publish
   *  strips it, leaving clean static HTML. */
  preview?: boolean;
}

/**
 * JSON safe to place inside a `<script>` element.
 *
 * Escaping `<`, `>` and `&` as \uXXXX (still valid JSON) neutralises `</script>`, `<!--` and
 * `<script>` breakouts while keeping the payload parseable. Same treatment head.ts gives JSON-LD.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * An SVG region's inner markup, sanitized.
 *
 * `sanitizeSvg` expects a whole `<svg>` document (it refuses anything without an `<svg` tag), while
 * a region carries only the INNER markup — a `<path>`, a `<g>`. Wrapping and unwrapping reuses that
 * audited sanitizer instead of growing a second one that would have to be kept in step with it.
 */
export function sanitizeSvgFragment(html: string): string {
  if (typeof html !== 'string' || html === '') return '';
  const wrapped = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${html}</svg>`);
  if (!wrapped) return '';
  const open = wrapped.indexOf('>');
  const close = wrapped.lastIndexOf('</svg>');
  return open === -1 || close === -1 || close < open ? '' : wrapped.slice(open + 1, close);
}

/**
 * An `svg` hotspot's element spec, with anything the runtime must not build stripped.
 *
 * ★ This is NOT a markup string — the runtime does `createElementNS(ns, tagName)` and then
 * `setAttribute(p.name, p.value)` for each property, so the config picks the element and every
 * attribute NAME. `tagName: "script"` builds an executable SVG script element and
 * `{name: "onload"}` sets an inline handler, and neither is a string a markup sanitizer would ever
 * inspect. An out-of-list tag degrades to `g` (an inert group) rather than dropping the hotspot,
 * so a bad value never silently removes content; out-of-list attributes are simply not set.
 */
function sanitizeSvgSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...spec };
  if ('tagName' in out) out.tagName = isSvgShapeTag(out.tagName) ? out.tagName : 'g';
  if (Array.isArray(out.properties)) {
    out.properties = out.properties.filter(
      (p): p is { name: string; value: unknown } =>
        isRecord(p) && isSvgShapeAttr(p.name) && typeof p.value === 'string',
    );
  }
  if (typeof out.html === 'string') out.html = sanitizeSvgFragment(out.html);
  return out;
}

/** Is this a plain object we should walk into? */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A deep copy of `config` with every author-authored markup value sanitized.
 *
 * Walks the whole config rather than the known paths: a map is a deep, recursive tree (artboards →
 * objects → nested group children → tooltip blocks), and a walk cannot miss a nesting depth the
 * way a hand-written path list can. The keys it acts on are exactly the three that reach the DOM
 * as markup; everything else is copied through untouched.
 */
export function sanitizeImageMapConfig(config: unknown): unknown {
  if (Array.isArray(config)) return config.map(sanitizeImageMapConfig);
  if (!isRecord(config)) return config;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    // `JSON.parse` happily produces an OWN "__proto__" property, and a plain `out[key] = …` for
    // that key runs the prototype setter instead of defining a property — so a stored config could
    // pollute Object.prototype for the whole render process. Not a legitimate config key; dropped.
    if (key === '__proto__') continue;

    let next: unknown;
    if (key === 'text' && typeof value === 'string') {
      // A tooltip block's rich text. (An OBJECT `text` is the text-object's style bag — it recurses
      // below like anything else, and its own inner `text` string is rendered with textContent.)
      next = sanitizeRichHtml(value);
    } else if (key === 'embedCode' && typeof value === 'string') {
      // A YouTube block's <iframe>. sanitizeRichHtml keeps https iframes and FORCES a sandbox.
      next = sanitizeRichHtml(value);
    } else if (key === 'svg' && isRecord(value)) {
      // An SVG hotspot's element spec: its `html`, plus the tagName/properties the runtime BUILDS
      // an element from — see sanitizeSvgSpec.
      next = sanitizeSvgSpec(value);
    } else if (key === 'html' && typeof value === 'string') {
      // An SVG region's inner markup reached some other way.
      next = sanitizeSvgFragment(value);
    } else if (key === 'icon_svg' && typeof value === 'string') {
      // ★ A SPOT's icon artwork. The runtime hands this straight to `template.innerHTML`
      // (shared/utilities.js htmlToElement), so an unsanitized value is live DOM from config — the
      // same shape as the five paths above, on the key an ICON hotspot uses for everything it draws.
      // `<script>` will not run from innerHTML, but an `onerror`/`onbegin` handler inside the
      // fragment will, and `<use href="data:…">` pulls in an external document.
      next = sanitizeSvgFragment(value);
    } else if (key === 'icon_url' && typeof value === 'string') {
      // ★ A custom icon's URL. spot.js interpolates it into `<img src="${…}">` and innerHTMLs the
      // result, so a value containing a quote closes the attribute and adds its own —
      // `x" onerror="…` is a working handler. safeLinkUrl's allowlist is the same gate every other
      // authored URL passes.
      next = safeAssetUrl(value);
    } else {
      next = sanitizeImageMapConfig(value);
    }
    // defineProperty, not assignment: never invokes an inherited setter for any key.
    Object.defineProperty(out, key, { value: next, writable: true, enumerable: true, configurable: true });
  }
  return out;
}

/**
 * An asset URL that is safe to put in a `src`.
 *
 * Deliberately narrow: http/https, a site-relative path, or a data: IMAGE (which cannot execute).
 * Anything else — `javascript:`, a bare `data:text/html`, a value carrying a quote — becomes ''.
 */
function safeAssetUrl(value: string): string {
  const url = value.trim();
  if (url === '') return '';
  if (/["'<>]/.test(url)) return '';
  if (/^\//.test(url) && !/^\/\//.test(url)) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(url)) return url;
  return '';
}

/** The first artboard's background image, for the no-JS fallback. */
function fallbackImage(config: Record<string, unknown>): { url: string; alt: string } | null {
  const artboards = config.artboards;
  if (!Array.isArray(artboards) || artboards.length === 0) return null;
  const first = artboards[0];
  if (!isRecord(first)) return null;
  const url = typeof first.image_url === 'string' ? first.image_url : '';
  if (url === '') return null;
  const general = isRecord(config.general) ? config.general : {};
  const alt = typeof first.title === 'string' && first.title !== ''
    ? first.title
    : typeof general.name === 'string'
      ? general.name
      : 'Image map';
  return { url, alt };
}

/**
 * The complete markup for a stored map: the component marker, a no-JS fallback image, and the
 * sanitized config as a JSON data block.
 */
export function renderImageMapMarkup(map: RenderImageMap, opts: { class?: string; preview?: boolean } = {}): string {
  const config = sanitizeImageMapConfig(map.config) as Record<string, unknown>;
  const cls = opts.class ? ` class="${escapeAttr(opts.class)}"` : '';
  const img = fallbackImage(config);
  const fallback = img ? `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(img.alt)}" />` : '';
  // ★ In PREVIEW the markup names the map it came from, exactly as the code-first `data-sw-imagemap`
  // form does. That id is what makes the map reachable from the editor: a click opens it in the
  // Studio. Without it the helper — which is the embed code the Studio itself hands out — produced a
  // map that could be seen and never edited. Publish emits no marker (nothing to edit on a live site).
  const marker = opts.preview && map.id ? ` ${IMAGE_MAP_ATTR}="${escapeAttr(map.id)}"` : '';
  return (
    `<div data-sw-component="image-map"${marker}${cls}>${fallback}` +
    `<script type="application/json" data-sw-part="config">${jsonForScript(config)}</script></div>`
  );
}

/** The message rendered in place of an unknown map reference. */
export function unknownImageMapMessage(id: string): string {
  return `Unknown image map "${id}"`;
}

/**
 * The `data-sw-imagemap` resolution pass. Runs inside renderTemplate after resolveDirectives;
 * a no-op when the fragment carries no reference or the surface provides no maps.
 *
 * The carrier element's own attributes are preserved (so an author can size and place it with
 * utility classes); its CONTENT is replaced by the fallback image + config block.
 */
export function resolveImageMapEmbeds(html: string, ctx: ImageMapEmbedContext): string {
  if (typeof html !== 'string' || !html.includes(IMAGE_MAP_ATTR)) return html;
  const maps = ctx.imageMaps;
  if (!maps) return html;

  const doc = parseDocument(html, { decodeEntities: true });
  const targets = findAll(
    (el) => Object.prototype.hasOwnProperty.call(el.attribs, IMAGE_MAP_ATTR),
    doc.children,
  );
  // The substring can appear in prose ("…use data-sw-imagemap…") — only re-serialize when a real
  // attribute carrier exists, so such pages keep byte-identical output.
  if (targets.length === 0) return html;

  for (const el of targets as Element[]) {
    // eslint-disable-next-line security/detect-object-injection -- IMAGE_MAP_ATTR is a module constant
    const id = (el.attribs[IMAGE_MAP_ATTR] ?? '').trim();
    // eslint-disable-next-line security/detect-object-injection -- own-property checked on the line itself, so an inherited key (constructor, toString) can't resolve
    const map = Object.prototype.hasOwnProperty.call(maps, id) ? maps[id] : undefined;
    if (!map) throw new Error(unknownImageMapMessage(id));

    const config = sanitizeImageMapConfig(map.config) as Record<string, unknown>;
    const img = fallbackImage(config);
    // Keep any author-authored fallback content; otherwise supply one from the first artboard.
    const authored = textContent(el).trim() !== '' || el.children.length > 0;
    const fallback = authored ? render(el.children, { decodeEntities: false }) : img
      ? `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(img.alt)}" />`
      : '';

    el.attribs['data-sw-component'] = 'image-map';
    // eslint-disable-next-line security/detect-object-injection -- IMAGE_MAP_ATTR is a module constant
    if (!ctx.preview) delete el.attribs[IMAGE_MAP_ATTR];
    const inner =
      `${fallback}<script type="application/json" data-sw-part="config">${jsonForScript(config)}</script>`;
    el.children = parseDocument(inner, { decodeEntities: true }).children;
    for (const kid of el.children) kid.parent = el;
  }

  return render(doc.children, { decodeEntities: false });
}

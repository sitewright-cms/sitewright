// The `data-sw-*` editable-leaf directive pass — the hybrid model's core.
//
// Handlebars renders structure/loops/logic; an author marks EDITABLE leaves on real
// elements with `data-sw-*` attributes. This pass runs AFTER Handlebars (inside
// renderTemplate, in the isolated worker), parses the rendered body fragment, and binds
// each directive to its element with a single, context-correct SINK rule:
//
//   data-sw-text="key"  → element textContent          (from page.data[key]; serializer escapes)
//   data-sw-html="key"  → element innerHTML             (from page.data[key]; sanitizeRichHtml)
//   data-sw-href="key"  → anchor href                   (from page.data[key]; safeUrl)
//   data-sw-src="key"   → <img> src                     (from page.data[key]; safeUrl)
//   data-sw-bg="key"    → inline background-image style (from page.data[key]; safeUrl + cssUrlEscape)
//
// STORE: a SINGLE store — every directive reads `page.data`. A BARE key (`data-sw-text="hero_h1"`,
// `data-sw-html="bio"`) is a top-level page.data property; a `data.<path>` key (`data.article_title`)
// is a nested page.data path. The value resolves to a STRING leaf (non-string / missing → keep the
// authored default). The retired `content`/`richContent` stores folded into page.data; `data-sw-html`
// is the one HTML sink and is always sanitized at render (`sanitizeRichHtml`), so storing raw HTML in
// generic page.data is safe — nothing is emitted to HTML unsanitized.
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
import { Text, type Element } from 'domhandler';
import { findAll } from 'domutils';
import render from 'dom-serializer';
import { sanitizeRichHtml } from './sanitize-rich.js';
import { safeUrl, cssUrlEscape } from './url.js';

/** Region keys that must never index a content map (prototype-pollution guard). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const TEXT_ATTR = 'data-sw-text';
const HTML_ATTR = 'data-sw-html';
const HREF_ATTR = 'data-sw-href';
const SRC_ATTR = 'data-sw-src';
const BG_ATTR = 'data-sw-bg';
/** Every directive attribute this pass recognizes. */
const DIRECTIVE_ATTRS = [TEXT_ATTR, HTML_ATTR, HREF_ATTR, SRC_ATTR, BG_ATTR] as const;

/** The `data.` key prefix routes a directive to the page's own `page.data` object. */
const DATA_PREFIX = 'data.';

export interface DirectiveContext {
  /**
   * The page's own `page.data` object — the SINGLE store for every directive (text/html/href/src/bg):
   * a BARE key (`data-sw-text="k"`, `data-sw-html="bio"`) is a top-level `page.data` property; a
   * `data.<path>` key is a nested page.data path.
   */
  data?: Record<string, unknown>;
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
 * The override string for a directive `key`, read from the single `page.data` store. A `data.<path>`
 * key reads `page.data` at that nested path; a BARE key reads a FLAT top-level `page.data` property.
 * Undefined → no override (keep the authored default).
 */
function resolveOverride(ctx: DirectiveContext, key: string): string | undefined {
  if (key.startsWith(DATA_PREFIX)) return dataLeaf(ctx.data, key.slice(DATA_PREFIX.length));
  return flatData(ctx.data, key);
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
  if (typeof html !== 'string' || !html.includes('data-sw-')) return html;
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
      // authored default (so clearing reverts, rather than producing a broken src="").
      const value = resolveOverride(ctx, srcKey);
      if (value !== undefined && value !== '') el.attribs.src = safeUrl(value, '');
    }
    const bgKey = el.attribs[BG_ATTR];
    if (typeof bgKey === 'string') {
      // Editable background image: a non-empty override → an inline `background-image:url('…')`,
      // scheme- AND CSS-url()-sanitized. We mutate the parsed style attribute (the serializer escapes
      // it), so there is no string-interpolation-into-style surface and no validateTemplate exception.
      // Empty → keep the authored default. (Publish rebases `/media/…` bg URLs via build.ts's
      // _assets step; a non-/media root-relative bg URL is not rebased — known sub-path-export gap.)
      const value = resolveOverride(ctx, bgKey);
      if (value !== undefined && value !== '') {
        const css = cssUrlEscape(safeUrl(value, ''));
        if (css) {
          const existing = (el.attribs.style ?? '').replace(/background-image\s*:[^;]*;?/gi, '').trim();
          const prefix = existing ? existing.replace(/;?$/, '; ') : '';
          el.attribs.style = `${prefix}background-image:url('${css}')`;
        }
      }
    }
    // Preview keeps the markers for the bridge; publish strips them for a clean artifact.
    if (!ctx.preview) {
      for (const attr of DIRECTIVE_ATTRS) {
        if (Object.prototype.hasOwnProperty.call(el.attribs, attr)) delete el.attribs[attr];
      }
    }
    /* eslint-enable security/detect-object-injection */
  }
  // `encodeEntities: 'utf8'` escapes only the markup-significant chars (&,<,>, attr quotes) and keeps
  // non-ASCII literal — so a re-serialized data-sw-* element matches the rest of the page (e.g. German
  // "Geschäft" stays literal, not "Gesch&#xe4;ft").
  return render(doc, { encodeEntities: 'utf8' });
}

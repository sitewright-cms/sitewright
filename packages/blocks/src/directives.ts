// The `data-sw-*` editable-leaf directive pass — the hybrid model's core.
//
// Handlebars renders structure/loops/logic; an author marks EDITABLE leaves on real
// elements with `data-sw-*` attributes. This pass runs AFTER Handlebars (inside
// renderTemplate, in the isolated worker), parses the rendered body fragment, and binds
// each directive to its element with a single, context-correct SINK rule:
//
//   data-sw-text="key"  → element textContent          (from content[key];     serializer escapes)
//   data-sw-html="key"  → element innerHTML             (from richContent[key]; sanitizeRichHtml)
//   data-sw-href="key"  → anchor href                   (from content[key];     safeUrl)
//   data-sw-src="key"   → <img> src                     (from content[key];     safeUrl)
//   data-sw-bg="key"    → inline background-image style (from content[key];     safeUrl + cssUrlEscape)
//
// KEY CONVENTION: a key prefixed `data.` (e.g. `data.article_title`) binds the leaf to the page's own
// `page.data` object at that dotted path (own-property per segment) instead of content/richContent —
// so a content-only template (e.g. global:blog-article) can render AND in-preview-edit a structured
// page-data field. The path resolves to a STRING leaf (non-string / missing → keep the authored
// default).
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
  /** Plain-text region overrides (the `page.content` map), keyed by directive key. */
  content?: Record<string, string>;
  /** Rich (sanitized-HTML) region overrides (the `page.richContent` map). */
  richContent?: Record<string, string>;
  /** The page's own `page.data` object — the source for `data.<path>`-keyed directives. */
  data?: Record<string, unknown>;
  /**
   * PREVIEW render: keep the `data-sw-*` marker attributes so the editor can make them
   * click-to-edit. Absent/false (PUBLISH) → strip every directive attribute from the output.
   */
  preview?: boolean;
}

/** Own-property lookup that refuses the prototype-pollution keys. */
function lookup(map: Record<string, string> | undefined, key: string): string | undefined {
  if (!map || key === '' || DANGEROUS_KEYS.has(key)) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- own-property + DANGEROUS_KEYS guarded above
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
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

/**
 * The override string for a directive `key`: a `data.<path>` key reads `page.data` at that path;
 * any other key reads `fallback` (content or richContent). Undefined → no override (keep the default).
 */
function resolveOverride(ctx: DirectiveContext, key: string, fallback: Record<string, string> | undefined): string | undefined {
  return key.startsWith(DATA_PREFIX) ? dataLeaf(ctx.data, key.slice(DATA_PREFIX.length)) : lookup(fallback, key);
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
      const value = resolveOverride(ctx, textKey, ctx.content);
      if (value !== undefined) setText(el, value);
    }
    const htmlKey = el.attribs[HTML_ATTR];
    if (typeof htmlKey === 'string') {
      const value = resolveOverride(ctx, htmlKey, ctx.richContent);
      if (value !== undefined) setHtml(el, sanitizeRichHtml(value));
    }
    const hrefKey = el.attribs[HREF_ATTR];
    if (typeof hrefKey === 'string') {
      // Editable link URL: a non-empty override → href (scheme-sanitized); empty → keep the default.
      const value = resolveOverride(ctx, hrefKey, ctx.content);
      if (value !== undefined && value !== '') el.attribs.href = safeUrl(value, '#');
    }
    const srcKey = el.attribs[SRC_ATTR];
    if (typeof srcKey === 'string') {
      // Editable image: a non-empty override → <img src> (scheme-sanitized); empty → keep the
      // authored default (so clearing reverts, rather than producing a broken src="").
      const value = resolveOverride(ctx, srcKey, ctx.content);
      if (value !== undefined && value !== '') el.attribs.src = safeUrl(value, '');
    }
    const bgKey = el.attribs[BG_ATTR];
    if (typeof bgKey === 'string') {
      // Editable background image: a non-empty override → an inline `background-image:url('…')`,
      // scheme- AND CSS-url()-sanitized. We mutate the parsed style attribute (the serializer escapes
      // it), so there is no string-interpolation-into-style surface and no validateTemplate exception.
      // Empty → keep the authored default. (Publish rebases `/media/…` bg URLs via build.ts's
      // _assets step; a non-/media root-relative bg URL is not rebased — known sub-path-export gap.)
      const value = resolveOverride(ctx, bgKey, ctx.content);
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
  return render(doc);
}

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

export interface DirectiveContext {
  /** Plain-text region overrides (the `page.content` map), keyed by directive key. */
  content?: Record<string, string>;
  /** Rich (sanitized-HTML) region overrides (the `page.richContent` map). */
  richContent?: Record<string, string>;
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
      const value = lookup(ctx.content, textKey);
      if (value !== undefined) setText(el, value);
    }
    const htmlKey = el.attribs[HTML_ATTR];
    if (typeof htmlKey === 'string') {
      const value = lookup(ctx.richContent, htmlKey);
      if (value !== undefined) setHtml(el, sanitizeRichHtml(value));
    }
    const hrefKey = el.attribs[HREF_ATTR];
    if (typeof hrefKey === 'string') {
      // Editable link URL: a non-empty override → href (scheme-sanitized); empty → keep the default.
      const value = lookup(ctx.content, hrefKey);
      if (value !== undefined && value !== '') el.attribs.href = safeUrl(value, '#');
    }
    const srcKey = el.attribs[SRC_ATTR];
    if (typeof srcKey === 'string') {
      // Editable image: a non-empty override → <img src> (scheme-sanitized); empty → keep the
      // authored default (so clearing reverts, rather than producing a broken src="").
      const value = lookup(ctx.content, srcKey);
      if (value !== undefined && value !== '') el.attribs.src = safeUrl(value, '');
    }
    const bgKey = el.attribs[BG_ATTR];
    if (typeof bgKey === 'string') {
      // Editable background image: a non-empty override → an inline `background-image:url('…')`,
      // scheme- AND CSS-url()-sanitized. We mutate the parsed style attribute (the serializer escapes
      // it), so there is no string-interpolation-into-style surface and no validateTemplate exception.
      // Empty → keep the authored default. (Publish rebases `/media/…` bg URLs via build.ts's
      // _assets step; a non-/media root-relative bg URL is not rebased — known sub-path-export gap.)
      const value = lookup(ctx.content, bgKey);
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

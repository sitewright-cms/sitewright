// Thin helpers over the htmlparser2 / domhandler / dom-serializer toolchain (the exact stack the
// renderer uses in packages/blocks/src/directives.ts). The engine parses → mutates DOM → re-serializes.
import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import { findAll, findOne } from 'domutils';
import { isComment, isTag, isText, Text, type AnyNode, type Document, type Element } from 'domhandler';

/** Parse an HTML fragment/document (entities decoded, mirroring the renderer's pass). */
export function parse(html: string): Document {
  return parseDocument(html, { decodeEntities: true });
}

/**
 * Serialize nodes back to HTML. `encodeEntities: 'utf8'` escapes only markup-significant chars and
 * keeps non-ASCII literal — matching the rest of a Sitewright page (and our zero-width mustache marks).
 */
export function serialize(nodes: AnyNode | AnyNode[]): string {
  return render(nodes, { encodeEntities: 'utf8' });
}

// A Handlebars mustache span: `{{ … }}` whose body carries no braces. INVARIANT: every token the
// nativizer emits is a single, flat mustache whose body contains no literal `{` or `}` — i.e. no
// `{{{raw}}}` (the template validator bans it) and no `}}` inside a quoted arg (the emitter uses only
// bare paths + simple string/number args, never a sub-expression like `{{a (b "}}")}}`). Under that
// invariant `[^{}]*` matches a whole token body; a body that broke it would be split at the first `}}`
// and only its head decoded — so a future emitter that adds sub-expressions must revisit this.
const MUSTACHE_SPAN = /\{\{[^{}]*\}\}/g;

/**
 * Restore the HTML entities that {@link serialize} escapes INSIDE mustache spans. A serialized text node
 * is HTML — so `>` becomes `&gt;`, `<` becomes `&lt;`, `&` becomes `&amp;` — but an emitted Handlebars
 * token is TEMPLATE SYNTAX, not text, and must survive re-serialization verbatim. The `>` of a partial
 * reference (`{{> logo-marquee}}`) is the concrete case: escaped to `{{&gt; logo-marquee}}` it is invalid
 * Handlebars and fails the whole page build. Decoding is confined to `{{ … }}` spans, so real page text is
 * untouched; `&amp;` is decoded last so a genuine `&amp;` inside a helper arg round-trips to a single `&`.
 */
export function restoreMustacheEntities(html: string): string {
  return html.replace(MUSTACHE_SPAN, (span) =>
    span.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );
}

/**
 * Serialize nodes to a Handlebars TEMPLATE string (a terminal nativizer output): {@link serialize} plus
 * {@link restoreMustacheEntities}, so emitted `{{…}}` tokens are not corrupted by HTML escaping. Use this
 * (not `serialize`) for any serialized fragment that is RETURNED as template source rather than re-parsed.
 */
export function serializeTemplate(nodes: AnyNode | AnyNode[]): string {
  return restoreMustacheEntities(serialize(nodes));
}

// Block-level tags get their own line + indentation in prettySerialize; everything else (inline runs,
// rawtext) is kept compact so text/inline formatting + whitespace-significant content are preserved.
const BLOCK_TAGS = new Set([
  'html', 'head', 'body', 'div', 'section', 'header', 'footer', 'nav', 'aside', 'main', 'article',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'td', 'th', 'form', 'fieldset', 'figure', 'figcaption', 'blockquote',
  'picture', 'hr',
]);
// Content is whitespace-significant or rawtext — never re-indent the inside.
const VERBATIM_TAGS = new Set(['pre', 'textarea', 'style', 'script', 'code']);

/** The element's opening tag only (`<div class="x">`), with dom-serializer's correct attribute escaping. */
function openTag(el: Element): string {
  const kids = el.children;
  el.children = [];
  const s = render(el, { encodeEntities: 'utf8' });
  el.children = kids;
  return s.replace(new RegExp(`</${el.name}>$`, 'i'), '');
}

/**
 * Serialize `nodes` as READABLE, indented HTML so an imported page's source is editable: a block element
 * that contains other block elements is opened/closed on its own indented lines with its children
 * recursed; everything else (inline-only elements, text, rawtext like <pre>) is emitted compact on one
 * line. Output is semantically identical to serialize() — only inter-element whitespace differs.
 */
export function prettySerialize(nodes: AnyNode | AnyNode[]): string {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  const out: string[] = [];
  const walk = (ns: AnyNode[], depth: number): void => {
    const pad = '  '.repeat(depth);
    for (const n of ns) {
      if (isText(n)) {
        const t = n.data.trim();
        if (t) out.push(pad + t);
        continue;
      }
      if (isComment(n)) {
        out.push(`${pad}<!--${n.data}-->`);
        continue;
      }
      if (!isTag(n)) continue;
      const hasBlockChild = n.children.some((c) => isTag(c) && BLOCK_TAGS.has(c.name));
      if (VERBATIM_TAGS.has(n.name) || !hasBlockChild) {
        out.push(pad + render(n, { encodeEntities: 'utf8' })); // compact: preserves inline + rawtext
      } else {
        out.push(pad + openTag(n));
        walk(n.children, depth + 1);
        out.push(`${pad}</${n.name}>`);
      }
    }
  };
  walk(list, 0);
  return out.join('\n');
}

/** The `<body>` element if the document has one (a full HTML doc), else undefined (a bare fragment). */
export function getBody(doc: Document): Element | undefined {
  return findOne((e) => e.name === 'body', doc.children, true) ?? undefined;
}

/** Every element at or below `nodes` (a stable snapshot — safe to mutate names/attribs while iterating). */
export function elements(nodes: AnyNode[]): Element[] {
  return findAll(() => true, nodes);
}

/** The first descendant element matching `name` (lowercased), or undefined. */
export function firstByName(nodes: AnyNode[], name: string): Element | undefined {
  return findOne((e) => e.name === name, nodes, true) ?? undefined;
}

/** All descendant elements matching `name`. */
export function allByName(nodes: AnyNode[], name: string): Element[] {
  return findAll((e) => e.name === name, nodes);
}

/** Visit every Text/Comment node (where stray `{{` could live) at or below `nodes`. */
export function eachTextLike(nodes: AnyNode[], cb: (node: { data: string }) => void): void {
  for (const n of nodes) {
    if (isText(n) || isComment(n)) cb(n);
    else if (isTag(n)) eachTextLike(n.children, cb);
  }
}

/** Zero-width space — invisible when rendered; used to split adjacent braces. */
const ZWSP = '\u200B';

/**
 * Break up literal `{{` / `}}` so the value can't start a Handlebars expression that `validateTemplate`
 * would reject. Inserts a zero-width space between adjacent braces — invisible when rendered, and the
 * scanner only matches two *adjacent* braces.
 */
export function neutralizeMustaches(s: string): string {
  if (!s.includes('{{') && !s.includes('}}')) return s;
  return s.replace(/\{(?=\{)/g, `{${ZWSP}`).replace(/\}(?=\})/g, `}${ZWSP}`);
}

/** Replace an element's children with a single raw text node (caller controls escaping at serialize).
 *  NOTE: the displaced children keep their stale `.parent` pointer — don't traverse upward from them
 *  after calling this (the callers here discard them). */
export function setText(el: Element, value: string): void {
  const node = new Text(value);
  node.parent = el;
  node.prev = null;
  node.next = null;
  el.children = [node];
}

export { isTag, isText, isComment };
export type { AnyNode, Document, Element };

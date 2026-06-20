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

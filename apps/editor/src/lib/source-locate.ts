/**
 * Locate the SOURCE range of a rendered element, so clicking something in the preview can select the
 * code that produced it.
 *
 * There is no position map from the rendered DOM back to the page source — the source is Handlebars
 * (loops, partials, bindings), so one authored element can render N times and some rendered elements
 * (chrome slots, component runtimes) have no source here at all. This resolves the element STRUCTURALLY
 * instead: the preview sends what it can see about the clicked node (tag, id, classes, and which
 * same-looking sibling it is), and we find the corresponding opening tag in the text.
 *
 * Deliberately a small scanner rather than a DOM parse: the source is a TEMPLATE, not HTML, so
 * `DOMParser` would drop/reorder `{{#each}}` blocks and lose the offsets we need. We only ever need to
 * find a tag and its matching close, which a quote/comment-aware scan does honestly.
 */

/** What the preview can tell us about the element that was clicked. */
export interface ElementSignature {
  /** Lowercase tag name. */
  tag: string;
  /** The element's `id`, when it has one — the strongest possible hint. */
  id?: string | undefined;
  /** The element's rendered class tokens (a superset of the authored ones: runtimes add their own). */
  classes?: string[] | undefined;
  /** Index among identically-shaped siblings in the render, so a loop's 3rd card finds the loop body. */
  nth?: number | undefined;
}

/** A character range in the source document. */
export interface SourceRange {
  from: number;
  to: number;
}

/** HTML elements that never have a closing tag — their range is the opening tag alone. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** A tag name we will look for: letters/digits/dash only (so a signature can't inject regex). */
const TAG_OK = /^[a-z][a-z0-9-]*$/;

/**
 * Index of the first `<!-- … -->` / `{{! … }}` end after `i`, or -1. Comments are skipped wholesale so
 * a commented-out `<section>` never becomes a candidate or unbalances the depth count.
 */
function skipComment(src: string, i: number): number {
  if (src.startsWith('<!--', i)) {
    const end = src.indexOf('-->', i + 4);
    return end === -1 ? src.length : end + 3;
  }
  if (src.startsWith('{{!--', i)) {
    const end = src.indexOf('--}}', i + 5);
    return end === -1 ? src.length : end + 4;
  }
  if (src.startsWith('{{!', i)) {
    const end = src.indexOf('}}', i + 3);
    return end === -1 ? src.length : end + 2;
  }
  return -1;
}

/** End offset (exclusive) of the tag starting at `<` — quote-aware, so `>` inside an attribute is safe. */
function tagEnd(src: string, start: number): number {
  let quote = '';
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return src.length;
}

/** Read one attribute's value out of an opening tag's text (`class="a b"` → `a b`). */
function attr(tagText: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(tagText);
  return m ? (m[2] ?? m[3] ?? '') : null;
}

/** Class tokens of an opening tag, ignoring any Handlebars expression among them. */
function staticClasses(tagText: string): string[] {
  const raw = attr(tagText, 'class');
  if (raw === null) return [];
  return raw
    .replace(/\{\{[^}]*\}\}/g, ' ') // `class="card {{#if x}}on{{/if}}"` → the static part only
    .split(/\s+/)
    .filter(Boolean);
}

/** Every opening tag of `tag` in `src`, as [offset, tagText] pairs, skipping comments. */
function openingTags(src: string, tag: string): Array<{ at: number; text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  for (let i = 0; i < src.length; ) {
    const skipped = skipComment(src, i);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    if (src[i] === '<' && src[i + 1] !== '/') {
      const end = tagEnd(src, i);
      const name = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(i, end))?.[1]?.toLowerCase();
      if (name === tag) out.push({ at: i, text: src.slice(i, end) });
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * End offset of the element opened at `open` — the character after its `</tag>`, walking nested
 * same-name tags so an outer `<div>` doesn't stop at an inner one's close. A void or self-closed
 * element (and an unclosed one, which real-world source has) ends at its opening tag.
 */
function elementEnd(src: string, open: { at: number; text: string }, tag: string): number {
  const afterOpen = open.at + open.text.length;
  if (VOID_ELEMENTS.has(tag) || /\/\s*>$/.test(open.text)) return afterOpen;
  let depth = 1;
  for (let i = afterOpen; i < src.length; ) {
    const skipped = skipComment(src, i);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    if (src[i] !== '<') {
      i++;
      continue;
    }
    const end = tagEnd(src, i);
    const slice = src.slice(i, end);
    const close = /^<\s*\/\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(slice)?.[1]?.toLowerCase();
    if (close === tag) {
      depth--;
      if (depth === 0) return end;
    } else if (!close) {
      const name = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(slice)?.[1]?.toLowerCase();
      if (name === tag && !VOID_ELEMENTS.has(tag) && !/\/\s*>$/.test(slice)) depth++;
    }
    i = end;
  }
  return afterOpen; // never closed — select the opening tag rather than the rest of the file
}

/**
 * The source range of the element the preview describes, or null when it cannot be placed (an element
 * from a chrome slot, a component's runtime-injected node, or source that has since been edited).
 *
 * Matching is deliberately forgiving in one direction only: the authored classes must be a SUBSET of
 * the rendered ones, because runtimes add classes (`sw-…`, enhancement markers) that were never typed.
 * `nth` then picks between equally-good candidates, which is what makes a loop's Nth row resolve to the
 * single authored block that produced it.
 */
export function findElementRange(source: string, sig: ElementSignature): SourceRange | null {
  const tag = sig.tag?.toLowerCase();
  if (!tag || !TAG_OK.test(tag) || !source) return null;

  const rendered = new Set(sig.classes ?? []);
  const candidates = openingTags(source, tag).filter(({ text }) => {
    if (sig.id) return attr(text, 'id') === sig.id;
    const authored = staticClasses(text);
    // No classes either side → the tag alone is the signature (nth still disambiguates).
    if (authored.length === 0) return rendered.size === 0;
    return authored.every((c) => rendered.has(c));
  });
  if (candidates.length === 0) return null;

  const index = Math.min(Math.max(sig.nth ?? 0, 0), candidates.length - 1);
  const open = candidates[index]!;
  return { from: open.at, to: elementEnd(source, open, tag) };
}

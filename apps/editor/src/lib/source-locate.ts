/**
 * Locate the SOURCE range of a rendered element, so clicking something in the preview can select the
 * code that produced it.
 *
 * There is no position map from the rendered DOM back to the page source — the source is Handlebars
 * (loops, partials, bindings), so one authored element can render N times and some rendered elements
 * (chrome slots, component runtimes) have no source here at all. This resolves the element
 * STRUCTURALLY instead, from what the preview can see about the node that was clicked.
 *
 * It SCORES candidates rather than filtering them. The first version filtered on classes alone and
 * went silent whenever the class signal was absent or contradicted — a source tag with no static
 * class whose runtime added one, `class="{{binding}}"`, an id the runtime invented, or two loops
 * sharing a class. Each of those is common, and each produced "nothing happens", which reads as
 * unreliable. Scoring lets a weak signal still win when it is the only one, and lets the strongest
 * available signal — the element's own TEXT, which survives every one of those cases — decide.
 *
 * Deliberately a small scanner rather than a DOM parse: the source is a TEMPLATE, so `DOMParser`
 * would drop/reorder `{{#each}}` blocks and lose the offsets we need.
 */

/** What the preview can tell us about the element that was clicked. */
export interface ElementSignature {
  /** Lowercase tag name. */
  tag: string;
  /** The element's `id`, when it has one. Ignored if no candidate carries it (runtimes invent ids). */
  id?: string | undefined;
  /** The element's rendered class tokens (a superset of the authored ones: runtimes add their own). */
  classes?: string[] | undefined;
  /** The element's own visible text, normalised — the signal that survives a missing/dynamic class. */
  text?: string | undefined;
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

/** How much of an element's text is compared — enough to be distinctive, cheap to normalise. */
const TEXT_SAMPLE = 120;

/** Collapse whitespace + lowercase, so source formatting never decides a match. */
function normText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, TEXT_SAMPLE);
}

/**
 * Index just past a `<!-- … -->` / `{{! … }}` comment starting at `i`, or -1 when none starts there.
 * Comments are skipped wholesale so commented-out markup is never a candidate and never unbalances
 * the depth count.
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

/** The candidate's own LITERAL text: markup and Handlebars expressions removed. */
function candidateText(src: string, from: number, to: number): string {
  return normText(
    src
      .slice(from, to)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\{\{[^}]*\}\}/g, ' '),
  );
}

/**
 * The range of the `{{#each dataset.<slug>}} … {{/each}}` block that renders a collection, nesting-aware.
 *
 * The fallback for a dataset row: the preview WRAPS every row in an injected `<div data-sw-entry>` that
 * exists in the DOM and not in the source, and a row's contents are bindings rather than literals — so
 * when no element inside the loop body can be pinned down, selecting the block that produced the row is
 * the honest answer, and it is the code the author actually edits.
 */
export function findEachBlock(source: string, slug: string): SourceRange | null {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(slug ?? '')) return null; // a dataset slug, never a regex
  const open = new RegExp(`\\{\\{\\s*#each\\s+dataset\\.${slug}\\b[^}]*\\}\\}`, 'g');
  const start = open.exec(source);
  if (!start) return null;
  // Walk forward counting nested {{#each}} so an inner loop's {{/each}} cannot close this one.
  const token = /\{\{\s*(#each|\/each)\b[^}]*\}\}/g;
  token.lastIndex = start.index + start[0].length;
  let depth = 1;
  for (let m = token.exec(source); m; m = token.exec(source)) {
    depth += m[1] === '#each' ? 1 : -1;
    if (depth === 0) return { from: start.index, to: m.index + m[0].length };
  }
  return { from: start.index, to: source.length };
}

/**
 * The source range of the element the preview describes, or null when nothing in this source could
 * plausibly be it — an element from a chrome slot, from a referenced template, from a `{{> partial}}`,
 * or source edited since the render. Selecting nothing is the right answer there: moving the caret
 * somewhere confidently wrong is worse than not moving it.
 */
export function findElementRange(source: string, sig: ElementSignature): SourceRange | null {
  const tag = sig.tag?.toLowerCase();
  if (!tag || !TAG_OK.test(tag) || !source) return null;

  const candidates = openingTags(source, tag);
  if (candidates.length === 0) return null;

  const rendered = new Set(sig.classes ?? []);
  const wantText = normText(sig.text ?? '');
  // An id the runtime invented is not in the source at all. Honour the id only when some candidate
  // actually carries it, instead of letting it veto every match.
  const idMatches = sig.id ? candidates.filter((c) => attr(c.text, 'id') === sig.id) : [];
  const pool = idMatches.length > 0 ? idMatches : candidates;

  const scored = pool.map((open) => {
    const end = elementEnd(source, open, tag);
    let score = 0;
    if (idMatches.length > 0) score += 100;

    const authored = staticClasses(open.text);
    if (authored.length > 0) {
      const hit = authored.filter((c) => rendered.has(c)).length;
      // Every authored class present in the render is a strong match; a class the render does NOT
      // have contradicts this candidate (it is a different element, not a superset).
      score += hit === authored.length ? 40 + Math.min(hit, 4) * 3 : -50;
    }

    // TEXT is the signal that survives a missing, dynamic or runtime-added class. Only a candidate
    // with literal text can use it — a loop body (`{{title}}`) has none, and must not be penalised.
    const own = candidateText(source, open.at + open.text.length, Math.max(end - 1, open.at + open.text.length));
    if (wantText && own) {
      if (own === wantText) score += 70;
      else if (own.includes(wantText) || wantText.includes(own)) score += 45;
      else score -= 25;
    }
    return { open, end, score };
  });

  const best = Math.max(...scored.map((s) => s.score));
  // A NEGATIVE best means every candidate is contradicted (a class or text the render disagrees with)
  // — that is evidence of the wrong element, so decline. A zero best is merely "no signal beyond the
  // tag", which is still worth acting on: it is the classless element that used to go silent.
  if (best < 0) return null;
  const top = scored.filter((s) => s.score === best);
  // `nth` disambiguates equally-good candidates (a loop's Nth row → its single authored block).
  const chosen = top[Math.min(Math.max(sig.nth ?? 0, 0), top.length - 1)]!;
  return { from: chosen.open.at, to: chosen.end };
}

/** Index just past the element's opening tag, honouring quoted attribute values (`title="a>b"`). */
function openTagEnd(source: string, from: number): number {
  let quote = '';
  for (let i = from; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Narrow an element's range to the TEXT inside it.
 *
 * Clicking words in the preview asks to edit those words, so selecting the whole `<section …>…</section>`
 * buries them. This walks in one step at a time and stops at the first honest answer:
 *
 *  1. no inner content (a void element, or `<div></div>`) → the element range, unchanged;
 *  2. the clicked run appears literally in the source → exactly that run;
 *  3. it does not → the element's whole inner content, trimmed.
 *
 * (3) is the case that matters for templates: a loop body's markup is `{{title}}`, which shares no
 * characters with the rendered "Autumn Collection" the author clicked. Selecting the inner content
 * still selects *the text region* — the binding that produces it — which is the code they came for.
 */
export function narrowToText(source: string, range: SourceRange, text: string): SourceRange {
  const innerFrom = openTagEnd(source, range.from);
  if (innerFrom < 0 || innerFrom >= range.to) return range;
  // `range.to` sits just past `</tag>`; the inner content ends where that closing tag begins. A void
  // element has no closing tag, so there is nothing to narrow to.
  const innerTo = source.lastIndexOf('</', range.to);
  if (innerTo < innerFrom) return range;

  const inner = source.slice(innerFrom, innerTo);
  if (!inner.trim()) return range;

  const wanted = text.trim();
  if (wanted) {
    // The source is indented and line-wrapped; the render is not. Match the words with flexible
    // whitespace between them rather than demanding the rendered spacing back.
    const pattern = wanted
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    const m = new RegExp(pattern).exec(inner);
    if (m) return { from: innerFrom + m.index, to: innerFrom + m.index + m[0].length };
  }

  // Fall back to the inner content, minus the whitespace the source indents it with.
  const lead = inner.length - inner.trimStart().length;
  const trail = inner.length - inner.trimEnd().length;
  return { from: innerFrom + lead, to: innerTo - trail };
}

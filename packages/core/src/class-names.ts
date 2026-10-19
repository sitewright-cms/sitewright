/** Upper bound on distinct class tokens extracted from one HTML/source string. */
export const MAX_EXTRACTED_CLASS_TOKENS = 2048;

/**
 * How far one class value is read with Handlebars awareness before the scan gives up on it and falls back
 * to the plain reading. Bounds the work any single `class=` can cost (author-controlled input), while being
 * far longer than any real attribute — a conditional class list runs to a few hundred characters.
 */
const MAX_TEMPLATED_CLASS_VALUE = 4096;

/** One `{{…}}` read out of a class value. */
interface Mustache {
  /** Index just past its closing `}}` (or `}}}`). */
  end: number;
  /** Its string-literal arguments — kept only for an OUTPUT expression, the only kind that renders text. */
  literals: string[];
}

/** One class attribute value read with Handlebars awareness. */
interface TemplatedValue {
  /** The literal text, every `{{…}}` replaced by a space (an expression always separates tokens). */
  text: string;
  /** String arguments of the OUTPUT expressions inside it (`{{sw-default x "bg-base-200"}}`). */
  literals: string[];
  /** Index just past the closing quote. */
  end: number;
}

/**
 * Whether the expression starting at `j` (just past `{{`, `{{{` and any `~`) is a BLOCK tag — `#if`, `/if`,
 * `^`, `else`, a partial or a decorator — rather than an output expression. A block tag's arguments are a
 * CONDITION (`(eq phase "dusk")`, `(sw-active "/about")`), never text in the class, so they are not candidates.
 */
function isBlockTag(src: string, j: number): boolean {
  const lead = src[j];
  if (lead === '#' || lead === '/' || lead === '^' || lead === '>' || lead === '*') return true;
  return src.startsWith('else', j) && !/[\w.-]/.test(src[j + 4] ?? '');
}

/**
 * Read the `{{…}}` starting at `i` (which points at `{{`) the way the Handlebars lexer does: string literals
 * (with `\` escapes) may contain quotes and `}}`, comments run to their own terminator. Undefined when it does
 * not close before `limit` — the caller then treats the whole value as malformed.
 */
function readMustache(src: string, i: number, limit: number): Mustache | undefined {
  let j = i + 2;
  const triple = src[j] === '{';
  if (triple) j += 1;
  if (src[j] === '~') j += 1;
  if (src[j] === '!') {
    const terminator = src.startsWith('--', j + 1) ? '--}}' : '}}';
    const close = src.indexOf(terminator, j);
    return close < 0 || close + terminator.length > limit ? undefined : { end: close + terminator.length, literals: [] };
  }
  const output = !isBlockTag(src, j);
  const literals: string[] = [];
  while (j < limit) {
    const c = src[j];
    if (c === '"' || c === "'") {
      let k = j + 1;
      while (k < limit && src[k] !== c) k += src[k] === '\\' ? 2 : 1;
      if (k >= limit) return undefined;
      if (output) literals.push(src.slice(j + 1, k));
      j = k + 1;
    } else if (c === '}' && src[j + 1] === '}') {
      return { end: j + (triple && src[j + 2] === '}' ? 3 : 2), literals };
    } else {
      j += 1;
    }
  }
  return undefined;
}

/**
 * Read the class value opening at `start` (just past its `quote`) with every `{{…}}` as one unit, so a quote
 * inside an expression — `{{#if (eq phase "dusk")}}` — no longer ends the attribute. Undefined when the value
 * (or an expression in it) does not close within {@link MAX_TEMPLATED_CLASS_VALUE}.
 */
function readTemplatedValue(src: string, start: number, quote: string): TemplatedValue | undefined {
  const limit = Math.min(src.length, start + MAX_TEMPLATED_CLASS_VALUE);
  const literals: string[] = [];
  let text = '';
  let segment = start;
  let i = start;
  while (i < limit) {
    if (src[i] === quote) return { text: text + src.slice(segment, i), literals, end: i + 1 };
    if (src[i] === '{' && src[i + 1] === '{') {
      const m = readMustache(src, i, limit);
      if (!m) return undefined;
      text += `${src.slice(segment, i)} `;
      literals.push(...m.literals);
      i = m.end;
      segment = i;
    } else {
      i += 1;
    }
  }
  return undefined;
}

/**
 * `value` with every `{{…}}` (one containing no `}`) replaced by a space — the fallback reading of a value
 * the templated reader could not close. Linear: a `{{` whose first following `}` is not a `}}` can never
 * close, and neither can any `{{` before that `}`, so the scan jumps past it rather than retrying each one
 * (the regex this replaces backtracked quadratically on a value made of nothing but `{{`).
 */
function stripMustaches(value: string): string {
  let out = '';
  let from = 0;
  let i = value.indexOf('{{');
  while (i >= 0) {
    const close = value.indexOf('}', i + 2);
    if (close < 0) break;
    if (value[close + 1] === '}') {
      out += `${value.slice(from, i)} `;
      from = close + 2;
      i = value.indexOf('{{', from);
    } else {
      i = value.indexOf('{{', close + 1);
    }
  }
  return out + value.slice(from);
}

/**
 * Extract the literal CSS class tokens from `class="…"` / `class='…'` attributes in an HTML string or a
 * Handlebars template source — the Tailwind JIT compiler's candidate set for code-first pages. Used by both
 * the publish build and the editor's live-preview endpoint, so the extraction stays identical across the two.
 *
 * A class value is read the way Handlebars reads it: each `{{…}}` is one unit whatever quotes it contains, so
 * every branch of `class="p-6 {{#if (eq phase "dusk")}}bg-orange-500{{else}}…{{/if}}"` is a candidate. The
 * expression itself never is — a dynamic value can't be precompiled — except for the string arguments of an
 * OUTPUT expression (`{{sw-default page.data.bg "bg-base-200"}}`), which are text the class can render. A
 * BLOCK tag's arguments are a condition, so `"dusk"` stays out. A value that doesn't close as a template
 * falls back to the plain reading (up to the next quote), so a stray `{{` can't swallow the rest of a page.
 *
 * The result is deduplicated and capped at `max` tokens: a rendered body can be up to ~1 MiB of
 * attacker-authored markup, and an uncapped synthetic class list would let an owner/admin spike Tailwind's
 * compiler. Real pages use far fewer than the cap.
 *
 * Helpers with `class="…"` HASH args (sw-form, sw-add-to-cart) are caught by the attribute scan itself.
 * KNOWN GAP: classes inside pre-rendered DATA values are invisible to any source scan — which is why the
 * publish build also harvests the classes its RENDERED pages carry (apps/api publish/rendered-classes.ts).
 */
export function extractClassNames(html: string, max: number = MAX_EXTRACTED_CLASS_TOKENS): string[] {
  const tokens = new Set<string>();
  /** Adds `value`'s tokens; true once the cap is reached. */
  const full = (value: string): boolean => {
    for (const token of value.split(/\s+/)) {
      if (!token) continue;
      tokens.add(token);
      if (tokens.size >= max) return true;
    }
    return false;
  };
  // Where the last FAILED templated read stopped looking. A value starting before it gets the plain reading
  // straight away, so failed reads never overlap and malformed input costs linear time in total — otherwise
  // every `class="` inside one broken 4 KB window would rescan that window.
  let failedUpTo = -1;
  // `class=` + a quoted value read up to the first matching quote (groups 1|3: the quote, 2|4: the value).
  // When that value holds a `{{`, the quote it stopped at may sit INSIDE an expression, so the value is
  // re-read below. (Regex literals inside the function: each call gets its own `lastIndex`.)
  const attrRe = /class\s*=\s*(?:(")([^"]*)"|(')([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html)) !== null) {
    const plain = m[2] ?? m[4] ?? '';
    // No expression before the first matching quote — by far the common case, and every rendered page.
    if (!plain.includes('{{')) {
      if (full(plain)) return [...tokens];
      continue;
    }
    const start = m.index + m[0].length - plain.length - 1;
    const templated = start < failedUpTo ? undefined : readTemplatedValue(html, start, m[1] ?? m[3]!);
    if (templated) {
      // Resume after the REAL closing quote, which lies past the one the plain match stopped at.
      attrRe.lastIndex = templated.end;
      if (full(templated.text) || templated.literals.some(full)) return [...tokens];
    } else {
      if (start >= failedUpTo) failedUpTo = start + MAX_TEMPLATED_CLASS_VALUE;
      // The plain reading, minus any fragment of the malformed expression (never a class).
      const words = stripMustaches(plain).split(/\s+/).filter((t) => !t.includes('{{') && !t.includes('}}'));
      if (full(words.join(' '))) return [...tokens];
    }
  }
  // The two loops run sequentially under ONE shared token cap — a cap-saturating page keeps the existing
  // attr-first priority; the cap bounds compiler work, not completeness.
  // {{sw-icon "name" "classes"}} (incl. "flag:<cc>"): the helper emits its second argument as the svg's class
  // attribute at RENDER time. A source-level scan must read it here too, or icon utility classes (the catalog's
  // own `{{sw-icon "caret-left" "size-6"}}` pattern) never reach the compiled sheet and icons render unsized.
  // The FIRST arg may be a quoted literal ("mail") OR a BARE VARIABLE/PATH (`icon`, `this.icon`) — the latter is
  // the common `{{#each company.social}} … {{sw-icon icon "size-7"}}` case, whose class arg would otherwise be
  // missed (the footer social icons then render 0×0). The class is the second string.
  const helperRe = /\{\{\s*sw-(?:icon|flag)\s+(?:"[^"]*"|'[^']*'|[^\s"'{}]+)\s+(?:"([^"]*)"|'([^']*)')/g;
  while ((m = helperRe.exec(html)) !== null) {
    if (full(m[1] ?? m[2] ?? '')) return [...tokens];
  }
  return [...tokens];
}

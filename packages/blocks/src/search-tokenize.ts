// The ONE tokenizer for site search. The publish build writes the index with it and the browser
// runtime queries the index with it — a second, parallel implementation would drift and pages would
// silently stop matching, which is the failure class this module exists to make impossible. Import it
// from both sides; never re-derive the rules. See docs/site-search.md §4.
//
// Language support is the standard `Intl.Segmenter`, not a per-language rule table: ICU word
// segmentation handles scripts that do not space their words (Chinese, Japanese, Thai, Khmer) with no
// code of ours per language. Everything below is pure and framework-free.

/** One indexed token: the term as stored, plus where it came from in the SOURCE text. */
export interface Token {
  /** The normalized term, exactly as it appears in the index. */
  term: string;
  /** Character offset of the token's first character in the ORIGINAL input string. */
  start: number;
  /**
   * Length of the token in the ORIGINAL input string. NOT `term.length`: normalization can change
   * length (a decomposed `a`+U+0308 is two characters for one letter; an `ﬁ` ligature is one
   * character for two). Snippet highlighting wraps SOURCE characters, so it needs this.
   */
  len: number;
}

export interface TokenizeOptions {
  /** BCP-47 locale driving segmentation and case folding. Defaults to the runtime's locale. */
  locale?: string;
  /**
   * Fold combining marks, so `Müller` matches `Muller` (default true). A per-locale switch rather
   * than a hardcoded rule: in Swedish `å`/`ä`/`ö` are distinct letters, not decorated `a`/`o`, so
   * folding there trades away precision an author may want to keep.
   */
  fold?: boolean;
  /** Test-only: take the regex path even where `Intl.Segmenter` exists. */
  forceFallback?: boolean;
}

/**
 * Combining marks that DECORATE A LATIN BASE — the only ones folding may strip.
 *
 * ★ Not `\p{M}+`. In Thai, Devanagari, Hebrew and Arabic a combining mark is a letter, not an accent:
 * stripping them turns `ไม่มี` into `ไมมี` and collapses genuinely different words into one term. A
 * Latin-only test suite cannot catch that, which is why docs/site-search.md §8 requires multi-script
 * coverage. Anchoring the strip to a Latin base keeps `Müller`→`muller` while leaving every script
 * that encodes meaning in marks completely untouched.
 */
const LATIN_BASE_WITH_MARKS = /(\p{sc=Latin})\p{M}+/gu;

/**
 * Fallback word split for runtimes without `Intl.Segmenter` (an old browser at query time; never the
 * Node build). Letters, digits and marks form a token; everything else separates. DEGRADED for
 * unspaced scripts — a CJK run becomes one token rather than words — which is why it is only ever a
 * fallback. Documented in docs/site-search.md §4.
 */
const FALLBACK_WORD = /[\p{L}\p{N}\p{M}]+/gu;

/**
 * Normalize one term to its indexed form: NFKC (so full-width and ligature forms converge) →
 * locale-aware lowercase → optional combining-mark fold.
 *
 * Lowercasing is locale-aware because it has to be: Turkish `I` lowercases to the dotless `ı`, and a
 * locale-blind `toLowerCase()` would make a Turkish site fail to match its own content.
 */
export function normalizeTerm(term: string, opts: TokenizeOptions = {}): string {
  const lower = opts.locale ? term.normalize('NFKC').toLocaleLowerCase(opts.locale) : term.normalize('NFKC').toLowerCase();
  if (opts.fold === false) return lower;
  return lower.normalize('NFD').replace(LATIN_BASE_WITH_MARKS, '$1').normalize('NFC');
}

/** Cached segmenters — constructing one per call is measurably expensive on a whole-site build. */
const segmenters = new Map<string, Intl.Segmenter>();

function wordSegmenter(locale: string | undefined): Intl.Segmenter | undefined {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return undefined;
  const key = locale ?? '';
  let seg = segmenters.get(key);
  if (!seg) {
    seg = locale ? new Intl.Segmenter(locale, { granularity: 'word' }) : new Intl.Segmenter(undefined, { granularity: 'word' });
    segmenters.set(key, seg);
  }
  return seg;
}

/**
 * Split `text` into indexed tokens with their source offsets.
 *
 * ★ Segments the ORIGINAL string and normalizes each segment individually — never the whole string
 * first. NFKC can change length, so normalizing up front would shift every later offset and the
 * snippet renderer would slice the wrong characters.
 */
export function tokenize(text: string, opts: TokenizeOptions = {}): Token[] {
  if (!text) return [];
  const out: Token[] = [];
  const push = (raw: string, start: number): void => {
    const term = normalizeTerm(raw, opts);
    // A segment can normalize to nothing (a lone combining mark under folding) — it indexes nothing.
    if (term) out.push({ term, start, len: raw.length });
  };

  const seg = opts.forceFallback ? undefined : wordSegmenter(opts.locale);
  if (seg) {
    for (const s of seg.segment(text)) {
      if (s.isWordLike) push(s.segment, s.index);
    }
    return out;
  }

  FALLBACK_WORD.lastIndex = 0;
  for (let m = FALLBACK_WORD.exec(text); m !== null; m = FALLBACK_WORD.exec(text)) {
    push(m[0], m.index);
  }
  return out;
}

/** {@link tokenize} when only the terms matter (query parsing, short fields). */
export function terms(text: string, opts: TokenizeOptions = {}): string[] {
  return tokenize(text, opts).map((t) => t.term);
}

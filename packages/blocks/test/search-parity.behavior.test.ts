// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect } from 'vitest';
import { SEARCH_JS } from '../src/search.js';
import { tokenize, normalizeTerm } from '../src/search-tokenize.js';

// ★ THE test that makes the duplicated tokenizer safe. The build indexes with the TypeScript
// tokenizer; the browser queries with the copy inside SEARCH_JS. If they ever disagree, a page stops
// matching its own words and NOTHING reports it — the search box just returns nothing. So both are run
// over the same corpus here and compared token for token.
//
// If this test fails after you edited one side, the fix is to make the other side match — not to
// relax the assertion.

interface RuntimeToken {
  term: string;
  start: number;
  len: number;
}

/** Lift the tokenizer section out of the shipped runtime string and evaluate it in isolation. */
function runtimeTokenizer(): {
  tokenize: (text: string, locale?: string, fold?: boolean) => RuntimeToken[];
  normalizeTerm: (term: string, locale?: string, fold?: boolean) => string;
} {
  const start = SEARCH_JS.indexOf('// ---- tokenizer');
  const end = SEARCH_JS.indexOf('// ---- ranking');
  if (start < 0 || end < 0) {
    throw new Error('the tokenizer section markers moved in SEARCH_JS — update this parity test');
  }
  const source = SEARCH_JS.slice(start, end);
   
  return new Function(`${source}; return { tokenize: tokenize, normalizeTerm: normalizeTerm };`)() as ReturnType<
    typeof runtimeTokenizer
  >;
}

const CORPUS: Array<{ text: string; locale?: string; fold?: boolean; why: string }> = [
  { text: 'The quick, brown fox!', why: 'Latin baseline' },
  { text: 'Wir decken Dächer in Dortmund', why: 'Latin diacritics fold' },
  { text: 'Dächer', why: 'decomposed diacritic — term.length differs from len' },
  { text: 'oﬃce hours today', why: 'NFKC ligature changes length' },
  { text: '東京都の観光案内と地図', why: 'Japanese, no spaces' },
  { text: 'ภาษาไทยไม่มีช่องว่าง', why: 'Thai — marks are letters, must NOT fold' },
  { text: 'مرحبا بالعالم', why: 'Arabic' },
  { text: 'मिल गया', why: 'Devanagari matra' },
  { text: 'Model A-250 costs 1200 EUR', why: 'digits and hyphens' },
  { text: 'the __proto__ and constructor words', why: 'prototype-key collisions' },
  { text: 'ＡＢＣ ﬁle', why: 'full-width + ligature' },
  { text: 'IŞIK ışık', locale: 'tr', why: 'Turkish dotless i — locale-aware lowercase' },
  { text: 'Åre Ängelholm', locale: 'sv', fold: false, why: 'folding OFF keeps distinct letters' },
  { text: '', why: 'empty' },
  { text: '—  … !!', why: 'punctuation only' },
];

describe('tokenizer parity: shipped runtime vs build-time module', () => {
  const runtime = runtimeTokenizer();

  for (const c of CORPUS) {
    it(`agrees on ${JSON.stringify(c.text).slice(0, 42)} — ${c.why}`, () => {
      const built = tokenize(c.text, { locale: c.locale, fold: c.fold });
      const shipped = runtime.tokenize(c.text, c.locale, c.fold);
      expect(shipped.map((t) => t.term)).toEqual(built.map((t) => t.term));
      expect(shipped.map((t) => t.start)).toEqual(built.map((t) => t.start));
      expect(shipped.map((t) => t.len)).toEqual(built.map((t) => t.len));
    });
  }

  it('agrees on normalizeTerm across folding modes', () => {
    for (const [term, locale, fold] of [
      ['Müller', undefined, undefined],
      ['Müller', undefined, false],
      ['ไม่มี', undefined, undefined],
      ['I', 'tr', false],
      ['İ', 'tr', undefined],
      ['ＡＢＣ', undefined, undefined],
    ] as Array<[string, string | undefined, boolean | undefined]>) {
      expect(runtime.normalizeTerm(term, locale, fold)).toBe(normalizeTerm(term, { locale, fold }));
    }
  });

  it('folds a Latin base but never a Thai one — the regression both copies must share', () => {
    expect(runtime.normalizeTerm('Müller')).toBe('muller');
    expect(runtime.normalizeTerm('ไม่มี')).toBe('ไม่มี');
  });
});

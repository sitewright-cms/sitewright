import { describe, it, expect } from 'vitest';
import { tokenize, normalizeTerm, terms } from '../src/search-tokenize.js';

/** Just the normalized terms, for assertions that don't care about offsets. */
const t = (s: string, opts?: Parameters<typeof tokenize>[1]): string[] => tokenize(s, opts).map((x) => x.term);

describe('tokenize — Latin baseline', () => {
  it('splits on whitespace and punctuation, lowercases', () => {
    expect(t('The quick, brown fox!')).toEqual(['the', 'quick', 'brown', 'fox']);
  });

  it('keeps digits (a product code or phone number is searchable)', () => {
    expect(t('Model A-250 costs 1200 EUR')).toEqual(['model', 'a', '250', 'costs', '1200', 'eur']);
  });

  it('returns nothing for empty or punctuation-only input', () => {
    expect(t('')).toEqual([]);
    expect(t('   ')).toEqual([]);
    expect(t('—  … !!')).toEqual([]);
  });
});

describe('tokenize — offsets index into the ORIGINAL string', () => {
  // The snippet renderer slices the stored text with these offsets, so an offset that
  // pointed into a normalized copy would slice the wrong characters (see docs/site-search.md §3.3).
  it('every offset+length lands on the token it reports', () => {
    const text = 'Wir decken Dächer in Dortmund';
    for (const tok of tokenize(text)) {
      // `len` is the ORIGINAL character count, which normalization may not preserve —
      // `<mark>` has to wrap source characters, so the token carries both.
      expect(normalizeTerm(text.slice(tok.start, tok.start + tok.len))).toBe(tok.term);
    }
  });

  it('reports the ORIGINAL length when normalization changes it', () => {
    // Written decomposed on purpose: 'a' + U+0308 is two source characters for one
    // normalized letter, so term.length (6) and len (7) genuinely differ here.
    const [tok] = tokenize('Da\u0308cher');
    if (!tok) throw new Error('expected a token');
    expect(tok.term).toBe('dacher');
    expect(tok.term).toHaveLength(6);
    expect(tok.len).toBe(7);
  });

  it('survives a normalization that CHANGES length (NFKC ligature)', () => {
    // 'ﬁ' (U+FB01) is ONE character that NFKC-expands to two. Normalizing the whole
    // string before segmenting would shift every later offset by one.
    const text = 'oﬃce hours today';
    const toks = tokenize(text);
    const last = toks[toks.length - 1];
    if (!last) throw new Error('expected a token');
    expect(last.term).toBe('today');
    expect(text.slice(last.start)).toBe('today');
  });
});

describe('tokenize — scripts without spaces', () => {
  it('segments Japanese', () => {
    expect(t('東京都の観光案内')).toEqual(['東京', '都', 'の', '観光', '案内']);
  });

  it('segments Thai', () => {
    expect(t('ภาษาไทยไม่มีช่องว่าง')).toEqual(['ภาษา', 'ไทย', 'ไม่มี', 'ช่อง', 'ว่าง']);
  });

  it('segments Arabic', () => {
    expect(t('مرحبا بالعالم')).toEqual(['مرحبا', 'بالعالم']);
  });

  it('gives Japanese offsets that slice the original text', () => {
    const text = '東京都の観光案内';
    const tok = tokenize(text)[2];
    if (!tok) throw new Error('expected a third token');
    expect(text.slice(tok.start, tok.start + tok.len)).toBe('の');
  });
});

describe('normalizeTerm — folding', () => {
  it('folds combining marks by default so Müller matches Muller', () => {
    expect(normalizeTerm('Müller')).toBe('muller');
    expect(normalizeTerm('Muller')).toBe('muller');
    expect(normalizeTerm('café')).toBe('cafe');
  });

  it('preserves distinct letters when folding is off for a locale', () => {
    // Swedish å/ä/ö are letters, not decorated a/o — a site in sv can turn folding off.
    expect(normalizeTerm('Åre', { fold: false })).toBe('åre');
    expect(normalizeTerm('Åre', { fold: true })).toBe('are');
  });

  it('NEVER strips marks that are letters rather than accents', () => {
    // Regression: folding was `\p{M}+`, which deleted Thai tone marks — `ไม่มี` became `ไมมี`,
    // merging distinct words into one term. Marks are only strippable over a LATIN base.
    expect(normalizeTerm('ไม่มี')).toBe('ไม่มี');
    expect(normalizeTerm('मिल')).toBe('मिल'); // Devanagari matra carries the vowel
    expect(normalizeTerm('שָׁלוֹם')).toBe('שָׁלוֹם'); // Hebrew niqqud
    // …while Latin folding still works, which is the whole point of the option.
    expect(normalizeTerm('Müller')).toBe('muller');
  });

  it('applies NFKC (full-width and ligature forms normalize)', () => {
    expect(normalizeTerm('ＡＢＣ')).toBe('abc');
    expect(normalizeTerm('ﬁle')).toBe('file');
  });
});

describe('normalizeTerm — lowercasing is locale-aware', () => {
  // Turkish dotless i: 'I' lowercases to 'ı' in tr and to 'i' everywhere else. A
  // locale-blind toLowerCase() silently makes tr queries miss their own content.
  it('lowercases Turkish I to the dotless form', () => {
    expect(normalizeTerm('I', { locale: 'tr', fold: false })).toBe('ı');
    expect(normalizeTerm('I', { locale: 'en', fold: false })).toBe('i');
  });

  it('keeps Turkish dotted capital İ as i', () => {
    expect(normalizeTerm('İ', { locale: 'tr' })).toBe('i');
  });
});

describe('tokenize — build/query parity', () => {
  // The index is written by the build and queried by the runtime. Identical input MUST
  // produce identical tokens or a page simply never matches (docs/site-search.md §4).
  const samples = [
    'Wir decken Dächer',
    '東京都の観光案内',
    'Model A-250',
    'ภาษาไทย',
    'Café Müller & Söhne',
  ];
  for (const s of samples) {
    it(`is deterministic for ${JSON.stringify(s)}`, () => {
      expect(t(s)).toEqual(t(s));
    });
  }

  it('terms() is tokenize() without offsets', () => {
    for (const s of samples) expect(terms(s)).toEqual(t(s));
  });
});

describe('tokenize — regex fallback', () => {
  // Exercised when Intl.Segmenter is unavailable (an old browser at query time; never the
  // Node build). Latin must be identical; CJK degrades to whole runs, which is documented.
  it('matches the segmenter for Latin text', () => {
    expect(t('The quick, brown fox!', { forceFallback: true })).toEqual(['the', 'quick', 'brown', 'fox']);
  });

  it('still reports usable offsets', () => {
    const text = 'Wir decken Dächer';
    for (const tok of tokenize(text, { forceFallback: true })) {
      expect(normalizeTerm(text.slice(tok.start, tok.start + tok.len))).toBe(tok.term);
    }
  });

  it('degrades CJK to unsegmented runs (documented limitation)', () => {
    expect(t('東京都の観光案内', { forceFallback: true })).toEqual(['東京都の観光案内']);
  });
});

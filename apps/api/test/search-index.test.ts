import { describe, it, expect } from 'vitest';
import { tokenize } from '@sitewright/blocks';
import {
  extractIndexText,
  extractIndexBlocks,
  buildSearchIndex,
  decodeDeltas,
  type SearchIndexFile,
  type SearchPageInput,
} from '../src/publish/search-index.js';

const page = (over: Partial<SearchPageInput> = {}): SearchPageInput => ({
  url: '/',
  title: 'Home',
  bodyHtml: '<p>hello world</p>',
  depth: 0,
  inNav: true,
  ...over,
});

/** Narrow away `undefined` from an index lookup, failing the test instead of the type check. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** The decoded body ordinals of `term` on page `pageIndex`. */
function ordinals(index: SearchIndexFile, term: string, pageIndex = 0): number[] {
  const postings = must(index.terms[term], `postings for "${term}"`);
  const hit = must(
    postings.find(([p]) => p === pageIndex),
    `a posting for "${term}" on page ${pageIndex}`,
  );
  return decodeDeltas(hit[1]);
}

describe('extractIndexText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(extractIndexText('<div>\n  <p>Wir decken   Dächer</p>\n</div>')).toBe('Wir decken Dächer');
  });

  it('separates adjacent elements with a word boundary', () => {
    // Without this, `<p>alpha</p><p>beta</p>` indexes the single term "alphabeta".
    expect(extractIndexText('<p>alpha</p><p>beta</p>')).toBe('alpha beta');
  });

  it('drops script, style, svg and noscript content', () => {
    const html = [
      '<p>keep</p>',
      '<script>var secret = "drop";</script>',
      '<style>.drop{color:red}</style>',
      '<svg><title>drop</title></svg>',
      '<noscript>drop</noscript>',
    ].join('');
    expect(extractIndexText(html)).toBe('keep');
  });

  it('drops HTML comments', () => {
    expect(extractIndexText('<p>keep</p><!-- drop me -->')).toBe('keep');
  });

  it('keeps img alt text as content', () => {
    expect(extractIndexText('<p>roof</p><img src="/a.jpg" alt="Slate roof in Dortmund">')).toBe(
      'roof Slate roof in Dortmund',
    );
  });

  it('ignores every other attribute', () => {
    const html = '<div class="hidden lg:flex" data-sw-text="body" href="/nope"><p>only this</p></div>';
    expect(extractIndexText(html)).toBe('only this');
  });

  it('decodes entities', () => {
    expect(extractIndexText('<p>Fish&nbsp;&amp;&nbsp;Chips &#39;n more</p>')).toBe("Fish & Chips 'n more");
  });

  it('stays linear with MANY CLOSED skip tags — the icon-grid case', () => {
    // The original scan called html.toLowerCase() INSIDE the loop, once per script/style/svg, so a
    // page of inline Phosphor icons went quadratic: measured 11ms at 2k icons, 705ms at 8k. The
    // unclosed-tag test below never caught it (it breaks out on the first iteration).
    const body = '<p>word</p><svg><path d="M0 0"/></svg>'.repeat(8000);
    const started = Date.now();
    const text = extractIndexText(body);
    const elapsed = Date.now() - started;
    expect(text.startsWith('word')).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('stays linear on unclosed markup', () => {
    // extractHeadings avoids lazy-quantifier region regexes because they go quadratic on
    // unclosed tags; this scan must not reintroduce that. Many opens, no closes.
    const hostile = '<script>'.repeat(20_000);
    const started = Date.now();
    expect(extractIndexText(hostile)).toBe('');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('extractIndexBlocks — block segmentation', () => {
  it('splits at block boundaries but not at inline ones', () => {
    expect(extractIndexBlocks('<p>alpha</p><p>beta</p>')).toEqual(['alpha', 'beta']);
    // A phrase may legitimately run through <strong>/<a>/<em> — those must NOT split.
    expect(extractIndexBlocks('<p>alpha <strong>beta</strong> gamma</p>')).toEqual(['alpha beta gamma']);
  });
});

describe('buildSearchIndex — postings', () => {
  it('leaves an ordinal GAP between blocks so a phrase cannot bridge them', () => {
    // Two cards: one ends with "alpha", the next begins with "beta". They are NOT the phrase
    // "alpha beta", however adjacent they look once the markup is flattened.
    const { index } = buildSearchIndex('en', [
      page({ bodyHtml: '<div><h3>ends with alpha</h3></div><div><p>beta starts here</p></div>' }),
    ]);
    const alpha = must(ordinals(index, 'alpha')[0], 'alpha ordinal');
    const beta = must(ordinals(index, 'beta')[0], 'beta ordinal');
    expect(beta).toBeGreaterThan(alpha + 1);
  });

  it('keeps words inside ONE block adjacent', () => {
    const { index } = buildSearchIndex('en', [page({ bodyHtml: '<p>alpha beta</p>' })]);
    const alpha = must(ordinals(index, 'alpha')[0], 'alpha ordinal');
    const beta = must(ordinals(index, 'beta')[0], 'beta ordinal');
    expect(beta).toBe(alpha + 1);
  });

  it('maps a term to the pages that contain it', () => {
    const { index } = buildSearchIndex('de', [
      page({ url: '/a/', bodyHtml: '<p>dachdecker in dortmund</p>' }),
      page({ url: '/b/', bodyHtml: '<p>maler in dortmund</p>' }),
    ]);
    expect(must(index.terms['dortmund'], 'dortmund postings').map(([p]) => p)).toEqual([0, 1]);
    expect(must(index.terms['dachdecker'], 'dachdecker postings').map(([p]) => p)).toEqual([0]);
  });

  it('records ordinals so adjacency (phrase search) is decidable', () => {
    const { index } = buildSearchIndex('en', [page({ bodyHtml: '<p>alpha beta gamma</p>' })]);
    const alpha = must(ordinals(index, 'alpha')[0], 'an alpha ordinal');
    const beta = must(ordinals(index, 'beta')[0], 'a beta ordinal');
    const gamma = must(ordinals(index, 'gamma')[0], 'a gamma ordinal');
    expect(beta).toBe(alpha + 1);
    expect(gamma).toBe(beta + 1);
  });

  it('counts body tokens for length normalization', () => {
    const { index } = buildSearchIndex('en', [page({ bodyHtml: '<p>one two three</p>' })]);
    expect(must(index.pages[0], 'a page row').n).toBe(3);
  });

  it('survives terms that collide with Object prototype keys', () => {
    // Regression: postings lived on a plain `{}`, and `obj['__proto__'] = …` does not create an own
    // property — it mutates the prototype, so the term disappeared from the emitted JSON with no
    // error anywhere. ICU segments `__proto__` as one word, so any page that mentions it (a docs
    // site about templating, say) silently lost that term.
    const { index } = buildSearchIndex('en', [
      page({ bodyHtml: '<p>the __proto__ and constructor and toString words</p>' }),
    ]);
    for (const term of ['__proto__', 'constructor', 'tostring']) {
      expect(Object.hasOwn(index.terms, term)).toBe(true);
      expect(ordinals(index, term)).toHaveLength(1);
    }
    // …and it must still be there after a JSON round-trip, which is how the runtime reads it.
    const roundTripped = JSON.parse(JSON.stringify(index)) as SearchIndexFile;
    expect(Object.hasOwn(roundTripped.terms, '__proto__')).toBe(true);
  });

  it('indexes ONLY the body it was given', () => {
    // Chrome exclusion is structural: the caller passes bodyHtml alone, so a nav word
    // cannot reach the index even if it appears on every page.
    const { index } = buildSearchIndex('en', [page({ bodyHtml: '<p>body only</p>' })]);
    expect(index.terms['impressum']).toBeUndefined();
  });
});

describe('buildSearchIndex — fields', () => {
  it('captures title, description and headings by level', () => {
    const { index } = buildSearchIndex('en', [
      page({
        title: 'Leistungen',
        description: 'Alles rund ums Dach',
        bodyHtml: '<h1>Unsere Leistungen</h1><h2>Dachdecker</h2><h4>Details</h4><p>text</p>',
      }),
    ]);
    const f = must(index.pages[0], 'a page row').f;
    expect(f.t).toEqual(['leistungen']);
    expect(f.d).toEqual(['alles', 'rund', 'ums', 'dach']);
    expect(f.h1).toEqual(['unsere', 'leistungen']);
    expect(f.h2).toEqual(['dachdecker']);
    expect(f.h4).toEqual(['details']);
  });

  it('omits empty fields rather than storing blanks', () => {
    const { index } = buildSearchIndex('en', [page({ title: 'X', bodyHtml: '<p>y</p>' })]);
    const row = must(index.pages[0], 'a page row');
    expect(row.f.d).toBeUndefined();
    expect(row.f.h1).toBeUndefined();
    expect(row.d).toBeUndefined();
  });

  it('carries the structural priors the ranking needs', () => {
    const { index } = buildSearchIndex('en', [page({ url: '/a/b/c/', depth: 3, inNav: false })]);
    const row = must(index.pages[0], 'a page row');
    expect(row.dep).toBe(3);
    expect(row.nv).toBe(0);
  });
});

describe('buildSearchIndex — text + offsets', () => {
  it('offsets slice back to the exact token in the stored text', () => {
    const html = '<h1>Wir decken Dächer</h1><p>in Dortmund und Hagen</p>';
    const { index, text } = buildSearchIndex('de', [page({ bodyHtml: html })]);
    const stored = must(text.text[0], 'stored text');
    const offsets = decodeDeltas(must(text.offsets[0], 'stored offsets'));
    // The table is indexed BY ORDINAL, and ordinals carry gaps between blocks — so it is longer
    // than the token count, and position-in-a-retokenization is NOT the right key.
    expect(offsets.length).toBeGreaterThanOrEqual(must(index.pages[0], 'a page row').n);
    for (const term of ['wir', 'decken', 'dacher', 'dortmund', 'hagen']) {
      for (const ord of ordinals(index, term)) {
        const at = must(offsets[ord], `an offset for "${term}"`);
        expect(tokenize(stored.slice(at), { locale: 'de' })[0]?.term).toBe(term);
      }
    }
  });

  it('a posting ordinal indexes into that page offset table', () => {
    const { index, text } = buildSearchIndex('de', [page({ bodyHtml: '<p>alpha beta gamma</p>' })]);
    const ordinal = must(ordinals(index, 'gamma')[0], 'a gamma ordinal');
    const offsets = decodeDeltas(must(text.offsets[0], 'stored offsets'));
    const at = must(offsets[ordinal], 'an offset at that ordinal');
    expect(must(text.text[0], 'stored text').slice(at, at + 5)).toBe('gamma');
  });

  it('stores one text entry per page, aligned with the page table', () => {
    const { index, text } = buildSearchIndex('en', [
      page({ url: '/a/', bodyHtml: '<p>first</p>' }),
      page({ url: '/b/', bodyHtml: '<p>second</p>' }),
    ]);
    expect(text.text).toHaveLength(index.pages.length);
    expect(text.text[1]).toBe('second');
  });
});

describe('buildSearchIndex — duplicate collapse', () => {
  it('gives byte-identical bodies the same group id', () => {
    // Observed in the wild: a source site served identical documents at `/` and `/shop/`,
    // so both clone pages match every query and the list shows one page twice.
    const { index } = buildSearchIndex('en', [
      page({ url: '/', bodyHtml: '<p>same body</p>' }),
      page({ url: '/shop/', bodyHtml: '<p>same body</p>' }),
      page({ url: '/other/', bodyHtml: '<p>different</p>' }),
    ]);
    const [a, b, c] = index.pages.map((p) => p.g);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it("keeps every page in the index — collapsing is the runtime's call", () => {
    const { index } = buildSearchIndex('en', [
      page({ url: '/', bodyHtml: '<p>same</p>' }),
      page({ url: '/shop/', bodyHtml: '<p>same</p>' }),
    ]);
    expect(index.pages.map((p) => p.u)).toEqual(['/', '/shop/']);
  });
});

describe('delta encoding', () => {
  it('round-trips an ascending sequence', () => {
    const { index } = buildSearchIndex('en', [page({ bodyHtml: '<p>a b a c a</p>' })]);
    expect(ordinals(index, 'a')).toEqual([0, 2, 4]);
  });

  it('decodes an empty list', () => {
    expect(decodeDeltas([])).toEqual([]);
  });
});

describe('buildSearchIndex — locale', () => {
  it('records the locale it was built for', () => {
    const { index } = buildSearchIndex('de', [page()]);
    expect(index.lang).toBe('de');
    expect(index.v).toBe(1);
  });

  it('honours a locale that turns folding off', () => {
    const { index } = buildSearchIndex('sv', [page({ bodyHtml: '<p>Åre</p>' })], { fold: false });
    expect(index.terms['åre']).toBeDefined();
    expect(index.terms['are']).toBeUndefined();
  });
});

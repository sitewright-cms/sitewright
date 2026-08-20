// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SEARCH_JS, renderSearchBox } from '../src/search.js';
import { encodeDeltas, tokenize, type SearchIndexFile, type SearchTextFile } from '../src/index.js';

// Behavioral coverage for the shipped runtime: ranking, phrase filtering, snippets, duplicate
// collapse and link resolution, exercised by running the REAL runtime string in a DOM.
// docs/site-search.md §5 is the contract these assert.

const SITE = 'https://example.com/sub/';

interface FixturePage {
  u: string;
  t: string;
  d?: string;
  /** A string is one block; an array is several, with the ordinal GAP the build inserts. */
  body: string | string[];
  dep?: number;
  nv?: 0 | 1;
  g?: number;
  f?: Record<string, string[]>;
}

/** Assemble index + text files the way the publish build does (apps/api/src/publish/search-index.ts). */
function makeFiles(pages: FixturePage[], lang = 'en'): { index: SearchIndexFile; text: SearchTextFile } {
  const terms = new Map<string, Array<[number, number[]]>>();
  const text: string[] = [];
  const offsets: number[][] = [];
  const rows = pages.map((p, i) => {
    const blocks = Array.isArray(p.body) ? p.body : [p.body];
    const joined = blocks.join(' ');
    const perTerm = new Map<string, number[]>();
    const tokenOffsets: number[] = [];
    let ordinal = 0;
    let base = 0;
    let tokenCount = 0;
    for (const [bi, block] of blocks.entries()) {
      for (const tok of tokenize(block, { locale: lang })) {
        const list = perTerm.get(tok.term);
        if (list) list.push(ordinal);
        else perTerm.set(tok.term, [ordinal]);
        tokenOffsets[ordinal] = base + tok.start;
        ordinal += 1;
        tokenCount += 1;
      }
      base += block.length + 1;
      if (bi < blocks.length - 1) {
        tokenOffsets[ordinal] = base;
        ordinal += 1;
      }
    }
    for (const [term, ords] of perTerm) {
      const postings = terms.get(term) ?? [];
      postings.push([i, encodeDeltas(ords)]);
      terms.set(term, postings);
    }
    text.push(joined);
    offsets.push(encodeDeltas(tokenOffsets));
    return {
      u: p.u,
      t: p.t,
      ...(p.d ? { d: p.d } : {}),
      n: tokenCount,
      dep: p.dep ?? 0,
      nv: (p.nv ?? 0) as 0 | 1,
      g: p.g ?? i,
      f: p.f ?? { t: tokenize(p.t, { locale: lang }).map((x) => x.term) },
    };
  });
  return {
    index: { v: 1, lang, pages: rows, terms: Object.fromEntries(terms) },
    text: { v: 1, text, offsets },
  };
}

function mount(files: { index: SearchIndexFile; text: SearchTextFile }, opts: { lang?: string } = {}): void {
  document.documentElement.setAttribute('lang', opts.lang ?? 'en');
  // The runtime resolves URLs from its own <script src> — this is also what proves sub-folder hosting.
  document.body.innerHTML = `<script src="${SITE}c-search.js"></script>${renderSearchBox({ limit: 10 })}`;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const name = String(url).replace(SITE, '');
      const body = name.startsWith('search-index') ? files.index : name.startsWith('search-text') ? files.text : null;
      if (!body || /\.(de|fr)\.json$/.test(name)) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }),
  );
   
  (0, eval)(SEARCH_JS);
}

const input = (): HTMLInputElement => document.querySelector('[data-sw-part="input"]') as HTMLInputElement;
const results = (): HTMLElement => document.querySelector('[data-sw-part="results"]') as HTMLElement;
const hits = (): HTMLAnchorElement[] => Array.from(results().querySelectorAll('a.sw-search-hit'));
const titles = (): string[] =>
  hits().map((a) => (a.querySelector('.sw-search-hit-title') as HTMLElement).textContent ?? '');

/** Type a query and let the debounce + fetch chain settle. */
async function type(value: string): Promise<void> {
  input().value = value;
  input().dispatchEvent(new Event('input'));
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 30));
}

describe('Search runtime behavior (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a ranked list of pages as links', async () => {
    mount(
      makeFiles([
        { u: '/roofing/', t: 'Roofing', body: 'we fit slate roofs and repair chimneys' },
        { u: '/about/', t: 'About', body: 'a family business since 1974' },
      ]),
    );
    await type('slate');
    expect(titles()).toEqual(['Roofing']);
  });

  it('resolves links against the index URL, so sub-folder hosting works', async () => {
    mount(makeFiles([{ u: '/roofing/', t: 'Roofing', body: 'slate roofs' }]));
    await type('slate');
    // NOT https://example.com/roofing/ — the site lives under /sub/.
    expect(hits()[0]?.getAttribute('href')).toBe('https://example.com/sub/roofing/');
  });

  it('links the HOME page to the site root, not to the runtime script', async () => {
    // `u` is '/', and new URL('', base) returns the BASE — so every home-page result pointed at
    // c-search.js. Only a real href assertion on the home page catches this.
    mount(makeFiles([{ u: '/', t: 'Home', body: 'welcome to the homepage' }]));
    await type('homepage');
    expect(hits()[0]?.getAttribute('href')).toBe('https://example.com/sub/');
  });

  it('does not match a phrase that spans two blocks', async () => {
    // One card ends with "alpha", the next begins with "beta". Flattened they look adjacent; they
    // are not the phrase "alpha beta", and the ordinal gap is what makes that decidable.
    mount(
      makeFiles([
        { u: '/cards/', t: 'Cards', body: ['a card ending with alpha', 'beta opens the next card'] },
        { u: '/real/', t: 'Real', body: 'here alpha beta really are adjacent' },
      ]),
    );
    expect(await type('"alpha beta"').then(() => titles())).toEqual(['Real']);
  });

  it('does not prefix-expand a word inside a quoted phrase', async () => {
    // A phrase word borrowing a longer word's positions made `"cat nap"` match "…category nap…".
    mount(makeFiles([{ u: '/a/', t: 'A', body: 'the category nap is not what was asked for' }]));
    await type('"cat nap"');
    expect(hits()).toHaveLength(0);
  });

  it('treats a quoted phrase as a filter, not a boost', async () => {
    mount(
      makeFiles([
        { u: '/a/', t: 'A', body: 'alpha beta together here' },
        { u: '/b/', t: 'B', body: 'beta first and alpha later, alpha again, alpha' },
      ]),
    );
    await type('alpha beta');
    expect(titles().sort()).toEqual(['A', 'B']);
    await type('"alpha beta"');
    expect(titles()).toEqual(['A']);
  });

  it('ranks a page matching ALL terms above one matching fewer', async () => {
    mount(
      makeFiles([
        // Repeats 'zebra' many times, so raw term frequency favours it — coverage must still win.
        { u: '/one/', t: 'One', body: 'zebra zebra zebra zebra zebra zebra zebra zebra' },
        { u: '/both/', t: 'Both', body: 'zebra and quokka' },
      ]),
    );
    await type('zebra quokka');
    expect(titles()[0]).toBe('Both');
  });

  it('never lets structural priors overturn relevance', async () => {
    // The home page is in the nav, at depth 0, and mentions the term once. A deep, non-nav page
    // is genuinely about it. "The home page wins everything" is the named failure mode.
    mount(
      makeFiles([
        { u: '/', t: 'Home', body: 'welcome to the site, we also do gutters somewhere', dep: 0, nv: 1 },
        {
          u: '/services/gutters/',
          t: 'Gutters',
          body: 'gutters gutters gutters cleaning and gutters repair',
          dep: 2,
          nv: 0,
        },
      ]),
    );
    await type('gutters');
    expect(titles()[0]).toBe('Gutters');
  });

  it('collapses pages that share a duplicate group', async () => {
    mount(
      makeFiles([
        { u: '/', t: 'Home', body: 'identical body text', g: 7 },
        { u: '/shop/', t: 'Shop', body: 'identical body text', g: 7 },
        { u: '/other/', t: 'Other', body: 'identical body text elsewhere', g: 9 },
      ]),
    );
    await type('identical');
    expect(hits()).toHaveLength(2);
  });

  it('shows a context snippet with the match highlighted', async () => {
    mount(
      makeFiles([
        { u: '/a/', t: 'A', body: 'a long introduction before the important keyword and some words after it' },
      ]),
    );
    await type('keyword');
    const mark = results().querySelector('.sw-search-hit-snippet mark');
    expect(mark?.textContent).toBe('keyword');
  });

  it('FINDS a page whose text collides with Object prototype keys', async () => {
    // Asserting "no results" here was VACUOUS: the runtime threw inside a promise (an unhandled
    // rejection), returned nothing, and the assertion passed anyway. Both the postings lookup and
    // the per-term accumulator must be prototype-safe, so the honest assertion is that these words
    // are FOUND — which only works if neither lookup hands back an inherited Object member.
    mount(
      makeFiles([
        { u: '/js/', t: 'JS', body: 'the constructor and toString and __proto__ of an object' },
        { u: '/other/', t: 'Other', body: 'nothing relevant here' },
      ]),
    );
    await type('constructor');
    expect(titles()).toEqual(['JS']);
    await type('tostring');
    expect(titles()).toEqual(['JS']);
    await type('__proto__');
    expect(titles()).toEqual(['JS']);
  });

  it('announces the result count in a live region', async () => {
    mount(makeFiles([{ u: '/a/', t: 'A', body: 'findable words' }]));
    await type('findable');
    const status = document.querySelector('[data-sw-part="status"]') as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('1 results');
  });

  it('shows the empty state only for a query with no matches', async () => {
    mount(makeFiles([{ u: '/a/', t: 'A', body: 'findable words' }]));
    const empty = (): HTMLElement => document.querySelector('[data-sw-part="empty"]') as HTMLElement;
    expect(empty().hidden).toBe(true);
    await type('findable');
    expect(empty().hidden).toBe(true);
    await type('absent');
    expect(empty().hidden).toBe(false);
  });

  it('stays inert when the index is missing, rather than rendering a broken state', async () => {
    document.documentElement.setAttribute('lang', 'en');
    document.body.innerHTML = `<script src="${SITE}c-search.js"></script>${renderSearchBox()}`;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) })));
     
    (0, eval)(SEARCH_JS);
    await type('anything');
    expect(hits()).toHaveLength(0);
    expect(results().textContent).toBe('');
  });

  it('does nothing for a query shorter than two characters', async () => {
    mount(makeFiles([{ u: '/a/', t: 'A', body: 'alpha' }]));
    await type('a');
    expect(hits()).toHaveLength(0);
  });
});

describe('the runtime lives in _assets/_sw/ but the index does not', () => {
  it('fetches the index from the SITE ROOT, not from beside the script', async () => {
    // ★ The runtime resolves the index against its own <script src>. Moving the runtimes into the
    // reserved `_assets/_sw/` directory therefore pointed it at `_assets/_sw/search-index.json` — a
    // 404 that leaves every search box silently inert, which is EXACTLY how this feature shipped
    // broken once before (readAsset closes `.json` at the root on purpose, so the index 404'd on
    // every platform-hosted site and only a browser against a deployed instance found it).
    const asked: string[] = [];
    document.documentElement.setAttribute('lang', 'en');
    document.body.innerHTML =
      `<script src="${SITE}_assets/_sw/c-search.js"></script>${renderSearchBox({ limit: 5 })}`;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        asked.push(String(url));
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      }),
    );
    (0, eval)(SEARCH_JS);
    (document.querySelector('[data-sw-part="input"]') as HTMLInputElement).value = 'anything';
    (document.querySelector('[data-sw-part="input"]') as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));

    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]).toBe(`${SITE}search-index.json`);
    expect(asked.some((u) => u.includes('_assets/_sw/search-index'))).toBe(false);
  });
});


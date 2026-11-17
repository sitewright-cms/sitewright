import { describe, expect, it } from 'vitest';
import { brightData, searchUrlFor } from '../src/rank/providers/brightdata.js';
import { RankProviderError, type FetchLike, type RankSearch, type SubmitOutcome } from '../src/rank/providers/index.js';
import { readPage } from '../src/rank/match.js';

/**
 * The Bright Data provider against a scripted SERP API: one request per results page, answered at once, through a
 * connection in the keyword's country; positions counted here; billed per successful request only.
 */

const CREDS = brightData.parseCredentials({ apiKey: 'bd_s3cret_key', zone: 'serp_api1' });

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { zone?: string; url?: string; format?: string; country?: string } | undefined;
}

type Answer = { status?: number; body: unknown } | Error;

function fakeFetch(handler: (call: Call, google: URL | null) => Answer): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = handler(call, call.body?.url ? new URL(call.body.url) : null);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { fetch, calls };
}

const search = (checkId: string, over: Partial<RankSearch> = {}): RankSearch => ({
  checkId,
  keyword: 'website development namibia',
  engine: 'google',
  device: 'desktop',
  location: { name: 'Namibia', countryCode: 'NA' },
  languageCode: 'en',
  startPage: 1,
  pages: 1,
  ...over,
});

/** One parsed results page: organic `urls` from `global_rank` `from`, and a next page unless `last`. */
const serp = (urls: string[], opts: { last?: boolean; snippets?: string[]; from?: number; timestamp?: string } = {}) => ({
  general: { search_engine: 'google', query: 'q', timestamp: opts.timestamp ?? '2026-11-17T15:00:00.000Z' },
  organic: urls.map((link, i) => ({ link, title: `r${i}`, rank: i + 1, global_rank: (opts.from ?? 1) + i })),
  ...(opts.snippets ? { featured_snippets: opts.snippets.map((link) => ({ link, global_rank: 0 })) } : {}),
  pagination: opts.last ? { current_page: 1 } : { current_page: 1, next_page: 2, next_page_start: 10 },
});

const startOf = (google: URL | null): number => Number(google?.searchParams.get('start') ?? 0);
/** Retries wait 16 seconds for real; these tests record the waits instead. */
const waits: number[] = [];
const noSleep = async (ms: number): Promise<void> => {
  waits.push(ms);
};
const costOf = (o: SubmitOutcome): number | undefined => ('costUsd' in o ? o.costUsd : undefined);

describe('Bright Data credentials, price and URLs', () => {
  it('needs an API key and a zone name; the price is optional', () => {
    expect(CREDS).toEqual({ apiKey: 'bd_s3cret_key', zone: 'serp_api1' });
    expect(() => brightData.parseCredentials({ apiKey: '', zone: 'serp_api1' })).toThrow(/API key/);
    expect(() => brightData.parseCredentials({ apiKey: 'k', zone: '' })).toThrow(/zone/);
    expect(() => brightData.parseCredentials({ apiKey: 'k', zone: 'serp api/1' })).toThrow(RankProviderError);
    expect(brightData.parseCredentials({ apiKey: ' k ', zone: ' z1 ', pricePer1000: '1,30' })).toEqual({ apiKey: 'k', zone: 'z1', pricePer1000: '1.3' });
    expect(() => brightData.parseCredentials({ apiKey: 'k', zone: 'z', pricePer1000: 'cheap' })).toThrow(/price/);
    expect(() => brightData.parseCredentials({ apiKey: 'k', zone: 'z', pricePer1000: '1000' })).toThrow(/price/);
    // Not free: the monthly budget needs a price to count, or charges past the free requests go unchecked.
    expect(() => brightData.parseCredentials({ apiKey: 'k', zone: 'z', pricePer1000: '0' })).toThrow(/above 0/);
  });

  it('books each page at the pay-as-you-go $1.50 per 1,000, or the admin’s price', () => {
    expect(brightData.estimateCostUsd(1, CREDS)).toBeCloseTo(0.0015, 6);
    expect(brightData.estimateCostUsd(5, CREDS)).toBeCloseTo(0.0075, 6);
    expect(brightData.estimateCostUsd(3, { ...CREDS, pricePer1000: '1.3' })).toBeCloseTo(0.0039, 6);
    // A stored price that no longer parses books the pay-as-you-go rate, never nothing.
    expect(brightData.estimateCostUsd(1, { ...CREDS, pricePer1000: '0' })).toBeCloseTo(0.0015, 6);
  });

  it('writes the Google URL with q first, Google’s offset for a later page, a city by name, and parsed results', () => {
    expect(searchUrlFor(search('c', { keyword: 'c++ & gas  fitter' }), 1)).toBe('https://www.google.com/search?q=c%2B%2B+%26+gas++fitter&gl=na&hl=en&brd_json=1');
    expect(searchUrlFor(search('c'), 3)).toBe('https://www.google.com/search?q=website+development+namibia&gl=na&hl=en&start=20&brd_json=1');
    expect(searchUrlFor(search('c', { device: 'mobile', location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' } }), 1)).toBe(
      'https://www.google.com/search?q=website+development+namibia&gl=na&hl=en&uule=Windhoek,Khomas+Region,Namibia&brd_mobile=1&brd_json=1',
    );
  });

  it('offers the country as the only place to pick', async () => {
    expect(await brightData.searchLocations(CREDS, 'NA', 'nam', { fetch: async () => Promise.reject(new Error('no list')) })).toEqual([{ name: 'Namibia', type: 'Country', countryCode: 'NA' }]);
  });
});

describe('Bright Data submit', () => {
  it('reads each search at once, through a connection in its country, with the key in the header', async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: serp(['https://www.google.com/search?q=website+development+namibia&udm=1', 'https://asylum.com.na/', 'https://www.phoenix-tech.net/web-development/']),
    }));
    const [out] = await brightData.submit(CREDS, [search('c1')], { fetch, sleep: noSleep });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.brightdata.com/request');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.authorization).toBe('Bearer bd_s3cret_key');
    expect(calls[0]!.body).toEqual({ zone: 'serp_api1', url: searchUrlFor(search('c1'), 1), format: 'raw', country: 'na' });
    expect(JSON.stringify(calls[0]!.body)).not.toContain('s3cret');
    expect(out).toMatchObject({ checkId: 'c1', state: 'done', costUsd: expect.closeTo(0.0015, 6) });
    const page = (out as Extract<typeof out, { state: 'done' }>).page;
    expect(page.checkedAt).toEqual(new Date('2026-11-17T15:00:00.000Z'));
    expect(page.pagesRead).toBe(1);
    // Google's Map link is no result: the site is second.
    expect(page.entries.map((e) => e.url)).toEqual(['https://asylum.com.na/', 'https://www.phoenix-tech.net/web-development/']);
    expect(readPage(page, { domain: 'phoenix-tech.net', includeSubdomains: true }).hit).toMatchObject({ position: 2 });
  });

  it('reads a result Google wrapped in its own redirect by the site it names — as Bright Data returned on 2026-11-17', async () => {
    const goto = (n: number) => `https://www.google.com/goto?url=CAESWAHEIkXX${n}&gsessionid=x`;
    const results = {
      ...serp([]),
      organic: [
        { link: 'https://www.namibiawebdesign.com/', display_link: 'https://www.namibiawebdesign.com', rank: 1, global_rank: 5 },
        { link: goto(1), display_link: 'https://www.webnamibia.com', rank: 2, global_rank: 9 },
        { link: goto(2), display_link: 'https://www.treasurehunt-design.com › services › web-de...', rank: 3, global_rank: 10 },
        { link: goto(3), rank: 4, global_rank: 11 }, // wrapped, naming nothing: still the 4th result
        { link: goto(4), display_link: 'https://www.phoenix-tech.net › web-development', rank: 5, global_rank: 16 },
      ],
    };
    const { fetch } = fakeFetch(() => ({ body: results }));
    const [out] = await brightData.submit(CREDS, [search('c1')], { fetch, sleep: noSleep });
    const page = (out as Extract<typeof out, { state: 'done' }>).page;
    expect(page.entries.map((e) => e.url)).toEqual([
      'https://www.namibiawebdesign.com/',
      'https://www.webnamibia.com/',
      'https://www.treasurehunt-design.com/',
      goto(3),
      'https://www.phoenix-tech.net/',
    ]);
    expect(readPage(page, { domain: 'phoenix-tech.net', includeSubdomains: true }).hit).toMatchObject({ position: 5, url: 'https://www.phoenix-tech.net/' });
  });

  it('counts a featured snippet first and the ordinary results by Google’s order, its page not twice', async () => {
    const results = serp(['https://b.test/', 'https://snippet.test/', 'https://a.test/'], { snippets: ['https://snippet.test/'] });
    // Out of order on purpose: ranked by `global_rank`.
    results.organic = [results.organic[2]!, results.organic[0]!, results.organic[1]!].map((o, i) => ({ ...o, global_rank: [9, 3, 5][i]! }));
    const { fetch } = fakeFetch(() => ({ body: results }));
    const [out] = await brightData.submit(CREDS, [search('c1')], { fetch, sleep: noSleep });
    const page = (out as Extract<typeof out, { state: 'done' }>).page;
    expect(page.entries.map((e) => [e.kind, e.url])).toEqual([
      ['featured_snippet', 'https://snippet.test/'],
      ['organic', 'https://b.test/'],
      ['organic', 'https://a.test/'],
    ]);
  });

  it('reads a stage of several pages one request each, numbered on from page to page, stopping where Google stops', async () => {
    const { fetch, calls } = fakeFetch((_c, google) => {
      const start = startOf(google);
      if (start === 20) return { body: serp(['https://p3a.test/', 'https://p3b.test/']) };
      if (start === 30) return { body: serp(['https://p4a.test/', 'https://plumbers.na/'], { last: true }) };
      return { body: serp(['https://never.test/']) };
    });
    const [out] = await brightData.submit(CREDS, [search('c1', { startPage: 3, pages: 3 })], { fetch, sleep: noSleep });
    expect(calls.map((c) => startOf(new URL(c.body!.url!)))).toEqual([20, 30]); // page 5 never asked for
    expect(out).toMatchObject({ state: 'done', costUsd: expect.closeTo(0.003, 6) }); // two pages
    const page = (out as Extract<typeof out, { state: 'done' }>).page;
    expect(page).toMatchObject({ pagesRead: 2, end: true });
    expect(page.entries.map((e) => [e.position, e.url])).toEqual([
      [1, 'https://p3a.test/'],
      [2, 'https://p3b.test/'],
      [3, 'https://p4a.test/'],
      [4, 'https://plumbers.na/'],
    ]);
  });

  it('stops only on a clear end: a later page in the pagination’s list counts as more', async () => {
    const endOf = async (pagination: unknown) => {
      const { fetch } = fakeFetch(() => ({ body: { ...serp(['https://a.test/']), pagination } }));
      const [out] = await brightData.submit(CREDS, [search('c1')], { fetch, sleep: noSleep });
      return (out as Extract<typeof out, { state: 'done' }>).page.end;
    };
    expect(await endOf({ current_page: 2, pages: [{ page: 1 }, { page: 3 }] })).toBeUndefined(); // no next_* fields, page 3 listed
    expect(await endOf({ current_page: 3, pages: [{ page: 1 }, { page: 2 }] })).toBe(true);
    expect(await endOf(undefined)).toBeUndefined(); // no pagination at all: not taken as the end
  });

  it('an empty page is the end; Bright Data’s `{ body }` wrapper is read too', async () => {
    const { fetch } = fakeFetch((_c, google) => (startOf(google) === 0 ? { body: { status_code: 200, body: JSON.stringify(serp(['https://a.test/'])) } } : { body: serp([]) }));
    const [out] = await brightData.submit(CREDS, [search('c1', { pages: 2 })], { fetch, sleep: noSleep });
    expect(out).toMatchObject({ state: 'done', page: { pagesRead: 2, end: true }, costUsd: expect.closeTo(0.003, 6) });
    expect((out as Extract<typeof out, { state: 'done' }>).page.entries).toHaveLength(1);
  });

  it.each([
    [401, 'auth'],
    [407, 'auth'],
    [402, 'funds'],
    [403, 'auth'],
    [429, 'rate'],
  ] as const)('a refusal of the whole account (%s) before anything was billed refuses the request as a whole', async (status, kind) => {
    const { fetch, calls } = fakeFetch(() => ({ status, body: 'Bad Request: zone serp_api1 key bd_s3cret_key' }));
    const err = await brightData.submit(CREDS, [search('a'), search('b'), search('c'), search('d'), search('e'), search('f')], { fetch, sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RankProviderError);
    expect((err as RankProviderError).kind).toBe(kind);
    expect((err as Error).message).not.toMatch(/s3cret|Bad Request/);
    expect(calls.length).toBeLessThanOrEqual(4); // the searches already started, no more
  });

  it('a search Bright Data fails is not billed; a lost reply may have been; the others go on', async () => {
    const { fetch } = fakeFetch((_c, google) => {
      const q = google?.searchParams.get('q');
      if (q === 'failed') return { status: 502, body: 'verifying' };
      if (q === 'lost') return new Error('socket hang up');
      if (q === 'html') return { body: '<html>not parsed</html>' };
      return { body: serp(['https://a.test/']) };
    });
    const out = await brightData.submit(CREDS, [search('ok'), search('f', { keyword: 'failed' }), search('l', { keyword: 'lost' }), search('h', { keyword: 'html' })], { fetch, sleep: noSleep });
    expect(out.map((o) => [o.checkId, o.state, costOf(o)])).toEqual([
      ['ok', 'done', expect.closeTo(0.0015, 6)],
      ['f', 'failed', 0],
      ['l', 'failed', expect.closeTo(0.0015, 6)],
      ['h', 'failed', expect.closeTo(0.0045, 6)], // answered three times (tried again twice), each possibly billed — never results
    ]);
  });

  it('a search refused for itself (HTTP 400) fails alone: the others go on', async () => {
    const { fetch, calls } = fakeFetch((_c, google) => (google?.searchParams.get('q') === 'bad' ? { status: 400, body: '' } : { body: serp(['https://a.test/']) }));
    const out = await brightData.submit(CREDS, [search('bad', { keyword: 'bad' }), search('a'), search('b'), search('c'), search('d')], { fetch, sleep: noSleep });
    expect(calls).toHaveLength(5);
    expect(out.map((o) => [o.checkId, o.state, costOf(o)])).toEqual([
      ['bad', 'failed', 0],
      ['a', 'done', expect.closeTo(0.0015, 6)],
      ['b', 'done', expect.closeTo(0.0015, 6)],
      ['c', 'done', expect.closeTo(0.0015, 6)],
      ['d', 'done', expect.closeTo(0.0015, 6)],
    ]);
  });

  it('an empty answer, or a query refused for a moment, is tried again after Bright Data’s wait', async () => {
    // Measured: an empty HTTP 200, then "This query recently failed…" (429) for 15 seconds, then a proper answer.
    let n = 0;
    waits.length = 0;
    const { fetch, calls } = fakeFetch(() => {
      n++;
      if (n === 1) return { body: '' };
      if (n === 2) return { status: 429, body: 'This query recently failed and cannot be attempted at this time. Please try again later, after a minimum of 15 seconds.' };
      return { body: serp(['https://a.test/', 'https://plumbers.na/']) };
    });
    const [out] = await brightData.submit(CREDS, [search('c1')], { fetch, sleep: noSleep });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([16_000, 16_000]);
    // The empty answer was Bright Data's own failure, and the refused one never ran: neither is billed.
    expect(out).toMatchObject({ state: 'done', page: { pagesRead: 1 }, costUsd: expect.closeTo(0.0015, 6) });
    expect(readPage((out as Extract<typeof out, { state: 'done' }>).page, { domain: 'plumbers.na', includeSubdomains: true }).hit?.position).toBe(2);
  });

  it('tries a page three times at most: empty answers cost nothing, answers without results may have been billed', async () => {
    const empty = fakeFetch(() => ({ body: '' }));
    const [e] = await brightData.submit(CREDS, [search('c1')], { fetch: empty.fetch, sleep: noSleep });
    expect(empty.calls).toHaveLength(3);
    expect(e).toMatchObject({ state: 'failed', costUsd: 0, error: expect.stringMatching(/empty answer/) });

    const noList = fakeFetch(() => ({ body: {} }));
    const [n] = await brightData.submit(CREDS, [search('c1')], { fetch: noList.fetch, sleep: noSleep });
    expect(noList.calls).toHaveLength(3);
    expect(n).toMatchObject({ state: 'failed', costUsd: expect.closeTo(0.0045, 6) });

    // Pages 3 read, page 4 never readable: page 3 kept, every answer booked.
    const later = fakeFetch((_c, google) => (startOf(google) === 20 ? { body: serp(['https://a.test/']) } : { body: {} }));
    const [l] = await brightData.submit(CREDS, [search('c1', { startPage: 3, pages: 3 })], { fetch: later.fetch, sleep: noSleep });
    expect(l).toMatchObject({ state: 'done', page: { pagesRead: 1, cut: true }, costUsd: expect.closeTo(0.006, 6) });
  });

  it('a page waiting to be tried again stops when another search meets an account-wide refusal', async () => {
    const { fetch, calls } = fakeFetch((_c, google) => (google?.searchParams.get('q') === 'empty' ? { body: '' } : { status: 402, body: '' }));
    const err = await brightData.submit(CREDS, [search('a', { keyword: 'empty' }), search('b')], { fetch, sleep: noSleep }).catch((x: unknown) => x);
    // Nothing billed anywhere: refused as a whole, and the empty one was not tried again after the refusal.
    expect(err).toMatchObject({ kind: 'funds' });
    expect(calls).toHaveLength(2);
  });

  it('two wrapped results of one site are two results, even both read as its home page', async () => {
    const goto = (n: number) => `https://www.google.com/goto?url=CAES${n}&gsessionid=x`;
    const results = {
      ...serp([]),
      featured_snippets: [{ link: goto(1), display_link: 'https://www.plumbers.na › faq', global_rank: 1 }],
      organic: [
        { link: goto(2), display_link: 'https://www.plumbers.na › drains', rank: 1, global_rank: 2 },
        { link: 'https://other.test/', rank: 2, global_rank: 3 },
        { link: goto(1), display_link: 'https://www.plumbers.na › faq', rank: 3, global_rank: 4 }, // the snippet again
      ],
    };
    const { fetch } = fakeFetch(() => ({ body: results }));
    const [out] = await brightData.submit(CREDS, [search('c1')], { fetch, sleep: noSleep });
    const page = (out as Extract<typeof out, { state: 'done' }>).page;
    expect(page.entries.map((e) => [e.kind, e.url])).toEqual([
      ['featured_snippet', 'https://www.plumbers.na/'],
      ['organic', 'https://www.plumbers.na/'],
      ['organic', 'https://other.test/'],
    ]);
  });

  it('a query refused every time fails alone, unbilled; the account’s own rate limit still stops the rest', async () => {
    const rejected = fakeFetch((_c, google) =>
      google?.searchParams.get('q') === 'stuck'
        ? { status: 429, body: 'This query cannot be attempted at this time. Please try again later, after a minimum of 15 seconds.' }
        : { body: serp(['https://a.test/']) },
    );
    const out = await brightData.submit(CREDS, [search('stuck', { keyword: 'stuck' }), search('a'), search('b')], { fetch: rejected.fetch, sleep: noSleep });
    expect(out.map((o) => [o.checkId, o.state, costOf(o)])).toEqual([
      ['stuck', 'failed', 0],
      ['a', 'done', expect.closeTo(0.0015, 6)],
      ['b', 'done', expect.closeTo(0.0015, 6)],
    ]);
    expect(rejected.calls.filter((c) => new URL(c.body!.url!).searchParams.get('q') === 'stuck')).toHaveLength(3);

    const throttled = fakeFetch(() => ({ status: 429, body: 'The request was auto-throttled due to low success rate.' }));
    await expect(brightData.submit(CREDS, [search('a')], { fetch: throttled.fetch, sleep: noSleep })).rejects.toMatchObject({ kind: 'rate' });
  });

  it('a stage stopped partway keeps the pages it read, marked cut, booked at what may have been billed', async () => {
    const failing = fakeFetch((_c, google) => (startOf(google) === 20 ? { body: serp(['https://a.test/']) } : { status: 502, body: '' }));
    const [out] = await brightData.submit(CREDS, [search('c1', { startPage: 3, pages: 3 })], { fetch: failing.fetch, sleep: noSleep });
    expect(out).toMatchObject({ state: 'done', page: { pagesRead: 1, cut: true }, costUsd: expect.closeTo(0.0015, 6) });
    expect((out as Extract<typeof out, { state: 'done' }>).page.entries.map((e) => e.url)).toEqual(['https://a.test/']);

    // The second page's reply lost: it may have been billed — booked, but not counted as read.
    const lost = fakeFetch((_c, google) => (startOf(google) === 20 ? { body: serp(['https://a.test/']) } : new Error('socket hang up')));
    const [out2] = await brightData.submit(CREDS, [search('c1', { startPage: 3, pages: 3 })], { fetch: lost.fetch, sleep: noSleep });
    expect(out2).toMatchObject({ state: 'done', page: { pagesRead: 1, cut: true }, costUsd: expect.closeTo(0.003, 6) });
  });

  it('never sends a search whose country is not an ISO code', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: serp(['https://a.test/']) }));
    const [out] = await brightData.submit(CREDS, [search('c1', { location: { name: 'X', countryCode: 'na&brd_x=1' } })], { fetch, sleep: noSleep });
    expect(calls).toHaveLength(0);
    expect(out).toMatchObject({ state: 'failed', costUsd: 0 });
  });

  it('once something was billed, an account refusal fails the rest instead of refusing the request', async () => {
    let n = 0;
    const { fetch } = fakeFetch(() => (n++ === 0 ? { body: serp(['https://a.test/']) } : { status: 402, body: '' }));
    // One at a time, so the first is done before the refusal.
    const out = await brightData.submit(CREDS, [search('first')], { fetch, sleep: noSleep }).then(async (first) => [
      ...first,
      ...(await brightData.submit(CREDS, [search('second'), search('third', { pages: 2 })], { fetch, sleep: noSleep }).catch((e: unknown) => [e])),
    ]);
    expect(out[0]).toMatchObject({ checkId: 'first', state: 'done' });
    // The second submit: refused before anything was billed — thrown as a whole.
    expect(out[1]).toBeInstanceOf(RankProviderError);

    let m = 0;
    const mixed = fakeFetch(() => (m++ === 0 ? { body: serp(['https://a.test/']) } : { status: 402, body: '' }));
    const both = await brightData.submit(CREDS, [search('a', { pages: 2 }), search('b')], { fetch: mixed.fetch, sleep: noSleep });
    expect(both.map((o) => [o.checkId, o.state, costOf(o)])).toEqual([
      ['a', 'done', expect.closeTo(0.0015, 6)], // its first page kept and billed; the rest read on a later pass
      ['b', 'unsent', undefined], // never sent: its claim is given back
    ]);
    expect(both[0]).toMatchObject({ page: { pagesRead: 1, cut: true } });
    expect(both[1]).toMatchObject({ error: expect.stringMatching(/no funds/) });
  });

  it('refuses more searches than one request may carry', async () => {
    const many = Array.from({ length: 11 }, (_, i) => search(`c${i}`));
    await expect(brightData.submit(CREDS, many, { fetch: async () => Promise.reject(new Error('never')) })).rejects.toBeInstanceOf(RankProviderError);
  });

  it('has nothing to collect: every search is answered at once', async () => {
    expect(await brightData.collect(CREDS, [{ checkId: 'c', ref: 'x' }], { fetch: async () => Promise.reject(new Error('never')) })).toEqual([
      { checkId: 'c', state: 'failed', error: expect.stringContaining('nothing to collect') },
    ]);
    expect(brightData.freeRereadDays).toBeUndefined();
  });
});

describe('Bright Data account', () => {
  it('checks the zone, then reads the balance when the key may', async () => {
    const { fetch, calls } = fakeFetch((c) => (c.url.includes('/zone/status') ? { body: { status: 'active' } } : { body: { balance: 7.5, credit: 0, pending_costs: 0.2 } }));
    expect(await brightData.account(CREDS, { fetch, sleep: noSleep })).toEqual({ balanceUsd: 7.5 });
    expect(calls.map((c) => c.url)).toEqual(['https://api.brightdata.com/zone/status?zone=serp_api1', 'https://api.brightdata.com/customer/balance']);
    expect(calls.every((c) => c.headers.authorization === 'Bearer bd_s3cret_key')).toBe(true);

    const limited = fakeFetch((c) => (c.url.includes('/zone/status') ? { body: {} } : { status: 403, body: '' }));
    expect(await brightData.account(CREDS, { fetch: limited.fetch, sleep: noSleep })).toEqual({ balanceUsd: null });
  });

  it('names a missing zone, and a refused key, as such', async () => {
    const missing = fakeFetch(() => ({ status: 404, body: '' }));
    await expect(brightData.account(CREDS, { fetch: missing.fetch, sleep: noSleep })).rejects.toThrow(/no SERP API zone named “serp_api1”/);
    const refused = fakeFetch(() => ({ status: 401, body: '' }));
    await expect(brightData.account(CREDS, { fetch: refused.fetch, sleep: noSleep })).rejects.toMatchObject({ kind: 'auth' });
    const down = fakeFetch(() => new Error('ECONNRESET'));
    await expect(brightData.account(CREDS, { fetch: down.fetch, sleep: noSleep })).rejects.toThrow(/could not be reached/);
  });
});

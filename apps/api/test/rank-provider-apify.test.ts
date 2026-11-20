import { describe, expect, it } from 'vitest';
import { apify, uuleFor } from '../src/rank/providers/apify.js';
import { RankProviderError, type FetchLike, type RankSearch } from '../src/rank/providers/index.js';
import { readPage } from '../src/rank/match.js';

/**
 * The Apify provider against a scripted Apify API: one actor run per group of searches that share their settings,
 * results read page by page from the run's dataset, and the run's real charge shared out among its searches.
 */

const CREDS = apify.parseCredentials({ token: 'apify_api_s3cretToken' });
const RUN_A = 'RunAAAAAAAAAAAAA1';
const RUN_B = 'RunBBBBBBBBBBBBB2';
const DATASET = 'DataSetDDDDDDDDD3';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(handler: (call: Call, path: string, query: URLSearchParams) => { status?: number; body: unknown } | Error): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const u = new URL(url);
    const r = handler(call, u.pathname, u.searchParams);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { fetch, calls };
}

const search = (checkId: string, over: Partial<RankSearch> = {}): RankSearch => ({
  checkId,
  keyword: 'plumber windhoek',
  engine: 'google',
  device: 'desktop',
  location: { name: 'Namibia', countryCode: 'NA' },
  languageCode: 'en',
  startPage: 1,
  pages: 10,
  ...over,
});

/** One dataset record: a results page of `urls` for `term`. */
const page = (term: string, n: number, urls: string[], extra: Record<string, unknown> = {}) => ({
  searchQuery: { term, page: n, type: 'SEARCH', countryCode: 'na' },
  organicResults: urls.map((url, i) => ({ title: `r${i}`, url, position: i + 1, type: 'organic' })),
  ...extra,
});

const finishedLongAgo = '2026-10-20T06:10:00.000Z';

describe('Apify credentials, price and places', () => {
  it('needs a token, and never one with spaces', () => {
    expect(CREDS).toEqual({ token: 'apify_api_s3cretToken' });
    expect(() => apify.parseCredentials({ token: '' })).toThrow(/API token/);
    expect(() => apify.parseCredentials({ token: 'two words' })).toThrow(RankProviderError);
  });

  it('prices a search per results page, at the listing’s base rate', () => {
    expect(apify.estimateCostUsd(10, CREDS)).toBeCloseTo(0.035);
    expect(apify.estimateCostUsd(1, CREDS)).toBeCloseTo(0.0035);
    expect(apify.estimateCostUsd(3, CREDS)).toBeCloseTo(0.0105);
  });

  it('encodes a place the way Google does', () => {
    expect(uuleFor('Berlin')).toBe('w+CAIQICIGQmVybGlu');
    expect(uuleFor('Windhoek,Khomas Region,Namibia')).toBe('w+CAIQICIeV2luZGhvZWssS2hvbWFzIFJlZ2lvbixOYW1pYmlh');
    // A name of 128 bytes or more needs a two-byte length.
    expect(Buffer.from(uuleFor('x'.repeat(130)).slice(2), 'base64').subarray(5, 7)).toEqual(Buffer.from([0x82, 0x01]));
  });

  it('offers the country as the only place to pick, and has no list to fetch', async () => {
    await expect(apify.searchLocations(CREDS, 'NA', '', { fetch: async () => Promise.reject(new Error('no network')) })).resolves.toEqual([
      { name: 'Namibia', type: 'Country', countryCode: 'NA' },
    ]);
    await expect(apify.searchLocations(CREDS, 'NA', 'nami', { fetch: async () => Promise.reject(new Error('x')) })).resolves.toHaveLength(1);
    await expect(apify.searchLocations(CREDS, 'NA', 'windhoek', { fetch: async () => Promise.reject(new Error('x')) })).resolves.toEqual([]);
    await expect(apify.searchLocations(CREDS, 'na', '', { fetch: async () => Promise.reject(new Error('x')) })).rejects.toThrow(/ISO code/);
  });

  it('reads what is left of the month’s usage limit as the balance', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { data: { limits: { maxMonthlyUsageUsd: 49 }, current: { monthlyUsageUsd: 12.5 } } } }));
    await expect(apify.account(CREDS, { fetch })).resolves.toEqual({ balanceUsd: 36.5 });
    expect(calls[0]!.url).toBe('https://api.apify.com/v2/users/me/limits');
    const odd = fakeFetch(() => ({ body: { data: {} } }));
    await expect(apify.account(CREDS, { fetch: odd.fetch })).resolves.toEqual({ balanceUsd: null });
    const refused = fakeFetch(() => ({ status: 401, body: { error: { type: 'token-not-valid', message: 'Authentication token is not valid.' } } }));
    await expect(apify.account(CREDS, { fetch: refused.fetch })).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('Apify submit', () => {
  it('starts one run per group of settings, with the token in the header and a charge cap on the run', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() => ({ status: 201, body: { data: { id: n++ === 0 ? RUN_A : RUN_B, status: 'READY' } } }));
    const out = await apify.submit(
      CREDS,
      [
        search('c1', { keyword: 'Plumber  Windhoek' }),
        search('c2', { keyword: 'geyser repair' }),
        search('c3', { keyword: 'plumber windhoek' }), // another project, the same search: one query, one result
        search('c4', { keyword: 'geyser repair', device: 'mobile', location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' }, pages: 3 }),
      ],
      { fetch },
    );

    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.method).toBe('POST');
      expect(c.headers.authorization).toBe('Bearer apify_api_s3cretToken');
      expect(c.url).not.toContain('s3cret'); // never in a URL: those end up in logs
      expect(new URL(c.url).pathname).toBe('/v2/acts/apify~google-search-scraper/runs');
    }
    expect(calls[0]!.body).toEqual({
      queries: 'plumber windhoek\ngeyser repair',
      countryCode: 'na',
      languageCode: 'en',
      mobileResults: false,
      maxPagesPerQuery: 10,
      includeUnfilteredResults: false,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
      maximumLeadsEnrichmentRecords: 0,
    });
    // Twice the estimate (2 × $0.035 × 2 searches = $0.14) is under the least cap Apify accepts: it refuses a run capped
    // below $0.50 ("Maximum cost per run is less than the allowed minimum of $0.50"), so both runs ask for that.
    expect(new URL(calls[0]!.url).searchParams.get('maxTotalChargeUsd')).toBe('0.5000');
    expect(new URL(calls[1]!.url).searchParams.get('maxTotalChargeUsd')).toBe('0.5000');
    expect(calls[1]!.body).toMatchObject({ queries: 'geyser repair', mobileResults: true, maxPagesPerQuery: 3, locationUule: uuleFor('Windhoek,Khomas Region,Namibia') });

    // The two checks of one search say so in their reference: each books half of what that search cost.
    expect(out).toEqual([
      { checkId: 'c1', state: 'queued', ref: `${RUN_A}:2:plumber windhoek`, costUsd: expect.closeTo(0.035) },
      { checkId: 'c2', state: 'queued', ref: `${RUN_A}:1:geyser repair`, costUsd: expect.closeTo(0.035) },
      { checkId: 'c3', state: 'queued', ref: `${RUN_A}:2:plumber windhoek`, costUsd: expect.closeTo(0.035) },
      { checkId: 'c4', state: 'queued', ref: `${RUN_B}:1:geyser repair`, costUsd: expect.closeTo(0.0105) },
    ]);
  });

  it.each([
    [401, { error: { type: 'token-not-valid', message: 'Authentication token is not valid.' } }, 'auth'],
    [402, { error: { type: 'not-enough-usage-to-run-paid-actor', message: 'Not enough credit.' } }, 'funds'],
    [403, { error: { type: 'monthly-usage-limit-exceeded', message: 'Limit exceeded.' } }, 'funds'],
    [403, { error: { type: 'insufficient-permissions', message: 'Not allowed.' } }, 'auth'],
    [429, { error: { type: 'rate-limit-exceeded' } }, 'rate'],
    [503, '<html>down</html>', 'unavailable'],
  ] as const)('refuses the whole request when the first run is refused (%s) — nothing went out', async (status, body, kind) => {
    const { fetch } = fakeFetch(() => ({ status, body }));
    const err = await apify.submit(CREDS, [search('c1')], { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RankProviderError);
    expect((err as RankProviderError).kind).toBe(kind);
    expect((err as Error).message).not.toContain('s3cret');
  });

  it('once a run is under way, a refused group fails alone — possibly paid only when the reply was lost', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() => {
      n++;
      if (n === 1) return { status: 201, body: { data: { id: RUN_A } } };
      if (n === 2) return { status: 400, body: { error: { type: 'invalid-input', message: 'Input is not valid: languageCode.' } } };
      return new Error('socket hang up');
    });
    const out = await apify.submit(
      CREDS,
      [search('ok'), search('bad', { languageCode: 'xx' }), search('lost', { device: 'mobile' })],
      { fetch },
    );
    expect(calls).toHaveLength(3);
    expect(out).toEqual([
      { checkId: 'ok', state: 'queued', ref: `${RUN_A}:1:plumber windhoek`, costUsd: expect.closeTo(0.035) },
      { checkId: 'bad', state: 'failed', error: expect.stringContaining('languageCode'), costUsd: 0 },
      // A run whose start was lost may exist, charged per page: booked at twice its estimate — not at Apify's $0.50
      // least cap, which would let a few lost replies eat the month's budget.
      { checkId: 'lost', state: 'failed', error: 'Apify could not be reached', costUsd: expect.closeTo(0.07) },
    ]);
  });

  it('stops starting runs once the account refuses one, and starts nothing more that day', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() => (n++ === 0 ? { status: 201, body: { data: { id: RUN_A } } } : { status: 402, body: { error: { type: 'not-enough-usage' } } }));
    const out = await apify.submit(CREDS, [search('a'), search('b', { device: 'mobile' }), search('c', { languageCode: 'de' })], { fetch });
    expect(calls).toHaveLength(2);
    expect(out.map((o) => [o.checkId, o.state, 'costUsd' in o ? o.costUsd : undefined])).toEqual([
      ['a', 'queued', expect.closeTo(0.035)],
      ['b', 'failed', 0],
      ['c', 'failed', 0],
    ]);
  });

  it('never sends a keyword that is a web address — the actor would open it — and starts no run for it', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 201, body: { data: { id: RUN_A } } }));
    const out = await apify.submit(CREDS, [search('url', { keyword: 'https://evil.test/page' }), search('ok')], { fetch });
    expect(calls).toHaveLength(1);
    expect((calls[0]!.body as { queries: string }).queries).toBe('plumber windhoek');
    expect(out).toContainEqual({ checkId: 'url', state: 'failed', error: expect.stringContaining('web address'), costUsd: 0 });
    const only = fakeFetch(() => ({ status: 201, body: { data: { id: RUN_A } } }));
    await apify.submit(CREDS, [search('url', { keyword: 'http://x.test' })], { fetch: only.fetch });
    expect(only.calls).toHaveLength(0);
  });

  it('a run that was taken but whose id cannot be read is kept as possibly paid', async () => {
    const { fetch } = fakeFetch(() => ({ status: 201, body: { data: { id: '../../users/me' } } }));
    await expect(apify.submit(CREDS, [search('c1')], { fetch })).resolves.toEqual([
      { checkId: 'c1', state: 'failed', error: 'Apify sent a reply the platform could not read', costUsd: expect.closeTo(0.07) },
    ]);
  });

  it('caps a run big enough at twice its estimate, above Apify’s least cap', async () => {
    const terms = Array.from({ length: 8 }, (_, i) => search(`c${i}`, { keyword: `term ${i}` }));
    const { fetch, calls } = fakeFetch(() => ({ status: 201, body: { data: { id: RUN_A } } }));
    await apify.submit(CREDS, terms, { fetch });
    expect(new URL(calls[0]!.url).searchParams.get('maxTotalChargeUsd')).toBe('0.5600'); // 2 × $0.035 × 8
  });

  it('sends a later stage as Google search URLs with Google’s own offset, the place in the URL', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 201, body: { data: { id: RUN_A } } }));
    const city = { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' };
    const out = await apify.submit(
      CREDS,
      [
        search('c1', { keyword: 'Plumber  Windhoek', startPage: 3, pages: 3 }),
        search('c2', { keyword: 'c++ geyser & repair', startPage: 3, pages: 3 }),
        search('c3', { keyword: 'geyser repair', startPage: 2, pages: 1, location: city }),
        search('c4', { keyword: 'geyser repair', startPage: 1, pages: 1 }),
      ],
      { fetch },
    );
    expect(calls).toHaveLength(3); // the stage is a setting of the run: one run per stage
    const [later, cityRun, first] = calls.map((c) => c.body as { queries: string; maxPagesPerQuery: number; locationUule?: string });
    expect(later!.queries.split('\n')).toEqual([
      'https://www.google.com/search?q=plumber+windhoek&gl=na&hl=en&start=20',
      'https://www.google.com/search?q=c%2B%2B+geyser+%26+repair&gl=na&hl=en&start=20',
    ]);
    expect(later!.maxPagesPerQuery).toBe(3);
    // A city goes in the URL, not as the actor's own setting (which a URL search ignores).
    expect(cityRun!.queries).toBe(`https://www.google.com/search?q=geyser+repair&gl=na&hl=en&start=10&uule=${encodeURIComponent(uuleFor('Windhoek,Khomas Region,Namibia'))}`);
    expect(cityRun).not.toHaveProperty('locationUule');
    expect(first).toMatchObject({ queries: 'geyser repair', maxPagesPerQuery: 1 });
    // Booked per page asked for: three pages, then one.
    expect(out.map((o) => ('costUsd' in o ? o.costUsd : undefined))).toEqual([expect.closeTo(0.0105, 6), expect.closeTo(0.0105, 6), expect.closeTo(0.0035, 6), expect.closeTo(0.0035, 6)]);
  });
});

describe('Apify collect', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    data: { id: RUN_A, status: 'SUCCEEDED', startedAt: '2026-10-20T06:00:00.000Z', finishedAt: finishedLongAgo, defaultDatasetId: DATASET, usageTotalUsd: 0.0081, ...over },
  });

  it('leaves a running run, and one whose charge is still settling, queued', async () => {
    for (const r of [run({ status: 'RUNNING', finishedAt: null }), run({ status: 'READY' }), run({ finishedAt: new Date().toISOString() })]) {
      const { fetch, calls } = fakeFetch(() => ({ body: r }));
      await expect(apify.collect(CREDS, [{ checkId: 'c1', ref: `${RUN_A}:1:plumber windhoek` }], { fetch })).resolves.toEqual([{ checkId: 'c1', state: 'pending' }]);
      expect(calls).toHaveLength(1); // the dataset is not read yet
    }
  });

  it('reads a finished run’s pages, numbers results across them, and shares the run’s charge by pages', async () => {
    const site = 'https://www.plumbers.na/';
    const records = [
      page('plumber windhoek', 2, ['https://p2a.test/', site]),
      page('plumber windhoek', 1, ['https://p1a.test/', 'https://p1b.test/'], { featuredSnippet: { url: 'https://snippet.test/' } }),
      page('geyser repair', 1, ['https://g1.test/']),
    ];
    const { fetch, calls } = fakeFetch((_c, path, query) => {
      if (path === `/v2/actor-runs/${RUN_A}`) return { body: run() };
      if (path === `/v2/datasets/${DATASET}/items`) {
        const offset = Number(query.get('offset'));
        return { body: records.slice(offset, offset + Number(query.get('limit'))) };
      }
      return { status: 404, body: {} };
    });
    const out = await apify.collect(
      CREDS,
      [
        { checkId: 'pw', ref: `${RUN_A}:1:plumber windhoek` },
        { checkId: 'gr', ref: `${RUN_A}:1:geyser repair` },
        { checkId: 'none', ref: `${RUN_A}:1:blocked drain` },
      ],
      { fetch },
    );
    // One run asked about once, its dataset read once.
    expect(calls.filter((c) => c.url.includes('/actor-runs/'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/datasets/'))).toHaveLength(1);

    const pw = out[0] as Extract<(typeof out)[number], { state: 'done' }>;
    expect(pw.state).toBe('done');
    expect(pw.page.pagesRead).toBe(2);
    expect(pw.page.checkedAt).toEqual(new Date('2026-10-20T06:00:00.000Z'));
    expect(pw.page.entries.map((e) => [e.kind, e.position, e.url])).toEqual([
      ['featured_snippet', 1, 'https://snippet.test/'],
      ['organic', 1, 'https://p1a.test/'],
      ['organic', 2, 'https://p1b.test/'],
      ['organic', 3, 'https://p2a.test/'], // page 2 continues the count
      ['organic', 4, site],
    ]);
    // Counted as Google counts: the snippet is 1, so the site is 5th.
    expect(readPage(pw.page, { domain: 'plumbers.na', includeSubdomains: true }).hit).toMatchObject({ position: 5, featured: false });
    expect(pw.costUsd).toBeCloseTo(0.0054); // 2 of the run's 3 pages × $0.0081

    expect(out[1]).toMatchObject({ checkId: 'gr', state: 'done', costUsd: expect.closeTo(0.0027) });
    // Nothing filed under its term: the estimate booked at sending stays — the run may have been charged for it.
    expect(out[2]).toEqual({ checkId: 'none', state: 'failed', error: 'Apify returned no results pages for this search' });
  });

  it('reads the site’s own featured snippet as position 1, however the actor marks it', async () => {
    const { fetch } = fakeFetch((_c, path) =>
      path.includes('/datasets/')
        ? { body: [{ searchQuery: { term: 'faq', page: 1 }, organicResults: [{ url: 'https://plumbers.na/faq', type: 'featuredSnippet' }, { url: 'https://other.test/', type: 'organic' }] }] }
        : { body: run() },
    );
    const [out] = await apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:faq` }], { fetch });
    const reading = readPage((out as Extract<typeof out, { state: 'done' }>).page, { domain: 'plumbers.na', includeSubdomains: true });
    expect(reading.hit).toMatchObject({ position: 1, featured: true });
  });

  it('keeps the pages a stopped or failed run did read — they were charged — and fails a search it never reached', async () => {
    const { fetch } = fakeFetch((_c, path) =>
      path.includes('/datasets/') ? { body: [page('plumber windhoek', 1, ['https://a.test/'])] } : { body: run({ status: 'TIMED-OUT', usageTotalUsd: 0.0035 }) },
    );
    const out = await apify.collect(
      CREDS,
      [
        { checkId: 'got', ref: `${RUN_A}:1:plumber windhoek` },
        { checkId: 'missed', ref: `${RUN_A}:1:geyser repair` },
      ],
      { fetch },
    );
    expect(out[0]).toMatchObject({ state: 'done', page: { pagesRead: 1 }, costUsd: expect.closeTo(0.0035) });
    expect(out[1]).toEqual({ checkId: 'missed', state: 'failed', error: 'the Apify run ended timed-out before this search was read' });
  });

  it('never puts a forged reference in a URL; a run Apify no longer has fails; a passing fault stays queued', async () => {
    const gone = fakeFetch(() => ({ status: 404, body: { error: { type: 'record-not-found', message: 'Actor run was not found' } } }));
    const out = await apify.collect(
      CREDS,
      [
        { checkId: 'forged', ref: '../../users/me:1:x' },
        { checkId: 'no-count', ref: `${RUN_B}:x` },
        { checkId: 'gone', ref: `${RUN_B}:1:x` },
      ],
      { fetch: gone.fetch },
    );
    expect(out[0]).toMatchObject({ checkId: 'forged', state: 'failed' });
    expect(out[1]).toMatchObject({ checkId: 'no-count', state: 'failed' });
    expect(out[2]).toMatchObject({ checkId: 'gone', state: 'failed', error: expect.stringContaining('not found') });
    expect(gone.calls).toHaveLength(1);

    const down = fakeFetch(() => ({ status: 502, body: '' }));
    await expect(apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:x` }], { fetch: down.fetch })).resolves.toEqual([{ checkId: 'c', state: 'pending' }]);
  });

  it('books a run’s charge within bounds: per-event charges when larger, never under the cheapest rate, never past the cap', async () => {
    const one = (runOver: Record<string, unknown>) =>
      fakeFetch((_c, path) => (path.includes('/datasets/') ? { body: [page('k', 1, ['https://a.test/']), page('k', 2, ['https://b.test/'])] } : { body: run(runOver) }));
    const costOf = async (runOver: Record<string, unknown>, shares = 1) => {
      const [out] = await apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:${shares}:k` }], { fetch: one(runOver).fetch });
      return (out as { costUsd?: number }).costUsd;
    };
    // The events carry the real charge, the total only platform usage: the larger is booked.
    expect(await costOf({ usageTotalUsd: 0.0001, eventUsage: { 'search-page-scraped': { eventTitle: 'Page', eventTotalUsd: 0.0048 } } })).toBeCloseTo(0.0048);
    // Reported at next to nothing: still booked at the cheapest plan's rate for its two pages.
    expect(await costOf({ usageTotalUsd: 0.00001 })).toBeCloseTo(0.003);
    // Reported far past the run's cap (a unit mix-up): held to the cap the run says it had…
    expect(await costOf({ usageTotalUsd: 500, options: { maxTotalChargeUsd: 0.5 } })).toBeCloseTo(0.5);
    // …or, when it does not say, the one it would have had for two pages: Apify's least, $0.50.
    expect(await costOf({ usageTotalUsd: 500 })).toBeCloseTo(0.5);
    expect(await costOf({ usageTotalUsd: 500 }, 2)).toBeCloseTo(0.25);
    // No figure at all: the estimate stays.
    expect(await costOf({ usageTotalUsd: undefined })).toBeUndefined();
    // Shared by two checks, collected in different passes: each books half, never the whole twice.
    expect(await costOf({ usageTotalUsd: 0.006 }, 2)).toBeCloseTo(0.003);

    // A large run: each check books its pages' part of the run's cap at most.
    const pagesOf = (count: number, terms: number) => Array.from({ length: count }, (_, i) => page(`t${i % terms}`, Math.floor(i / terms) + 1, [`https://r${i}.test/`]));
    const heldTo = async (records: ReturnType<typeof pagesOf>, runOver: Record<string, unknown>) => {
      const { fetch } = fakeFetch((_c, path, query) => {
        if (!path.includes('/datasets/')) return { body: run(runOver) };
        const offset = Number(query.get('offset'));
        return { body: records.slice(offset, offset + Number(query.get('limit'))) };
      });
      const [out] = await apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:t0` }], { fetch });
      return (out as { costUsd?: number }).costUsd;
    };
    expect(await heldTo(pagesOf(80, 8), { usageTotalUsd: 500, options: { maxTotalChargeUsd: 0.56 } })).toBeCloseTo(0.07); // $0.56 × 10 of 80 pages
    expect(await heldTo(pagesOf(80, 8), { usageTotalUsd: 500 })).toBeCloseTo(0.07); // max($0.50, 2 × $0.0035 × 80) × 10/80
    // More records than the run asked for (repeats, retries): still never past the cap it was started with.
    expect(await heldTo(pagesOf(300, 1), { usageTotalUsd: 500, options: { maxTotalChargeUsd: 0.5 } })).toBeCloseTo(0.5);
  });

  it('does not count a snippet’s page twice when the actor also lists it among the ordinary results', async () => {
    const { fetch } = fakeFetch((_c, path) =>
      path.includes('/datasets/')
        ? { body: [page('k', 1, ['https://snippet.test/', 'https://second.test/', 'https://plumbers.na/'], { featuredSnippet: { url: 'https://snippet.test/' } })] }
        : { body: run() },
    );
    const [out] = await apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:k` }], { fetch });
    const done = out as Extract<typeof out, { state: 'done' }>;
    expect(done.page.entries.map((e) => [e.kind, e.url])).toEqual([
      ['featured_snippet', 'https://snippet.test/'],
      ['organic', 'https://second.test/'],
      ['organic', 'https://plumbers.na/'],
    ]);
    expect(readPage(done.page, { domain: 'plumbers.na', includeSubdomains: true }).hit?.position).toBe(3);
  });

  it('does not count Google’s own Map link as a result — Google’s own sites still count', async () => {
    const map = 'https://www.google.com/search?q=website+development+namibia&gl=na&hl=en&udm=1';
    const { fetch } = fakeFetch((_c, path) =>
      path.includes('/datasets/')
        ? { body: [page('k', 1, [map, 'https://asylum.com.na/', 'https://support.google.com/business/', 'https://plumbers.na/'])] }
        : { body: run() },
    );
    const [out] = await apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:k` }], { fetch });
    const done = out as Extract<typeof out, { state: 'done' }>;
    expect(done.page.entries.map((e) => e.url)).toEqual(['https://asylum.com.na/', 'https://support.google.com/business/', 'https://plumbers.na/']);
    expect(readPage(done.page, { domain: 'plumbers.na', includeSubdomains: true }).hit?.position).toBe(3);
  });

  it('reads a result Google wrapped in its own redirect by the address it shows', async () => {
    const records = [
      {
        searchQuery: { term: 'k', page: 1 },
        organicResults: [
          { url: 'https://other.test/', position: 1, type: 'organic' },
          { url: 'https://www.google.com/goto?url=CAESabc&gsessionid=x', displayedUrl: 'https://www.plumbers.na › drains', position: 2, type: 'organic' },
        ],
      },
    ];
    const { fetch } = fakeFetch((_c, path) => (path.includes('/datasets/') ? { body: records } : { body: run() }));
    const [out] = await apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:k` }], { fetch });
    const page = (out as Extract<typeof out, { state: 'done' }>).page;
    expect(readPage(page, { domain: 'plumbers.na', includeSubdomains: true }).hit).toMatchObject({ position: 2, url: 'https://www.plumbers.na/' });
    // The redirect is kept for the tracker to ask Google for the page; a plain link has none.
    expect(page.entries.map((e) => e.via)).toEqual([undefined, 'https://www.google.com/goto?url=CAESabc&gsessionid=x']);
  });

  it('says Google had nothing more when the last page says so, or came back empty', async () => {
    const endOf = async (records: unknown[]) => {
      const { fetch } = fakeFetch((_c, path) => (path.includes('/datasets/') ? { body: records } : { body: run() }));
      const [out] = await apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:k` }], { fetch });
      return (out as Extract<typeof out, { state: 'done' }>).page.end;
    };
    expect(await endOf([page('k', 1, ['https://a.test/'], { hasNextPage: true })])).toBeUndefined();
    expect(await endOf([page('k', 1, ['https://a.test/'], { hasNextPage: false })])).toBe(true);
    expect(await endOf([page('k', 1, ['https://a.test/']), page('k', 2, [])])).toBe(true);
  });

  it('throws when the token stops working, so the tracker can report it', async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, body: { error: { type: 'token-not-valid' } } }));
    await expect(apify.collect(CREDS, [{ checkId: 'c', ref: `${RUN_A}:1:x` }], { fetch })).rejects.toMatchObject({ kind: 'auth' });
  });

  it('is never re-read: its runs are not kept free of charge for a month', () => {
    expect(apify.freeRereadDays).toBeUndefined();
  });
});

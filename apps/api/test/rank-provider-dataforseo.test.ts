import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataForSeoLocationCache, dataForSeo } from '../src/rank/providers/dataforseo.js';
import { RankProviderError, type FetchLike, type RankSearch, type SerpEntry } from '../src/rank/providers/index.js';
import { findRank } from '../src/rank/match.js';

const CREDS = dataForSeo.parseCredentials({ login: 'api@agency.test', password: 's3cret-pass' });
const TASK_A = '11111111-1111-4111-8111-111111111111';
const TASK_B = '22222222-2222-4222-8222-222222222222';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A transport that answers by path, and records what it was asked. */
function fakeFetch(routes: Record<string, (call: Call) => { status?: number; body: unknown } | Error>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const path = new URL(url).pathname;
    const handler = Object.entries(routes).find(([prefix]) => path.startsWith(prefix))?.[1];
    if (!handler) return { ok: false, status: 404, text: async () => '{}' };
    const r = handler(call);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { fetch, calls };
}

const envelope = (tasks: unknown[], extra: Record<string, unknown> = {}) => ({ status_code: 20000, status_message: 'Ok.', tasks, ...extra });

const search = (checkId: string, keyword = 'plumber windhoek', pages = 10, startPage = 1): RankSearch => ({
  checkId,
  keyword,
  engine: 'google',
  device: 'desktop',
  location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' },
  languageCode: 'en',
  startPage,
  pages,
});

beforeEach(() => clearDataForSeoLocationCache());

describe('DataForSEO credentials and price', () => {
  it('requires a login and password, defaults to live searches, and refuses an unknown environment', () => {
    expect(CREDS).toEqual({ login: 'api@agency.test', password: 's3cret-pass', environment: 'production' });
    expect(() => dataForSeo.parseCredentials({ login: '', password: 'x' })).toThrow(/API login/);
    expect(() => dataForSeo.parseCredentials({ login: 'a', password: '' })).toThrow(/API password/);
    expect(() => dataForSeo.parseCredentials({ login: 'a', password: 'b', environment: 'staging' })).toThrow(RankProviderError);
  });

  it('prices a request per page of ten results, and the sandbox at nothing', () => {
    expect(dataForSeo.estimateCostUsd(1, CREDS)).toBeCloseTo(0.0006);
    expect(dataForSeo.estimateCostUsd(10, CREDS)).toBeCloseTo(0.006);
    expect(dataForSeo.estimateCostUsd(3, CREDS)).toBeCloseTo(0.0018);
    expect(dataForSeo.estimateCostUsd(10, { ...CREDS, environment: 'sandbox' })).toBe(0);
  });
});

describe('DataForSEO submit', () => {
  it('posts one task per search with Basic auth, tagged with the check id, and reads back each task', async () => {
    const { fetch, calls } = fakeFetch({
      '/v3/serp/google/organic/task_post': (call) => ({
        body: envelope([
          { id: TASK_A, status_code: 20100, status_message: 'Task Created.', cost: 0.006, data: { tag: (call.body as Array<{ tag: string }>)[0]!.tag } },
          { id: null, status_code: 40501, status_message: 'Invalid Field: location_name.', cost: 0, data: { tag: (call.body as Array<{ tag: string }>)[1]!.tag } },
        ]),
      }),
    });
    const out = await dataForSeo.submit(CREDS, [search('c1', '100% plumbing + gas'), search('c2'), search('c3')], { fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.dataforseo.com/v3/serp/google/organic/task_post');
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('api@agency.test:s3cret-pass').toString('base64')}`);
    const posted = calls[0]!.body as Array<Record<string, unknown>>;
    // ★ DataForSEO URL-decodes the keyword: a literal % and + must arrive encoded or the search changes.
    expect(posted[0]).toMatchObject({
      keyword: '100%25 plumbing %2B gas',
      location_name: 'Windhoek,Khomas Region,Namibia',
      language_code: 'en',
      device: 'desktop',
      os: 'windows',
      depth: 100,
      tag: 'c1',
    });
    // The first pages need no offset.
    expect(posted[0]).not.toHaveProperty('search_param');
    expect(out).toEqual([
      { checkId: 'c1', state: 'queued', ref: TASK_A, costUsd: 0.006 },
      { checkId: 'c2', state: 'failed', error: expect.stringContaining('Invalid Field'), costUsd: 0 },
      { checkId: 'c3', state: 'failed', error: 'DataForSEO returned no task for this search', costUsd: 0 },
    ]);
  });

  it('asks for a later stage’s pages with Google’s own offset, by results', async () => {
    const { fetch, calls } = fakeFetch({ '/v3/serp': () => ({ body: envelope([]) }) });
    await dataForSeo.submit(CREDS, [search('c1', 'plumber windhoek', 1, 2), search('c2', 'plumber windhoek', 3, 3), search('c3', 'plumber windhoek', 5, 6)], { fetch });
    const posted = calls[0]!.body as Array<Record<string, unknown>>;
    expect(posted.map((p) => [p.search_param, p.depth])).toEqual([
      ['start=10', 10],
      ['start=20', 30],
      ['start=50', 50],
    ]);
  });

  it('uses the sandbox host when asked, and a mobile search asks for a phone', async () => {
    const { fetch, calls } = fakeFetch({ '/v3/serp': () => ({ body: envelope([]) }) });
    await dataForSeo.submit({ ...CREDS, environment: 'sandbox' }, [{ ...search('c1'), device: 'mobile' }], { fetch });
    expect(calls[0]!.url.startsWith('https://sandbox.dataforseo.com/')).toBe(true);
    expect((calls[0]!.body as Array<Record<string, unknown>>)[0]).toMatchObject({ device: 'mobile', os: 'android' });
  });

  it.each([
    [{ status: 401, body: '' }, 'auth'],
    [{ status: 402, body: '' }, 'funds'],
    [{ body: { status_code: 40210, status_message: 'Insufficient Funds.' } }, 'funds'],
    [{ body: { status_code: 40100, status_message: 'You are not authorized.' } }, 'auth'],
    [{ body: { status_code: 40202, status_message: 'Rate limit.' } }, 'rate'],
    [{ body: { status_code: 50000, status_message: 'Internal Error.' } }, 'unavailable'],
    [{ status: 502, body: '<html>bad gateway</html>' }, 'unavailable'],
    [{ status: 500, body: { message: 'oops' } }, 'unavailable'],
    [{ body: { tasks: [] } }, 'unavailable'],
    [new Error('the payment provider could not be reached'), 'unavailable'],
  ] as const)('a refused request (%j) is a %s error that never echoes the transport or a credential', async (answer, kind) => {
    const { fetch } = fakeFetch({ '/v3/serp': () => answer as never });
    const err = await dataForSeo.submit(CREDS, [search('c1')], { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RankProviderError);
    expect((err as RankProviderError).kind).toBe(kind);
    expect((err as Error).message).not.toMatch(/payment|s3cret|api@agency/);
  });

  it('reads every task refused for one account reason, with nothing charged, as the whole request refused', async () => {
    const { fetch } = fakeFetch({
      '/v3/serp': (call) => ({
        body: envelope(
          (call.body as Array<{ tag: string }>).map((t) => ({ id: null, status_code: 40210, status_message: 'Insufficient Funds.', cost: 0, data: { tag: t.tag } })),
        ),
      }),
    });
    await expect(dataForSeo.submit(CREDS, [search('a'), search('b')], { fetch })).rejects.toMatchObject({ kind: 'funds' });
  });

  it('survives nulls and junk in an answer it was charged for, and reads it as possibly paid', async () => {
    const { fetch } = fakeFetch({
      '/v3/serp': () => ({ body: envelope([null, 'junk', { id: TASK_A, status_code: 20100, cost: 0.006, data: { tag: 'c1' } }]) }),
    });
    await expect(dataForSeo.submit(CREDS, [search('c1')], { fetch })).resolves.toEqual([
      { checkId: 'c1', state: 'queued', ref: TASK_A, costUsd: 0.006 },
    ]);
  });

  it('refuses more searches than one request may carry', async () => {
    const { fetch } = fakeFetch({});
    const many = Array.from({ length: 101 }, (_, i) => search(`c${i}`));
    await expect(dataForSeo.submit(CREDS, many, { fetch })).rejects.toThrow(/at most 100/);
  });
});

describe('DataForSEO collect', () => {
  const page = (items: unknown[], extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
    envelope([{ id: TASK_A, status_code: 20000, data, result: [{ datetime: '2026-10-20 06:15:00 +00:00', items, ...extra }] }]);

  it('reads organic results and featured snippets, skipping what it cannot use', async () => {
    const { fetch, calls } = fakeFetch({
      '/v3/serp/google/organic/task_get/regular/': () => ({
        body: page([
          { type: 'paid', rank_group: 1, rank_absolute: 1, url: 'https://ads.test/', domain: 'ads.test' },
          { type: 'featured_snippet', rank_group: 1, rank_absolute: 2, url: 'https://www.plumbers.na/faq', domain: 'www.plumbers.na' },
          { type: 'organic', rank_group: 1, rank_absolute: 3, url: 'https://other.test/', domain: 'other.test' },
          { type: 'organic', rank_group: 2, rank_absolute: 4, url: 'https://www.plumbers.na/', domain: 'www.plumbers.na' },
          { type: 'organic', rank_group: 'x', url: 'https://broken.test/' },
          null,
          { type: 'organic', rank_group: 3, rank_absolute: 5, url: 'javascript://plumbers.na/%0aalert(1)', domain: 'plumbers.na' },
        ], { pages_count: 3, items_count: 7 }, { depth: 100 }),
      }),
    });
    const [out] = await dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch });
    expect(calls[0]!.url).toBe(`https://api.dataforseo.com/v3/serp/google/organic/task_get/regular/${TASK_A}`);
    expect(out).toEqual({
      checkId: 'c1',
      state: 'done',
      page: {
        checkedAt: new Date('2026-10-20T06:15:00Z'),
        entries: [
          { kind: 'featured_snippet', position: 1, absolutePosition: 2, url: 'https://www.plumbers.na/faq', domain: 'www.plumbers.na' },
          { kind: 'organic', position: 1, absolutePosition: 3, url: 'https://other.test/', domain: 'other.test' },
          { kind: 'organic', position: 2, absolutePosition: 4, url: 'https://www.plumbers.na/', domain: 'www.plumbers.na' },
        ],
        // How many results pages Google served: three, for a search that asked for ten — so it has no more.
        pagesRead: 3,
        end: true,
      },
    });
  });

  it('reads a link DataForSEO could not resolve from Google’s redirect by the site its breadcrumb names', async () => {
    const GOTO = 'https://www.google.com/goto?url=CAESABC123opaque';
    const { fetch } = fakeFetch({
      '/v3/serp/google/organic/task_get/regular/': () => ({
        body: page([
          // A featured snippet has no breadcrumb ("always equals null"): its domain names the site.
          { type: 'featured_snippet', rank_group: 1, rank_absolute: 1, url: GOTO, domain: 'www.plumbers.na', breadcrumb: null },
          { type: 'organic', rank_group: 1, rank_absolute: 2, url: 'https://other.test/', domain: 'other.test', breadcrumb: 'https://other.test' },
          { type: 'organic', rank_group: 2, rank_absolute: 3, url: GOTO, domain: 'www.plumbers.na', breadcrumb: 'https://www.plumbers.na › services › geysers' },
          { type: 'organic', rank_group: 3, rank_absolute: 4, url: 'https://www.google.com/url?q=https://wrapped.test/page', domain: 'wrapped.test' },
          // Nothing names a site: the link stays as it came, holding its place, no one's to find.
          { type: 'organic', rank_group: 4, rank_absolute: 5, url: GOTO, domain: 'www.google.com', breadcrumb: '' },
          // A breadcrumb cut short inside the host names no site: the domain does.
          { type: 'organic', rank_group: 5, rank_absolute: 6, url: GOTO, domain: 'www.geysers.na', breadcrumb: 'https://www.geysers-and-solar-…' },
        ]),
      }),
    });
    const [out] = await dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch });
    const entries = (out as { page: { entries: SerpEntry[] } }).page.entries;
    expect(entries).toEqual([
      { kind: 'featured_snippet', position: 1, absolutePosition: 1, url: 'https://www.plumbers.na/', domain: 'www.plumbers.na', via: GOTO },
      { kind: 'organic', position: 1, absolutePosition: 2, url: 'https://other.test/', domain: 'other.test' },
      // The breadcrumb stands for a path cut into labels: the site alone, and the redirect to ask for the page.
      { kind: 'organic', position: 2, absolutePosition: 3, url: 'https://www.plumbers.na/', domain: 'www.plumbers.na', via: GOTO },
      { kind: 'organic', position: 3, absolutePosition: 4, url: 'https://wrapped.test/page', domain: 'wrapped.test' },
      { kind: 'organic', position: 4, absolutePosition: 5, url: GOTO, domain: 'www.google.com' },
      { kind: 'organic', position: 5, absolutePosition: 6, url: 'https://www.geysers.na/', domain: 'www.geysers.na', via: GOTO },
    ]);
    // Read as it came, the site's result was google.com's, and the site was not on the page at all.
    expect(findRank(entries, { domain: 'plumbers.na', includeSubdomains: false })).toMatchObject({ position: 1, featured: true, via: GOTO });
    expect(findRank(entries.slice(1), { domain: 'plumbers.na', includeSubdomains: false })).toMatchObject({ position: 2, via: GOTO });
  });

  it('asks for a stored result’s redirects resolved only on a re-read, waits longer, and reads as usual when that does not answer', async () => {
    const BASE = `https://api.dataforseo.com/v3/serp/google/organic/task_get/regular/${TASK_A}`;
    const answer = JSON.stringify(page([{ type: 'organic', rank_group: 1, rank_absolute: 1, url: 'https://www.plumbers.na/', domain: 'www.plumbers.na' }]));
    vi.useFakeTimers();
    try {
      const asked: string[] = [];
      // A usual read answers; a resolving one only fails, once aborted — so how long it is given is how long it waits.
      const fetch: FetchLike = (url, init) => {
        asked.push(url);
        if (!url.includes('resolve_goto_urls')) return Promise.resolve({ ok: true, status: 200, text: async () => answer });
        return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      };
      const read = (stored: boolean) => dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch, timeoutMs: 30_000 }, { stored });

      await expect(read(false)).resolves.toMatchObject([{ checkId: 'c1', state: 'done' }]);
      expect(asked).toEqual([BASE]);

      asked.length = 0;
      let settled = false;
      const reread = read(true).finally(() => (settled = true));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false); // still waiting where a usual read gives up
      expect(asked).toEqual([`${BASE}?resolve_goto_urls=true`]);
      await vi.advanceTimersByTimeAsync(30_000);
      // No answer in a minute: read as usual, not taken for an outage that would end every other re-read with it.
      await expect(reread).resolves.toMatchObject([{ checkId: 'c1', state: 'done', page: { entries: [{ url: 'https://www.plumbers.na/' }] } }]);
      expect(asked).toEqual([`${BASE}?resolve_goto_urls=true`, BASE]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks a re-read once when DataForSEO answers it, limits requests, or refuses the account', async () => {
    const limited = fakeFetch({ '/v3/serp': () => ({ status: 429, body: '' }) });
    await expect(dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch: limited.fetch }, { stored: true })).resolves.toEqual([{ checkId: 'c1', state: 'pending' }]);
    expect(limited.calls).toHaveLength(1);

    const answered = fakeFetch({ '/v3/serp/google/organic/task_get/regular/': () => ({ body: page([]) }) });
    await expect(dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch: answered.fetch }, { stored: true })).resolves.toMatchObject([{ state: 'done' }]);
    expect(answered.calls.map((c) => c.url)).toEqual([`https://api.dataforseo.com/v3/serp/google/organic/task_get/regular/${TASK_A}?resolve_goto_urls=true`]);

    const refused = fakeFetch({ '/v3/serp': () => ({ status: 401, body: '' }) });
    await expect(dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch: refused.fetch }, { stored: true })).rejects.toMatchObject({ kind: 'auth' });
    expect(refused.calls).toHaveLength(1);
  });

  it('reads a re-read as usual when DataForSEO refuses to resolve it', async () => {
    const { fetch, calls } = fakeFetch({
      '/v3/serp/google/organic/task_get/regular/': (call) =>
        call.url.includes('resolve_goto_urls') ? { body: { status_code: 40501, status_message: 'Invalid Field: resolve_goto_urls.' } } : { body: page([]) },
    });
    await expect(dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch }, { stored: true })).resolves.toMatchObject([{ state: 'done' }]);
    expect(calls.map((c) => c.url.endsWith('?resolve_goto_urls=true'))).toEqual([true, false]);
  });

  it('says Google had nothing more only when it served fewer pages than the task asked for', async () => {
    const read = async (pagesCount: number, depth?: number) => {
      const { fetch } = fakeFetch({ '/v3/serp/google/organic/task_get/regular/': () => ({ body: page([], { pages_count: pagesCount }, depth === undefined ? {} : { depth }) }) });
      const [out] = await dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch });
      return (out as { page: { end?: boolean } }).page.end;
    };
    expect(await read(1, 10)).toBeUndefined(); // one page asked, one served: maybe more after it
    expect(await read(3, 30)).toBeUndefined();
    expect(await read(2, 30)).toBe(true);
    expect(await read(2)).toBeUndefined(); // the task did not say what it asked for: no conclusion
  });

  it('leaves the pages out when DataForSEO does not say, or says something unusable', async () => {
    for (const extra of [{}, { pages_count: 'many' }, { pages_count: -1 }]) {
      const { fetch } = fakeFetch({ '/v3/serp/google/organic/task_get/regular/': () => ({ body: page([], extra) }) });
      const [out] = await dataForSeo.collect(CREDS, [{ checkId: 'c1', ref: TASK_A }], { fetch });
      expect(out).toMatchObject({ state: 'done' });
      expect((out as { page: object }).page).not.toHaveProperty('pagesRead');
    }
  });

  it('may be read again for free within the 30 days DataForSEO keeps a result', () => {
    expect(dataForSeo.freeRereadDays).toBe(29);
  });

  it('reports a task still in the queue as pending, an unknown one as failed, and never puts a forged id in a URL', async () => {
    const { fetch, calls } = fakeFetch({
      [`/v3/serp/google/organic/task_get/regular/${TASK_A}`]: () => ({ body: envelope([{ id: TASK_A, status_code: 40602, status_message: 'Task In Queue.' }]) }),
      [`/v3/serp/google/organic/task_get/regular/${TASK_B}`]: () => ({ body: envelope([{ id: TASK_B, status_code: 40401, status_message: 'Task Not Found.' }]) }),
    });
    const out = await dataForSeo.collect(
      CREDS,
      [
        { checkId: 'a', ref: TASK_A },
        { checkId: 'b', ref: TASK_B },
        { checkId: 'c', ref: '../../v3/appendix/user_data' },
      ],
      { fetch },
    );
    expect(out[0]).toEqual({ checkId: 'a', state: 'pending' });
    expect(out[1]).toMatchObject({ checkId: 'b', state: 'failed', error: expect.stringContaining('Task Not Found') });
    expect(out[2]).toMatchObject({ checkId: 'c', state: 'failed' });
    expect(calls).toHaveLength(2);
  });

  it('stops asking when the provider limits the rate, leaving the rest queued', async () => {
    const { fetch, calls } = fakeFetch({ '/v3/serp': () => ({ body: { status_code: 40202, status_message: 'Rate limit.' } }) });
    const queued = Array.from({ length: 20 }, (_, i) => ({ checkId: `c${i}`, ref: TASK_A }));
    const out = await dataForSeo.collect(CREDS, queued, { fetch });
    expect(out.every((o) => o.state === 'pending')).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(4); // the workers that were already asking
  });

  it('throws when the credentials stop working, so the tracker can report it', async () => {
    const { fetch } = fakeFetch({ '/v3/serp': () => ({ status: 401, body: '' }) });
    await expect(dataForSeo.collect(CREDS, [{ checkId: 'a', ref: TASK_A }], { fetch })).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('DataForSEO account and locations', () => {
  it('reads the balance', async () => {
    const { fetch, calls } = fakeFetch({
      '/v3/appendix/user_data': () => ({ body: envelope([{ status_code: 20000, result: [{ money: { balance: 48.25, total: 50 } }] }]) }),
    });
    await expect(dataForSeo.account(CREDS, { fetch })).resolves.toEqual({ balanceUsd: 48.25 });
    expect(calls[0]!.method).toBe('GET');
  });

  it('searches one country, places people search from first, and fetches the list once', async () => {
    const list = [
      { location_name: 'Namibia', location_type: 'Country', country_iso_code: 'NA' },
      { location_name: 'Windhoek East,Khomas Region,Namibia', location_type: 'Neighborhood', country_iso_code: 'NA' },
      { location_name: 'Khomas Region,Namibia', location_type: 'Region', country_iso_code: 'NA' },
      { location_name: 'Windhoek,Khomas Region,Namibia', location_type: 'City', country_iso_code: 'NA' },
      { location_name: 'Stray,Somewhere,Elsewhere', location_type: 'City', country_iso_code: 'ZA' },
    ];
    const { fetch, calls } = fakeFetch({ '/v3/serp/google/locations/na': () => ({ body: envelope([{ status_code: 20000, result: list }]) }) });
    // Two pickers at once share one download.
    const [wind] = await Promise.all([dataForSeo.searchLocations(CREDS, 'NA', 'wind', { fetch }), dataForSeo.searchLocations(CREDS, 'NA', 'kho', { fetch })]);
    expect(wind!.map((l) => l.name)).toEqual(['Windhoek,Khomas Region,Namibia', 'Windhoek East,Khomas Region,Namibia']);
    expect(wind![0]).toEqual({ name: 'Windhoek,Khomas Region,Namibia', type: 'City', countryCode: 'NA' });
    const all = await dataForSeo.searchLocations(CREDS, 'NA', '', { fetch });
    expect(all.map((l) => l.type)).toEqual(['City', 'Country', 'Region', 'Neighborhood']);
    expect(calls).toHaveLength(1);
    await expect(dataForSeo.searchLocations(CREDS, 'na', 'x', { fetch })).rejects.toThrow(/ISO code/);
  });

  it('fetches a location list through the large transport, and does not keep an empty one', async () => {
    const small = fakeFetch({});
    const large = fakeFetch({ '/v3/serp/google/locations/za': () => ({ body: envelope([{ status_code: 20000, result: [] }]) }) });
    await dataForSeo.searchLocations(CREDS, 'ZA', '', { fetch: small.fetch, largeFetch: large.fetch });
    await dataForSeo.searchLocations(CREDS, 'ZA', '', { fetch: small.fetch, largeFetch: large.fetch });
    expect(small.calls).toHaveLength(0);
    expect(large.calls).toHaveLength(2);
  });
});

describe('findRank — where the site is on a results page, the same for every provider', () => {
  const entry = (position: number, url: string, kind: SerpEntry['kind'] = 'organic', domain = ''): SerpEntry => ({
    kind,
    position,
    absolutePosition: position + 1,
    url,
    domain,
  });

  it('matches with or without www, and returns the best organic position', () => {
    const entries = [entry(1, 'https://other.test/'), entry(4, 'https://www.plumbers.na/services/'), entry(9, 'https://plumbers.na/contact/')];
    expect(findRank(entries, { domain: 'plumbers.na', includeSubdomains: false })).toEqual({
      position: 4,
      absolutePosition: 5,
      url: 'https://www.plumbers.na/services/',
      featured: false,
    });
  });

  it('counts a subdomain only when asked, and never a look-alike host', () => {
    const entries = [entry(2, 'https://shop.plumbers.na/'), entry(3, 'https://plumbers.na.evil.test/'), entry(5, 'https://notplumbers.na/')];
    expect(findRank(entries, { domain: 'plumbers.na', includeSubdomains: false })).toBeNull();
    expect(findRank(entries, { domain: 'plumbers.na', includeSubdomains: true })?.position).toBe(2);
  });

  it('counts the site’s featured snippet as position 1, as Google and Search Console do', () => {
    // Google does not repeat the snippet's page among the ordinary results below it, so this used to read as a miss.
    const snippet: SerpEntry = { kind: 'featured_snippet', position: 1, absolutePosition: 1, url: 'https://plumbers.na/faq', domain: '' };
    const organic: SerpEntry = { kind: 'organic', position: 1, absolutePosition: 2, url: 'https://other.test/', domain: '' };
    expect(findRank([snippet, organic], { domain: 'plumbers.na', includeSubdomains: true })).toEqual({
      position: 1,
      absolutePosition: 1,
      url: 'https://plumbers.na/faq',
      featured: true,
    });
  });

  it('numbers the ordinary results after someone else’s snippet from 2, and keeps the better of two listings', () => {
    const page: SerpEntry[] = [
      { kind: 'featured_snippet', position: 1, absolutePosition: 1, url: 'https://other.test/', domain: '' },
      { kind: 'organic', position: 1, absolutePosition: 2, url: 'https://third.test/', domain: '' },
      { kind: 'organic', position: 2, absolutePosition: 3, url: 'https://plumbers.na/', domain: '' },
      { kind: 'organic', position: 7, absolutePosition: 8, url: 'https://plumbers.na/contact/', domain: '' },
    ];
    expect(findRank(page, { domain: 'plumbers.na', includeSubdomains: true })).toMatchObject({ position: 3, featured: false, url: 'https://plumbers.na/' });
  });

  it("falls back to the provider's domain when the URL cannot be read", () => {
    expect(findRank([entry(3, 'not a url', 'organic', 'www.plumbers.na')], { domain: 'plumbers.na', includeSubdomains: false })?.position).toBe(3);
  });
});

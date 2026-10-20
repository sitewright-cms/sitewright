import { beforeEach, describe, expect, it } from 'vitest';
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

const search = (checkId: string, keyword = 'plumber windhoek', depth = 100): RankSearch => ({
  checkId,
  keyword,
  engine: 'google',
  device: 'desktop',
  location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' },
  languageCode: 'en',
  depth,
});

beforeEach(() => clearDataForSeoLocationCache());

describe('DataForSEO credentials and price', () => {
  it('requires a login and password, defaults to live searches, and refuses an unknown environment', () => {
    expect(CREDS).toEqual({ login: 'api@agency.test', password: 's3cret-pass', environment: 'production' });
    expect(() => dataForSeo.parseCredentials({ login: '', password: 'x' })).toThrow(/API login/);
    expect(() => dataForSeo.parseCredentials({ login: 'a', password: '' })).toThrow(/API password/);
    expect(() => dataForSeo.parseCredentials({ login: 'a', password: 'b', environment: 'staging' })).toThrow(RankProviderError);
  });

  it('prices a check per page of ten results, and the sandbox at nothing', () => {
    expect(dataForSeo.estimateCostUsd(10, CREDS)).toBeCloseTo(0.0006);
    expect(dataForSeo.estimateCostUsd(100, CREDS)).toBeCloseTo(0.006);
    expect(dataForSeo.estimateCostUsd(25, CREDS)).toBeCloseTo(0.0018);
    expect(dataForSeo.estimateCostUsd(100, { ...CREDS, environment: 'sandbox' })).toBe(0);
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
    expect(out).toEqual([
      { checkId: 'c1', state: 'queued', ref: TASK_A, costUsd: 0.006 },
      { checkId: 'c2', state: 'failed', error: expect.stringContaining('Invalid Field'), costUsd: 0 },
      { checkId: 'c3', state: 'failed', error: 'DataForSEO returned no task for this search', costUsd: 0 },
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
    [new Error('the payment provider could not be reached'), 'unavailable'],
  ] as const)('a refused request (%j) is a %s error that never echoes the transport or a credential', async (answer, kind) => {
    const { fetch } = fakeFetch({ '/v3/serp': () => answer as never });
    const err = await dataForSeo.submit(CREDS, [search('c1')], { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RankProviderError);
    expect((err as RankProviderError).kind).toBe(kind);
    expect((err as Error).message).not.toMatch(/payment|s3cret|api@agency/);
  });

  it('refuses more searches than one request may carry', async () => {
    const { fetch } = fakeFetch({});
    const many = Array.from({ length: 101 }, (_, i) => search(`c${i}`));
    await expect(dataForSeo.submit(CREDS, many, { fetch })).rejects.toThrow(/at most 100/);
  });
});

describe('DataForSEO collect', () => {
  const page = (items: unknown[]) =>
    envelope([{ id: TASK_A, status_code: 20000, result: [{ datetime: '2026-10-20 06:15:00 +00:00', items }] }]);

  it('reads organic results and featured snippets, skipping what it cannot use', async () => {
    const { fetch, calls } = fakeFetch({
      '/v3/serp/google/organic/task_get/regular/': () => ({
        body: page([
          { type: 'paid', rank_group: 1, rank_absolute: 1, url: 'https://ads.test/', domain: 'ads.test' },
          { type: 'featured_snippet', rank_group: 1, rank_absolute: 2, url: 'https://www.plumbers.na/faq', domain: 'www.plumbers.na' },
          { type: 'organic', rank_group: 1, rank_absolute: 3, url: 'https://other.test/', domain: 'other.test' },
          { type: 'organic', rank_group: 2, rank_absolute: 4, url: 'https://www.plumbers.na/', domain: 'www.plumbers.na' },
          { type: 'organic', rank_group: 'x', url: 'https://broken.test/' },
        ]),
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
      },
    });
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
    const wind = await dataForSeo.searchLocations(CREDS, 'NA', 'wind', { fetch });
    expect(wind.map((l) => l.name)).toEqual(['Windhoek,Khomas Region,Namibia', 'Windhoek East,Khomas Region,Namibia']);
    expect(wind[0]).toEqual({ name: 'Windhoek,Khomas Region,Namibia', type: 'City', countryCode: 'NA' });
    const all = await dataForSeo.searchLocations(CREDS, 'NA', '', { fetch });
    expect(all.map((l) => l.type)).toEqual(['City', 'Country', 'Region', 'Neighborhood']);
    expect(calls).toHaveLength(1);
    await expect(dataForSeo.searchLocations(CREDS, 'na', 'x', { fetch })).rejects.toThrow(/ISO code/);
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
    });
  });

  it('counts a subdomain only when asked, and never a look-alike host', () => {
    const entries = [entry(2, 'https://shop.plumbers.na/'), entry(3, 'https://plumbers.na.evil.test/'), entry(5, 'https://notplumbers.na/')];
    expect(findRank(entries, { domain: 'plumbers.na', includeSubdomains: false })).toBeNull();
    expect(findRank(entries, { domain: 'plumbers.na', includeSubdomains: true })?.position).toBe(2);
  });

  it('does not count a featured snippet as a position of its own', () => {
    const entries = [entry(1, 'https://plumbers.na/faq', 'featured_snippet'), entry(6, 'https://plumbers.na/faq')];
    expect(findRank(entries, { domain: 'plumbers.na', includeSubdomains: true })?.position).toBe(6);
  });

  it("falls back to the provider's domain when the URL cannot be read", () => {
    expect(findRank([entry(3, 'not a url', 'organic', 'www.plumbers.na')], { domain: 'plumbers.na', includeSubdomains: false })?.position).toBe(3);
  });
});

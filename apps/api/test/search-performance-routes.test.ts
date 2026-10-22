import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchPerformanceAvailability, SearchPerformanceView } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { addProjectMember } from '../src/repo/accounts.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * STATISTICS → SEARCH PERFORMANCE over HTTP: the numbers from the platform's Google and Bing accounts, for a site
 * verified there (the Search engines tile), readable by anyone who reads the project — the client too. Nothing is
 * asked of a search engine for a site that is not verified, and an answer is reused for an hour.
 */

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY_FILE = JSON.stringify({
  type: 'service_account',
  project_id: 'sitewright-seo-123',
  private_key_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  private_key: PEM,
  client_email: 'sitewright-seo@sitewright-seo-123.iam.gserviceaccount.com',
});
const BING_KEY = '0123456789abcdef0123456789abcdef';
const SITE = 'https://perfsite.sites.test/';
const slug = 'perfsite';

let engines: { googleDown: boolean; bingDown?: boolean; bingSites: string[]; analytics: Array<Record<string, unknown>>; calls: string[] };

/** Midnight Pacific of `day`, as Bing writes it. */
const bingDate = (day: string): string => `/Date(${Date.parse(`${day}T07:00:00Z`)}-0700)/`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysAgo = (n: number): string => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const fakeEngines: FetchLike = async (url, init) => {
  const path = url.split('?')[0]!;
  engines.calls.push(`${init.method} ${path}`);
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => (body === '' ? '' : JSON.stringify(body)) });
  if (path === 'https://oauth2.googleapis.com/token') return answer(200, { access_token: 'ya29.token' });
  if (path.endsWith('/siteVerification/v1/token')) return answer(200, { method: 'META', token: '<meta name="google-site-verification" content="gOOgle-Tag_1234567890" />' });
  if (path.includes('/siteVerification/v1/webResource')) return answer(200, { id: 'x', owners: [] });
  if (path.endsWith('/searchAnalytics/query')) {
    if (engines.googleDown) return answer(503, {});
    const body = JSON.parse(String(init.body)) as { dimensions: string[]; startDate: string };
    engines.analytics.push(body);
    const dim = body.dimensions[0];
    if (dim === 'date') {
      return answer(200, {
        rows: [
          { keys: [daysAgo(3)], clicks: 4, impressions: 80, ctr: 0.05, position: 6 },
          { keys: [daysAgo(10)], clicks: 2, impressions: 50, ctr: 0.04, position: 8 },
        ],
      });
    }
    if (dim === 'query') return answer(200, { rows: [{ keys: ['roofing windhoek'], clicks: 4, impressions: 60, ctr: 0.0667, position: 3.5 }] });
    if (dim === 'page') return answer(200, { rows: [{ keys: [`${SITE}services/`], clicks: 3, impressions: 40, ctr: 0.075, position: 4 }] });
    return answer(200, { rows: [] });
  }
  if (path.startsWith('https://www.googleapis.com/webmasters/v3/sites/')) return answer(204, '');
  if (path.endsWith('/GetUserSites')) return answer(200, { d: engines.bingSites.map((u) => ({ Url: u, AuthenticationCode: '0A1B2C3D4E5F60718293A4B5C6D7E8F9', IsVerified: true })) });
  if (path.endsWith('/AddSite')) {
    engines.bingSites.push((JSON.parse(String(init.body)) as { siteUrl: string }).siteUrl);
    return answer(200, { d: null });
  }
  if (path.endsWith('/VerifySite')) return answer(200, { d: true });
  if (engines.bingDown && /\/Get(RankAndTrafficStats|QueryStats|PageStats)$/.test(path)) return answer(503, {});
  if (path.endsWith('/GetRankAndTrafficStats')) return answer(200, { d: [{ Date: bingDate(daysAgo(2)), Clicks: 5, Impressions: 70 }] });
  if (path.endsWith('/GetQueryStats')) return answer(200, { d: [{ Date: bingDate(daysAgo(2)), Query: 'roof repair', Clicks: 5, Impressions: 70, AvgClickPosition: 2, AvgImpressionPosition: 3 }] });
  if (path.endsWith('/GetPageStats')) return answer(200, { d: [] });
  return answer(404, {});
};

let harness: Harness;
let admin: TestClient;
let projectId: string;
let publishRoot: string;

beforeEach(async () => {
  engines = { googleDown: false, bingSites: [], analytics: [], calls: [] };
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-search-perf-'));
  harness = await makeHarness({ publishRoot, sitesDomain: 'sites.test', webmasterFetch: fakeEngines, rankTickMs: 0 });
  admin = await harness.signup({ admin: true });
  expect((await admin.put('/admin/webmaster-accounts', { google: { keyFile: KEY_FILE }, bing: { apiKey: BING_KEY } })).statusCode).toBe(200);
  projectId = await admin.createProject('Perf Site', slug);
  await seed(SITE);
});
afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
});

async function seed(siteUrl: string): Promise<void> {
  const proj = admin.project(projectId);
  expect((await proj.putContent('settings', 'settings', { brand: { name: 'Perf' }, settings: { defaultLocale: 'en', locales: ['en'] }, website: { siteUrl } })).statusCode).toBe(200);
  expect((await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<h1>Hi</h1>' })).statusCode).toBe(200);
}
/** The Search engines tile's whole run: switch on, tags, deploy (Local Hosting), verify. */
async function verifyBoth(): Promise<void> {
  const base = `/projects/${projectId}/search-engines`;
  expect((await admin.put(base, { google: true, bing: true })).statusCode).toBe(200);
  expect((await admin.post(`${base}/prepare`, {})).statusCode).toBe(200);
  expect((await admin.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
  for (const s of ['google', 'bing']) expect(((await admin.post(`${base}/${s}/verify`, {})).json() as { result: { ok: boolean } }).result.ok).toBe(true);
}
const available = async (c: TestClient = admin) => (await c.get(`/projects/${projectId}/search-performance/available`)).json() as SearchPerformanceAvailability;
const read = (service: string, days = 28, c: TestClient = admin) => c.get(`/projects/${projectId}/search-performance?service=${service}&days=${days}`);

describe('search performance', () => {
  it('has nothing, and asks nobody, for a site no search engine verified', async () => {
    expect(await available()).toEqual({ services: [] });
    const r = await read('google');
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'This site has no search data at Google yet' });
    expect(engines.calls.filter((c) => c.includes('searchAnalytics'))).toEqual([]);
  });

  it('reads Google’s numbers for the period once, and the same answer for the next hour', async () => {
    await verifyBoth();
    expect(await available()).toEqual({ services: ['google', 'bing'] });
    const r = await read('google', 7);
    expect(r.statusCode).toBe(200);
    const view = r.json() as SearchPerformanceView;
    // Google's newest day is three days ago: the week shown ends there, the week before it is as long.
    expect(view).toMatchObject({
      service: 'google',
      siteUrl: SITE,
      period: { days: 7, start: daysAgo(9), end: daysAgo(3) },
      totals: { clicks: 4, impressions: 80, ctr: 0.05, position: 6 },
      previous: { clicks: 2, impressions: 50, ctr: 0.04, position: 8 },
      queries: [{ key: 'roofing windhoek', clicks: 4, impressions: 60 }],
      pages: [{ key: `${SITE}services/`, clicks: 3 }],
    });
    expect(view.daily.at(-1)).toEqual({ date: daysAgo(3), clicks: 4, impressions: 80 });
    // Nothing known about the site yet: the searches and pages were asked WITH the days, for the week ending yesterday;
    // Google's newest day said otherwise, so they were asked again for the week ending three days ago.
    expect(engines.analytics.map((q) => q.dimensions)).toEqual([['date'], ['query'], ['page'], ['query'], ['page']]);
    expect(engines.analytics[0]).toMatchObject({ type: 'web', dataState: 'all', startDate: daysAgo(16), endDate: today });
    expect(engines.analytics[1]).toMatchObject({ startDate: daysAgo(7), endDate: daysAgo(1) });
    expect(engines.analytics[3]).toMatchObject({ startDate: daysAgo(9), endDate: daysAgo(3) });
    await read('google', 7);
    expect(engines.analytics).toHaveLength(5);
    // The next period knows where this site's days end: everything in one round.
    expect((await read('google', 28)).json()).toMatchObject({ period: { days: 28, start: daysAgo(30), end: daysAgo(3) } });
    expect(engines.analytics.slice(5).map((q) => [q.dimensions, q.startDate, q.endDate])).toEqual([
      [['date'], daysAgo(58), today],
      [['query'], daysAgo(30), daysAgo(3)],
      [['page'], daysAgo(30), daysAgo(3)],
    ]);
    // One token for the verification and every read since: it lasts an hour.
    expect(engines.calls.filter((c) => c === 'POST https://oauth2.googleapis.com/token')).toHaveLength(1);
  });

  // ★ The agent tools read the SAME route, so the same answers: an agent asking costs Google and Bing nothing more.
  it('an agent reads the same numbers, and the rankings, through its tools with a read-only key', async () => {
    await verifyBoth();
    const key = await admin.post(`/projects/${projectId}/api-keys`, { name: 'agent', role: 'member', expiresInDays: 1, capabilities: ['content:read'] });
    const token = (key.json() as { token: string }).token;
    const tool = async (name: string, args: Record<string, unknown>) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${token}` },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      });
      expect(res.statusCode).toBe(200);
      const result = (res.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }).result;
      expect(result.isError).toBeFalsy();
      return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    };

    const both = await tool('get_search_performance', { days: 7 });
    expect(both).toMatchObject({
      services: ['google', 'bing'],
      results: [
        { service: 'google', siteUrl: SITE, totals: { clicks: 4, impressions: 80 }, queries: [{ key: 'roofing windhoek' }] },
        { service: 'bing', siteUrl: SITE },
      ],
    });
    const asked = engines.analytics.length;
    // The editor's view of the same period is the answer the agent got, and Google was not asked again.
    expect((await read('google', 7)).json()).toEqual((both.results as unknown[])[0]);
    expect(engines.analytics).toHaveLength(asked);

    // Rankings: nothing tracked, and no provider on this instance — read, never an error.
    expect(await tool('get_rankings', {})).toMatchObject({ tracking: null, keywords: [], canManage: false, configured: false });
  });

  it('does not keep a Bing answer that failed: the next period asks again', async () => {
    await verifyBoth();
    engines.bingDown = true;
    expect((await read('bing', 7)).statusCode).toBe(502);
    engines.bingDown = false;
    expect((await read('bing', 28)).statusCode).toBe(200);
  });

  it('reads Bing once for every period: Bing answers with the whole history', async () => {
    await verifyBoth();
    const asked = () => engines.calls.filter((c) => c.endsWith('/GetQueryStats')).length;
    expect((await read('bing', 7)).statusCode).toBe(200);
    expect((await read('bing', 28)).statusCode).toBe(200);
    expect((await read('bing', 90)).statusCode).toBe(200);
    expect(asked()).toBe(1);
  });

  it('reads Bing’s, which have no overall position', async () => {
    await verifyBoth();
    const view = (await read('bing', 7)).json() as SearchPerformanceView;
    expect(view.totals).toEqual({ clicks: 5, impressions: 70, ctr: 5 / 70, position: null });
    expect(view.queries).toEqual([{ key: 'roof repair', clicks: 5, impressions: 70, ctr: 5 / 70, position: 3 }]);
    expect(view.previous).toBeNull(); // Bing keeps nothing that old here
  });

  it('is for anyone who reads the project — the client too — and nobody else', async () => {
    await verifyBoth();
    const client = await harness.signup();
    expect((await read('google', 28, client)).statusCode).toBe(403);
    await addProjectMember(harness.db, client.userId, projectId, 'member');
    expect(await available(client)).toEqual({ services: ['google', 'bing'] });
    expect((await read('google', 28, client)).statusCode).toBe(200);
  });

  it('refuses a question it cannot answer, and says a search engine refused in words for any reader', async () => {
    await verifyBoth();
    expect((await read('yahoo')).statusCode).toBe(400);
    expect((await read('google', 30)).statusCode).toBe(400);
    engines.googleDown = true;
    const r = await read('google', 90);
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'Google could not be reached; try again later' });
    // Remembered for a while: a second reader does not make the server ask a search engine that is down.
    const tries = () => engines.calls.filter((c) => c.endsWith('/searchAnalytics/query')).length;
    const asked = tries();
    expect(asked).toBeGreaterThan(0);
    expect((await read('google', 90)).statusCode).toBe(502);
    expect(tries()).toBe(asked);
  });

  it('a new Production URL has no data until it is verified in turn', async () => {
    await verifyBoth();
    await seed('https://www.perf-site.test');
    expect(await available()).toEqual({ services: [] });
    expect((await read('google')).statusCode).toBe(404);
  });
});

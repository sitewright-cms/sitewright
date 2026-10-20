import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProjectRankings, RankTrackingAdminView } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { addProjectMember, registerAccount } from '../src/repo/accounts.js';
import type { FetchLike } from '../src/rank/providers/index.js';
import { clearDataForSeoLocationCache } from '../src/rank/providers/dataforseo.js';

/**
 * Rank tracking over HTTP: who may configure, who may manage keywords, who may only read — and one full run from
 * an admin entering credentials to a client reading a position, against a fake DataForSEO.
 */

const TASK = '33333333-3333-4333-8333-333333333333';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let previewRoot: string;
let calls: Array<{ url: string; body: unknown; auth: string | undefined }>;
/** What the fake DataForSEO answers to a results request. */
let resultItems: unknown[];

const fakeDataForSeo: FetchLike = async (url, init) => {
  calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization });
  const path = new URL(url).pathname;
  const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  if (path === '/v3/appendix/user_data') {
    return json({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ money: { balance: 49.5 } }] }] });
  }
  if (path === '/v3/serp/google/organic/task_post') {
    const tasks = (JSON.parse(init.body ?? '[]') as Array<{ tag: string }>).map((t) => ({
      id: TASK,
      status_code: 20100,
      cost: 0.006,
      data: { tag: t.tag },
    }));
    return json({ status_code: 20000, tasks });
  }
  if (path.startsWith('/v3/serp/google/organic/task_get/regular/')) {
    return json({
      status_code: 20000,
      tasks: [{ id: TASK, status_code: 20000, result: [{ datetime: '2026-10-20 06:00:00 +00:00', items: resultItems }] }],
    });
  }
  if (path === '/v3/serp/google/locations/na') {
    return json({
      status_code: 20000,
      tasks: [{ status_code: 20000, result: [{ location_name: 'Windhoek,Khomas Region,Namibia', location_type: 'City', country_iso_code: 'NA' }] }],
    });
  }
  return { ok: false, status: 404, text: async () => '{}' };
};

beforeEach(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-rank-'));
  db = await makeTestDb();
  calls = [];
  resultItems = [];
  clearDataForSeoLocationCache();
  app = await createApp({
    db,
    previewRoot,
    cookieSecret: 'rank-test-secret',
    encryptionKey: randomBytes(32),
    rankTickMs: 0,
    rankFetch: fakeDataForSeo,
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(previewRoot, { recursive: true, force: true });
});

const sessionOf = (r: { cookies: Array<{ name: string; value: string }> }): string => {
  const t = r.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
};

async function user(email: string, platformRole?: 'admin' | 'developer'): Promise<{ id: string; t: string }> {
  const { userId } = await registerAccount(db, email, 'Pw-secret-1', platformRole ? { platformRole } : {});
  const t = sessionOf(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  return { id: userId, t };
}

/** An admin, a developer who made the project, a client member, a client OWNER, and a developer elsewhere. */
async function cast() {
  const admin = await user('admin@agency.test', 'admin');
  const dev = await user('dev@agency.test', 'developer');
  const outsider = await user('other-dev@agency.test', 'developer');
  const client = await user('client@shop.test');
  const clientOwner = await user('owner@shop.test');
  const created = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: dev.t }, payload: { name: 'Plumbers', slug: 'plumbers' } });
  const pid = (created.json() as { project: { id: string } }).project.id;
  await addProjectMember(db, client.id, pid, 'member');
  await addProjectMember(db, clientOwner.id, pid, 'owner');
  return { admin, dev, outsider, client, clientOwner, pid };
}

const as = (t: string) => ({ cookies: { sw_session: t } });

async function configure(adminT: string): Promise<void> {
  const r = await app.inject({
    method: 'PUT',
    url: '/admin/rank-tracking',
    ...as(adminT),
    payload: { credentials: { dataforseo: { login: 'api@agency.test', password: 'p4ss-word' } }, activeProvider: 'dataforseo', monthlyBudgetUsd: 5 },
  });
  expect(r.statusCode).toBe(200);
}

describe('instance admin: provider, credentials, budget', () => {
  it('stores credentials without ever returning the secret, keeps it on a later save, and tests them', async () => {
    const { admin } = await cast();
    await configure(admin.t);
    const view = (await app.inject({ method: 'GET', url: '/admin/rank-tracking', ...as(admin.t) })).json() as RankTrackingAdminView;
    expect(view).toMatchObject({ activeProvider: 'dataforseo', monthlyBudgetUsd: 5, spentThisMonthUsd: 0, lastError: null });
    const dfs = view.providers.find((p) => p.id === 'dataforseo')!;
    expect(dfs).toMatchObject({ configured: true, values: { login: 'api@agency.test', environment: 'production' }, secretsSet: { password: true } });
    expect(JSON.stringify(view)).not.toContain('p4ss-word');

    // Switching to the sandbox without retyping the password keeps it.
    const r = await app.inject({ method: 'PUT', url: '/admin/rank-tracking', ...as(admin.t), payload: { credentials: { dataforseo: { environment: 'sandbox' } } } });
    expect(r.statusCode).toBe(200);
    const test = await app.inject({ method: 'POST', url: '/admin/rank-tracking/test', ...as(admin.t), payload: { provider: 'dataforseo' } });
    expect(test.json()).toEqual({ ok: true, balanceUsd: 49.5 });
    expect(calls.at(-1)!.url).toBe('https://sandbox.dataforseo.com/v3/appendix/user_data');
    expect(calls.at(-1)!.auth).toBe(`Basic ${Buffer.from('api@agency.test:p4ss-word').toString('base64')}`);
  });

  it('refuses an unknown field, a provider without credentials, and a budget past the ceiling', async () => {
    const { admin } = await cast();
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/admin/rank-tracking', ...as(admin.t), payload: payload as object });
    expect((await put({ credentials: { dataforseo: { login: 'a', password: 'b', apiKey: 'x' } } })).json()).toEqual({ error: 'DataForSEO has no field "apiKey"' });
    expect((await put({ activeProvider: 'dataforseo' })).json()).toEqual({ error: 'add the DataForSEO credentials first' });
    expect((await put({ monthlyBudgetUsd: 1_000_000 })).statusCode).toBe(400);
    expect((await put({ credentials: { dataforseo: { login: 'a' } } })).json()).toEqual({ error: 'Enter the DataForSEO API password' });
  });

  it('is for instance admins only: not developers, not clients, never a token', async () => {
    const { dev, client } = await cast();
    for (const t of [dev.t, client.t]) {
      expect((await app.inject({ method: 'GET', url: '/admin/rank-tracking', ...as(t) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: '/admin/rank-tracking', ...as(t), payload: { monthlyBudgetUsd: 1 } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/admin/rank-tracking', headers: { authorization: 'Bearer swm_x' } })).statusCode).toBe(403);
  });
});

describe('agency staff manage a project; clients only read', () => {
  it('a developer on the project sets it up and manages keywords; clients and outsiders cannot', async () => {
    const { dev, outsider, client, clientOwner, pid } = await cast();
    const settings = { domain: 'https://www.Plumbers.na/', schedule: 'daily', depth: 20 };

    for (const t of [client.t, clientOwner.t]) {
      const r = await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, ...as(t), payload: settings });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: 'only agency staff can change keyword tracking' });
    }
    expect((await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, ...as(outsider.t), payload: settings })).statusCode).toBe(403);

    const keywords = { keywords: ['Plumber  Windhoek', 'plumber windhoek', 'geyser repair'], location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' }, languageCode: 'en' };
    expect((await app.inject({ method: 'POST', url: `/projects/${pid}/rankings/keywords`, ...as(dev.t), payload: keywords })).json()).toEqual({
      error: 'set the domain to track first',
    });
    const set = await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, ...as(dev.t), payload: settings });
    expect(set.json()).toEqual({ tracking: { domain: 'plumbers.na', includeSubdomains: true, schedule: 'daily', depth: 20 } });
    const added = await app.inject({ method: 'POST', url: `/projects/${pid}/rankings/keywords`, ...as(dev.t), payload: keywords });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toEqual({ added: 2, existing: 0 }); // the two spellings are one keyword
    expect((await app.inject({ method: 'POST', url: `/projects/${pid}/rankings/keywords`, ...as(dev.t), payload: keywords })).json()).toEqual({ added: 0, existing: 2 });

    // The client reads them, and is told nothing about managing them.
    const read = (await app.inject({ method: 'GET', url: `/projects/${pid}/rankings`, ...as(client.t) })).json() as ProjectRankings;
    expect(read.canManage).toBe(false);
    expect(read).not.toHaveProperty('status');
    expect(read.keywords.map((k) => k.keyword)).toEqual(['geyser repair', 'plumber windhoek']);
    const kid = read.keywords[0]!.id;
    for (const req of [
      { method: 'PATCH' as const, url: `/projects/${pid}/rankings/keywords/${kid}`, payload: { paused: true } },
      { method: 'DELETE' as const, url: `/projects/${pid}/rankings/keywords/${kid}` },
      { method: 'POST' as const, url: `/projects/${pid}/rankings/check` },
      { method: 'POST' as const, url: `/projects/${pid}/rankings/keywords`, payload: keywords },
    ]) {
      expect((await app.inject({ ...req, ...as(client.t) })).statusCode).toBe(403);
    }

    expect((await app.inject({ method: 'PATCH', url: `/projects/${pid}/rankings/keywords/${kid}`, ...as(dev.t), payload: { paused: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/projects/${pid}/rankings/keywords/${kid}`, ...as(dev.t) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/projects/${pid}/rankings/keywords/${kid}`, ...as(dev.t) })).statusCode).toBe(404);
    const staffRead = (await app.inject({ method: 'GET', url: `/projects/${pid}/rankings`, ...as(dev.t) })).json() as ProjectRankings;
    expect(staffRead).toMatchObject({ canManage: true, status: 'no-provider' });
    expect(staffRead.keywords).toHaveLength(1);
  });

  it('a project key with read access reads the rankings but cannot manage them', async () => {
    const { dev, pid } = await cast();
    const key = await app.inject({
      method: 'POST',
      url: `/projects/${pid}/api-keys`,
      ...as(dev.t),
      payload: { name: 'k', role: 'owner', expiresInDays: 30, capabilities: ['content:read', 'content:write'] },
    });
    const bearer = { authorization: `Bearer ${(key.json() as { token: string }).token}` };
    const read = await app.inject({ method: 'GET', url: `/projects/${pid}/rankings`, headers: bearer });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ canManage: false, tracking: null, keywords: [] });
    const write = await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, headers: bearer, payload: { domain: 'x.test' } });
    expect(write.statusCode).toBe(403);
  });

  it('validates the range and the settings', async () => {
    const { dev, pid } = await cast();
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/rankings?from=2026-10-20&to=2026-10-01`, ...as(dev.t) })).json()).toEqual({ error: 'from is after to' });
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/rankings?from=2020-01-01&to=2026-10-01`, ...as(dev.t) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/rankings?from=2026-02-01&to=2026-02-31`, ...as(dev.t) })).statusCode).toBe(400);
    const bad = await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, ...as(dev.t), payload: { domain: 'localhost' } });
    expect(bad.json()).toEqual({ error: 'domain: enter the domain the site is published at, e.g. example.com' });
    expect((await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, ...as(dev.t), payload: { domain: 'a.test', depth: 15 } })).statusCode).toBe(400);
  });
});

describe('one full run', () => {
  it('admin configures, a developer adds keywords and checks now, the client reads the position', async () => {
    const { admin, dev, client, pid } = await cast();
    await configure(admin.t);

    // Locations come from the provider, for staff.
    const loc = await app.inject({ method: 'GET', url: '/rank-tracking/locations?country=NA&q=wind', ...as(dev.t) });
    expect(loc.json()).toEqual({ locations: [{ name: 'Windhoek,Khomas Region,Namibia', type: 'City', countryCode: 'NA' }] });
    expect((await app.inject({ method: 'GET', url: '/rank-tracking/locations?country=NA&q=wind', ...as(client.t) })).statusCode).toBe(403);

    await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, ...as(dev.t), payload: { domain: 'plumbers.na', schedule: 'weekly', depth: 100 } });
    await app.inject({
      method: 'POST',
      url: `/projects/${pid}/rankings/keywords`,
      ...as(dev.t),
      payload: { keywords: ['plumber windhoek'], device: 'mobile', location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' }, languageCode: 'en' },
    });

    resultItems = [
      { type: 'organic', rank_group: 1, rank_absolute: 1, url: 'https://competitor.test/', domain: 'competitor.test' },
      { type: 'organic', rank_group: 2, rank_absolute: 3, url: 'https://www.plumbers.na/emergency/', domain: 'www.plumbers.na' },
    ];
    // A place the provider does not know is refused while someone is looking, not failed every day after.
    const unknown = await app.inject({
      method: 'POST',
      url: `/projects/${pid}/rankings/keywords`,
      ...as(dev.t),
      payload: { keywords: ['x'], location: { name: 'Atlantis,Khomas Region,Namibia', countryCode: 'NA' }, languageCode: 'en' },
    });
    expect(unknown.json()).toEqual({ error: 'DataForSEO does not know the location "Atlantis,Khomas Region,Namibia"; choose one from the list' });

    const first = await app.inject({ method: 'POST', url: `/projects/${pid}/rankings/check`, ...as(dev.t) });
    expect(first.json()).toMatchObject({ status: 'ok', sent: 1 });
    const posted = calls.find((c) => c.url.endsWith('/task_post'))!.body as Array<Record<string, unknown>>;
    expect(posted).toEqual([
      expect.objectContaining({ keyword: 'plumber windhoek', location_name: 'Windhoek,Khomas Region,Namibia', device: 'mobile', depth: 100 }),
    ]);

    // Pending until collected.
    const pending = (await app.inject({ method: 'GET', url: `/projects/${pid}/rankings`, ...as(client.t) })).json() as ProjectRankings;
    expect(pending.keywords[0]).toMatchObject({ pending: true, latest: null });

    // The next pass collects (a second "check now" sends nothing new: once a day).
    expect((await app.inject({ method: 'POST', url: `/projects/${pid}/rankings/check`, ...as(dev.t) })).json()).toMatchObject({ sent: 0, collected: 1 });
    const read = (await app.inject({ method: 'GET', url: `/projects/${pid}/rankings`, ...as(client.t) })).json() as ProjectRankings;
    expect(read.tracking).toEqual({ domain: 'plumbers.na', includeSubdomains: true, schedule: 'weekly', depth: 100 });
    expect(read.keywords[0]).toMatchObject({
      keyword: 'plumber windhoek',
      device: 'mobile',
      pending: false,
      latest: { position: 2, url: 'https://www.plumbers.na/emergency/', depth: 100, checkedAt: '2026-10-20T06:00:00.000Z' },
      best: 2,
      change: null,
    });
    expect(read.keywords[0]!.series).toHaveLength(1);

    const adminView = (await app.inject({ method: 'GET', url: '/admin/rank-tracking', ...as(admin.t) })).json() as RankTrackingAdminView;
    expect(adminView).toMatchObject({ spentThisMonthUsd: 0.006, projectsTracked: 1, keywordsTracked: 1 });

    // A new domain is another site: its history starts empty rather than comparing against the old one.
    await app.inject({ method: 'PUT', url: `/projects/${pid}/rankings/settings`, ...as(dev.t), payload: { domain: 'plumbers-windhoek.na', schedule: 'weekly', depth: 100 } });
    const moved = (await app.inject({ method: 'GET', url: `/projects/${pid}/rankings`, ...as(client.t) })).json() as ProjectRankings;
    expect(moved.keywords[0]).toMatchObject({ latest: null, series: [], best: null });
  });
});

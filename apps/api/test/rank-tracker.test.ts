import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { projects, rankChecks } from '../src/db/schema.js';
import { RankRepository, RANK_MAX_ATTEMPTS } from '../src/rank/repo.js';
import { RankTracker } from '../src/rank/tracker.js';
import {
  RankProviderError,
  type CollectOutcome,
  type RankProvider,
  type RankSearch,
  type SubmitOutcome,
} from '../src/rank/providers/index.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * The tracker against a real database and a scripted provider: what is due, what it costs, and what happens
 * when the provider refuses.
 */

type Db = Awaited<ReturnType<typeof makeTestDb>>;

/** A provider whose answers the test scripts. Charges $0.006 per search unless told otherwise. */
function scriptedProvider() {
  const submitted: RankSearch[][] = [];
  const state = {
    submitError: null as RankProviderError | null,
    collectError: null as RankProviderError | null,
    /** checkId → result page entries, or 'pending'. */
    results: new Map<string, 'pending' | Array<{ position: number; url: string }>>(),
    cost: 0.006,
  };
  const provider: RankProvider = {
    id: 'dataforseo',
    label: 'Scripted',
    signupUrl: 'https://example.test/',
    fields: [],
    maxBatch: 2,
    parseCredentials: (raw) => ({ ...raw }),
    estimateCostUsd: () => state.cost,
    async submit(_creds, searches) {
      if (state.submitError) throw state.submitError;
      submitted.push([...searches]);
      return searches.map((s): SubmitOutcome => ({ checkId: s.checkId, state: 'queued', ref: `ref-${s.checkId}`, costUsd: state.cost }));
    },
    async collect(_creds, queued) {
      if (state.collectError) throw state.collectError;
      return queued.map((q): CollectOutcome => {
        const r = state.results.get(q.checkId) ?? 'pending';
        if (r === 'pending') return { checkId: q.checkId, state: 'pending' };
        return {
          checkId: q.checkId,
          state: 'done',
          page: {
            checkedAt: new Date('2026-10-20T06:00:00Z'),
            entries: r.map((e) => ({ kind: 'organic' as const, position: e.position, absolutePosition: e.position, url: e.url, domain: '' })),
          },
        };
      });
    },
    account: async () => ({ balanceUsd: 10 }),
    searchLocations: async () => [],
  };
  return { provider, submitted, state };
}

let db: Db;
let repo: RankRepository;
let now: Date;
const log = { info: () => {}, warn: () => {} };

async function makeProject(slug: string): Promise<string> {
  const owner = await registerAccount(db, `${slug}@a.test`, 'Pw-secret-1');
  const p = await new ProjectRepository(db).create({ name: slug, slug }, owner.userId);
  return p.id;
}

async function checks(): Promise<Array<typeof rankChecks.$inferSelect>> {
  return db.select().from(rankChecks);
}

beforeEach(async () => {
  db = await makeTestDb();
  repo = new RankRepository(db, randomBytes(32));
  now = new Date('2026-10-20T08:00:00Z');
  await repo.putCredentials('dataforseo', { login: 'l', password: 'p' });
  await repo.putConfig({ activeProvider: 'dataforseo', monthlyBudgetMicros: 1_000_000 });
});

function tracker(provider: RankProvider): RankTracker {
  return new RankTracker({ repo, providers: { dataforseo: provider }, io: { fetch: async () => { throw new Error('no network'); } }, now: () => now, log });
}

async function addKeywords(projectId: string, keywords: string[], schedule: 'daily' | 'weekly' = 'daily'): Promise<void> {
  await repo.putProject(projectId, { domain: 'plumbers.na', includeSubdomains: true, schedule, depth: 100 });
  await repo.addKeywords(projectId, {
    keywords,
    engine: 'google',
    device: 'desktop',
    location: { name: 'Namibia', countryCode: 'NA' },
    languageCode: 'en',
  });
}

describe('credentials at rest', () => {
  it('stores them encrypted and reads them back', async () => {
    const [row] = await db.select().from((await import('../src/db/schema.js')).rankProviderCredentials);
    expect(JSON.stringify(row)).not.toContain('"password"');
    expect(await repo.getCredentials('dataforseo')).toEqual({ login: 'l', password: 'p' });
  });
});

describe('the tracker sends what is due, once a day', () => {
  it('sends every due keyword in batches, records the cost, and does not send them again that day', async () => {
    const pid = await makeProject('one');
    await addKeywords(pid, ['plumber windhoek', 'geyser repair', 'blocked drain']);
    const { provider, submitted } = scriptedProvider();
    const t = tracker(provider);

    const first = await t.tick();
    expect(first).toMatchObject({ status: 'ok', sent: 3 });
    expect(submitted.map((b) => b.length)).toEqual([2, 1]); // maxBatch 2
    const rows = await checks();
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued', 'queued']);
    expect(rows.every((r) => r.costMicros === 6000 && r.day === '2026-10-20' && r.providerRef?.startsWith('ref-'))).toBe(true);
    expect(await repo.spentMicrosSince(new Date('2026-10-01T00:00:00Z'))).toBe(18_000);

    // A second pass the same day — or a "check now" — pays for nothing more.
    expect(await t.tick()).toMatchObject({ sent: 0 });
    expect(await t.checkNow(pid)).toMatchObject({ sent: 0 });
    expect(submitted).toHaveLength(2);
  });

  it('collects results and records where the site ranked, or that it was not in the results read', async () => {
    const pid = await makeProject('two');
    await addKeywords(pid, ['plumber windhoek', 'geyser repair']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [a, b] = await checks();
    state.results.set(a!.id, [
      { position: 1, url: 'https://competitor.test/' },
      { position: 3, url: 'https://www.plumbers.na/geysers/' },
    ]);
    state.results.set(b!.id, [{ position: 1, url: 'https://competitor.test/' }]);
    const report = await t.tick();
    expect(report).toMatchObject({ collected: 2 });
    const done = new Map((await checks()).map((r) => [r.id, r]));
    expect(done.get(a!.id)).toMatchObject({ status: 'done', position: 3, url: 'https://www.plumbers.na/geysers/' });
    expect(done.get(b!.id)).toMatchObject({ status: 'done', position: null, url: null });
    expect(done.get(a!.id)!.checkedAt).toEqual(new Date('2026-10-20T06:00:00Z'));
  });

  it('checks a weekly keyword again only after seven days, unless checked now', async () => {
    const pid = await makeProject('three');
    await addKeywords(pid, ['plumber windhoek'], 'weekly');
    const { provider, submitted, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    for (const r of await checks()) state.results.set(r.id, []); // finished: not in the results read
    now = new Date('2026-10-26T08:00:00Z'); // six days on
    expect(await t.tick()).toMatchObject({ sent: 0 });
    expect(await t.checkNow(pid)).toMatchObject({ sent: 1 }); // a different day: once that day
    now = new Date('2026-11-02T08:00:00Z');
    expect(await t.tick()).toMatchObject({ sent: 1 });
    expect(submitted).toHaveLength(3);
  });

  it('skips paused keywords, projects without a setup, and soft-deleted projects', async () => {
    const live = await makeProject('live');
    await addKeywords(live, ['kept', 'paused']);
    const paused = (await repo.listKeywords(live)).find((k) => k.keyword === 'paused')!;
    await repo.setPaused(live, paused.id, true);
    const deleted = await makeProject('gone');
    await addKeywords(deleted, ['ghost']);
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, deleted));
    const bare = await makeProject('bare');
    await repo.addKeywords(bare, { keywords: ['no setup'], engine: 'google', device: 'desktop', location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'en' });

    const { provider, submitted } = scriptedProvider();
    await tracker(provider).tick();
    expect(submitted.flat().map((s) => s.keyword)).toEqual(['kept']);
  });
});

describe('money', () => {
  it('stops at the monthly budget, and starts again next month', async () => {
    await repo.putConfig({ monthlyBudgetMicros: 13_000 }); // two checks at $0.006
    const pid = await makeProject('budget');
    await addKeywords(pid, ['a', 'b', 'c']);
    const { provider, submitted } = scriptedProvider();
    const t = tracker(provider);
    expect(await t.tick()).toMatchObject({ status: 'budget-reached', sent: 2 });
    expect(await t.status()).toBe('ok'); // 12,000 of 13,000 spent: below, but not enough for another check
    expect(await t.tick()).toMatchObject({ sent: 0 });
    now = new Date('2026-11-01T00:30:00Z');
    // A new month: the budget is fresh again, and still pays for two.
    expect(await t.tick()).toMatchObject({ status: 'budget-reached', sent: 2 });
    expect(submitted.flat()).toHaveLength(4);
  });

  it('reports budget-reached once the month is spent', async () => {
    await repo.putConfig({ monthlyBudgetMicros: 6_000 });
    const pid = await makeProject('spent');
    await addKeywords(pid, ['a']);
    const t = tracker(scriptedProvider().provider);
    await t.tick();
    expect(await t.status()).toBe('budget-reached');
  });

  it('gives the claims back when the provider refuses the whole request, and says why', async () => {
    const pid = await makeProject('refused');
    await addKeywords(pid, ['a', 'b']);
    const { provider, state, submitted } = scriptedProvider();
    state.submitError = new RankProviderError('The DataForSEO balance is too low; add funds to the account', 'funds');
    const t = tracker(provider);
    expect(await t.tick()).toMatchObject({ status: 'provider-error', sent: 0, failed: 0 });
    expect(await checks()).toHaveLength(0); // nothing spent, no attempt used
    expect((await repo.getConfig()).lastError?.message).toMatch(/balance is too low/);
    expect(await t.status()).toBe('provider-error');

    // Funds added: the same keywords go out the same day, and the error clears.
    state.submitError = null;
    expect(await t.tick()).toMatchObject({ status: 'ok', sent: 2 });
    expect(submitted).toHaveLength(1);
    expect((await repo.getConfig()).lastError).toBeNull();
  });

  it('counts a transport failure as an attempt (the request may have been taken), and stops after a few', async () => {
    const pid = await makeProject('flaky');
    await addKeywords(pid, ['a']);
    const { provider, state } = scriptedProvider();
    state.submitError = new RankProviderError('DataForSEO could not be reached', 'unavailable');
    const t = tracker(provider);
    for (let i = 0; i < RANK_MAX_ATTEMPTS + 2; i++) await t.tick();
    const [row] = await checks();
    expect(row).toMatchObject({ status: 'failed', attempts: RANK_MAX_ATTEMPTS, error: 'DataForSEO could not be reached' });
  });

  it('a claim is taken once: a queued or finished check is never claimed again that day', async () => {
    const pid = await makeProject('claim');
    await addKeywords(pid, ['a']);
    const [k] = await repo.listKeywords(pid);
    const id = await repo.claim(k!, '2026-10-20', 'dataforseo', 100, now);
    expect(id).toBeTruthy();
    expect(await repo.claim(k!, '2026-10-20', 'dataforseo', 100, now)).toBeNull(); // still posting
    await repo.markQueued(id!, 'ref', 0.006);
    expect(await repo.claim(k!, '2026-10-20', 'dataforseo', 100, now)).toBeNull();
    expect(await repo.claim(k!, '2026-10-21', 'dataforseo', 100, now)).toBeTruthy();
  });
});

describe('housekeeping', () => {
  it('fails a send cut off by a restart, and a result that never came', async () => {
    const pid = await makeProject('stale');
    await addKeywords(pid, ['a', 'b']);
    const [a, b] = await repo.listKeywords(pid);
    const posting = await repo.claim(a!, '2026-10-17', 'dataforseo', 100, new Date('2026-10-17T00:00:00Z'));
    const queued = await repo.claim(b!, '2026-10-12', 'dataforseo', 100, new Date('2026-10-12T00:00:00Z'));
    await repo.markQueued(queued!, 'ref', 0);
    expect(await repo.expireStale(now)).toBe(2);
    const rows = new Map((await checks()).map((r) => [r.id, r]));
    expect(rows.get(posting!)).toMatchObject({ status: 'failed', error: 'the request to the provider did not finish' });
    expect(rows.get(queued!)).toMatchObject({ status: 'failed', error: 'the provider never returned a result' });
  });

  it('after days of downtime, collects a result the provider still holds instead of expiring it', async () => {
    const pid = await makeProject('downtime');
    await addKeywords(pid, ['a'], 'weekly');
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 7, url: 'https://plumbers.na/' }]);
    now = new Date('2026-10-28T08:00:00Z'); // eight days on: past the queued-check expiry
    await t.tick();
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'done', position: 7 });
    expect(submitted).toHaveLength(2); // the weekly keyword is due again; the old result was not paid for twice
  });

  it('still collects checks of a provider that is no longer the active one', async () => {
    const pid = await makeProject('switch');
    await addKeywords(pid, ['a']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    await repo.putConfig({ activeProvider: null });
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 2, url: 'https://plumbers.na/' }]);
    expect(await t.tick()).toMatchObject({ status: 'no-provider', collected: 1 });
    expect((await checks())[0]).toMatchObject({ status: 'done', position: 2 });
  });

  it('removing a keyword removes its history; deleting the project removes everything', async () => {
    const pid = await makeProject('reap');
    await addKeywords(pid, ['a', 'b']);
    await tracker(scriptedProvider().provider).tick();
    const [a] = await repo.listKeywords(pid);
    expect(await repo.removeKeyword(pid, a!.id)).toBe(true);
    expect(await checks()).toHaveLength(1);
    expect(await repo.removeKeyword('another-project', (await repo.listKeywords(pid))[0]!.id)).toBe(false);
    await new ProjectRepository(db).remove(pid);
    expect(await checks()).toHaveLength(0);
    expect(await repo.getProject(pid)).toBeNull();
  });
});

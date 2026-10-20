import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { projects, rankChecks, rankProviderCredentials } from '../src/db/schema.js';
import { RankRepository, type DueKeyword, type RankKeywordRow } from '../src/rank/repo.js';
import { RankTracker } from '../src/rank/tracker.js';
import { RankProviderError, type CollectOutcome, type RankProvider, type RankSearch, type SubmitOutcome } from '../src/rank/providers/index.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * The tracker against a real database and a scripted provider: what is due, what it costs, and what happens when
 * the provider refuses or a reply is lost.
 */

type Db = Awaited<ReturnType<typeof makeTestDb>>;

/** A provider whose answers the test scripts. Charges $0.006 per search of depth 100 unless told otherwise. */
function scriptedProvider() {
  const submitted: RankSearch[][] = [];
  const state = {
    /** Thrown by the next submits, in order (null = answer normally). */
    submitErrors: [] as Array<RankProviderError | null>,
    collectError: null as RankProviderError | null,
    /** checkId → result page entries, 'pending', or a failure message. */
    results: new Map<string, 'pending' | { fail: string } | Array<{ position: number; url: string }>>(),
    cost: 0.006,
  };
  const provider: RankProvider = {
    id: 'dataforseo',
    label: 'Scripted',
    signupUrl: 'https://example.test/',
    fields: [],
    maxBatch: 2,
    parseCredentials: (raw) => ({ ...raw }),
    estimateCostUsd: (depth) => state.cost * (depth / 100),
    async submit(_creds, searches) {
      const err = state.submitErrors.shift();
      if (err) throw err;
      submitted.push([...searches]);
      return searches.map((s): SubmitOutcome => ({ checkId: s.checkId, state: 'queued', ref: `ref-${s.checkId}`, costUsd: state.cost * (s.depth / 100) }));
    },
    async collect(_creds, queued) {
      if (state.collectError) throw state.collectError;
      return queued.map((q): CollectOutcome => {
        const r = state.results.get(q.checkId) ?? 'pending';
        if (r === 'pending') return { checkId: q.checkId, state: 'pending' };
        if (!Array.isArray(r)) return { checkId: q.checkId, state: 'failed', error: r.fail };
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
  return (await new ProjectRepository(db).create({ name: slug, slug }, owner.userId)).id;
}

const checks = (): Promise<Array<typeof rankChecks.$inferSelect>> => db.select().from(rankChecks);
const due = (k: RankKeywordRow, domain = 'plumbers.na'): DueKeyword => ({ ...k, depth: 100, domain, includeSubdomains: true });

beforeEach(async () => {
  db = await makeTestDb();
  repo = new RankRepository(db, randomBytes(32));
  now = new Date('2026-10-20T08:00:00Z');
  await repo.putCredentials('dataforseo', { login: 'l', password: 'p' });
  await repo.putConfig({ activeProvider: 'dataforseo', monthlyBudgetMicros: 1_000_000 });
});

function tracker(provider: RankProvider): RankTracker {
  return new RankTracker({ repo, providers: { dataforseo: provider }, io: { fetch: async () => Promise.reject(new Error('no network')) }, now: () => now, log });
}

async function addKeywords(projectId: string, keywords: string[], schedule: 'daily' | 'weekly' = 'daily', depth: 10 | 100 = 100): Promise<void> {
  await repo.putProject(projectId, { domain: 'plumbers.na', includeSubdomains: true, schedule, depth });
  await repo.addKeywords(projectId, { keywords, engine: 'google', device: 'desktop', location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'en' });
}

describe('credentials at rest', () => {
  it('stores them encrypted and reads them back', async () => {
    const [row] = await db.select().from(rankProviderCredentials);
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

    expect(await t.tick()).toMatchObject({ status: 'ok', sent: 3 });
    expect(submitted.map((b) => b.length)).toEqual([2, 1]); // maxBatch 2
    const rows = await checks();
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued', 'queued']);
    expect(rows.every((r) => r.costMicros === 6000 && r.day === '2026-10-20' && r.domain === 'plumbers.na')).toBe(true);
    expect(await repo.spentMicrosSince(new Date('2026-10-01T00:00:00Z'))).toBe(18_000);

    // A second pass the same day — or a "check now" — sends nothing more.
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
    expect(await t.tick()).toMatchObject({ collected: 2 });
    const done = new Map((await checks()).map((r) => [r.id, r]));
    expect(done.get(a!.id)).toMatchObject({ status: 'done', position: 3, url: 'https://www.plumbers.na/geysers/' });
    expect(done.get(b!.id)).toMatchObject({ status: 'done', position: null, url: null });
    expect(done.get(a!.id)!.checkedAt).toEqual(new Date('2026-10-20T06:00:00Z'));
  });

  it('reads a result against the domain the check was SENT for, not one set since', async () => {
    const pid = await makeProject('moved');
    await addKeywords(pid, ['plumber']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    await repo.putProject(pid, { domain: 'newname.na', includeSubdomains: true, schedule: 'daily', depth: 100 });
    const [row] = await checks();
    state.results.set(row!.id, [
      { position: 1, url: 'https://newname.na/' },
      { position: 5, url: 'https://plumbers.na/' },
    ]);
    await t.tick();
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'done', position: 5, domain: 'plumbers.na' });
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

  it('refuses a second "check now" of a project while one runs', async () => {
    const pid = await makeProject('twice');
    await addKeywords(pid, ['a']);
    const t = tracker(scriptedProvider().provider);
    const [first, second] = await Promise.all([t.checkNow(pid), t.checkNow(pid)]);
    expect(first).toMatchObject({ sent: 1 });
    expect(second).toBeNull();
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
    expect(await t.tick()).toMatchObject({ sent: 0 });
    now = new Date('2026-11-01T00:30:00Z');
    expect(await t.tick()).toMatchObject({ status: 'budget-reached', sent: 2 }); // a fresh month, still two
    expect(submitted.flat()).toHaveLength(4);
  });

  it('skips a keyword the rest of the budget cannot pay for, and still sends a cheaper one after it', async () => {
    await repo.putConfig({ monthlyBudgetMicros: 7_000 });
    const deep = await makeProject('deep');
    await addKeywords(deep, ['deep one', 'deep two'], 'daily', 100); // $0.006 each
    const shallow = await makeProject('shallow');
    await addKeywords(shallow, ['shallow'], 'daily', 10); // $0.0006
    const { provider, submitted } = scriptedProvider();
    expect(await tracker(provider).tick()).toMatchObject({ status: 'budget-reached', sent: 2 });
    expect(submitted.flat().map((s) => s.keyword).sort()).toEqual(['deep one', 'shallow']);
  });

  it('serves the longest-unchecked keywords first, so a tight budget rotates through projects', async () => {
    const a = await makeProject('first');
    await addKeywords(a, ['a']);
    const b = await makeProject('second');
    await addKeywords(b, ['b']);
    const { provider, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick(); // both, day one ($0.012)
    await repo.putConfig({ monthlyBudgetMicros: 18_000 }); // room for exactly one more
    now = new Date('2026-10-21T08:00:00Z');
    await t.tick(); // one of them on day two
    await repo.putConfig({ monthlyBudgetMicros: 24_000 }); // and one more
    now = new Date('2026-10-22T08:00:00Z');
    await t.tick(); // day three: the one NOT checked on day two goes first
    const day2 = submitted.at(-2)!.map((s) => s.keyword);
    const day3 = submitted.at(-1)!.map((s) => s.keyword);
    expect(day2).toHaveLength(1);
    expect(day3).toHaveLength(1);
    expect(day3[0]).not.toBe(day2[0]);
  });

  it('books the estimate when a check is claimed, so checks in flight count against the budget', async () => {
    const pid = await makeProject('booked');
    await addKeywords(pid, ['a']);
    const [k] = await repo.listKeywords(pid);
    await repo.claim(due(k!), '2026-10-20', 'dataforseo', 0.006, now);
    expect(await repo.spentMicrosSince(new Date('2026-10-01T00:00:00Z'))).toBe(6000);
  });

  it('gives the claims back when the provider refuses the whole request, and says why', async () => {
    const pid = await makeProject('refused');
    await addKeywords(pid, ['a', 'b']);
    const { provider, state, submitted } = scriptedProvider();
    state.submitErrors = [new RankProviderError('The DataForSEO balance is too low; add funds to the account', 'funds')];
    const t = tracker(provider);
    expect(await t.tick()).toMatchObject({ status: 'provider-error', sent: 0, failed: 0 });
    expect(await checks()).toHaveLength(0); // nothing booked
    expect((await repo.getConfig()).lastError?.message).toMatch(/balance is too low/);
    expect(await t.status()).toBe('provider-error');

    // Funds added: the same keywords go out the same day, and the error clears.
    expect(await t.tick()).toMatchObject({ status: 'ok', sent: 2 });
    expect(submitted).toHaveLength(1);
    expect((await repo.getConfig()).lastError).toBeNull();
  });

  it('a refusal partway gives back only what was not sent', async () => {
    const pid = await makeProject('partway');
    await addKeywords(pid, ['a', 'b', 'c']); // batches of 2: [a, b], [c]
    const { provider, state } = scriptedProvider();
    state.submitErrors = [null, new RankProviderError('DataForSEO is limiting the request rate; trying again later', 'rate')];
    expect(await tracker(provider).tick()).toMatchObject({ status: 'provider-error', sent: 2 });
    const rows = await checks();
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued']); // the third was given back, not failed
  });

  it('treats a lost reply as possibly paid: final for the day, the estimate kept, sent again tomorrow', async () => {
    const pid = await makeProject('lost');
    await addKeywords(pid, ['a']);
    const { provider, state, submitted } = scriptedProvider();
    state.submitErrors = [new RankProviderError('DataForSEO could not be reached', 'unavailable')];
    const t = tracker(provider);
    expect(await t.tick()).toMatchObject({ status: 'provider-error', sent: 0, failed: 1 });
    expect(await t.tick()).toMatchObject({ sent: 0 }); // not again today: it may have been charged
    const [row] = await checks();
    expect(row).toMatchObject({ status: 'failed', costMicros: 6000, error: 'DataForSEO could not be reached' });
    now = new Date('2026-10-21T08:00:00Z');
    expect(await t.tick()).toMatchObject({ sent: 1 });
    expect(submitted).toHaveLength(1);
  });

  it('does not buy a search again the same day when the provider ran it and it failed', async () => {
    const pid = await makeProject('failed');
    await addKeywords(pid, ['a']);
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, { fail: 'DataForSEO refused the request (40501: Invalid Field)' });
    expect(await t.tick()).toMatchObject({ failed: 1, sent: 0 });
    expect(submitted).toHaveLength(1);
  });

  it('a claim is taken once a day', async () => {
    const pid = await makeProject('claim');
    await addKeywords(pid, ['a']);
    const [k] = await repo.listKeywords(pid);
    const id = await repo.claim(due(k!), '2026-10-20', 'dataforseo', 0.006, now);
    expect(id).toBeTruthy();
    expect(await repo.claim(due(k!), '2026-10-20', 'dataforseo', 0.006, now)).toBeNull();
    await repo.markFailed(id!, 'x');
    expect(await repo.claim(due(k!), '2026-10-20', 'dataforseo', 0.006, now)).toBeNull();
    expect(await repo.claim(due(k!), '2026-10-21', 'dataforseo', 0.006, now)).toBeTruthy();
  });
});

describe('housekeeping', () => {
  it('fails a send cut off by a restart (its estimate kept), and a result that never came', async () => {
    const pid = await makeProject('stale');
    await addKeywords(pid, ['a', 'b']);
    const [a, b] = await repo.listKeywords(pid);
    const posting = await repo.claim(due(a!), '2026-10-17', 'dataforseo', 0.006, new Date('2026-10-17T00:00:00Z'));
    const queued = await repo.claim(due(b!), '2026-10-12', 'dataforseo', 0.006, new Date('2026-10-12T00:00:00Z'));
    await repo.markQueued(queued!, 'ref', 0.006);
    expect(await repo.expireStale(now)).toBe(2);
    const rows = new Map((await checks()).map((r) => [r.id, r]));
    expect(rows.get(posting!)).toMatchObject({ status: 'failed', costMicros: 6000, error: 'the request to the provider did not finish' });
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

  it('a successful collection clears the last provider error', async () => {
    const pid = await makeProject('clears');
    await addKeywords(pid, ['a']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    await repo.setLastError('DataForSEO is limiting the request rate; trying again later');
    const [row] = await checks();
    state.results.set(row!.id, []);
    await t.tick();
    expect((await repo.getConfig()).lastError).toBeNull();
  });

  it('setting the last error never writes back a provider or budget an admin just changed', async () => {
    await repo.putConfig({ activeProvider: null, monthlyBudgetMicros: 42 });
    await repo.setLastError('x');
    expect(await repo.getConfig()).toMatchObject({ activeProvider: null, monthlyBudgetMicros: 42, lastError: { message: 'x' } });
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

  it('unreadable credentials stop the tracker, not the caller', async () => {
    const other = new RankRepository(db, randomBytes(32)); // a different key: the stored secret cannot be decrypted
    const t = new RankTracker({ repo: other, providers: { dataforseo: scriptedProvider().provider }, io: { fetch: async () => Promise.reject(new Error('x')) }, now: () => now, log });
    await expect(t.status()).resolves.toBe('no-provider');
    await expect(t.tick()).resolves.toMatchObject({ status: 'no-provider' });
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

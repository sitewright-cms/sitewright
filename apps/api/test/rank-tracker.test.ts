import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { projects, rankCharges, rankChecks, rankProviderCredentials } from '../src/db/schema.js';
import { RankRepository, type DueKeyword, type RankKeywordRow } from '../src/rank/repo.js';
import { RankTracker } from '../src/rank/tracker.js';
import { projectRankings } from '../src/rank/routes.js';
import { RankProviderError, type CollectOutcome, type RankProvider, type RankSearch, type SubmitOutcome } from '../src/rank/providers/index.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * The tracker against a real database and a scripted provider: what is due, what it costs, and what happens when
 * the provider refuses or a reply is lost.
 */

type Db = Awaited<ReturnType<typeof makeTestDb>>;

/**
 * A provider whose answers the test scripts. Charges $0.006 per results PAGE unless told otherwise — a check's first
 * stage reads one page, so a first stage costs $0.006.
 */
function scriptedProvider() {
  const submitted: RankSearch[][] = [];
  const state = {
    /** Thrown by the next submits, in order (null = answer normally). */
    submitErrors: [] as Array<RankProviderError | null>,
    collectError: null as RankProviderError | null,
    /** checkId → result page entries, 'pending', or a failure message. An entry is organic unless `snippet`. */
    results: new Map<string, 'pending' | { fail: string } | Array<{ position: number; url: string; snippet?: true }>>(),
    /** checkId → the results pages the provider says it fetched. */
    pages: new Map<string, number>(),
    /** Checks whose page says Google has no more results. */
    ends: new Set<string>(),
    /** Every collect request, as the check ids asked about. */
    collected: [] as string[][],
    cost: 0.006,
    /** What the provider says it charged, when not the estimate. */
    charged: null as number | null,
    /** Runs while the request is with the provider (before any scripted error): what happens meanwhile. */
    duringSubmit: null as (() => Promise<void>) | null,
  };
  const provider: RankProvider = {
    id: 'dataforseo',
    label: 'Scripted',
    signupUrl: 'https://example.test/',
    fields: [],
    maxBatch: 2,
    parseCredentials: (raw) => ({ ...raw }),
    estimateCostUsd: (pages) => state.cost * pages,
    async submit(_creds, searches) {
      await state.duringSubmit?.();
      const err = state.submitErrors.shift();
      if (err) throw err;
      submitted.push([...searches]);
      return searches.map((s): SubmitOutcome => ({ checkId: s.checkId, state: 'queued', ref: `ref-${s.checkId}`, costUsd: (state.charged ?? state.cost) * s.pages }));
    },
    async collect(_creds, queued) {
      state.collected.push(queued.map((q) => q.checkId));
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
            // A snippet sits just above the organic result of the same number: `absolutePosition` keeps the page order.
            entries: r.map((e) => ({
              kind: e.snippet ? ('featured_snippet' as const) : ('organic' as const),
              position: e.position,
              absolutePosition: e.snippet ? e.position * 2 - 1 : e.position * 2,
              url: e.url,
              domain: '',
            })),
            ...(state.pages.has(q.checkId) ? { pagesRead: state.pages.get(q.checkId) } : {}),
            ...(state.ends.has(q.checkId) ? { end: true } : {}),
          },
        };
      });
    },
    account: async () => ({ balanceUsd: 10 }),
    searchLocations: async () => [],
  };
  return { provider, submitted, state };
}

/**
 * A provider that answers every search at once (as Bright Data does), from `pageOf` — results numbered from the first
 * page asked for. $0.0015 per page.
 */
function liveProvider(
  pageOf: (s: RankSearch) => { urls: string[]; end?: boolean; pagesRead?: number; cut?: true } | { unsent: string } | { fail: string; retry?: true },
) {
  const submitted: RankSearch[][] = [];
  const provider: RankProvider = {
    ...scriptedProvider().provider,
    id: 'brightdata',
    estimateCostUsd: (pages) => 0.0015 * pages,
    async submit(_creds, searches) {
      submitted.push([...searches]);
      return searches.map((s): SubmitOutcome => {
        const answer = pageOf(s);
        if ('unsent' in answer) return { checkId: s.checkId, state: 'unsent', error: answer.unsent };
        if ('fail' in answer) return { checkId: s.checkId, state: 'failed', error: answer.fail, costUsd: 0, ...(answer.retry ? { retry: true } : {}) };
        const { urls, end, cut } = answer;
        const pagesRead = answer.pagesRead ?? s.pages;
        const entries = urls.map((url, i) => ({ kind: 'organic' as const, position: i + 1, absolutePosition: i + 1, url, domain: '' }));
        const page = { checkedAt: now, entries, pagesRead, ...(end ? { end } : {}), ...(cut ? { cut } : {}) };
        return { checkId: s.checkId, state: 'done', page, costUsd: 0.0015 * pagesRead };
      });
    },
  };
  return { provider, submitted };
}

/** Ten results that are not the site's, for page `n`. */
const others = (n: number, count = 10): string[] => Array.from({ length: count }, (_, i) => `https://other${n}-${i}.test/`);

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

/** A provider never configured in these tests: it must never be asked anything. */
const idle = (id: 'apify' | 'brightdata' | 'dataforseo'): RankProvider => ({
  ...scriptedProvider().provider,
  id,
  submit: async () => Promise.reject(new Error(`${id} was never configured`)),
  collect: async () => Promise.reject(new Error(`${id} was never configured`)),
});
const idleApify = idle('apify');

function tracker(provider: RankProvider, clock?: () => number): RankTracker {
  const providers = { dataforseo: idle('dataforseo'), apify: idleApify, brightdata: idle('brightdata'), [provider.id]: provider };
  return new RankTracker({ repo, providers, io: { fetch: async () => Promise.reject(new Error('no network')) }, now: () => now, log, ...(clock ? { clock } : {}) });
}

/** Bright Data as the active provider (credentials stored). */
async function useLive(): Promise<void> {
  await repo.putCredentials('brightdata', { apiKey: 'k', zone: 'z' });
  await repo.putConfig({ activeProvider: 'brightdata' });
}

/** A finished check of the keyword on an earlier day, at `position`. */
async function checkedBefore(k: RankKeywordRow, day: string, position: number | null): Promise<void> {
  const id = (await repo.claim(due(k), day, 'brightdata', 0.0015, new Date(`${day}T06:00:00Z`)))!;
  await repo.markDone(id, { hit: position === null ? null : { position, absolutePosition: position, url: 'https://plumbers.na/', featured: false }, resultsRead: 50, pagesRead: 5, listEnded: false }, new Date(`${day}T06:00:00Z`));
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
    expect(await repo.spentMicrosInMonth(now)).toBe(18_000);

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
    state.ends.add(b!.id); // Google had nothing past it: the check reads no further
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

  it('skips a stage the rest of the budget cannot pay for, and still sends a cheaper one after it', async () => {
    const deep = await makeProject('deep');
    await addKeywords(deep, ['deep']);
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick(); // page 1 ($0.006)
    await t.tick();
    const [row] = await checks();
    // Pages 1 and 2 did not hold the site: next come pages 3–5, three pages ($0.018).
    state.results.set(row!.id, [{ position: 1, url: 'https://competitor.test/' }]);
    await t.tick(); // page 2
    state.results.set(row!.id, [{ position: 1, url: 'https://competitor.test/' }]);
    const shallow = await makeProject('shallow');
    await addKeywords(shallow, ['shallow']);
    await repo.putConfig({ monthlyBudgetMicros: (await repo.spentMicrosInMonth(now)) + 7_000 }); // room for one page
    expect(await t.tick()).toMatchObject({ status: 'budget-reached', sent: 1 });
    expect(submitted.at(-1)!.map((s) => [s.keyword, s.startPage, s.pages])).toEqual([['shallow', 1, 1]]);
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'next', pagesRead: 2 });
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
    expect(await repo.spentMicrosInMonth(now)).toBe(6000);
  });

  it('gives the claims back when the provider refuses the whole request, and says why', async () => {
    const pid = await makeProject('refused');
    await addKeywords(pid, ['a', 'b']);
    const { provider, state, submitted } = scriptedProvider();
    state.submitErrors = [new RankProviderError('The DataForSEO balance is too low; add funds to the account', 'funds')];
    const t = tracker(provider);
    expect(await t.tick()).toMatchObject({ status: 'provider-error', sent: 0, failed: 0 });
    expect(await checks()).toHaveLength(0); // nothing booked
    expect(await repo.spentMicrosInMonth(now)).toBe(0); // …in the budget either: the charges went with the claims
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
    expect(await repo.spentMicrosInMonth(now)).toBe(12_000);
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
    expect(await repo.spentMicrosInMonth(now)).toBe(6000); // the estimate stays booked
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
    expect(await repo.spentMicrosInMonth(now)).toBe(6000); // the claim that lost booked nothing
    await repo.markFailed(id!, 'x');
    expect(await repo.claim(due(k!), '2026-10-20', 'dataforseo', 0.006, now)).toBeNull();
    expect(await repo.claim(due(k!), '2026-10-21', 'dataforseo', 0.006, now)).toBeTruthy();
  });
});

describe('money outlives the checks', () => {
  // The month's spend used to be SUM(rank_checks.cost_micros), and those rows go with their keyword or project — so
  // money already spent vanished from the budget. Each test below read 0 (or paid past the budget) before the fix.

  it('removing keywords keeps what their checks cost; adding them back and checking again counts both, up to the budget', async () => {
    await repo.putConfig({ monthlyBudgetMicros: 30_000 }); // five checks at $0.006
    const pid = await makeProject('readd');
    await addKeywords(pid, ['a', 'b']);
    const { provider, submitted } = scriptedProvider();
    const t = tracker(provider);
    expect(await t.tick()).toMatchObject({ sent: 2 });

    const removeAll = async () => {
      for (const k of await repo.listKeywords(pid)) expect(await repo.removeKeyword(pid, k.id)).toBe(true);
    };
    await removeAll();
    expect(await checks()).toHaveLength(0);
    expect(await repo.spentMicrosInMonth(now)).toBe(12_000);

    // Added again: new ids, so the once-a-day index does not see the first checks — they are bought again, and counted.
    await addKeywords(pid, ['a', 'b']);
    expect(await t.tick()).toMatchObject({ sent: 2 });
    expect(await repo.spentMicrosInMonth(now)).toBe(24_000);

    // A third round: only one more check fits in the budget.
    await removeAll();
    await addKeywords(pid, ['a', 'b']);
    expect(await t.tick()).toMatchObject({ status: 'budget-reached', sent: 1 });
    expect(submitted.flat()).toHaveLength(5);
    expect(await repo.spentMicrosInMonth(now)).toBe(30_000);
    expect(await t.status()).toBe('budget-reached');
  });

  it('purging a project keeps what its checks cost', async () => {
    const pid = await makeProject('purged');
    await addKeywords(pid, ['a', 'b']);
    await tracker(scriptedProvider().provider).tick();
    await new ProjectRepository(db).remove(pid);
    expect(await checks()).toHaveLength(0);
    expect(await repo.spentMicrosInMonth(now)).toBe(12_000);
  });

  it('a check whose project is purged while the provider has the request is still booked, at the provider’s figure', async () => {
    const pid = await makeProject('race');
    await addKeywords(pid, ['a']);
    const { provider, state, submitted } = scriptedProvider();
    state.charged = 0.004; // the estimate is $0.006
    state.duringSubmit = () => new ProjectRepository(db).remove(pid);
    expect(await tracker(provider).tick()).toMatchObject({ sent: 1 });
    expect(submitted.flat()).toHaveLength(1);
    expect(await checks()).toHaveLength(0); // markQueued found no check to update…
    expect(await repo.spentMicrosInMonth(now)).toBe(4000); // …and the charge was booked all the same
  });

  it('a claim given back after its project was purged books nothing: nothing was sent for it', async () => {
    const pid = await makeProject('race-refused');
    await addKeywords(pid, ['a']);
    const { provider, state } = scriptedProvider();
    state.duringSubmit = () => new ProjectRepository(db).remove(pid);
    state.submitErrors = [new RankProviderError('DataForSEO refused the credentials', 'auth')];
    expect(await tracker(provider).tick()).toMatchObject({ status: 'provider-error', sent: 0 });
    expect(await repo.spentMicrosInMonth(now)).toBe(0);
  });

  it('a late release never gives back a check that went out', async () => {
    const pid = await makeProject('late-release');
    await addKeywords(pid, ['a']);
    const [k] = await repo.listKeywords(pid);
    const id = await repo.claim(due(k!), '2026-10-20', 'dataforseo', 0.006, now);
    await repo.markQueued(id!, 'ref', 0.005);
    await repo.release(id!);
    expect(await checks()).toHaveLength(1);
    expect(await repo.spentMicrosInMonth(now)).toBe(5000);
  });

  it('counts a check in the month it was claimed, whenever its result arrives', async () => {
    const pid = await makeProject('month-end');
    await addKeywords(pid, ['a']);
    const [k] = await repo.listKeywords(pid);
    const id = await repo.claim(due(k!), '2026-10-31', 'dataforseo', 0.006, new Date('2026-10-31T23:59:00Z'));
    await repo.markDone(id!, { hit: null, resultsRead: 100, pagesRead: 10, listEnded: false }, new Date('2026-11-01T00:05:00Z'), 0.007);
    expect(await repo.spentMicrosInMonth(new Date('2026-10-15T00:00:00Z'))).toBe(7000);
    expect(await repo.spentMicrosInMonth(new Date('2026-11-15T00:00:00Z'))).toBe(0);
  });
});

describe('retention', () => {
  const ids = async (table: typeof rankChecks | typeof rankCharges): Promise<string[]> =>
    table === rankChecks
      ? (await db.select({ id: rankChecks.id }).from(rankChecks)).map((r) => r.id).sort()
      : (await db.select({ id: rankCharges.checkId }).from(rankCharges)).map((r) => r.id).sort();

  it('once a day, the scheduled pass deletes checks older than 25 months, and charges of the months before them', async () => {
    const pid = await makeProject('old');
    await addKeywords(pid, ['a']);
    const [k] = await repo.listKeywords(pid);
    const claimOn = (day: string) => repo.claim(due(k!), day, 'dataforseo', 0.006, new Date(`${day}T08:00:00Z`));
    const august = (await claimOn('2024-08-31'))!;
    const gone = (await claimOn('2024-09-19'))!;
    const kept = (await claimOn('2024-09-20'))!; // 2026-10-20 minus 25 months: the first day kept
    await repo.putConfig({ activeProvider: null }); // nothing to send: only the housekeeping runs
    const t = tracker(scriptedProvider().provider);

    await t.tick();
    expect(await ids(rankChecks)).toEqual([kept]);
    expect(await ids(rankCharges)).toEqual([gone, kept].sort()); // September 2024 is partly inside: its charges stay

    // At most once a day: a check that falls out of the window later the same day waits for the next one.
    const later = (await claimOn('2024-09-10'))!;
    await t.tick();
    expect(await ids(rankChecks)).toEqual([kept, later].sort());
    now = new Date('2026-10-21T08:00:00Z');
    await t.tick();
    expect(await ids(rankChecks)).toEqual([]);
    expect(august).toBeTruthy();
  });

  it('deletes in bounded batches until nothing old is left, and stops after the day’s share', async () => {
    const pid = await makeProject('old-batches');
    await addKeywords(pid, ['a', 'b', 'c']);
    const ks = await repo.listKeywords(pid);
    for (const [i, k] of ks.entries()) {
      for (const day of ['2024-01-01', '2024-01-02']) await repo.claim(due(k), day, 'dataforseo', 0.006, new Date(`${day}T0${i}:00:00Z`));
    }
    const kept = await repo.claim(due(ks[0]!), '2026-10-20', 'dataforseo', 0.006, now);
    expect(await repo.pruneOld('2026-10-20', 4, 1)).toEqual({ checks: 4, charges: 4 }); // one batch of four: the rest tomorrow
    expect(await repo.pruneOld('2026-10-20', 4)).toEqual({ checks: 2, charges: 2 });
    expect(await ids(rankChecks)).toEqual([kept]);
    expect(await ids(rankCharges)).toEqual([kept]);
  });

  it('a "check now" does not run it', async () => {
    const pid = await makeProject('old-now');
    await addKeywords(pid, ['a']);
    const [k] = await repo.listKeywords(pid);
    const old = await repo.claim(due(k!), '2024-01-01', 'dataforseo', 0.006, new Date('2024-01-01T08:00:00Z'));
    await repo.putConfig({ activeProvider: null });
    await tracker(scriptedProvider().provider).checkNow(pid);
    expect(await ids(rankChecks)).toEqual([old]);
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
    const t = new RankTracker({ repo: other, providers: { dataforseo: scriptedProvider().provider, apify: idleApify, brightdata: idle('brightdata') }, io: { fetch: async () => Promise.reject(new Error('x')) }, now: () => now, log });
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

describe('what a results page says, counted the way Google counts', () => {
  it('a featured snippet is the site’s position 1, and the ordinary results after someone else’s start at 2', async () => {
    const pid = await makeProject('snippet');
    await addKeywords(pid, ['own snippet', 'their snippet']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [own, theirs] = await checks();
    // Google does not repeat the snippet's page below it: the provider lists it apart, organic numbering without it.
    state.results.set(own!.id, [{ position: 1, url: 'https://plumbers.na/geysers/', snippet: true }, { position: 1, url: 'https://competitor.test/' }]);
    state.results.set(theirs!.id, [{ position: 1, url: 'https://competitor.test/', snippet: true }, { position: 3, url: 'https://plumbers.na/' }]);
    await t.tick();
    const done = new Map((await checks()).map((r) => [r.id, r]));
    expect(done.get(own!.id)).toMatchObject({ position: 1, featured: true, url: 'https://plumbers.na/geysers/', resultsRead: 2 });
    expect(done.get(theirs!.id)).toMatchObject({ position: 4, featured: false });
  });

  it('keeps how many results pages came back, so a short list is told apart from "not in the top 100"', async () => {
    const pid = await makeProject('short');
    await addKeywords(pid, ['deep']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 1, url: 'https://competitor.test/' }, { position: 2, url: 'https://other.test/' }]);
    state.ends.add(row!.id); // Google served this page and no more
    await t.tick();
    expect((await checks())[0]).toMatchObject({ status: 'done', position: null, resultsRead: 2, pagesRead: 1, depth: 100 });
  });
});

describe('stages: a check reads further pages only while the site has not turned up', () => {
  const sentStages = (submitted: RankSearch[][]) => submitted.flat().map((s) => [s.startPage, s.pages]);

  it('a site on the first page costs one page: no further request', async () => {
    const pid = await makeProject('first-page');
    await addKeywords(pid, ['k']);
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 4, url: 'https://plumbers.na/' }]);
    await t.tick();
    await t.tick();
    expect(sentStages(submitted)).toEqual([[1, 1]]);
    expect((await checks())[0]).toMatchObject({ status: 'done', position: 4, pagesRead: 1, costMicros: 6000 });
    expect(await repo.spentMicrosInMonth(now)).toBe(6000);
  });

  it('reads on page by page, numbering on from what the pages before held, and books each page', async () => {
    const pid = await makeProject('page-two');
    await addKeywords(pid, ['k']);
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick(); // page 1 out
    const [row] = await checks();
    state.results.set(row!.id, Array.from({ length: 9 }, (_, i) => ({ position: i + 1, url: `https://other${i}.test/` })));
    await t.tick(); // page 1 back without the site: page 2 goes out in the same pass
    expect(sentStages(submitted)).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect((await checks())[0]).toMatchObject({ status: 'queued', resultsRead: 9, pagesRead: 1, costMicros: 12_000, costSettledMicros: 6000 });
    expect(await repo.spentMicrosInMonth(now)).toBe(12_000); // the second page is booked before it is sent

    state.results.set(row!.id, [
      { position: 1, url: 'https://competitor.test/' },
      { position: 2, url: 'https://www.plumbers.na/drains/' },
    ]);
    await t.tick();
    // Page 2's second result follows page 1's nine: position 11.
    expect((await checks())[0]).toMatchObject({ status: 'done', position: 11, resultsRead: 11, pagesRead: 2, costMicros: 12_000 });
    expect(sentStages(submitted)).toHaveLength(2);
  });

  it('stops where Google stops, and at the depth', async () => {
    const pid = await makeProject('stops');
    await addKeywords(pid, ['ends', 'empty']);
    const shallow = await makeProject('shallow-stops');
    await addKeywords(shallow, ['two pages'], 'daily', 10);
    await repo.putProject(shallow, { domain: 'plumbers.na', includeSubdomains: true, schedule: 'daily', depth: 20 });
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const rows = new Map((await checks()).map((r) => [r.keywordId, r.id]));
    const kw = new Map((await Promise.all([pid, shallow].map((p) => repo.listKeywords(p)))).flat().map((k) => [k.keyword, k.id]));
    const id = (k: string) => rows.get(kw.get(k)!)!;
    state.results.set(id('ends'), [{ position: 1, url: 'https://competitor.test/' }]);
    state.ends.add(id('ends')); // Google: nothing past this page
    state.results.set(id('empty'), []); // an empty page: nothing more either
    state.results.set(id('two pages'), [{ position: 1, url: 'https://competitor.test/' }]);
    await t.tick(); // 'two pages' goes on to page 2 — the last of its top 20
    await t.tick(); // …which misses too: done, both pages read
    const done = new Map((await checks()).map((r) => [r.id, r]));
    expect(done.get(id('ends'))).toMatchObject({ status: 'done', position: null, pagesRead: 1, listEnded: true });
    expect(done.get(id('empty'))).toMatchObject({ status: 'done', position: null, pagesRead: 1, listEnded: true });
    expect(done.get(id('two pages'))).toMatchObject({ status: 'done', position: null, pagesRead: 2, depth: 20 });
    expect(sentStages(submitted).sort()).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [2, 1],
    ]);
    // Readers see that Google's answers ended there, not that the check stopped short.
    const view = await projectRankings(repo, pid, { from: '2026-10-20', to: '2026-10-20' });
    const ends = view.keywords.find((k) => k.keyword === 'ends')!;
    expect(ends.series).toEqual([{ day: '2026-10-20', position: null, resultsRead: 1, listEnded: true }]);
    expect(ends.latest).toMatchObject({ position: null, depth: 100, resultsRead: 1, listEnded: true });
    // A check read before this was recorded makes neither claim: "not in those results".
    await db.update(rankChecks).set({ listEnded: null }).where(eq(rankChecks.id, id('ends')));
    const before = (await projectRankings(repo, pid, { from: '2026-10-20', to: '2026-10-20' })).keywords.find((k) => k.keyword === 'ends')!;
    expect(before.series).toEqual([{ day: '2026-10-20', position: null, resultsRead: 1 }]);
    expect(before.latest).not.toHaveProperty('listEnded');
  });

  it('a provider that answers at once reads every stage in one pass: 1, 2, 3–5', async () => {
    await repo.putCredentials('brightdata', { apiKey: 'k', zone: 'z' });
    await repo.putConfig({ activeProvider: 'brightdata' });
    const pid = await makeProject('live');
    await addKeywords(pid, ['deep', 'top']);
    const { provider, submitted } = liveProvider((s) => {
      if (s.keyword === 'top') return { urls: ['https://plumbers.na/'] };
      // 'deep': the site is on page 4, the second result there.
      if (s.startPage === 3) return { urls: [...others(3), 'https://other4-0.test/', 'https://plumbers.na/services/', ...others(4).slice(2), ...others(5)] };
      return { urls: others(s.startPage) };
    });
    expect(await tracker(provider).tick()).toMatchObject({ status: 'ok', sent: 2 });
    expect(submitted.map((b) => b.map((s) => [s.keyword, s.startPage, s.pages]))).toEqual([
      [
        ['deep', 1, 1],
        ['top', 1, 1],
      ],
      [['deep', 2, 1]],
      [['deep', 3, 3]],
    ]);
    const rows = await checks();
    const byKeyword = new Map((await repo.listKeywords(pid)).map((k) => [k.keyword, k.id]));
    const deep = rows.find((r) => r.keywordId === byKeyword.get('deep'))!;
    // 10 + 10 on pages 1–2, then the 12th result of pages 3–5: position 32. Five pages at $0.0015.
    expect(deep).toMatchObject({ status: 'done', position: 32, pagesRead: 5, costMicros: 7500 });
    expect(rows.find((r) => r.keywordId === byKeyword.get('top'))).toMatchObject({ status: 'done', position: 1, pagesRead: 1, costMicros: 1500 });
    expect(await repo.spentMicrosInMonth(now)).toBe(9000);
  });

  it('a stage the budget cannot pay for waits; at the end of its day the check is done with what it read', async () => {
    const pid = await makeProject('waits');
    await addKeywords(pid, ['k']);
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [
      { position: 1, url: 'https://a.test/' },
      { position: 2, url: 'https://b.test/' },
    ]);
    await repo.putConfig({ monthlyBudgetMicros: 6000 }); // page 1 is all it can pay for
    expect(await t.tick()).toMatchObject({ status: 'budget-reached', sent: 0 });
    expect((await checks())[0]).toMatchObject({ status: 'next', resultsRead: 2, pagesRead: 1 });
    expect(await repo.inFlight(pid)).toEqual(new Set([row!.keywordId]));

    now = new Date('2026-10-21T08:00:00Z'); // its day is over
    await t.tick();
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'done', position: null, resultsRead: 2, pagesRead: 1, listEnded: false });
    expect(sentStages(submitted)).toEqual([[1, 1]]);
    // Readers see how much was read, and that the check stopped short of Google's list: not "not in the top 100".
    const view = await projectRankings(repo, pid, { from: '2026-10-20', to: '2026-10-20' });
    expect(view.keywords[0]!.series).toEqual([{ day: '2026-10-20', position: null, resultsRead: 2, listEnded: false }]);
  });

  it('a later stage refused as a whole gives back that stage only: what the pages before cost stays booked', async () => {
    const pid = await makeProject('later-refused');
    await addKeywords(pid, ['k']);
    const { provider, state, submitted } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 1, url: 'https://a.test/' }]);
    state.submitErrors = [new RankProviderError('DataForSEO is limiting the request rate; trying again later', 'rate')];
    expect(await t.tick()).toMatchObject({ status: 'provider-error' });
    expect((await checks())[0]).toMatchObject({ status: 'next', pagesRead: 1, costMicros: 6000, costSettledMicros: 6000 });
    expect(await repo.spentMicrosInMonth(now)).toBe(6000);
    // The next pass sends page 2 after all.
    state.results.set(row!.id, 'pending');
    expect(await t.tick()).toMatchObject({ status: 'ok', sent: 1 });
    expect(sentStages(submitted)).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('a later stage whose reply was lost fails the check for the day, every page booked', async () => {
    const pid = await makeProject('later-lost');
    await addKeywords(pid, ['k']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 1, url: 'https://a.test/' }]);
    state.submitErrors = [new RankProviderError('DataForSEO could not be reached', 'unavailable')];
    await t.tick();
    expect((await checks())[0]).toMatchObject({ status: 'failed', costMicros: 12_000 });
    expect(await repo.spentMicrosInMonth(now)).toBe(12_000);
  });

  it('what the provider says a later stage cost adds to the pages before — even if the check went meanwhile', async () => {
    const pid = await makeProject('later-cost');
    await addKeywords(pid, ['k']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 1, url: 'https://a.test/' }]);
    state.charged = 0.002; // page 2 cost less than its $0.006 estimate
    state.duringSubmit = async () => {
      state.duringSubmit = null;
      await repo.removeKeyword(pid, row!.keywordId);
    };
    await t.tick();
    expect(await checks()).toHaveLength(0);
    expect(await repo.spentMicrosInMonth(now)).toBe(8000); // $0.006 for page 1 + $0.002 for page 2
  });

  it('a check sent before stages, for the whole depth, is finished by its one result', async () => {
    const pid = await makeProject('legacy');
    await addKeywords(pid, ['full', 'short', 'unsaid']);
    const legacy = async (k: RankKeywordRow) => {
      const id = (await repo.claim(due(k), '2026-10-20', 'dataforseo', 0.006, now))!;
      await repo.markQueued(id, `ref-${k.keyword}`, 0.006);
      // Sent before stages: no count of pages read at all.
      await db.update(rankChecks).set({ pagesRead: null }).where(eq(rankChecks.id, id));
      return id;
    };
    const [full, short, unsaid] = await repo.listKeywords(pid);
    const fullId = await legacy(full!);
    const shortId = await legacy(short!);
    const unsaidId = await legacy(unsaid!);
    const { provider, state, submitted } = scriptedProvider();
    state.results.set(fullId, [{ position: 1, url: 'https://a.test/' }]);
    state.pages.set(fullId, 10); // all ten pages it asked for
    state.results.set(shortId, [{ position: 1, url: 'https://a.test/' }]);
    state.pages.set(shortId, 7);
    state.ends.add(shortId); // Google stopped after seven of the ten
    state.results.set(unsaidId, [{ position: 1, url: 'https://a.test/' }]);
    state.pages.set(unsaidId, 6); // six of ten, and the provider does not say Google stopped (as Apify may not)
    await tracker(provider).tick();
    const rows = new Map((await checks()).map((r) => [r.id, r]));
    expect(rows.get(fullId)).toMatchObject({ status: 'done', pagesRead: 10 });
    expect(rows.get(shortId)).toMatchObject({ status: 'done', pagesRead: 7 });
    // Not sent on for pages 7–10: it asked for all ten, and was answered.
    expect(rows.get(unsaidId)).toMatchObject({ status: 'done', pagesRead: 6, costMicros: 6000 });
    expect(submitted).toHaveLength(0);
  });

  it('searches the provider never sent are given back, the refusal shown, and sent again later', async () => {
    await repo.putCredentials('brightdata', { apiKey: 'k', zone: 'z' });
    await repo.putConfig({ activeProvider: 'brightdata' });
    const pid = await makeProject('unsent');
    await addKeywords(pid, ['sent', 'refused']);
    let refuse = true;
    const { provider, submitted } = liveProvider((s) =>
      s.keyword === 'refused' && refuse ? { unsent: 'Bright Data has no funds left for this request' } : { urls: ['https://plumbers.na/'] },
    );
    const t = tracker(provider);
    expect(await t.tick()).toMatchObject({ status: 'provider-error', sent: 1 });
    const byKeyword = new Map((await repo.listKeywords(pid)).map((k) => [k.keyword, k.id]));
    const rows = await checks();
    expect(rows.map((r) => r.keywordId)).toEqual([byKeyword.get('sent')]); // the unsent claim is gone
    expect(await repo.spentMicrosInMonth(now)).toBe(1500); // …and so is its charge
    expect((await repo.getConfig()).lastError?.message).toMatch(/no funds/);

    refuse = false;
    expect(await t.tick()).toMatchObject({ status: 'ok', sent: 1 });
    expect(submitted.flat().map((s) => s.keyword).sort()).toEqual(['refused', 'refused', 'sent']); // the refused one twice
    expect((await repo.getConfig()).lastError).toBeNull();
  });

  it('a later stage refused after its keyword went keeps what the earlier stages cost', async () => {
    const pid = await makeProject('later-refused-gone');
    await addKeywords(pid, ['k']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick(); // page 1: $0.006
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 1, url: 'https://a.test/' }]);
    state.duringSubmit = async () => {
      state.duringSubmit = null;
      await repo.removeKeyword(pid, row!.keywordId);
    };
    state.submitErrors = [new RankProviderError('DataForSEO is limiting the request rate; trying again later', 'rate')];
    await t.tick(); // page 2 claimed ($0.012 booked), the keyword removed meanwhile, then refused
    expect(await checks()).toHaveLength(0);
    expect(await repo.spentMicrosInMonth(now)).toBe(6000); // page 1 was paid for; page 2 never went out
  });

  it('a stage collected just after midnight still goes on; one left waiting closes six hours after its last stage', async () => {
    const pid = await makeProject('midnight');
    await addKeywords(pid, ['k']);
    const { provider, state, submitted } = scriptedProvider();
    now = new Date('2026-10-20T23:50:00Z');
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 1, url: 'https://a.test/' }]);
    now = new Date('2026-10-21T00:05:00Z');
    await t.tick(); // collected the next day: page 2 goes out for the day it belongs to
    expect(sentStages(submitted)).toEqual([
      [1, 1],
      [2, 1], // checks under way go first…
      [1, 1], // …then the keyword's check for the new day
    ]);
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'queued', day: '2026-10-20' });

    // Page 2 misses too, and the budget allows no more: it waits, and closes six hours after it was sent.
    state.results.set(row!.id, [{ position: 1, url: 'https://b.test/' }]);
    await repo.putConfig({ monthlyBudgetMicros: await repo.spentMicrosInMonth(now) });
    await t.tick();
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'next', pagesRead: 2 });
    now = new Date('2026-10-21T06:06:00Z');
    await t.tick();
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'done', position: null, resultsRead: 2, pagesRead: 2 });
  });

  it('a stage the provider cut short reads on from where it stopped, not from the next stage', async () => {
    await repo.putCredentials('brightdata', { apiKey: 'k', zone: 'z' });
    await repo.putConfig({ activeProvider: 'brightdata' });
    const pid = await makeProject('cut');
    await addKeywords(pid, ['k']);
    const { provider, submitted } = liveProvider((s) => {
      if (s.startPage === 3) return { urls: others(3), pagesRead: 1, cut: true }; // page 3 read, 4–5 not
      if (s.startPage === 4) return { urls: [...others(4), 'https://plumbers.na/'] };
      return { urls: others(s.startPage) };
    });
    await tracker(provider).tick();
    expect(submitted.flat().map((s) => [s.startPage, s.pages])).toEqual([
      [1, 1],
      [2, 1],
      [3, 3],
      [4, 2],
    ]);
    // Pages 1–3 held 30; page 4 onwards puts the site 11th: position 41. Five pages paid.
    expect((await checks())[0]).toMatchObject({ status: 'done', position: 41, pagesRead: 5, costMicros: 7500 });
  });

  it('a pass whose stages only went on to the next still clears the last provider error', async () => {
    await repo.putCredentials('brightdata', { apiKey: 'k', zone: 'z' });
    await repo.putConfig({ activeProvider: 'brightdata', monthlyBudgetMicros: 1500 }); // page 1 and no more
    const pid = await makeProject('continued');
    await addKeywords(pid, ['k']);
    await repo.setLastError('Bright Data is limiting the request rate; trying again later');
    const { provider } = liveProvider((s) => ({ urls: others(s.startPage) }));
    expect(await tracker(provider).tick()).toMatchObject({ sent: 0 });
    expect((await checks())[0]).toMatchObject({ status: 'next' });
    expect((await repo.getConfig()).lastError).toBeNull();
  });

  it('a check waiting for its next stage when the provider changes waits for its day to end, then is done', async () => {
    const pid = await makeProject('switched');
    await addKeywords(pid, ['k']);
    const { provider, state } = scriptedProvider();
    const t = tracker(provider);
    await t.tick();
    const [row] = await checks();
    state.results.set(row!.id, [{ position: 1, url: 'https://a.test/' }]);
    await repo.putCredentials('brightdata', { apiKey: 'k', zone: 'z' });
    await repo.putConfig({ activeProvider: 'brightdata' });
    const live = liveProvider(() => ({ urls: [] }));
    const both = new RankTracker({ repo, providers: { dataforseo: provider, apify: idleApify, brightdata: live.provider }, io: { fetch: async () => Promise.reject(new Error('x')) }, now: () => now, log });
    await both.tick(); // collected from DataForSEO: waits for page 2, which Bright Data never sends for it
    expect((await checks())[0]).toMatchObject({ status: 'next', provider: 'dataforseo' });
    expect(live.submitted).toHaveLength(0);
    now = new Date('2026-10-21T08:00:00Z');
    await both.tick();
    expect((await checks()).find((r) => r.id === row!.id)).toMatchObject({ status: 'done', pagesRead: 1 });
  });
});

describe('at scale: passes that end in time, searches read once, same-day retries, confirmed drops', () => {
  it('a pass stops sending when its time is up; what is left is not claimed, and goes out on the next pass', async () => {
    const pid = await makeProject('time-box');
    await addKeywords(pid, ['a', 'b', 'c', 'd', 'e', 'f']);
    let t = 0;
    const { provider, submitted } = scriptedProvider();
    const slow: RankProvider = {
      ...provider,
      async submit(creds, searches, io) {
        t += 100_000; // each chunk takes 100 seconds
        return provider.submit(creds, searches, io);
      },
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const tr = tracker(slow, () => t);
      expect(await tr.tick()).toMatchObject({ sent: 4 }); // two chunks of two; the third would start past 3 minutes
      expect(await checks()).toHaveLength(4); // the rest was never claimed
      // The next pass follows half a minute later — not at the next scheduled one.
      await vi.advanceTimersByTimeAsync(29_000);
      expect(submitted.flat()).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(1_000);
      for (let i = 0; i < 500 && (await checks()).length < 6; i++) await new Promise((r) => setImmediate(r));
      expect(await checks()).toHaveLength(6);
      expect(submitted.flat().map((s) => s.keyword).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      tr.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a "check now" makes the scheduled pass stop at its next chunk, and goes next', async () => {
    const big = await makeProject('big');
    await addKeywords(big, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    const small = await makeProject('small');
    await addKeywords(small, ['b1']);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const { provider } = scriptedProvider();
    const held: RankProvider = {
      ...provider,
      async submit(creds, searches, io) {
        if (++calls === 1) await gate;
        return provider.submit(creds, searches, io);
      },
    };
    const tr = tracker(held);
    const scheduled = tr.tick();
    while (calls === 0) await new Promise((r) => setTimeout(r, 1));
    const now_ = tr.checkNow(small);
    release();
    expect(await scheduled).toMatchObject({ sent: 2 }); // its first chunk only
    expect(await now_).toMatchObject({ sent: 1 }); // then the check now
    const sentFor = new Map((await checks()).map((r) => [r.projectId, 0]));
    for (const r of await checks()) sentFor.set(r.projectId, (sentFor.get(r.projectId) ?? 0) + 1);
    expect(sentFor.get(small)).toBe(1);
    expect(sentFor.get(big)).toBe(2);
  });

  it('a scheduled pass sends one chunk before it gives way, however early "check now" is pressed', async () => {
    const big = await makeProject('big-early');
    await addKeywords(big, ['a1', 'a2', 'a3', 'a4']);
    const small = await makeProject('small-early');
    await addKeywords(small, ['b1']);
    const { provider } = scriptedProvider();
    let pressed: Promise<unknown> | undefined;
    const early: RankProvider = {
      ...provider,
      // Read as the pass starts sending: "check now" is pressed before its first chunk.
      parseCredentials: (raw) => {
        pressed ??= tr.checkNow(small);
        return provider.parseCredentials(raw);
      },
    };
    const tr = tracker(early); // read by `early` only once the pass runs
    expect(await tr.tick()).toMatchObject({ sent: 2 }); // one chunk (of two), then it gives way
    await pressed;
    expect((await checks()).filter((r) => r.projectId === small)).toHaveLength(1);
    expect((await checks()).filter((r) => r.projectId === big)).toHaveLength(2);
  });

  it('a continuation that finds a "check now" running carries on after it, not at the next scheduled pass', async () => {
    const big = await makeProject('big-cont');
    await addKeywords(big, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    const small = await makeProject('small-cont');
    await addKeywords(small, ['b1']);
    let t = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { provider } = scriptedProvider();
    const slow: RankProvider = {
      ...provider,
      async submit(creds, searches, io) {
        t += 100_000;
        if (searches.some((x) => x.keyword === 'b1')) await gate;
        return provider.submit(creds, searches, io);
      },
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const tr = tracker(slow, () => t);
      expect(await tr.tick()).toMatchObject({ sent: 4 }); // out of time: a continuation is set
      const held = tr.checkNow(small); // busy until the gate opens
      await vi.advanceTimersByTimeAsync(30_000); // the continuation finds it busy
      expect((await checks()).filter((r) => r.projectId === big)).toHaveLength(4);
      release();
      await held;
      await vi.advanceTimersByTimeAsync(30_000); // and carries on half a minute later
      for (let i = 0; i < 500 && (await checks()).length < 7; i++) await new Promise((r) => setImmediate(r));
      expect((await checks()).filter((r) => r.projectId === big)).toHaveLength(6);
      tr.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('identical searches of different projects go out in the same request', async () => {
    const one = await makeProject('one-site');
    await addKeywords(one, ['plumber windhoek', 'geyser repair', 'blocked drain']);
    const two = await makeProject('two-site');
    await addKeywords(two, ['zebra', 'plumber windhoek']);
    const { provider, submitted } = scriptedProvider(); // batches of two
    await tracker(provider).tick();
    const batchOf = (keyword: string) => submitted.findIndex((b) => b.some((s) => s.keyword === keyword));
    const together = submitted.find((b) => b.filter((s) => s.keyword === 'plumber windhoek').length === 2);
    expect(together).toBeDefined();
    expect(submitted.flat()).toHaveLength(5);
    expect(batchOf('zebra')).toBeGreaterThanOrEqual(0);
  });

  it('takes identical searches together however far apart they were added, so a pass limit does not split them', async () => {
    const first = await makeProject('first-added');
    await addKeywords(first, ['aardvark plumbing']);
    const filler = await makeProject('filler');
    await addKeywords(filler, ['bravo', 'charlie', 'delta']);
    const last = await makeProject('last-added');
    await addKeywords(last, [' Aardvark Plumbing ']);
    // Added first and last, with three between: by age alone a limit of two would take one of them and 'bravo'.
    const due = await repo.dueKeywords('2026-10-20', 2);
    expect(due.map((k) => [k.projectId, k.keyword.trim().toLowerCase()])).toEqual([
      [first, 'aardvark plumbing'],
      [last, 'aardvark plumbing'],
    ]);
  });

  it('a search the provider could not run is tried again an hour later the same day, at most twice', async () => {
    await useLive();
    const pid = await makeProject('flaky');
    await addKeywords(pid, ['flaky', 'never']);
    let flakyFails = 1;
    const { provider, submitted } = liveProvider((s) => {
      if (s.keyword === 'never') return { fail: 'Bright Data could not run the search (an empty answer)', retry: true };
      if (s.keyword === 'flaky' && flakyFails-- > 0) return { fail: 'Bright Data could not run the search (an empty answer)', retry: true };
      return { urls: ['https://plumbers.na/'] };
    });
    const tr = tracker(provider);
    await tr.tick();
    const byKeyword = async () => new Map((await checks()).map((r) => [r.keywordId, r]));
    const ids = new Map((await repo.listKeywords(pid)).map((k) => [k.keyword, k.id]));
    expect((await byKeyword()).get(ids.get('flaky')!)).toMatchObject({ status: 'retry', attempts: 1, retryAt: new Date(now.getTime() + 3_600_000), costMicros: 0 });
    expect(await repo.inFlight(pid)).toEqual(new Set([ids.get('flaky'), ids.get('never')]));

    now = new Date(now.getTime() + 30 * 60_000);
    await tr.tick(); // half an hour on: not yet
    expect(submitted.flat()).toHaveLength(2);

    now = new Date(now.getTime() + 31 * 60_000);
    await tr.tick();
    expect((await byKeyword()).get(ids.get('flaky')!)).toMatchObject({ status: 'done', position: 1, attempts: 1 });
    expect((await byKeyword()).get(ids.get('never')!)).toMatchObject({ status: 'retry', attempts: 2 });
    now = new Date(now.getTime() + 61 * 60_000);
    await tr.tick();
    // Two tries after the first: final for the day.
    expect((await byKeyword()).get(ids.get('never')!)).toMatchObject({ status: 'failed', attempts: 2, error: expect.stringMatching(/empty answer/) });
    expect(submitted.flat().filter((s) => s.keyword === 'never')).toHaveLength(3);
  });

  it('a retry its day runs out on stays failed; a refused retry goes back to waiting, never deleted', async () => {
    await useLive();
    const pid = await makeProject('retry-edges');
    await addKeywords(pid, ['k']);
    let answer: 'fail' | 'unsent' = 'fail';
    const { provider } = liveProvider(() => (answer === 'fail' ? { fail: 'Bright Data could not run the search', retry: true } : { unsent: 'Bright Data is limiting the request rate' }));
    const tr = tracker(provider);
    await tr.tick();
    expect((await checks())[0]).toMatchObject({ status: 'retry', attempts: 1 });
    answer = 'unsent';
    now = new Date(now.getTime() + 61 * 60_000);
    await tr.tick(); // claimed for its retry, then given back: still there, due again — never a "not found" it never read
    expect(await checks()).toHaveLength(1);
    expect((await checks())[0]).toMatchObject({ status: 'retry', attempts: 1, position: null, resultsRead: null });
    now = new Date('2026-10-21T08:00:00Z'); // its day is over
    await tr.tick();
    expect((await checks()).find((r) => r.day === '2026-10-20')).toMatchObject({ status: 'failed' });
  });

  it('a retry partway through a check that its day runs out on is done with the pages it read', async () => {
    await useLive();
    const pid = await makeProject('retry-partway');
    await addKeywords(pid, ['k']);
    const { provider } = liveProvider((s) => (s.startPage === 1 ? { urls: others(1) } : { fail: 'Bright Data could not run the search', retry: true }));
    const tr = tracker(provider);
    await tr.tick();
    expect((await checks())[0]).toMatchObject({ status: 'retry', attempts: 1, pagesRead: 1, resultsRead: 10 });
    now = new Date('2026-10-21T08:00:00Z');
    await tr.tick();
    expect((await checks()).find((r) => r.day === '2026-10-20')).toMatchObject({ status: 'done', position: null, pagesRead: 1, resultsRead: 10, error: null });
  });

  it('a keyword that ranked before and now reads "not found" is read again to confirm, and that reading counts', async () => {
    await useLive();
    const pid = await makeProject('confirm');
    await addKeywords(pid, ['dropped', 'recovers', 'never ranked']);
    const ks = new Map((await repo.listKeywords(pid)).map((k) => [k.keyword, k]));
    await checkedBefore(ks.get('dropped')!, '2026-10-19', 4);
    await checkedBefore(ks.get('recovers')!, '2026-10-19', 6);
    await checkedBefore(ks.get('never ranked')!, '2026-10-19', null);
    let firstReading = true;
    const { provider, submitted } = liveProvider((s) => {
      // The first reading misses everywhere; on the second, 'recovers' is back.
      if (!firstReading && s.keyword === 'recovers') return { urls: [...others(1, 5), 'https://plumbers.na/'] };
      return { urls: others(s.startPage), end: true };
    });
    const tr = tracker(provider);
    await tr.tick();
    const today = async () => new Map((await checks()).filter((r) => r.day === '2026-10-20').map((r) => [r.keywordId, r]));
    expect((await today()).get(ks.get('dropped')!.id)).toMatchObject({ status: 'retry', confirming: true, pagesRead: 0, resultsRead: 0, costMicros: 1500 });
    expect((await today()).get(ks.get('never ranked')!.id)).toMatchObject({ status: 'done', confirming: false, position: null });

    firstReading = false;
    now = new Date(now.getTime() + 6 * 60_000);
    await tr.tick();
    expect((await today()).get(ks.get('dropped')!.id)).toMatchObject({ status: 'done', confirming: true, position: null, pagesRead: 1, costMicros: 3000 });
    expect((await today()).get(ks.get('recovers')!.id)).toMatchObject({ status: 'done', confirming: true, position: 6 });
    // Read once more each — never a third time.
    await tr.tick();
    expect(submitted.flat().filter((s) => s.keyword === 'dropped')).toHaveLength(2);
    expect(submitted.flat().filter((s) => s.keyword === 'never ranked')).toHaveLength(1);
  });

  it('neither retries nor confirms past midnight UTC: the next day’s check is due by then', async () => {
    await useLive();
    const pid = await makeProject('late');
    await addKeywords(pid, ['flaky', 'dropped']);
    const ks = new Map((await repo.listKeywords(pid)).map((k) => [k.keyword, k]));
    await checkedBefore(ks.get('dropped')!, '2026-10-19', 4);
    now = new Date('2026-10-20T23:57:00Z');
    const { provider } = liveProvider((s) => (s.keyword === 'flaky' ? { fail: 'Bright Data could not run the search', retry: true } : { urls: others(1), end: true }));
    await tracker(provider).tick();
    const today = new Map((await checks()).filter((r) => r.day === '2026-10-20').map((r) => [r.keywordId, r]));
    expect(today.get(ks.get('flaky')!.id)).toMatchObject({ status: 'failed', attempts: 0 });
    expect(today.get(ks.get('dropped')!.id)).toMatchObject({ status: 'done', position: null, confirming: false });
  });

  it('does not confirm a drop for a domain the project no longer tracks', async () => {
    await useLive();
    const pid = await makeProject('moved');
    await addKeywords(pid, ['k']);
    const [k] = await repo.listKeywords(pid);
    await checkedBefore(k!, '2026-10-19', 2); // for plumbers.na
    await repo.putProject(pid, { domain: 'new-plumbers.na', includeSubdomains: true, schedule: 'daily', depth: 100 });
    const { provider, submitted } = liveProvider((s) => ({ urls: ['https://plumbers.na/'], end: s.startPage === 1 }));
    await tracker(provider).tick();
    expect((await checks()).find((r) => r.day === '2026-10-20')).toMatchObject({ status: 'done', position: null, confirming: false });
    expect(submitted.flat()).toHaveLength(1);
  });

  it('confirms a drop with a provider that queues its searches too (read again once collected)', async () => {
    const pid = await makeProject('queued-confirm');
    await addKeywords(pid, ['k']);
    const [k] = await repo.listKeywords(pid);
    await checkedBefore(k!, '2026-10-19', 3);
    const { provider, submitted, state } = scriptedProvider();
    const tr = tracker(provider);
    await tr.tick(); // sent, queued
    const id = (await checks()).find((r) => r.day === '2026-10-20')!.id;
    state.results.set(id, [{ position: 1, url: 'https://other.test/' }]);
    state.ends.add(id);
    await tr.tick(); // collected: not found → read again in five minutes
    expect((await checks()).find((r) => r.id === id)).toMatchObject({ status: 'retry', confirming: true, pagesRead: 0 });
    state.results.set(id, 'pending');
    now = new Date(now.getTime() + 6 * 60_000);
    await tr.tick(); // sent again
    expect(submitted.flat().filter((x) => x.checkId === id)).toHaveLength(2);
    state.results.set(id, [{ position: 1, url: 'https://other.test/' }, { position: 2, url: 'https://plumbers.na/' }]);
    await tr.tick(); // the second reading is the one recorded
    expect((await checks()).find((r) => r.id === id)).toMatchObject({ status: 'done', confirming: true, position: 2 });
  });

  it('a confirmation the budget never allows ends its day as "not found"', async () => {
    await useLive();
    const pid = await makeProject('confirm-budget');
    await addKeywords(pid, ['k']);
    const [k] = await repo.listKeywords(pid);
    await checkedBefore(k!, '2026-10-19', 3);
    const { provider } = liveProvider((s) => ({ urls: others(s.startPage), end: true }));
    const tr = tracker(provider);
    await tr.tick();
    await repo.putConfig({ monthlyBudgetMicros: await repo.spentMicrosInMonth(now) }); // no room for the second reading
    now = new Date('2026-10-21T08:00:00Z');
    await tr.tick();
    expect((await checks()).find((r) => r.day === '2026-10-20')).toMatchObject({ status: 'done', position: null, resultsRead: null, confirming: true });
  });

  it('the admin sees each day’s checks per provider: found, not found, failed, running, retried, confirmed, pages, cost', async () => {
    await useLive();
    const pid = await makeProject('stats');
    await addKeywords(pid, ['found', 'missing', 'broken']);
    const { provider } = liveProvider((s) =>
      s.keyword === 'broken' ? { fail: 'Bright Data refused the request (HTTP 400): check the zone name' } : s.keyword === 'found' ? { urls: ['https://plumbers.na/'] } : { urls: others(1), end: true },
    );
    await tracker(provider).tick();
    expect(await repo.dailyStats('2026-10-14')).toEqual([
      { day: '2026-10-20', provider: 'brightdata', checks: 3, found: 1, notFound: 1, failed: 1, running: 0, retried: 0, confirmed: 0, pages: 2, costUsd: 0.003 },
    ]);
  });
});

describe('re-reading stored results of earlier checks (free at the provider)', () => {
  /** A check finished by the previous version: done, but without what a page reading now keeps. */
  async function legacyCheck(provider: RankProvider, state: ReturnType<typeof scriptedProvider>['state'], keyword: string): Promise<string> {
    const pid = await makeProject(keyword.replace(/\W+/g, '-'));
    await addKeywords(pid, [keyword]);
    const t = tracker(provider);
    await t.tick();
    const row = (await checks()).find((r) => r.status === 'queued')!;
    state.results.set(row.id, [{ position: 1, url: 'https://competitor.test/' }]);
    state.ends.add(row.id);
    await t.tick();
    state.ends.delete(row.id);
    await db.update(rankChecks).set({ resultsRead: null, pagesRead: null, featured: false }).where(eq(rankChecks.id, row.id));
    return row.id;
  }

  it('reads an earlier check again under today’s rules, once, on the scheduled pass', async () => {
    const { provider, state } = scriptedProvider();
    const free = { ...provider, freeRereadDays: 29 };
    const id = await legacyCheck(free, state, 'held the snippet');
    expect((await checks())[0]).toMatchObject({ position: null, resultsRead: null });

    // What the provider still holds: the site was the featured snippet that day.
    state.results.set(id, [{ position: 1, url: 'https://plumbers.na/', snippet: true }, { position: 1, url: 'https://competitor.test/' }]);
    state.pages.set(id, 10);
    state.collected.length = 0;
    await tracker(free).tick();
    expect((await checks())[0]).toMatchObject({ position: 1, featured: true, resultsRead: 2, pagesRead: 10, status: 'done' });
    expect((await checks())[0]!.rereadAt).toEqual(now);
    expect(state.collected).toEqual([[id]]);

    // Never again.
    await tracker(free).tick();
    expect(state.collected).toEqual([[id]]);
  });

  it('a result the provider no longer has leaves the check as it was, and is not asked for again', async () => {
    const { provider, state } = scriptedProvider();
    const free = { ...provider, freeRereadDays: 29 };
    const id = await legacyCheck(free, state, 'gone');
    state.results.set(id, { fail: 'Task Not Found.' });
    state.collected.length = 0;
    await tracker(free).tick();
    await tracker(free).tick();
    expect(state.collected).toEqual([[id]]);
    expect((await checks())[0]).toMatchObject({ status: 'done', position: null, resultsRead: null });
    expect((await checks())[0]!.rereadAt).toEqual(now);
  });

  it('only within the provider’s free window, only for a provider that has one, and never on a "check now"', async () => {
    const { provider, state } = scriptedProvider();
    const free = { ...provider, freeRereadDays: 29 };
    const id = await legacyCheck(free, state, 'window');
    const pid = (await checks())[0]!.projectId;
    state.collected.length = 0;

    await tracker(provider).tick(); // no free re-read: nothing asked
    await tracker(free).checkNow(pid); // a "check now" never re-reads
    expect(state.collected).toEqual([]);

    // Past the window: not asked. Presence guard below — the same check IS asked inside the window.
    const inside = now;
    now = new Date(inside.getTime() + 30 * 86_400_000);
    await tracker(free).tick();
    expect(state.collected.flat()).not.toContain(id);
    now = inside;
    await tracker(free).tick();
    expect(state.collected.flat()).toContain(id);
  });

  it('a stored result that is not ready yet is tried once too, so the same few never fill every batch', async () => {
    const { provider, state } = scriptedProvider();
    const free = { ...provider, freeRereadDays: 29 };
    const id = await legacyCheck(free, state, 'pending');
    state.results.set(id, 'pending');
    state.collected.length = 0;
    const t = tracker(free);
    await t.tick();
    await t.tick();
    expect(state.collected).toEqual([[id]]);
    expect((await checks())[0]).toMatchObject({ status: 'done', resultsRead: null });
    expect((await checks())[0]!.rereadAt).toEqual(now);
  });
});

describe('what readers see', () => {
  it('marks a featured snippet, and tells a miss in a short list apart from one in a full list', async () => {
    const pid = await makeProject('readers');
    await addKeywords(pid, ['k']);
    const [k] = await repo.listKeywords(pid);
    const at = (day: string) => new Date(`${day}T06:00:00Z`);
    const done = async (day: string, reading: Parameters<RankRepository['markDone']>[1]) => {
      const id = await repo.claim(due(k!), day, 'dataforseo', 0.006, at(day));
      await repo.markDone(id!, reading, at(day));
    };
    await done('2026-10-16', { hit: { position: 1, absolutePosition: 1, url: 'https://plumbers.na/', featured: true }, resultsRead: 98, pagesRead: 10, listEnded: false });
    await done('2026-10-17', { hit: null, resultsRead: 29, pagesRead: 3, listEnded: true }); // Google stopped after three pages
    await done('2026-10-18', { hit: null, resultsRead: 97, pagesRead: 10, listEnded: false }); // a real miss
    await done('2026-10-19', { hit: { position: 12, absolutePosition: 14, url: 'https://plumbers.na/', featured: false }, resultsRead: 30, pagesRead: 3, listEnded: false });
    await done('2026-10-20', { hit: null, resultsRead: 30, pagesRead: null, listEnded: false }); // the provider did not say: no claim either way

    const view = await projectRankings(repo, pid, { from: '2026-10-01', to: '2026-10-20' });
    const [kw] = view.keywords;
    expect(kw!.series).toEqual([
      { day: '2026-10-16', position: 1, featured: true },
      { day: '2026-10-17', position: null, resultsRead: 29, listEnded: true },
      { day: '2026-10-18', position: null },
      { day: '2026-10-19', position: 12 },
      { day: '2026-10-20', position: null },
    ]);
    expect(kw!.best).toBe(1);
    expect(kw!.latest).toMatchObject({ day: '2026-10-20', position: null, depth: 100 });
    expect(kw!.latest).not.toHaveProperty('resultsRead');
  });
});

describe('the page behind Google’s redirect', () => {
  const goto = (keyword: string): string => `https://www.google.com/goto?url=CAES-${encodeURIComponent(keyword)}`;
  const pageFor = (keyword: string): string => `https://plumbers.na/${keyword.replace(/\s+/g, '-')}/`;

  /** Bright Data answering every search with the site third, its page hidden behind Google's redirect (`via`). */
  function wrappedLive(): RankProvider {
    const live = liveProvider(() => ({ urls: [...others(1, 2), 'https://plumbers.na/'], end: true }));
    return {
      ...live.provider,
      async submit(creds, searches, io) {
        const outs = await live.provider.submit(creds, searches, io);
        return outs.map((o) => {
          if (o.state !== 'done') return o;
          const keyword = searches.find((s) => s.checkId === o.checkId)!.keyword;
          const entries = o.page.entries.map((e) => (e.url === 'https://plumbers.na/' ? { ...e, via: goto(keyword) } : e));
          return { ...o, page: { ...o.page, entries } };
        });
      },
    };
  }

  type Fetch = RankTrackerDepsIo['fetch'];
  type RankTrackerDepsIo = ConstructorParameters<typeof RankTracker>[0]['io'];

  function withFetch(fetch: Fetch, clock?: () => number): RankTracker {
    const providers = { dataforseo: idle('dataforseo'), apify: idleApify, brightdata: wrappedLive() };
    return new RankTracker({ repo, providers, io: { fetch }, now: () => now, log, ...(clock ? { clock } : {}) });
  }

  /** Google answering every `/goto` with a redirect to the keyword's page. */
  const google = (): { fetch: Fetch; asked: string[] } => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      const keyword = decodeURIComponent(new URL(url).searchParams.get('url')!.slice('CAES-'.length));
      return { ok: false, status: 302, location: pageFor(keyword), text: async () => '' };
    };
    return { fetch, asked };
  };

  it('records the page Google’s redirect leads to, asking once per check and for the site’s result alone', async () => {
    const pid = await makeProject('wrapped');
    await addKeywords(pid, ['plumber windhoek', 'geyser repair']);
    await useLive();
    const g = google();
    expect(await withFetch(g.fetch).tick()).toMatchObject({ status: 'ok', sent: 2 });

    const rows = await checks();
    expect(rows.map((r) => [r.status, r.position, r.url]).sort()).toEqual([
      ['done', 3, pageFor('geyser repair')],
      ['done', 3, pageFor('plumber windhoek')],
    ]);
    expect(g.asked.sort()).toEqual([goto('geyser repair'), goto('plumber windhoek')]);
  });

  it('keeps the site when Google does not say; after three such answers in a row it asks none for a while', async () => {
    const pid = await makeProject('unresolved');
    await addKeywords(pid, ['a1', 'a2', 'a3', 'a4', 'a5']);
    await useLive();
    let clock = 0;
    let refuse = true;
    const g = google();
    const fetch: Fetch = async (url, init) => {
      if (!refuse) return g.fetch(url, init);
      g.asked.push(url);
      return { ok: false, status: 429, text: async () => '' };
    };
    const t = withFetch(fetch, () => clock);
    expect(await t.tick()).toMatchObject({ sent: 5 });
    const rows = await checks();
    expect(rows.every((r) => r.status === 'done' && r.position === 3 && r.url === 'https://plumbers.na/')).toBe(true);
    // Two at a time (a batch of two): the third refusal pauses asking, the lookup beside it still finishes, and the
    // fifth check is not asked about.
    expect(g.asked).toHaveLength(4);

    // Past the pause, the next day's checks ask again.
    now = new Date('2026-10-21T08:00:00Z');
    clock += 15 * 60_000;
    refuse = false;
    expect(await t.tick()).toMatchObject({ sent: 5 });
    const today = (await checks()).filter((r) => r.day === '2026-10-21');
    expect(today.map((r) => r.url).sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5'].map(pageFor));
    expect(g.asked).toHaveLength(9);
  });

  it('asks a few at a time, and records the rest with the site once a batch’s lookups run out of time', async () => {
    const pid = await makeProject('slow');
    const keywords = Array.from({ length: 30 }, (_, i) => `slow ${i}`);
    await addKeywords(pid, keywords);
    await useLive();
    let clock = 0;
    let open = 0;
    let most = 0;
    const g = google();
    // Each lookup takes six seconds of the tracker's clock; those started together end together.
    const fetch: Fetch = async (url, init) => {
      const started = clock;
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 5));
      clock = Math.max(clock, started + 6_000);
      open--;
      return g.fetch(url, init);
    };
    const live = wrappedLive();
    const providers = { dataforseo: idle('dataforseo'), apify: idleApify, brightdata: { ...live, maxBatch: 30 } };
    await new RankTracker({ repo, providers, io: { fetch }, now: () => now, log, clock: () => clock }).tick();

    const rows = await checks();
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.status === 'done' && r.position === 3)).toBe(true);
    expect(most).toBe(10);
    // Ten at once, six seconds each: a second ten start within the batch's ten seconds, a third does not.
    expect(g.asked).toHaveLength(20);
    const resolved = rows.map((r) => r.url).filter((u) => u !== 'https://plumbers.na/');
    expect(new Set(resolved).size).toBe(20);
    expect(resolved.every((u) => keywords.map(pageFor).includes(u!))).toBe(true);
    expect(g.asked.map((u) => pageFor(decodeURIComponent(new URL(u).searchParams.get('url')!.slice('CAES-'.length)))).sort()).toEqual([...resolved].sort());
  });

  it('asks nothing when the site’s result names its page, or the site is not found', async () => {
    const pid = await makeProject('plain');
    await addKeywords(pid, ['plain link']);
    await useLive();
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return { ok: false, status: 302, location: 'https://plumbers.na/x/', text: async () => '' };
    };
    const live = liveProvider(() => ({ urls: [...others(1, 2), 'https://plumbers.na/drains/', goto('elsewhere')], end: true }));
    const providers = { dataforseo: idle('dataforseo'), apify: idleApify, brightdata: live.provider };
    await new RankTracker({ repo, providers, io: { fetch }, now: () => now, log }).tick();
    expect((await checks()).map((r) => r.url)).toEqual(['https://plumbers.na/drains/']);
    expect(asked).toEqual([]);
  });
});

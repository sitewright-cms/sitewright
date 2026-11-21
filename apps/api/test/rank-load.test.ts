import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { rankCharges, rankChecks } from '../src/db/schema.js';
import { RankRepository } from '../src/rank/repo.js';
import { RankTracker } from '../src/rank/tracker.js';
import { brightData } from '../src/rank/providers/brightdata.js';
import { RANK_PROVIDERS, type FetchLike } from '../src/rank/providers/index.js';
import { ProjectRepository } from '../src/repo/projects.js';

/**
 * THE TRACKER AT VOLUME: thousands of keywords through the real tracker and the real Bright Data adapter, against a
 * simulated SERP API — Google's pages for each keyword with each project's site at a planted position, pages that come
 * back empty now and then (as measured: a captcha on Bright Data's connection), keywords shared by several projects,
 * and keywords that ranked yesterday and drop today.
 *
 * In CI it runs a few hundred keywords with no delay, on a clock that moves three seconds per page read (ten at once),
 * and checks the outcome is RIGHT at volume: every keyword checked once, every position the one planted, every planted
 * drop confirmed, shared searches bought once, passes that stop sending in time and carry on, the money adding up.
 * For a measured run:
 *
 *   SW_RANK_LOAD_KEYWORDS=5000 SW_RANK_LOAD_LATENCY_MS=300 SW_RANK_LOAD_TIME_SCALE=10 \
 *     pnpm --filter @sitewright/api exec vitest run test/rank-load.test.ts
 *
 * which prints passes, the longest pass, how long the day's checks took, requests, retries, confirmations, cost,
 * memory and rows. The tracker's clock runs SCALE times faster than the real one, so 300 ms a request plays the three
 * seconds a Bright Data page takes, and the pass's three minutes of sending pass in eighteen.
 */

const KEYWORDS = Number(process.env.SW_RANK_LOAD_KEYWORDS ?? 300);
const LATENCY_MS = Number(process.env.SW_RANK_LOAD_LATENCY_MS ?? 0);
const SCALE = Number(process.env.SW_RANK_LOAD_TIME_SCALE ?? 1);
/** Unless a real-time scale is set, the tracker's clock moves by the pages read: three seconds each, ten at once. */
const REAL_TIME = process.env.SW_RANK_LOAD_TIME_SCALE !== undefined;
const PAGE_MS = 3_000;
const AT_ONCE = 10;
const SEND_BUDGET_MS = 3 * 60_000;
/** The tracker's pacing: the next scheduled pass, or (when a pass ran out of time) the one that carries on. */
const TICK_MS = 10 * 60_000;
const CONTINUE_MS = 30_000;
const MEASURED = process.env.SW_RANK_LOAD_KEYWORDS !== undefined;
const KEYWORDS_PER_PROJECT = 50;

/** A small seeded generator: the same run every time. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

interface Planted {
  domain: string;
  /** Where the site is in Google's list for the keyword; null when it is not in it. */
  position: number | null;
}

describe('rank tracking at volume', () => {
  it(
    `checks ${KEYWORDS} keywords once each, every position right, shared searches bought once, the money adding up`,
    async () => {
      const db = await makeTestDb();
      const repo = new RankRepository(db, randomBytes(32));
      await repo.putCredentials('brightdata', { apiKey: 'k', zone: 'z', concurrency: String(AT_ONCE) });
      await repo.putConfig({ activeProvider: 'brightdata', monthlyBudgetMicros: 1_000_000_000 });
      const random = rng(20261117);
      let now = new Date('2026-10-20T08:00:00Z');

      // ── The world: projects, keywords (some shared), and where Google has each site ──
      const serp = new Map<string, { served: number; sites: Planted[] }>();
      const planted = new Map<string, number | null>(); // `${projectId} ${keyword}` → position
      const projects: Array<{ id: string; domain: string }> = [];
      const projectRepo = new ProjectRepository(db);
      for (let p = 0; p * KEYWORDS_PER_PROJECT < KEYWORDS; p++) {
        const id = (await projectRepo.create({ name: `Load ${p}`, slug: `load-${p}` })).id;
        projects.push({ id, domain: `site${p}.test` });
        await repo.putProject(id, { domain: `site${p}.test`, includeSubdomains: true, schedule: 'daily', depth: 100 });
      }
      const positionOf = (): number | null => {
        const r = random();
        if (r < 0.4) return 1 + Math.floor(random() * 10); // page 1
        if (r < 0.6) return 11 + Math.floor(random() * 10); // page 2
        if (r < 0.75) return 21 + Math.floor(random() * 30); // pages 3–5
        if (r < 0.85) return 51 + Math.floor(random() * 50); // pages 6–10
        return null; // not there
      };
      let shared = 0;
      for (let i = 0; i < KEYWORDS; i++) {
        const project = projects[Math.floor(i / KEYWORDS_PER_PROJECT)]!;
        // One keyword in ten is one another project tracks too.
        const reuse = i >= KEYWORDS_PER_PROJECT && random() < 0.1;
        const keyword = reuse ? `keyword ${Math.floor(random() * KEYWORDS_PER_PROJECT)}` : `keyword ${i}`;
        const added = await repo.addKeywords(project.id, { keywords: [keyword], engine: 'google', device: 'desktop', location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'en' });
        if (added.added === 0) continue;
        if (reuse) shared++;
        const entry = serp.get(keyword) ?? { served: 5 + Math.floor(random() * 6), sites: [] };
        const taken = new Set(entry.sites.map((s) => s.position));
        let position = positionOf();
        while (position !== null && taken.has(position)) position++;
        if (position !== null && position > entry.served * 10) position = null; // beyond what Google serves
        entry.sites.push({ domain: project.domain, position });
        serp.set(keyword, entry);
        planted.set(`${project.id} ${keyword}`, position);
      }
      // One keyword in twenty ranked yesterday but is gone today: each such drop is read twice to confirm it.
      let drops = 0;
      const dropped = new Set<string>(); // keyword ids
      for (const project of projects) {
        for (const k of await repo.listKeywords(project.id)) {
          if (planted.get(`${project.id} ${k.keyword}`) !== null || random() >= 0.2) continue;
          const id = (await repo.claim({ ...k, depth: 100, domain: project.domain, includeSubdomains: true }, '2026-10-19', 'brightdata', 0, new Date('2026-10-19T08:00:00Z')))!;
          await repo.markDone(id, { hit: { position: 7, absolutePosition: 7, url: `https://${project.domain}/`, featured: false }, resultsRead: 50, pagesRead: 5, listEnded: false }, new Date('2026-10-19T08:00:00Z'));
          drops++;
          dropped.add(k.id);
        }
      }

      // ── The simulated SERP API ──
      const requests = new Map<string, number>(); // `${q} ${start}` → times asked
      const answeredFirst = new Map<string, number>(); // keyword → first pages answered (not empty)
      let empties = 0;
      let simulatedMs = 0;
      const clock = REAL_TIME ? () => Date.now() * SCALE : () => simulatedMs;
      const fetch: FetchLike = async (_url, init) => {
        if (LATENCY_MS > 0) await new Promise((r) => setTimeout(r, LATENCY_MS * (0.5 + random())));
        simulatedMs += PAGE_MS / AT_ONCE;
        const google = new URL((JSON.parse(init.body ?? '{}') as { url: string }).url);
        const q = (google.searchParams.get('q') ?? '').replace(/\+/g, ' ');
        const start = Number(google.searchParams.get('start') ?? 0);
        requests.set(`${q} ${start}`, (requests.get(`${q} ${start}`) ?? 0) + 1);
        if (random() < 0.05) {
          empties++;
          return { ok: true, status: 200, text: async () => '' }; // a captcha on Bright Data's side
        }
        const entry = serp.get(q)!;
        const page = start / 10 + 1;
        if (start === 0) answeredFirst.set(q, (answeredFirst.get(q) ?? 0) + 1);
        const organic = page > entry.served ? [] : Array.from({ length: 10 }, (_, i) => {
          const position = start + i + 1;
          const site = entry.sites.find((s) => s.position === position);
          return { link: site ? `https://www.${site.domain}/page` : `https://r${position}-${q.replace(/\W/g, '')}.test/`, rank: i + 1, global_rank: i + 1 };
        });
        const body = { general: { timestamp: now.toISOString() }, organic, pagination: page < entry.served ? { current_page: page, next_page: page + 1 } : { current_page: page } };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      };
      let stoppedShort = false;
      const tracker = new RankTracker({
        repo,
        providers: { ...RANK_PROVIDERS, brightdata: brightData },
        io: { fetch, largeFetch: fetch, sleep: async () => {} },
        now: () => now,
        clock,
        log: {
          info: (_obj, msg) => {
            if (msg.includes('stopped sending')) stoppedShort = true;
          },
          warn: () => {},
        },
      });

      // ── Run the day: passes at the tracker's pace until nothing is left to do ──
      const heapBefore = process.memoryUsage().heapUsed;
      const passMs: number[] = []; // on the tracker's clock
      let dayMs = 0;
      const started = Date.now();
      const open = async (): Promise<number> =>
        Number(((await db.all(sql`SELECT COUNT(*) AS n FROM rank_checks WHERE day = '2026-10-20' AND status NOT IN ('done', 'failed')`)) as Array<{ n: number }>)[0]!.n);
      const total = (await Promise.all(projects.map((p) => repo.listKeywords(p.id)))).flat().length;
      let passes = 0;
      let shortPasses = 0;
      for (; passes < 500; passes++) {
        const t0 = clock();
        await tracker.tick();
        tracker.close(); // its own continuation timer: this loop plays it
        const ms = clock() - t0;
        passMs.push(ms);
        dayMs += ms;
        const checked = Number(((await db.all(sql`SELECT COUNT(*) AS n FROM rank_checks WHERE day = '2026-10-20'`)) as Array<{ n: number }>)[0]!.n);
        if (checked === total && (await open()) === 0) break;
        const gap = stoppedShort ? CONTINUE_MS : TICK_MS;
        if (stoppedShort) shortPasses++;
        stoppedShort = false;
        dayMs += gap;
        now = new Date(now.getTime() + ms + gap);
      }
      const wallMs = Date.now() - started;
      const heapAfter = process.memoryUsage().heapUsed;

      // ── What it did ──
      const rows = await db.select().from(rankChecks);
      const today = rows.filter((r) => r.day === '2026-10-20');
      const tracked = (await Promise.all(projects.map((p) => repo.listKeywords(p.id)))).flat();
      // Every keyword checked exactly once today, and finished.
      expect(today).toHaveLength(tracked.length);
      expect(new Set(today.map((r) => r.keywordId)).size).toBe(tracked.length);
      expect(today.filter((r) => r.status !== 'done' && r.status !== 'failed')).toHaveLength(0);
      // Every position found is the one planted — and nothing is found that was not planted.
      const domainOf = new Map(projects.map((p) => [p.id, p.domain]));
      const keywordOf = new Map(tracked.map((k) => [k.id, k.keyword]));
      let wrong = 0;
      let found = 0;
      for (const r of today.filter((x) => x.status === 'done')) {
        const want = planted.get(`${r.projectId} ${keywordOf.get(r.keywordId)}`);
        if (r.position !== null) found++;
        if (r.position !== null && r.position !== want) wrong++;
        if (r.position !== null) expect(r.url).toBe(`https://www.${domainOf.get(r.projectId)}/page`);
      }
      expect(wrong).toBe(0);
      // A planted position is missed only when the provider never answered for it (failed).
      const missed = today.filter((r) => r.status === 'done' && r.position === null && planted.get(`${r.projectId} ${keywordOf.get(r.keywordId)}`) !== null);
      expect(missed).toHaveLength(0);
      // The money: what the month's charges say equals what the checks say (no claim left behind, none counted twice).
      const charged = Number(((await db.all(sql`SELECT COALESCE(SUM(cost_micros), 0) AS n FROM ${rankCharges} WHERE check_id IN (SELECT id FROM ${rankChecks} WHERE day = '2026-10-20')`)) as Array<{ n: number }>)[0]!.n);
      expect(charged).toBe(today.reduce((sum, r) => sum + r.costMicros, 0));
      // Every planted drop was read a second time (unless the provider never could read it).
      expect(drops).toBeGreaterThan(0);
      const todayOf = new Map(today.map((r) => [r.keywordId, r]));
      expect([...dropped].filter((id) => !todayOf.get(id)!.confirming && todayOf.get(id)!.status !== 'failed')).toEqual([]);
      expect(today.filter((r) => r.confirming && !dropped.has(r.keywordId))).toEqual([]);
      // Shared searches were bought once: a keyword's first page was answered once for all the checks that share it,
      // plus once per confirmation or retry of one of them. Keywords are taken longest-unchecked first, so copies
      // last checked on different days (here: a planted drop, checked yesterday, beside copies never checked) are
      // read in different passes — once per such class.
      expect(shared).toBeGreaterThan(0);
      const rereads = new Map<string, number>();
      const classes = new Map<string, Set<boolean>>();
      for (const r of today) {
        const q = keywordOf.get(r.keywordId)!;
        const extra = (r.confirming ? 1 : 0) + r.attempts;
        if (extra > 0) rereads.set(q, (rereads.get(q) ?? 0) + extra);
        classes.set(q, (classes.get(q) ?? new Set()).add(dropped.has(r.keywordId)));
      }
      const overRead = [...answeredFirst.entries()].filter(([q, n]) => n > (classes.get(q)?.size ?? 1) + (rereads.get(q) ?? 0));
      expect(overRead).toEqual([]);
      const checksOf = new Map<string, number>();
      for (const r of today) checksOf.set(keywordOf.get(r.keywordId)!, (checksOf.get(keywordOf.get(r.keywordId)!) ?? 0) + 1);
      // Bought once per class, and not more: what merging saved is at least one read per shared copy, less the classes.
      const saved = [...checksOf.entries()].reduce((n, [q, c]) => n + c + (rereads.get(q) ?? 0) - (answeredFirst.get(q) ?? 0), 0);
      const extraClasses = [...classes.values()].reduce((n, c) => n + c.size - 1, 0);
      expect(saved).toBeGreaterThanOrEqual(shared - extraClasses);
      expect(saved).toBeGreaterThan(0);
      // Passes stopped sending in time — no later than one chunk past it — and the next carried on.
      const slowest = Math.max(...passMs);
      expect(slowest).toBeLessThan(SEND_BUDGET_MS + 60_000);
      if (!REAL_TIME) expect(shortPasses).toBeGreaterThan(0);

      if (MEASURED) {
        const pages = today.reduce((n, r) => n + (r.pagesRead ?? 0), 0);
        const sent = [...requests.values()].reduce((a, b) => a + b, 0);
        const report = {
          keywords: tracked.length,
          projects: projects.length,
          sharedKeywords: shared,
          passes: passes + 1,
          passesOutOfTime: shortPasses,
          wallSeconds: Math.round(wallMs / 1000),
          slowestPassSeconds: Math.round(slowest / 1000),
          dayHours: +(dayMs / 3_600_000).toFixed(2),
          requests: sent,
          emptyAnswers: empties,
          pagesRead: pages,
          pagesPerCheck: +(pages / today.length).toFixed(2),
          found,
          notFound: today.filter((r) => r.status === 'done' && r.position === null).length,
          failed: today.filter((r) => r.status === 'failed').length,
          retried: today.filter((r) => r.attempts > 0).length,
          dropsConfirmed: today.filter((r) => r.confirming).length,
          dropsPlanted: drops,
          costUsd: +(today.reduce((n, r) => n + r.costMicros, 0) / 1e6).toFixed(4),
          heapGrowthMb: Math.round((heapAfter - heapBefore) / 1e6),
          checkRows: rows.length,
        };
        process.stdout.write(`\nrank-load: ${JSON.stringify(report, null, 2)}\n`);
      }
    },
    MEASURED ? 3_600_000 : 120_000,
  );
});

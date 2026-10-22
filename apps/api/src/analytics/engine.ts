import { createHash, randomBytes } from 'node:crypto';
import { isbot } from 'isbot';
import {
  shiftStatsDay,
  statsDay,
  statsRetentionStart,
  STATS_DEVICES,
  type SiteStats,
  type StatsClass,
  type StatsDevice,
  type StatsQuery,
  type StatsSource,
} from '@sitewright/schema';
import { deviceClass, trafficClass, trafficSource } from './classify.js';
import type { GeoLookup } from './geo.js';
import { dimKey, type GoalDimRow, type GoalRow, type PageDimRow, type PageRow, type SeenRow, type SourceDimRow, type SourceRow, type StatsDelta, type StatsStore, type StatsTable, type TrafficRow } from './store.js';
import { statsProjectKey } from './token.js';

/**
 * The built-in statistics engine: counts in memory, writes daily totals once a minute.
 *
 * ★ Nothing touches the disk per visit. A pageview is classified (bot or human, device, country, source) and
 * added to a few in-memory counters; every {@link FLUSH_MS} those counters are written to the store as one
 * transaction of increments and cleared. A crash loses at most the last minute.
 *
 * VISITORS. A visitor is the 30-bit truncation of SHA-256(daily salt, project, IP, user agent). Only TODAY's
 * ids are kept — in a per-project Set, and appended to the store with each flush so a restart (clean or not)
 * does not count everyone twice — and they are dropped at midnight UTC; the salt itself is deleted two days
 * later. The first pageview of a visitor's day counts the visitor — on that pageview's device/country row, and
 * on its traffic source — so "visitors from Germany on mobile" needs no per-visitor storage at all. A truncated
 * id can collide; at 100,000 visitors to one site in a day that undercounts by about five.
 *
 * BREAKDOWNS. A human pageview is also counted by (page, device, country), and a visitor's source and a goal by
 * (…, device, country), so the device and country filters reach those lists too. They sit beside the exact lists,
 * capped per site and day; what they could not place is the difference from the exact totals, which a filtered
 * query reports rather than hides (see {@link StatsEngine.query}).
 *
 * Every in-memory structure is BOUNDED, per site as well as overall (see {@link StatsLimits}): a flood of junk
 * — or one very busy site — can cost one site its accuracy, never another site's, and never unbounded memory.
 */

/** How often counters are written. */
export const FLUSH_MS = 60_000;
/** The orphan reap refuses to delete more sites than this AND more than half of them in one pass. */
const MASS_REAP_FLOOR = 3;
/** Purges held in memory because the statistics file could not record them (see {@link StatsEngine.forget}). */
const PURGED_IN_MEMORY_MAX = 10_000;

export interface StatsLimits {
  /** Distinct counter rows held between flushes, across all sites. */
  pendingRows: number;
  /** …and for any one site, so one site's flood cannot crowd out the others' counts. */
  pendingRowsPerSite: number;
  /** Visitor ids remembered for today, across all sites (~30 bytes each in a Set). */
  seenIds: number;
  /** …and for any one site. Past it, that site's new visitors are counted but not remembered. */
  seenIdsPerSite: number;
  /** Distinct referring hosts / campaigns named per site per day; the rest are counted under their kind alone. */
  sourceHosts: number;
  /** …and across all sites (each name is up to 253 characters, remembered until midnight). */
  sourceHostsTotal: number;
  /**
   * The device × country BREAKDOWN of pages, sources and goals (what a filtered list is read from): distinct
   * (page, device, country) rows per site per day. Past it a pageview still counts everywhere else; a filtered
   * page list then shows it as "not broken down". These three caps are what bound the breakdown's disk use.
   */
  pageDimsPerSite: number;
  /** …distinct (source, host, device, country) rows per site per day. */
  sourceDimsPerSite: number;
  /** …distinct (goal, device, country) rows per site per day. */
  goalDimsPerSite: number;
  /** Breakdown rows remembered for today across all sites, to apply those caps (a 30-bit fingerprint each, ~16 bytes). */
  dimKeys: number;
}

export const DEFAULT_STATS_LIMITS: StatsLimits = {
  pendingRows: 50_000,
  pendingRowsPerSite: 10_000,
  seenIds: 1_000_000,
  seenIdsPerSite: 250_000,
  sourceHosts: 500,
  sourceHostsTotal: 100_000,
  pageDimsPerSite: 1_000,
  sourceDimsPerSite: 500,
  goalDimsPerSite: 200,
  dimKeys: 300_000,
};

type DimKind = 'pages' | 'sources' | 'goals';

/**
 * A breakdown key's fingerprint for the per-site caps: FNV-1a, kept to 30 bits like a visitor id, so it stays a
 * small integer in a Set (~16 bytes, not a boxed number). A collision admits one extra row, no more.
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 2;
}

export interface StatsHit {
  projectId: string;
  /** The page's route as the publisher signed it (`/`, `/about/`). */
  route: string;
  ua: string;
  ip: string;
  chMobile?: boolean;
  mobileHint?: boolean;
  touch?: boolean;
  webdriver?: boolean;
  referrerHost?: string;
  campaign?: string;
  /** Whether a referring host is one of this site's own. */
  isOwnHost?: (host: string) => boolean;
}

export interface StatsEngineOptions {
  store: StatsStore;
  geo: GeoLookup;
  /**
   * The secret route signatures derive from. Pass one derived from a key that outlives the statistics file
   * (the instance encryption key): pages already deployed elsewhere carry signatures from it, so a secret that
   * changed with a lost or restored `analytics.db` would silently stop counting every one of them. Without it,
   * a random secret is created and kept in the store.
   */
  secret?: string;
  now?: () => Date;
  log?: (msg: string, err?: unknown) => void;
  limits?: Partial<StatsLimits>;
}

interface Pending {
  traffic: Map<string, TrafficRow>;
  pages: Map<string, PageRow>;
  sources: Map<string, SourceRow>;
  goals: Map<string, GoalRow>;
  /** Visitor ids first seen since the last flush, per site and day — appended to the store with the counts. */
  seen: Map<string, SeenRow>;
  /**
   * The device × country breakdowns. Outside the pending-row caps: a row here exists only for a key admitted under
   * the per-site breakdown caps for the day, which bound them on their own.
   */
  pageDims: Map<string, PageDimRow>;
  sourceDims: Map<string, SourceDimRow>;
  goalDims: Map<string, GoalDimRow>;
  /** Distinct counter rows per site (for the per-site cap). */
  rowsBySite: Map<string, number>;
  rows: number;
}

const emptyPending = (): Pending => ({
  traffic: new Map(),
  pages: new Map(),
  sources: new Map(),
  goals: new Map(),
  seen: new Map(),
  pageDims: new Map(),
  sourceDims: new Map(),
  goalDims: new Map(),
  rowsBySite: new Map(),
  rows: 0,
});
const K = '\u0000';

export class StatsEngine {
  private readonly store: StatsStore;
  private readonly geo: GeoLookup;
  private readonly now: () => Date;
  private readonly log: (msg: string, err?: unknown) => void;
  private readonly limits: StatsLimits;
  private secret = '';
  /**
   * Whether opening CREATED the signing secret (none was stored and none was passed). The caller reports it:
   * pages already published elsewhere stop counting until republished. Not logged from here, because the
   * engine opens before its owner's logger exists.
   */
  createdSecret = false;
  private pending: Pending = emptyPending();
  private day = '';
  private salt: Buffer = Buffer.alloc(0);
  private saltSaved = false;
  private seen = new Map<string, Set<number>>();
  private seenCount = 0;
  private sourceHosts = new Map<string, Set<string>>();
  private sourceHostCount = 0;
  /** Today's breakdown rows per `${kind}\0${project}`, as key fingerprints (see {@link StatsLimits.pageDimsPerSite}). */
  private dimKeys = new Map<string, Set<number>>();
  private dimKeyCount = 0;
  private dimsDropped = 0;
  /** The first day the breakdowns were recorded (see StatsStore.dimsSince). */
  private dimsSince = '';
  /** Purges the store could not record; the next sweep finishes them all the same. */
  private purgedInMemory = new Set<string>();
  private prunedFor = '';
  private dropped = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<boolean> = Promise.resolve(true);
  /** Set by close(): no more counting. The store stays open until the last flush is written. */
  private closing = false;
  private storeClosed = false;

  private constructor(opts: StatsEngineOptions) {
    this.store = opts.store;
    this.geo = opts.geo;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? (() => {});
    this.limits = { ...DEFAULT_STATS_LIMITS, ...opts.limits };
  }

  /** Opens an engine over `store`: the signing secret, today's salt, and today's visitors so far. */
  static async open(opts: StatsEngineOptions): Promise<StatsEngine> {
    const engine = new StatsEngine(opts);
    if (opts.secret) {
      engine.secret = opts.secret;
    } else {
      const { secret, created } = await engine.store.secret();
      engine.secret = secret;
      engine.createdSecret = created;
    }
    const today = statsDay(engine.now());
    const salt = await engine.store.salt(today);
    engine.day = today;
    engine.salt = salt ?? randomBytes(16);
    engine.saltSaved = salt !== null;
    for (const [project, ids] of await engine.store.loadSeen(today)) {
      const set = new Set<number>();
      for (const id of ids) {
        if (engine.seenCount >= engine.limits.seenIds || set.size >= engine.limits.seenIdsPerSite) break;
        if (set.has(id)) continue;
        set.add(id);
        engine.seenCount++;
      }
      engine.seen.set(project, set);
    }
    engine.dimsSince = await engine.store.dimsSince(today);
    // Today's breakdown rows count against today's caps after a restart too — or every restart would grant a site
    // a fresh allowance, and a crash loop an unbounded one.
    const stored = await engine.store.loadDimKeys(today);
    for (const kind of ['pages', 'sources', 'goals'] as const) {
      // eslint-disable-next-line security/detect-object-injection -- kind is one of three literals
      for (const [project, keys] of stored[kind]) {
        const set = new Set(keys.map(fnv1a));
        engine.dimKeys.set(`${kind}${K}${project}`, set);
        engine.dimKeyCount += set.size;
      }
    }
    return engine;
  }

  /** Starts the once-a-minute flush. The timer never keeps the process alive. */
  start(): void {
    if (this.timer || this.closing) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  /** Stops counting, writes what was counted, and closes the store. */
  async close(): Promise<void> {
    if (this.closing) return;
    // Intake stops FIRST: a visit recorded while the last flush is in flight would otherwise land in a
    // batch nothing will ever write.
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const written = await this.flush();
    if (!written) this.log('statistics: the final write failed — the counts of the last minute are lost');
    this.storeClosed = true;
    this.store.close();
  }

  /** Whether a user agent is a known bot (no category lookup — the cheap check). */
  isKnownBot(ua: string): boolean {
    return ua.trim() !== '' && isbot(ua);
  }

  /** The key a project's builds sign their routes with (one HMAC — cheaper than any cache of it). */
  projectKey(projectId: string): string {
    return statsProjectKey(this.secret, projectId);
  }

  /** Rolls the day over at midnight UTC: a fresh salt, and yesterday's visitors forgotten. */
  private today(): string {
    const day = statsDay(this.now());
    if (day !== this.day) {
      this.day = day;
      this.salt = randomBytes(16);
      this.saltSaved = false;
      this.seen = new Map();
      this.seenCount = 0;
      this.sourceHosts = new Map();
      this.sourceHostCount = 0;
      this.dimKeys = new Map();
      this.dimKeyCount = 0;
    }
    return day;
  }

  /**
   * Whether a breakdown row may be written for `key` today: it already exists, or the site and the instance are
   * under their caps (and it is then remembered). A refusal costs only the breakdown — the visit counts everywhere
   * else, and a filtered list shows it as not broken down.
   */
  private admitDim(kind: DimKind, project: string, key: string): boolean {
    const id = `${kind}${K}${project}`;
    const fp = fnv1a(key);
    let set = this.dimKeys.get(id);
    if (set?.has(fp)) return true;
    const cap = kind === 'pages' ? this.limits.pageDimsPerSite : kind === 'sources' ? this.limits.sourceDimsPerSite : this.limits.goalDimsPerSite;
    if ((set?.size ?? 0) >= cap || this.dimKeyCount >= this.limits.dimKeys) {
      this.dimsDropped++;
      return false;
    }
    if (!set) this.dimKeys.set(id, (set = new Set()));
    set.add(fp);
    this.dimKeyCount++;
    return true;
  }

  /** Adds to TODAY's breakdown row for `key` (admitting it first when it is new). */
  private bumpDim<R>(kind: DimKind, map: Map<string, R>, project: string, key: string, make: () => R, add: (row: R) => void): void {
    const mapKey = dimKey(this.day, project, key);
    let row = map.get(mapKey);
    if (!row) {
      if (!this.admitDim(kind, project, key)) return;
      row = make();
      map.set(mapKey, row);
    }
    add(row);
  }

  /** Whether `id` is a visitor not yet seen today on `projectId` (and remembers it). */
  private firstVisit(projectId: string, ip: string, ua: string): boolean {
    const id = createHash('sha256').update(this.salt).update(projectId).update(K).update(ip).update(K).update(ua).digest().readUInt32BE(0) >>> 2;
    let set = this.seen.get(projectId);
    if (set?.has(id)) return false;
    // Past a cap a new visitor is still counted, just not remembered — a later pageview of theirs counts
    // them again. The per-site cap is what keeps that overcount on the one site that reached it.
    if (this.seenCount >= this.limits.seenIds || (set?.size ?? 0) >= this.limits.seenIdsPerSite) return true;
    if (!set) this.seen.set(projectId, (set = new Set()));
    set.add(id);
    this.seenCount++;
    const key = `${this.day}${K}${projectId}`;
    const fresh = this.pending.seen.get(key);
    if (fresh) fresh.ids.push(id);
    else this.pending.seen.set(key, { project: projectId, day: this.day, ids: [id] });
    return true;
  }

  private bump<R>(map: Map<string, R>, project: string, key: string, make: () => R, add: (row: R) => void): void {
    let row = map.get(key);
    if (!row) {
      const p = this.pending;
      const forSite = p.rowsBySite.get(project) ?? 0;
      if (p.rows >= this.limits.pendingRows || forSite >= this.limits.pendingRowsPerSite) {
        this.dropped++;
        return;
      }
      row = make();
      map.set(key, row);
      p.rows++;
      p.rowsBySite.set(project, forSite + 1);
    }
    add(row);
  }

  private countTraffic(project: string, day: string, cls: StatsClass, device: StatsDevice | '', country: string, visitor: boolean): void {
    this.bump(
      this.pending.traffic,
      project,
      [project, day, cls, device, country].join(K),
      () => ({ project, day, cls, device, country, views: 0, visitors: 0 }),
      (r) => {
        r.views++;
        if (visitor) r.visitors++;
      },
    );
  }

  private countPage(project: string, day: string, path: string, human: boolean): void {
    this.bump(
      this.pending.pages,
      project,
      [project, day, path].join(K),
      () => ({ project, day, path, views: 0, botViews: 0 }),
      (r) => {
        if (human) r.views++;
        else r.botViews++;
      },
    );
  }

  /** Counts a visitor's source; returns the host it was counted under (`''` past the named-host caps). */
  private countSource(project: string, day: string, source: StatsSource, rawHost: string): string {
    let hosts = this.sourceHosts.get(project);
    if (!hosts) this.sourceHosts.set(project, (hosts = new Set()));
    const named = `${source}${K}${rawHost}`;
    // A site's list of referrers is a long tail; past the cap the visit still counts, under its kind alone.
    let host = rawHost;
    if (rawHost && !hosts.has(named)) {
      if (hosts.size >= this.limits.sourceHosts || this.sourceHostCount >= this.limits.sourceHostsTotal) {
        host = '';
      } else {
        hosts.add(named);
        this.sourceHostCount++;
      }
    }
    this.bump(
      this.pending.sources,
      project,
      [project, day, source, host].join(K),
      () => ({ project, day, source, host, visitors: 0 }),
      (r) => {
        r.visitors++;
      },
    );
    return host;
  }

  /** The device × country breakdown of a human pageview, its source (on a first visit) — see `page_dims`. */
  private countDims(project: string, day: string, device: StatsDevice, country: string, path: string, source?: { source: StatsSource; host: string }): void {
    this.bumpDim('pages', this.pending.pageDims, project, dimKey(path, device, country), () => ({ project, day, path, device, country, views: 0 }), (r) => {
      r.views++;
    });
    if (!source) return;
    const { source: kind, host } = source;
    this.bumpDim('sources', this.pending.sourceDims, project, dimKey(kind, host, device, country), () => ({ project, day, source: kind, host, device, country, visitors: 0 }), (r) => {
      r.visitors++;
    });
  }

  /** Counts one pageview reported by a page's tracker. */
  record(hit: StatsHit): void {
    if (this.closing) return;
    const day = this.today();
    const cls = trafficClass({ ua: hit.ua, webdriver: hit.webdriver });
    const human = cls === 'human';
    const country = this.geo.country(hit.ip) ?? 'ZZ';
    if (!human) {
      // Bots have no visitors and no source: they are counted as views, by kind and by page.
      this.countTraffic(hit.projectId, day, cls, '', country, false);
      this.countPage(hit.projectId, day, hit.route, false);
      return;
    }
    const device = deviceClass({ ua: hit.ua, chMobile: hit.chMobile, mobileHint: hit.mobileHint, touch: hit.touch });
    const first = this.firstVisit(hit.projectId, hit.ip, hit.ua);
    this.countTraffic(hit.projectId, day, 'human', device, country, first);
    this.countPage(hit.projectId, day, hit.route, true);
    if (!first) {
      this.countDims(hit.projectId, day, device, country, hit.route);
      return;
    }
    const { source, host: rawHost } = trafficSource({ referrerHost: hit.referrerHost, campaign: hit.campaign, isOwnHost: hit.isOwnHost ?? (() => false) });
    const host = this.countSource(hit.projectId, day, source, rawHost);
    this.countDims(hit.projectId, day, device, country, hit.route, { source, host });
  }

  /**
   * Counts a page the platform SERVED to a bot (local hosting). Most crawlers never run a page's script, so
   * without this a locally hosted site would see almost no bot traffic at all. Humans are left to the tracker:
   * a browser that loads the page reports it, and counting it here as well would count it twice.
   */
  recordServedPage(projectId: string, route: string, ua: string, ip: string): void {
    if (this.closing || !ua.trim() || !isbot(ua)) return;
    const day = this.today();
    const cls = trafficClass({ ua });
    const country = this.geo.country(ip) ?? 'ZZ';
    this.countTraffic(projectId, day, cls, '', country, false);
    this.countPage(projectId, day, route, false);
  }

  /**
   * Counts a goal completion (a form submission). `visitor` is the submitting request: its device class (from the
   * user agent and the mobile client hint — the page's own hints are not sent with a form) and country break the
   * goal down for the filters. Without it the goal counts, unbroken down.
   */
  recordGoal(projectId: string, goal: string, visitor?: { ua: string; ip: string; chMobile?: boolean }): void {
    if (this.closing) return;
    const day = this.today();
    this.bump(
      this.pending.goals,
      projectId,
      [projectId, day, goal].join(K),
      () => ({ project: projectId, day, goal, count: 0 }),
      (r) => {
        r.count++;
      },
    );
    if (!visitor) return;
    const device = deviceClass({ ua: visitor.ua, chMobile: visitor.chMobile });
    const country = this.geo.country(visitor.ip) ?? 'ZZ';
    this.bumpDim('goals', this.pending.goalDims, projectId, dimKey(goal, device, country), () => ({ project: projectId, day, goal, device, country, count: 0 }), (r) => {
      r.count++;
    });
  }

  /**
   * Writes the counters gathered since the last flush. Flushes never overlap. Resolves whether this flush's
   * write succeeded (a failure is logged, and its counts are kept for the next one).
   */
  flush(): Promise<boolean> {
    this.flushing = this.flushing.then(() =>
      this.flushNow().then(
        () => true,
        (err: unknown) => {
          this.log('statistics: flush failed', err);
          return false;
        },
      ),
    );
    return this.flushing;
  }

  private async flushNow(): Promise<void> {
    if (this.storeClosed) return;
    const day = this.today();
    if (!this.saltSaved) {
      const salt = this.salt;
      await this.store.saveSalt(day, salt);
      // Midnight may have passed during that write; the NEW day's salt is then still unsaved.
      if (this.salt === salt) this.saltSaved = true;
    }
    const batch = this.pending;
    this.pending = emptyPending();
    if (this.dropped > 0) {
      this.log(`statistics: ${this.dropped} counts dropped — more distinct rows between flushes than the caps allow`);
      this.dropped = 0;
    }
    if (this.dimsDropped > 0) {
      this.log(`statistics: ${this.dimsDropped} visits not broken down by device and country — a site reached its daily breakdown cap (they still count)`);
      this.dimsDropped = 0;
    }
    const delta: StatsDelta = {
      traffic: [...batch.traffic.values()],
      pages: [...batch.pages.values()],
      sources: [...batch.sources.values()],
      goals: [...batch.goals.values()],
      seen: [...batch.seen.values()],
      pageDims: [...batch.pageDims.values()],
      sourceDims: [...batch.sourceDims.values()],
      goalDims: [...batch.goalDims.values()],
    };
    try {
      await this.store.apply(delta);
    } catch (err) {
      // Put the counts back so the next flush retries them — merged into whatever arrived meanwhile, and
      // still under the same caps (bump drops what does not fit).
      this.requeue(batch);
      throw err;
    }
    if (this.prunedFor !== day) {
      await this.store.prune(day, statsRetentionStart(day), shiftStatsDay(day, -1));
      this.prunedFor = day;
      // Yesterday's visitor ids and the oldest day of totals just went: give their space back.
      await this.compactQuietly();
    }
  }

  private requeue(batch: Pending): void {
    for (const r of batch.traffic.values()) {
      this.bump(this.pending.traffic, r.project, [r.project, r.day, r.cls, r.device, r.country].join(K), () => ({ ...r, views: 0, visitors: 0 }), (x) => {
        x.views += r.views;
        x.visitors += r.visitors;
      });
    }
    for (const r of batch.pages.values()) {
      this.bump(this.pending.pages, r.project, [r.project, r.day, r.path].join(K), () => ({ ...r, views: 0, botViews: 0 }), (x) => {
        x.views += r.views;
        x.botViews += r.botViews;
      });
    }
    for (const r of batch.sources.values()) {
      this.bump(this.pending.sources, r.project, [r.project, r.day, r.source, r.host].join(K), () => ({ ...r, visitors: 0 }), (x) => {
        x.visitors += r.visitors;
      });
    }
    for (const r of batch.goals.values()) {
      this.bump(this.pending.goals, r.project, [r.project, r.day, r.goal].join(K), () => ({ ...r, count: 0 }), (x) => {
        x.count += r.count;
      });
    }
    for (const [key, row] of batch.seen) {
      // Only TODAY's ids are worth retrying: an earlier day's are of no use once it is over (the prune deletes
      // them), and keeping them would let a store that fails for days pile up a day's worth of ids per day.
      if (row.day !== this.day) continue;
      const fresh = this.pending.seen.get(key);
      this.pending.seen.set(key, fresh ? { ...row, ids: [...row.ids, ...fresh.ids] } : row);
    }
    // Breakdown rows were admitted when they were counted (that day's caps): merged back as they are.
    const merge = <R>(from: Map<string, R>, to: Map<string, R>, add: (into: R, r: R) => void): void => {
      for (const [key, r] of from) {
        const into = to.get(key);
        if (into) add(into, r);
        else to.set(key, r);
      }
    };
    merge(batch.pageDims, this.pending.pageDims, (x, r) => (x.views += r.views));
    merge(batch.sourceDims, this.pending.sourceDims, (x, r) => (x.visitors += r.visitors));
    merge(batch.goalDims, this.pending.goalDims, (x, r) => (x.count += r.count));
  }

  /** A project's statistics for a range: flushed first, so the answer includes the last minute. */
  async query(projectId: string, q: StatsQuery, enabled: boolean): Promise<SiteStats> {
    await this.flush();
    const { totals, ...res } = await this.store.query(projectId, q);
    const byDay = new Map(res.daily.map((d) => [d.day, d]));
    const daily: SiteStats['daily'] = [];
    for (let d = q.from; d <= q.to; d = shiftStatsDay(d, 1)) daily.push(byDay.get(d) ?? { day: d, views: 0, visitors: 0, botViews: 0 });
    // Every device class is listed, zero or not, in a fixed order — a chart whose bars come and go is harder
    // to read than one with an empty bar.
    const devices = STATS_DEVICES.map((device) => res.devices.find((x) => x.device === device) ?? { device, views: 0, visitors: 0 });
    if (!totals) return { ...res, enabled, daily, devices };
    // Under a filter: what the page, source and goal lists could not place — set against the EXACT filtered totals
    // (the traffic table had device and country from the start), so days before the breakdown existed, and visits
    // past a site's daily breakdown cap, show as "not broken down" rather than as no traffic.
    const breakdown = {
      since: this.dimsSince,
      pages: Math.max(0, res.human.views - totals.pageViews),
      sources: Math.max(0, res.human.visitors - totals.sourceVisitors),
      goals: Math.max(0, totals.goals - totals.goalsBrokenDown),
    };
    return { ...res, enabled, daily, devices, breakdown };
  }

  /** One table's raw daily rows for the CSV export. */
  async rows(projectId: string, table: StatsTable, from: string, to: string): Promise<string[][]> {
    await this.flush();
    return this.store.rows(projectId, table, from, to);
  }

  /**
   * Gives freed space back. Best-effort: the counts are already written by the time this runs, so a failure here
   * must not fail the flush (which would report lost counts) or repeat the prune.
   */
  private async compactQuietly(): Promise<void> {
    try {
      await this.store.compact();
    } catch (err) {
      this.log('statistics: could not give freed space back', err);
    }
  }

  /**
   * Runs `fn` on the flush chain, so it never interleaves with a flush (the minute timer included). The chain
   * survives `fn` failing; the caller still sees the failure.
   */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.flushing.then(fn);
    this.flushing = run.then(
      () => true,
      () => true,
    );
    return run;
  }

  /**
   * Forgets a project entirely (it was deleted for good), and gives its space back.
   *
   * ★ The purge is RECORDED first (in the statistics file; in memory when that cannot be written), and the record
   * stays until a {@link reapOrphans} pass finds none of its statistics left. So a delete that fails here —
   * or a visit that was already past its checks when the project went and lands a row afterwards — is finished by
   * the sweep, whatever its brake says: the brake is for sites that vanished with no purge on record.
   */
  async forget(projectId: string): Promise<void> {
    await this.exclusive(async () => {
      await this.markPurged(projectId);
      await this.flushNow();
      this.dropFromMemory(projectId);
      await this.store.forget(projectId);
      await this.compactQuietly();
    });
  }

  /**
   * Puts a purge on record ahead of the steps that destroy the project, so that whatever happens between here and
   * {@link forget} — a step that throws, a process that stops — the sweep still forgets its statistics. Never
   * throws: a purge must not fail over its statistics. A record for a project that turns out to exist after all
   * is dropped by the sweep, statistics kept.
   */
  async recordPurge(projectId: string): Promise<void> {
    await this.exclusive(() => this.markPurged(projectId));
  }

  /** The purge record: in the statistics file, or in memory when that cannot be written. */
  private async markPurged(projectId: string): Promise<void> {
    try {
      await this.store.markPurged(projectId, this.now());
    } catch (err) {
      if (this.purgedInMemory.size < PURGED_IN_MEMORY_MAX) {
        this.log('statistics: could not record a purge in the statistics file — retrying it from memory until a restart', err);
        this.purgedInMemory.add(projectId);
      } else {
        this.log('statistics: could not record a purge, and too many are waiting in memory — its statistics are left to the orphan sweep', err);
      }
    }
  }

  private dropFromMemory(projectId: string): void {
    this.seenCount -= this.seen.get(projectId)?.size ?? 0;
    this.seen.delete(projectId);
    this.sourceHostCount -= this.sourceHosts.get(projectId)?.size ?? 0;
    this.sourceHosts.delete(projectId);
    for (const kind of ['pages', 'sources', 'goals'] as const) {
      const id = `${kind}${K}${projectId}`;
      this.dimKeyCount -= this.dimKeys.get(id)?.size ?? 0;
      this.dimKeys.delete(id);
    }
  }

  /**
   * Deletes the statistics of every project that no longer exists — the reconciliation behind {@link forget}.
   * `exists` answers which ids still exist (soft-deleted ones included: they can be restored). Returns the ids
   * whose statistics it removed.
   *
   * Two kinds of leftovers, treated differently:
   *  - PURGED projects (on record from {@link forget}): always forgotten; the record goes once a pass finds nothing
   *    left. A failed delete, or a row that landed after it, is finished here however many sites went at once.
   *  - UNEXPLAINED ones (statistics of a project the database does not know, with no purge on record — say a
   *    beacon that landed after a restart lost an in-memory record): forgotten too, but behind the brake below.
   * Without this, either would linger until the 25-month retention reached it.
   */
  async reapOrphans(exists: (ids: string[]) => Promise<ReadonlySet<string>>): Promise<string[]> {
    if (this.closing) return [];
    return this.exclusive(async () => {
      await this.flushNow();
      const ids = await this.store.projectIds();
      const purged = [...new Set([...(await this.store.purgedIds()), ...this.purgedInMemory])];
      if (ids.length === 0 && purged.length === 0) return [];
      const live = await exists([...new Set([...ids, ...purged])]);
      const stored = new Set(ids);
      const removed: string[] = [];
      for (const id of purged) {
        // The record is dropped only by a pass that finds NOTHING left — so a visit that lands a row just after the
        // pass that deleted the others is deleted by the next one — or when the project exists again (a main
        // database restored from before the purge), which keeps what it has.
        if (!live.has(id) && stored.has(id)) {
          this.dropFromMemory(id);
          await this.store.forget(id);
          removed.push(id);
          continue;
        }
        await this.store.unmarkPurged(id);
        this.purgedInMemory.delete(id);
      }
      const onRecord = new Set(purged);
      const rest = ids.filter((id) => !onRecord.has(id));
      const gone = rest.filter((id) => !live.has(id));
      // ★ A sanity brake. Statistics live in their own file, so they can outlive the database they belong to: a
      // main database restored from an old backup, or a data directory pointed at another one, would make most
      // sites look deleted at once — and this would erase their history for good. A real deletion is on record
      // (above); most of the REST vanishing at once is the other thing.
      if (gone.length > Math.max(MASS_REAP_FLOOR, rest.length / 2)) {
        this.log(
          `statistics: ${gone.length} of ${rest.length} sites with statistics are missing from the database — NOT deleting their statistics. If those projects really are gone, delete analytics.db or remove them one by one.`,
        );
      } else {
        for (const id of gone) {
          this.dropFromMemory(id);
          await this.store.forget(id);
          removed.push(id);
        }
      }
      if (removed.length) await this.compactQuietly();
      return removed;
    });
  }
}

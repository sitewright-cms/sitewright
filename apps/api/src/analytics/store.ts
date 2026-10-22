import { randomBytes } from 'node:crypto';
import { createClient, type Client, type InStatement, type InValue } from '@libsql/client';
import type { SiteStats, StatsClass, StatsDevice, StatsQuery, StatsSource } from '@sitewright/schema';

/**
 * The built-in statistics' storage: DAILY TOTALS in their own SQLite file (`<data>/analytics.db`).
 *
 * A separate file, not tables in the main database, so the counters' steady trickle of writes never shares a
 * write lock or a WAL with content saves, and so an operator can move, back up or delete the statistics
 * without touching the sites. There is no per-visit table: the engine adds visits up in memory and hands this
 * store one batch of increments a minute, which it applies as UPSERTs in a single transaction.
 *
 * Every table is keyed `(project, day, …)` WITHOUT ROWID, so a range query is one index walk and a row costs
 * little more than its own columns.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`,
  // class: human | search | ai | seo | monitor | social | bot. device: '' for bots. country: ISO alpha-2 or ZZ.
  `CREATE TABLE IF NOT EXISTS traffic (
     project TEXT NOT NULL, day TEXT NOT NULL, class TEXT NOT NULL, device TEXT NOT NULL, country TEXT NOT NULL,
     views INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project, day, class, device, country)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS pages (
     project TEXT NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL,
     views INTEGER NOT NULL DEFAULT 0, bot_views INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project, day, path)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS sources (
     project TEXT NOT NULL, day TEXT NOT NULL, source TEXT NOT NULL, host TEXT NOT NULL,
     visitors INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project, day, source, host)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS goals (
     project TEXT NOT NULL, day TEXT NOT NULL, goal TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project, day, goal)) WITHOUT ROWID`,
  // The daily visitor salt — deleted once it is two days old, after which no visitor id can be recomputed.
  `CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt BLOB NOT NULL) WITHOUT ROWID`,
  // TODAY's visitor ids, appended with each flush (a blob of the ids first seen since the last one), so a
  // restart — clean or not — does not count everyone twice. Dropped once the day is over.
  `CREATE TABLE IF NOT EXISTS seen (project TEXT NOT NULL, day TEXT NOT NULL, ids BLOB NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS seen_by_day ON seen (day, project)`,
  // Projects deleted FOR GOOD whose statistics must go: written before those statistics are deleted, removed by
  // the hourly sweep once they are. A failed delete is retried from here — never left to the orphan sweep's
  // brake, which cannot tell a purge from a main database restored from an old backup.
  `CREATE TABLE IF NOT EXISTS purged (project TEXT PRIMARY KEY, at TEXT NOT NULL) WITHOUT ROWID`,
  // ★ The device × country BREAKDOWNS of pages, sources and goals — what lets those lists follow a filter.
  // `pages`, `sources` and `goals` above stay the exact, uncapped record; these are capped per site and day
  // (see StatsLimits in engine.ts), and a filtered list states what they could not place by comparing with the
  // exact `traffic` totals. Human pageviews only. Recorded from the day in meta `dims_since` on.
  `CREATE TABLE IF NOT EXISTS page_dims (
     project TEXT NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, device TEXT NOT NULL, country TEXT NOT NULL,
     views INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project, day, path, device, country)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS source_dims (
     project TEXT NOT NULL, day TEXT NOT NULL, source TEXT NOT NULL, host TEXT NOT NULL, device TEXT NOT NULL,
     country TEXT NOT NULL, visitors INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project, day, source, host, device, country)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS goal_dims (
     project TEXT NOT NULL, day TEXT NOT NULL, goal TEXT NOT NULL, device TEXT NOT NULL, country TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project, day, goal, device, country)) WITHOUT ROWID`,
];

const DATA_TABLES = ['traffic', 'pages', 'sources', 'goals'] as const;
/** The breakdown tables (not exported as CSV: the exact tables are the record; these only serve filters). */
const DIM_TABLES = ['page_dims', 'source_dims', 'goal_dims'] as const;
/** Every table holding a project's statistics by day — what the retention prune and a forget cover. */
const DAILY_TABLES = [...DATA_TABLES, ...DIM_TABLES] as const;

/** Above this, an existing file is not rewritten at startup to switch on incremental vacuum. */
const CONVERT_MAX_BYTES = 64 * 1024 * 1024;
/** Pages handed back per step of compact() (4 KB pages: 2 MB a step). */
const COMPACT_STEP_PAGES = 512;
/**
 * Purges remembered at most (see the `purged` table). The sweep empties the table every hour, so it only fills
 * while every delete keeps failing; past this the OLDEST go, and their statistics are left to the orphan sweep.
 */
export const PURGED_MAX = 10_000;

export interface StatsStoreOptions {
  /** Hears about problems that are not worth failing over (an unconverted file). */
  log?: (message: string, err?: unknown) => void;
  /** Override for {@link CONVERT_MAX_BYTES} (tests). */
  convertMaxBytes?: number;
  /** Override for {@link PURGED_MAX} (tests). */
  purgedMax?: number;
}

export interface TrafficRow { project: string; day: string; cls: StatsClass; device: StatsDevice | ''; country: string; views: number; visitors: number }
export interface PageRow { project: string; day: string; path: string; views: number; botViews: number }
export interface SourceRow { project: string; day: string; source: StatsSource; host: string; visitors: number }
export interface GoalRow { project: string; day: string; goal: string; count: number }
export interface SeenRow { project: string; day: string; ids: number[] }
export interface PageDimRow { project: string; day: string; path: string; device: StatsDevice; country: string; views: number }
export interface SourceDimRow { project: string; day: string; source: StatsSource; host: string; device: StatsDevice; country: string; visitors: number }
export interface GoalDimRow { project: string; day: string; goal: string; device: StatsDevice; country: string; count: number }

/** One flush worth of increments. */
export interface StatsDelta {
  traffic: TrafficRow[];
  pages: PageRow[];
  sources: SourceRow[];
  goals: GoalRow[];
  /** Visitor ids first seen since the last flush. */
  seen: SeenRow[];
  /** The device × country breakdowns (see the `page_dims` table). */
  pageDims?: PageDimRow[];
  sourceDims?: SourceDimRow[];
  goalDims?: GoalDimRow[];
}

/** Today's breakdown keys per project, for the engine's per-site caps after a restart. */
export interface DimKeys {
  pages: Map<string, string[]>;
  sources: Map<string, string[]>;
  goals: Map<string, string[]>;
}

/**
 * The exact figures a filtered list is checked against, from {@link StatsStore.query} under a device or country
 * filter: what the breakdown tables hold for it, beside the totals it should add up to.
 */
export interface StatsBreakdownTotals {
  /** Filtered human pageviews that are in `page_dims`. */
  pageViews: number;
  /** Filtered visitors (their first pageview of the day) that are in `source_dims`. */
  sourceVisitors: number;
  /** All goal completions in the range, and those broken down at all (whatever the filter). */
  goals: number;
  goalsBrokenDown: number;
}

/** The key of a breakdown row within its site and day — the unit the engine's per-site caps count. */
export const dimKey = (...parts: string[]): string => parts.join('\u0000');

/** The four exportable tables, for the CSV download. */
export type StatsTable = (typeof DATA_TABLES)[number];
export const STATS_TABLES: readonly StatsTable[] = DATA_TABLES;

/** A BLOB column's bytes (the driver hands back an ArrayBuffer; a view is accepted too). */
const bytesOf = (v: unknown): Uint8Array | null =>
  v instanceof ArrayBuffer ? new Uint8Array(v) : v instanceof Uint8Array ? v : null;
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v ?? 0) || 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));

/** Caps on the breakdown lists a query returns (the CSV export is uncapped up to its own ceiling). */
const LIST_LIMIT = 100;
const COUNTRY_LIMIT = 300;
export const CSV_ROW_LIMIT = 100_000;

export class StatsStore {
  private constructor(
    private readonly client: Client,
    private readonly purgedMax: number,
  ) {}

  /** Opens (creating when absent) the statistics database at a libsql URL — `:memory:` for tests. */
  static async open(url: string, opts: StatsStoreOptions = {}): Promise<StatsStore> {
    const client = createClient({ url });
    // Same posture as the main database (see db/client.ts); WAL is a no-op for `:memory:`.
    // INCREMENTAL auto-vacuum lets compact() hand freed pages back to the filesystem; without it a SQLite file
    // never shrinks, and a reaped site's rows would leave their space behind for good. It only takes effect
    // before the first table exists, so it goes first — ahead of the WAL switch too.
    await client.execute('PRAGMA auto_vacuum = INCREMENTAL');
    await client.executeMultiple('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    await client.batch(SCHEMA, 'write');
    // A file created without incremental vacuum converts once — a full VACUUM, which rewrites the file. Only a
    // small one, and never fatally: statistics are optional, and the platform must boot even when a rewrite
    // cannot (a full disk, a huge file). An unconverted file still works; it just does not shrink.
    const mode = await client.execute('PRAGMA auto_vacuum');
    if (Number(mode.rows[0]?.[0] ?? 0) !== 2) {
      const size = await client.batch(['PRAGMA page_count', 'PRAGMA page_size'], 'read');
      const bytes = num(size[0]!.rows[0]?.[0]) * num(size[1]!.rows[0]?.[0]);
      if (bytes > (opts.convertMaxBytes ?? CONVERT_MAX_BYTES)) {
        opts.log?.(`statistics: ${url} was made without incremental vacuum and is too large to convert at startup; it will not shrink after deletes`);
      } else {
        try {
          await client.executeMultiple('PRAGMA auto_vacuum = INCREMENTAL; VACUUM;');
        } catch (err) {
          opts.log?.('statistics: could not convert the statistics file to incremental vacuum; it will not shrink after deletes', err);
        }
      }
    }
    return new StatsStore(client, opts.purgedMax ?? PURGED_MAX);
  }

  /** Hands the pages freed by deletes back to the filesystem (a no-op when nothing was freed). */
  async compact(): Promise<void> {
    // In bounded steps, yielding between them: the driver is synchronous, so one pragma freeing every page of
    // a large delete would hold the event loop — and every request with it — for the whole run.
    // executeMultiple, not execute: the pragma frees one page per STEP, and a single-row query leaves it
    // mid-flight ("cannot commit transaction - SQL statements in progress").
    for (let i = 0; i < 10_000; i++) {
      const { free } = await this.pages();
      if (free === 0) return;
      await this.client.executeMultiple(`PRAGMA incremental_vacuum(${COMPACT_STEP_PAGES});`);
      if (free <= COMPACT_STEP_PAGES) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /** Database pages in use and free — what compact() can give back. */
  async pages(): Promise<{ total: number; free: number }> {
    const [total, free] = await this.client.batch(['PRAGMA page_count', 'PRAGMA freelist_count'], 'read');
    return { total: num(total!.rows[0]?.[0]), free: num(free!.rows[0]?.[0]) };
  }

  /** Every project id that has statistics stored. */
  async projectIds(): Promise<string[]> {
    // DAILY_TABLES is a closed constant list.
    const rs = await this.client.execute([...DAILY_TABLES, 'seen'].map((t) => `SELECT project FROM ${t}`).join(' UNION '));
    return rs.rows.map((r) => str(r.project));
  }

  /**
   * The first day the device × country breakdowns were recorded: the day this version first opened the file
   * (stored then, and kept). Days before it have no breakdown, and a filtered list says so.
   */
  async dimsSince(today: string): Promise<string> {
    await this.client.execute({ sql: 'INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)', args: ['dims_since', today] });
    const rs = await this.client.execute({ sql: 'SELECT v FROM meta WHERE k = ?', args: ['dims_since'] });
    return str(rs.rows[0]?.v) || today;
  }

  /** `day`'s breakdown keys per project and table (bounded by the engine's per-site caps). */
  async loadDimKeys(day: string): Promise<DimKeys> {
    const [pages, sources, goals] = await this.client.batch(
      [
        { sql: 'SELECT project, path, device, country FROM page_dims WHERE day = ?', args: [day] },
        { sql: 'SELECT project, source, host, device, country FROM source_dims WHERE day = ?', args: [day] },
        { sql: 'SELECT project, goal, device, country FROM goal_dims WHERE day = ?', args: [day] },
      ],
      'read',
    );
    const group = (rows: ReadonlyArray<Record<string, unknown>>, cols: string[]): Map<string, string[]> => {
      const out = new Map<string, string[]>();
      for (const r of rows) {
        const project = str(r.project);
        let keys = out.get(project);
        if (!keys) out.set(project, (keys = []));
        // eslint-disable-next-line security/detect-object-injection -- `c` is one of the constant column names above
        keys.push(dimKey(...cols.map((c) => str(r[c]))));
      }
      return out;
    };
    return {
      pages: group(pages!.rows, ['path', 'device', 'country']),
      sources: group(sources!.rows, ['source', 'host', 'device', 'country']),
      goals: group(goals!.rows, ['goal', 'device', 'country']),
    };
  }

  close(): void {
    this.client.close();
  }

  /** The stored secret route signatures derive from — created on first use and kept. */
  async secret(): Promise<{ secret: string; created: boolean }> {
    const fresh = randomBytes(32).toString('hex');
    const ins = await this.client.execute({ sql: 'INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)', args: ['secret', fresh] });
    const rs = await this.client.execute({ sql: 'SELECT v FROM meta WHERE k = ?', args: ['secret'] });
    return { secret: str(rs.rows[0]?.v), created: ins.rowsAffected > 0 };
  }

  /** The stored salt for `day`, or null. */
  async salt(day: string): Promise<Buffer | null> {
    const rs = await this.client.execute({ sql: 'SELECT salt FROM salts WHERE day = ?', args: [day] });
    const bytes = bytesOf(rs.rows[0]?.salt);
    return bytes ? Buffer.from(bytes) : null;
  }

  /** Stores `salt` for `day` unless one is already there. */
  async saveSalt(day: string, salt: Buffer): Promise<void> {
    await this.client.execute({ sql: 'INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)', args: [day, salt] });
  }

  /** Applies one batch of increments in a single transaction. */
  async apply(delta: StatsDelta): Promise<void> {
    const stmts: InStatement[] = [
      ...delta.traffic.map((r) => ({
        sql: `INSERT INTO traffic (project, day, class, device, country, views, visitors) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (project, day, class, device, country)
              DO UPDATE SET views = views + excluded.views, visitors = visitors + excluded.visitors`,
        args: [r.project, r.day, r.cls, r.device, r.country, r.views, r.visitors],
      })),
      ...delta.pages.map((r) => ({
        sql: `INSERT INTO pages (project, day, path, views, bot_views) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (project, day, path) DO UPDATE SET views = views + excluded.views, bot_views = bot_views + excluded.bot_views`,
        args: [r.project, r.day, r.path, r.views, r.botViews],
      })),
      ...delta.sources.map((r) => ({
        sql: `INSERT INTO sources (project, day, source, host, visitors) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (project, day, source, host) DO UPDATE SET visitors = visitors + excluded.visitors`,
        args: [r.project, r.day, r.source, r.host, r.visitors],
      })),
      ...delta.goals.map((r) => ({
        sql: `INSERT INTO goals (project, day, goal, count) VALUES (?, ?, ?, ?)
              ON CONFLICT (project, day, goal) DO UPDATE SET count = count + excluded.count`,
        args: [r.project, r.day, r.goal, r.count],
      })),
      ...delta.seen
        .filter((r) => r.ids.length > 0)
        .map((r) => ({ sql: 'INSERT INTO seen (project, day, ids) VALUES (?, ?, ?)', args: [r.project, r.day, Buffer.from(Uint32Array.from(r.ids).buffer)] })),
      ...(delta.pageDims ?? []).map((r) => ({
        sql: `INSERT INTO page_dims (project, day, path, device, country, views) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (project, day, path, device, country) DO UPDATE SET views = views + excluded.views`,
        args: [r.project, r.day, r.path, r.device, r.country, r.views],
      })),
      ...(delta.sourceDims ?? []).map((r) => ({
        sql: `INSERT INTO source_dims (project, day, source, host, device, country, visitors) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (project, day, source, host, device, country) DO UPDATE SET visitors = visitors + excluded.visitors`,
        args: [r.project, r.day, r.source, r.host, r.device, r.country, r.visitors],
      })),
      ...(delta.goalDims ?? []).map((r) => ({
        sql: `INSERT INTO goal_dims (project, day, goal, device, country, count) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (project, day, goal, device, country) DO UPDATE SET count = count + excluded.count`,
        args: [r.project, r.day, r.goal, r.device, r.country, r.count],
      })),
    ];
    if (stmts.length) await this.client.batch(stmts, 'write');
  }

  /** Drops everything older than the retention window, and salts and visitor ids from before `today`. */
  async prune(today: string, keepFrom: string, saltKeepFrom: string): Promise<void> {
    await this.client.batch(
      [
        ...DAILY_TABLES.map((t) => ({ sql: `DELETE FROM ${t} WHERE day < ?`, args: [keepFrom] })),
        { sql: 'DELETE FROM salts WHERE day < ?', args: [saltKeepFrom] },
        { sql: 'DELETE FROM seen WHERE day < ?', args: [today] },
      ],
      'write',
    );
  }

  /** Deletes every statistic of a project (it was deleted for good). */
  async forget(project: string): Promise<void> {
    await this.client.batch(
      [...DAILY_TABLES, 'seen'].map((t) => ({ sql: `DELETE FROM ${t} WHERE project = ?`, args: [project] })),
      'write',
    );
  }

  /**
   * Records that `project` was deleted for good, so its statistics must go (see the `purged` table). Marking it
   * again keeps the first time; past {@link PURGED_MAX} the oldest records are dropped.
   */
  async markPurged(project: string, at: Date): Promise<void> {
    await this.client.batch(
      [
        { sql: 'INSERT INTO purged (project, at) VALUES (?, ?) ON CONFLICT (project) DO NOTHING', args: [project, at.toISOString()] },
        {
          sql: 'DELETE FROM purged WHERE project NOT IN (SELECT project FROM purged ORDER BY at DESC, project DESC LIMIT ?)',
          args: [this.purgedMax],
        },
      ],
      'write',
    );
  }

  /** The projects recorded by {@link markPurged} and not yet settled, oldest first. */
  async purgedIds(): Promise<string[]> {
    const rs = await this.client.execute({ sql: 'SELECT project FROM purged ORDER BY at, project LIMIT ?', args: [this.purgedMax] });
    return rs.rows.map((r) => str(r.project));
  }

  /** Drops the purge record of `project` (its statistics are gone, or it turned out to exist after all). */
  async unmarkPurged(project: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM purged WHERE project = ?', args: [project] });
  }

  /** Today's remembered visitor ids per project, in the order they were seen (see the `seen` table). */
  async loadSeen(day: string): Promise<Map<string, number[]>> {
    const rs = await this.client.execute({ sql: 'SELECT project, ids FROM seen WHERE day = ? ORDER BY rowid', args: [day] });
    const out = new Map<string, number[]>();
    for (const row of rs.rows) {
      const bytes = bytesOf(row.ids);
      if (!bytes || bytes.byteLength % 4 !== 0) continue;
      const project = str(row.project);
      let ids = out.get(project);
      if (!ids) out.set(project, (ids = []));
      // Copy into an aligned buffer: the driver's view may start at any offset.
      for (const id of new Uint32Array(Uint8Array.from(bytes).buffer)) ids.push(id);
    }
    return out;
  }

  /**
   * The breakdowns for one project and range (the engine zero-fills the days and adds `enabled` and the breakdown's
   * start). `totals` is there only under a filter (see {@link StatsBreakdownTotals}).
   */
  async query(
    project: string,
    q: StatsQuery,
  ): Promise<Omit<SiteStats, 'enabled' | 'daily' | 'breakdown'> & { daily: SiteStats['daily']; totals?: StatsBreakdownTotals }> {
    const range = 'project = ? AND day >= ? AND day <= ?';
    const base: InValue[] = [project, q.from, q.to];
    const filtered = Boolean(q.device || q.country);
    // The filters: device and/or country, on everything that was counted with them. Each breakdown drops its OWN
    // dimension's filter, so the device list under a country filter still shows every device (and vice versa) —
    // that is what makes it a filter you can switch, not a dead end. Bots have a country but no device.
    const filter = (skip?: 'device' | 'country'): { sql: string; args: InValue[] } => {
      const parts: string[] = [];
      const args: InValue[] = [];
      if (q.device && skip !== 'device') {
        parts.push('device = ?');
        args.push(q.device);
      }
      if (q.country && skip !== 'country') {
        parts.push('country = ?');
        args.push(q.country);
      }
      return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', args };
    };
    const all = filter();
    const exceptDevice = filter('device');
    const exceptCountry = filter('country');
    // Bots: the country filter only (a bot has no device class).
    const bot = filter('device');
    // Pages, sources and goals: the exact tables unfiltered; the breakdown tables under a filter.
    const lists: InStatement[] = filtered
      ? [
          { sql: `SELECT path, SUM(views) AS v, 0 AS b FROM page_dims WHERE ${range}${all.sql} GROUP BY path ORDER BY v DESC LIMIT ${LIST_LIMIT}`, args: [...base, ...all.args] },
          { sql: `SELECT source, host, SUM(visitors) AS u FROM source_dims WHERE ${range}${all.sql} GROUP BY source, host ORDER BY u DESC LIMIT ${LIST_LIMIT}`, args: [...base, ...all.args] },
          { sql: `SELECT goal, SUM(count) AS c FROM goal_dims WHERE ${range}${all.sql} GROUP BY goal ORDER BY c DESC LIMIT ${LIST_LIMIT}`, args: [...base, ...all.args] },
          // What those lists add up to, and what they should: see StatsBreakdownTotals.
          { sql: `SELECT COALESCE(SUM(views), 0) AS n FROM page_dims WHERE ${range}${all.sql}`, args: [...base, ...all.args] },
          { sql: `SELECT COALESCE(SUM(visitors), 0) AS n FROM source_dims WHERE ${range}${all.sql}`, args: [...base, ...all.args] },
          { sql: `SELECT COALESCE(SUM(count), 0) AS n FROM goals WHERE ${range}`, args: base },
          { sql: `SELECT COALESCE(SUM(count), 0) AS n FROM goal_dims WHERE ${range}`, args: base },
        ]
      : [
          { sql: `SELECT path, SUM(views) AS v, SUM(bot_views) AS b FROM pages WHERE ${range} GROUP BY path ORDER BY v DESC, b DESC LIMIT ${LIST_LIMIT}`, args: base },
          { sql: `SELECT source, host, SUM(visitors) AS u FROM sources WHERE ${range} GROUP BY source, host ORDER BY u DESC LIMIT ${LIST_LIMIT}`, args: base },
          { sql: `SELECT goal, SUM(count) AS c FROM goals WHERE ${range} GROUP BY goal ORDER BY c DESC LIMIT ${LIST_LIMIT}`, args: base },
        ];
    const [human, bots, daily, devices, countries, botClasses, pages, sources, goals, pageDimViews, sourceDimVisitors, goalsAll, goalDimsAll] = await this.client.batch(
      [
        { sql: `SELECT COALESCE(SUM(views), 0) AS v, COALESCE(SUM(visitors), 0) AS u FROM traffic WHERE ${range} AND class = 'human'${all.sql}`, args: [...base, ...all.args] },
        { sql: `SELECT COALESCE(SUM(views), 0) AS v FROM traffic WHERE ${range} AND class <> 'human'${bot.sql}`, args: [...base, ...bot.args] },
        {
          sql: `SELECT day,
                  SUM(CASE WHEN class = 'human'${all.sql} THEN views ELSE 0 END) AS v,
                  SUM(CASE WHEN class = 'human'${all.sql} THEN visitors ELSE 0 END) AS u,
                  SUM(CASE WHEN class <> 'human'${bot.sql} THEN views ELSE 0 END) AS b
                FROM traffic WHERE ${range} GROUP BY day ORDER BY day`,
          args: [...all.args, ...all.args, ...bot.args, ...base],
        },
        { sql: `SELECT device, SUM(views) AS v, SUM(visitors) AS u FROM traffic WHERE ${range} AND class = 'human'${exceptDevice.sql} GROUP BY device ORDER BY u DESC, v DESC`, args: [...base, ...exceptDevice.args] },
        { sql: `SELECT country, SUM(views) AS v, SUM(visitors) AS u FROM traffic WHERE ${range} AND class = 'human'${exceptCountry.sql} GROUP BY country ORDER BY u DESC, v DESC LIMIT ${COUNTRY_LIMIT}`, args: [...base, ...exceptCountry.args] },
        { sql: `SELECT class, SUM(views) AS v FROM traffic WHERE ${range} AND class <> 'human'${bot.sql} GROUP BY class ORDER BY v DESC`, args: [...base, ...bot.args] },
        ...lists,
      ],
      'read',
    );
    const out = {
      from: q.from,
      to: q.to,
      human: { views: num(human!.rows[0]?.v), visitors: num(human!.rows[0]?.u) },
      botViews: num(bots!.rows[0]?.v),
      daily: daily!.rows.map((r) => ({ day: str(r.day), views: num(r.v), visitors: num(r.u), botViews: num(r.b) })),
      devices: devices!.rows.map((r) => ({ device: str(r.device) as StatsDevice, views: num(r.v), visitors: num(r.u) })),
      countries: countries!.rows.map((r) => ({ country: str(r.country), views: num(r.v), visitors: num(r.u) })),
      bots: botClasses!.rows.map((r) => ({ class: str(r.class) as Exclude<StatsClass, 'human'>, views: num(r.v) })),
      pages: pages!.rows.map((r) => ({ path: str(r.path), views: num(r.v), botViews: num(r.b) })),
      sources: sources!.rows.map((r) => ({ source: str(r.source) as StatsSource, host: str(r.host), visitors: num(r.u) })),
      goals: goals!.rows.map((r) => ({ goal: str(r.goal), label: str(r.goal), count: num(r.c) })),
    };
    if (!filtered) return out;
    return {
      ...out,
      totals: {
        pageViews: num(pageDimViews!.rows[0]?.n),
        sourceVisitors: num(sourceDimVisitors!.rows[0]?.n),
        goals: num(goalsAll!.rows[0]?.n),
        goalsBrokenDown: num(goalDimsAll!.rows[0]?.n),
      },
    };
  }

  /** One table's rows for the range, as CSV-ready records (header first). */
  async rows(project: string, table: StatsTable, from: string, to: string): Promise<string[][]> {
    const columns: Record<StatsTable, string[]> = {
      traffic: ['day', 'class', 'device', 'country', 'views', 'visitors'],
      pages: ['day', 'path', 'views', 'bot_views'],
      sources: ['day', 'source', 'host', 'visitors'],
      goals: ['day', 'goal', 'count'],
    };
    // eslint-disable-next-line security/detect-object-injection -- table is a closed union
    const cols = columns[table];
    const rs = await this.client.execute({
      // table + columns are closed constants
      sql: `SELECT ${cols.join(', ')} FROM ${table} WHERE project = ? AND day >= ? AND day <= ? ORDER BY ${cols.slice(0, -1).join(', ')} LIMIT ${CSV_ROW_LIMIT}`,
      args: [project, from, to],
    });
    // eslint-disable-next-line security/detect-object-injection -- c is one of the constant column names
    return [cols, ...rs.rows.map((r) => cols.map((c) => str(r[c])))];
  }
}

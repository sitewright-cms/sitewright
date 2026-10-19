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
];

const DATA_TABLES = ['traffic', 'pages', 'sources', 'goals'] as const;

export interface TrafficRow { project: string; day: string; cls: StatsClass; device: StatsDevice | ''; country: string; views: number; visitors: number }
export interface PageRow { project: string; day: string; path: string; views: number; botViews: number }
export interface SourceRow { project: string; day: string; source: StatsSource; host: string; visitors: number }
export interface GoalRow { project: string; day: string; goal: string; count: number }
export interface SeenRow { project: string; day: string; ids: number[] }

/** One flush worth of increments. */
export interface StatsDelta {
  traffic: TrafficRow[];
  pages: PageRow[];
  sources: SourceRow[];
  goals: GoalRow[];
  /** Visitor ids first seen since the last flush. */
  seen: SeenRow[];
}

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
  private constructor(private readonly client: Client) {}

  /** Opens (creating when absent) the statistics database at a libsql URL — `:memory:` for tests. */
  static async open(url: string): Promise<StatsStore> {
    const client = createClient({ url });
    // Same posture as the main database (see db/client.ts); WAL is a no-op for `:memory:`.
    await client.executeMultiple('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    await client.batch(SCHEMA, 'write');
    return new StatsStore(client);
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
    ];
    if (stmts.length) await this.client.batch(stmts, 'write');
  }

  /** Drops everything older than the retention window, and salts and visitor ids from before `today`. */
  async prune(today: string, keepFrom: string, saltKeepFrom: string): Promise<void> {
    await this.client.batch(
      [
        ...DATA_TABLES.map((t) => ({ sql: `DELETE FROM ${t} WHERE day < ?`, args: [keepFrom] })),
        { sql: 'DELETE FROM salts WHERE day < ?', args: [saltKeepFrom] },
        { sql: 'DELETE FROM seen WHERE day < ?', args: [today] },
      ],
      'write',
    );
  }

  /** Deletes every statistic of a project (it was deleted for good). */
  async forget(project: string): Promise<void> {
    await this.client.batch(
      [...DATA_TABLES, 'seen'].map((t) => ({ sql: `DELETE FROM ${t} WHERE project = ?`, args: [project] })),
      'write',
    );
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

  /** The breakdowns for one project and range (the engine zero-fills the days and adds `enabled`). */
  async query(project: string, q: StatsQuery): Promise<Omit<SiteStats, 'enabled' | 'daily'> & { daily: SiteStats['daily'] }> {
    const range = 'project = ? AND day >= ? AND day <= ?';
    const base: InValue[] = [project, q.from, q.to];
    // The human filters: device and/or country. Each breakdown drops its OWN dimension's filter, so the device
    // list under a country filter still shows every device (and vice versa) — that is what makes it a filter
    // you can switch, not a dead end.
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
    const [human, bots, daily, devices, countries, botClasses, pages, sources, goals] = await this.client.batch(
      [
        { sql: `SELECT COALESCE(SUM(views), 0) AS v, COALESCE(SUM(visitors), 0) AS u FROM traffic WHERE ${range} AND class = 'human'${all.sql}`, args: [...base, ...all.args] },
        { sql: `SELECT COALESCE(SUM(views), 0) AS v FROM traffic WHERE ${range} AND class <> 'human'`, args: base },
        {
          sql: `SELECT day,
                  SUM(CASE WHEN class = 'human'${all.sql} THEN views ELSE 0 END) AS v,
                  SUM(CASE WHEN class = 'human'${all.sql} THEN visitors ELSE 0 END) AS u,
                  SUM(CASE WHEN class <> 'human' THEN views ELSE 0 END) AS b
                FROM traffic WHERE ${range} GROUP BY day ORDER BY day`,
          args: [...all.args, ...all.args, ...base],
        },
        { sql: `SELECT device, SUM(views) AS v, SUM(visitors) AS u FROM traffic WHERE ${range} AND class = 'human'${exceptDevice.sql} GROUP BY device ORDER BY u DESC, v DESC`, args: [...base, ...exceptDevice.args] },
        { sql: `SELECT country, SUM(views) AS v, SUM(visitors) AS u FROM traffic WHERE ${range} AND class = 'human'${exceptCountry.sql} GROUP BY country ORDER BY u DESC, v DESC LIMIT ${COUNTRY_LIMIT}`, args: [...base, ...exceptCountry.args] },
        { sql: `SELECT class, SUM(views) AS v FROM traffic WHERE ${range} AND class <> 'human' GROUP BY class ORDER BY v DESC`, args: base },
        { sql: `SELECT path, SUM(views) AS v, SUM(bot_views) AS b FROM pages WHERE ${range} GROUP BY path ORDER BY v DESC, b DESC LIMIT ${LIST_LIMIT}`, args: base },
        { sql: `SELECT source, host, SUM(visitors) AS u FROM sources WHERE ${range} GROUP BY source, host ORDER BY u DESC LIMIT ${LIST_LIMIT}`, args: base },
        { sql: `SELECT goal, SUM(count) AS c FROM goals WHERE ${range} GROUP BY goal ORDER BY c DESC LIMIT ${LIST_LIMIT}`, args: base },
      ],
      'read',
    );
    return {
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

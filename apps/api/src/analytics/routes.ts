import { BlockList } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parse as secureJsonParse } from 'secure-json-parse';
import { shiftStatsDay, statsDay, statsRetentionStart, StatsQuerySchema, StatsDaySchema, type SiteStats } from '@sitewright/schema';
import type { ApiKeyCapability } from '../db/schema.js';
import type { ProjectContext } from '../repo/context.js';
import type { StatsEngine } from './engine.js';
import { STATS_TABLES, type StatsTable } from './store.js';
import { verifyStatsRouteToken } from './token.js';

/**
 * The built-in statistics' HTTP surface:
 *
 *   POST /a/:projectId              the PUBLIC collector a published page's tracker beacons to
 *   GET  /projects/:id/stats         the breakdowns for a range (Statistics tab, agent tool)
 *   GET  /projects/:id/stats.csv     one table's daily rows, for a spreadsheet
 */

/** What the collector needs to know about a site, cached briefly by the caller. */
export interface StatsSiteConfig {
  enabled: boolean;
  /**
   * Hosts the site is served from by THIS platform (its `<slug>.<sitesDomain>`, its verified custom domains,
   * the app host for the path form). A bot there was already counted when the page was served.
   */
  platformHosts: ReadonlySet<string>;
  /** Every host that is the site's own: the platform hosts plus the configured site URL's. */
  ownHosts: ReadonlySet<string>;
  /**
   * Whether to count only pageviews from {@link ownHosts}. On when the site has a site URL — the address it is
   * deployed at is then known, and a copy of the pages running elsewhere (or a local test) is not counted.
   */
  restrictToOwnHosts: boolean;
}

export interface StatsRouteDeps {
  engine: StatsEngine;
  siteConfig: (projectId: string) => Promise<StatsSiteConfig | null>;
  resolveProject: (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; slug: string } }>;
  /** form id → form name, for the goals list. */
  formNames: (ctx: ProjectContext, projectId: string) => Promise<ReadonlyMap<string, string>>;
  /** Something the owner should know about how their visits are counted (see {@link SiteStats.notice}). */
  notice: (ctx: ProjectContext, projectId: string) => Promise<SiteStats['notice']>;
  /** Whether a trusted reverse proxy is configured (`TRUST_PROXY`), i.e. whether `req.ip` is the visitor. */
  trustProxy: boolean;
  /** Logs once, the first time visits arrive through what looks like an untrusted proxy. */
  warn: (message: string) => void;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// eslint-disable-next-line security/detect-unsafe-regex -- one bounded class then a literal: linear in the (1 KB-capped) input
const ROUTE_RE = /^\/(?:[^\s?#]{0,510}\/)?$/;
/** The collector's body cap: the payload is a few short fields. */
export const STATS_BODY_LIMIT = 1024;
/** The longest range a query may ask for: the retention window, plus slack for month lengths. */
const MAX_RANGE_DAYS = 800;

/** Loopback and private ranges: a visitor "from" one of these is a proxy, or the operator's own machine. */
const PRIVATE = new BlockList();
for (const [net, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  try {
    return v4.includes(':') ? PRIVATE.check(v4, 'ipv6') : PRIVATE.check(v4, 'ipv4');
  } catch {
    return false;
  }
}

/** `www.` is the same site. */
export const bareHost = (h: string): string => h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

interface Beacon {
  r: string;
  k: string;
  h?: string;
  f?: string;
  u?: string;
  m?: boolean;
  t?: boolean;
  w?: boolean;
}

/** The tracker's payload, or null when it is not one. */
export function parseBeacon(body: unknown): Beacon | null {
  let raw: unknown = body;
  if (typeof body === 'string') {
    try {
      raw = secureJsonParse(body);
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const optStr = (v: unknown, max: number): string | undefined | null =>
    v === undefined ? undefined : typeof v === 'string' && v.length <= max ? v : null;
  const flag = (v: unknown): boolean | null => (v === undefined ? false : v === 1 ? true : null);
  if (typeof o.r !== 'string' || !ROUTE_RE.test(o.r) || typeof o.k !== 'string' || o.k.length > 64) return null;
  const h = optStr(o.h, 253);
  const f = optStr(o.f, 253);
  const u = optStr(o.u, 64);
  const m = flag(o.m);
  const t = flag(o.t);
  const w = flag(o.w);
  if (h === null || f === null || u === null || m === null || t === null || w === null) return null;
  return { r: o.r, k: o.k, h, f, u, m, t, w };
}

/** RFC 4180 CSV, with spreadsheet formula injection neutralized. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (v: string): string => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Validates and clamps a range query; returns an error message for a 400 instead. */
function rangeOf(from: string, to: string, today: string): { from: string; to: string } | string {
  if (from > to) return '`from` is after `to`';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days)) return 'not a valid date';
  if (days > MAX_RANGE_DAYS) return `a range is at most ${MAX_RANGE_DAYS} days`;
  // Nothing older than the retention window exists, and nothing after tomorrow (a viewer ahead of UTC).
  const keepFrom = statsRetentionStart(today);
  const latest = shiftStatsDay(today, 1);
  return { from: from < keepFrom ? keepFrom : from, to: to > latest ? latest : to };
}

export function registerStatsRoutes(app: FastifyInstance, deps: StatsRouteDeps): void {
  const { engine, siteConfig, resolveProject, formNames, notice, trustProxy, warn, rl } = deps;
  let warnedProxy = false;

  const cors = (reply: FastifyReply): void => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-methods', 'POST, OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-max-age', '600');
  };

  // A text/plain beacon needs no preflight; this answers a client that sends one anyway. Both collector routes log
  // at `warn` only: Fastify's per-request lines carry the client address, and a log of every pageview's IP is
  // exactly the record the statistics promise not to keep.
  app.options('/a/:projectId', { config: rl(60), logLevel: 'warn' }, async (_req, reply) => {
    cors(reply);
    return reply.code(204).send();
  });

  // ★ PUBLIC. Every outcome that depends on the site — unknown project, statistics off, a forged route, a
  // foreign host — answers the same 204, so the endpoint is no oracle for which sites count or what their
  // pages are. Only a body that is not a tracker payload at all gets a 400.
  app.post<{ Params: { projectId: string } }>(
    '/a/:projectId',
    { config: rl(120), bodyLimit: STATS_BODY_LIMIT, logLevel: 'warn' },
    async (req, reply) => {
      cors(reply);
      reply.header('cache-control', 'no-store');
      const beacon = parseBeacon(req.body);
      if (!beacon) return reply.code(400).send({ error: 'not a statistics beacon' });
      const { projectId } = req.params;
      if (!PROJECT_ID_RE.test(projectId)) return reply.code(204).send();
      // The signature FIRST: it costs two HMACs and no I/O, and a stranger cannot forge one — so a flood of
      // made-up project ids or routes never reaches the database or the per-site cache.
      if (!verifyStatsRouteToken(engine.projectKey(projectId), beacon.r, beacon.k)) return reply.code(204).send();
      const cfg = await siteConfig(projectId);
      if (!cfg?.enabled) return reply.code(204).send();
      const host = beacon.h ? bareHost(beacon.h) : '';
      // A page opened from a file, or a copy running on somebody else's host, is not a visit to the site.
      if (!host || (cfg.restrictToOwnHosts && !cfg.ownHosts.has(host))) return reply.code(204).send();
      const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
      // A crawler on a page this platform served was counted when the page was served; its beacon (from one of
      // the few crawlers that run scripts) would count it twice. "Served here" is a platform host of the site,
      // or the very host this beacon arrived on (a root-relative beacon from a page on the same origin).
      const arrivedOn = bareHost((req.headers.host ?? '').replace(/:\d+$/, ''));
      if ((cfg.platformHosts.has(host) || host === arrivedOn) && engine.isKnownBot(ua)) return reply.code(204).send();
      if (!trustProxy && !warnedProxy && isPrivateAddress(req.ip)) {
        warnedProxy = true;
        warn(
          'statistics: visits are arriving from a private address and TRUST_PROXY is off — behind a reverse proxy every visitor then looks like the proxy (one visitor, one country, one rate-limit bucket). Set TRUST_PROXY.',
        );
      }
      engine.record({
        projectId,
        route: beacon.r,
        ua,
        ip: req.ip,
        chMobile: req.headers['sec-ch-ua-mobile'] === '?1',
        mobileHint: beacon.m,
        touch: beacon.t,
        webdriver: beacon.w,
        ...(beacon.f ? { referrerHost: beacon.f } : {}),
        ...(beacon.u ? { campaign: beacon.u } : {}),
        isOwnHost: (h) => cfg.ownHosts.has(bareHost(h)),
      });
      return reply.code(204).send();
    },
  );

  type RangeReq = FastifyRequest<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>;

  app.get('/projects/:projectId/stats', { config: rl(60) }, async (req: RangeReq, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:read');
    const parsed = StatsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid query' });
    const range = rangeOf(parsed.data.from, parsed.data.to, statsDay());
    if (typeof range === 'string') return reply.code(400).send({ error: range });
    const cfg = await siteConfig(project.id);
    const stats = await engine.query(project.id, { ...parsed.data, ...range }, cfg?.enabled === true);
    const note = cfg?.enabled ? await notice(ctx, project.id).catch(() => undefined) : undefined;
    if (note) stats.notice = note;
    if (stats.goals.length) {
      const names = await formNames(ctx, project.id).catch(() => new Map<string, string>());
      stats.goals = stats.goals.map((g) => ({ ...g, label: g.goal.startsWith('form:') ? (names.get(g.goal.slice(5)) ?? 'Deleted form') : g.goal }));
    }
    reply.header('cache-control', 'no-store');
    return reply.send(stats);
  });

  app.get('/projects/:projectId/stats.csv', { config: rl(20) }, async (req: RangeReq, reply) => {
    const { project } = await resolveProject(req, 'content:read');
    const q = req.query ?? {};
    const from = StatsDaySchema.safeParse(q.from);
    const to = StatsDaySchema.safeParse(q.to);
    if (!from.success || !to.success) return reply.code(400).send({ error: 'from and to are days, YYYY-MM-DD' });
    const table = (q.table ?? 'traffic') as StatsTable;
    if (!STATS_TABLES.includes(table)) return reply.code(400).send({ error: `table is one of ${STATS_TABLES.join(', ')}` });
    const range = rangeOf(from.data, to.data, statsDay());
    if (typeof range === 'string') return reply.code(400).send({ error: range });
    const rows = await engine.rows(project.id, table, range.from, range.to);
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="statistics-${project.slug}-${table}-${range.from}-${range.to}.csv"`)
      .type('text/csv; charset=utf-8')
      .send(toCsv(rows));
  });
}

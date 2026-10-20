import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  RANK_KEYWORDS_PER_PROJECT_MAX,
  RankingsQuerySchema,
  RankKeywordPatchSchema,
  RankKeywordsInputSchema,
  RankProjectSettingsInputSchema,
  RankProviderIdSchema,
  RankTrackingAdminInputSchema,
  type ProjectRankings,
  type RankKeywordView,
  type RankProviderId,
  type RankProviderView,
  type RankTrackingAdminView,
} from '@sitewright/schema';
import type { z } from 'zod';
import type { ProjectContext } from '../repo/context.js';
import { RankProviderError, type RankProvider, type RankProviderIo } from './providers/index.js';
import { shiftDay, utcDay, type RankRepository } from './repo.js';
import type { RankTracker } from './tracker.js';

/**
 * Rank tracking's HTTP surface.
 *
 *   GET    /projects/:id/rankings                      the results — anyone who can read the project
 *   PUT    /projects/:id/rankings/settings             domain, schedule, depth — agency staff
 *   POST   /projects/:id/rankings/keywords             add keywords — agency staff
 *   PATCH  /projects/:id/rankings/keywords/:keywordId  pause / resume — agency staff
 *   DELETE /projects/:id/rankings/keywords/:keywordId  remove, with its history — agency staff
 *   POST   /projects/:id/rankings/check                check now — agency staff
 *   GET    /rank-tracking/locations                    the location picker — agency staff
 *   GET    /admin/rank-tracking                        provider, budget, spend — instance admin
 *   PUT    /admin/rank-tracking                        the same, and credentials — instance admin
 *   POST   /admin/rank-tracking/test                   try a provider's credentials — instance admin
 *
 * ★ Every write is SESSION-ONLY agency staff: a client (a project `member`, or an owner without a platform role)
 * only reads, and no token — not even an admin's — changes what is tracked or spent.
 */

export interface RankRouteDeps {
  repo: RankRepository;
  tracker: RankTracker;
  providers: Readonly<Record<RankProviderId, RankProvider>>;
  io: RankProviderIo;
  resolveProject: (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    access: 'content:read' | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  requireInstanceAdmin: (req: FastifyRequest) => Promise<string>;
  /** Session-only agency staff (admin or developer); `action` completes the refusal. */
  requirePlatformStaff: (req: FastifyRequest, action: string) => Promise<string>;
  /** The caller's platform role when it is an interactive session, else null. */
  sessionPlatformRole: (req: FastifyRequest) => Promise<'admin' | 'developer' | null>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** The longest range a read may ask for. */
const MAX_RANGE_DAYS = 800;
const DEFAULT_RANGE_DAYS = 90;

const firstIssue = (err: z.ZodError): string => {
  const issue = err.issues[0];
  return issue ? (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message) : 'invalid request';
};

const daysBetween = (from: string, to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** A project's rankings for a range, as every reader sees them. Shared with the agent tool. */
export async function projectRankings(
  repo: RankRepository,
  projectId: string,
  range: { from: string; to: string },
): Promise<Omit<ProjectRankings, 'canManage' | 'status'>> {
  const [tracking, keywords, history, latest, inFlight] = await Promise.all([
    repo.getProject(projectId),
    repo.listKeywords(projectId),
    repo.history(projectId, range.from, range.to),
    repo.latestTwo(projectId),
    repo.inFlight(projectId),
  ]);
  const seriesOf = new Map<string, Array<{ day: string; position: number | null }>>();
  for (const h of history) {
    const list = seriesOf.get(h.keywordId) ?? [];
    list.push({ day: h.day, position: h.position });
    seriesOf.set(h.keywordId, list);
  }
  const views = keywords.map((k): RankKeywordView => {
    const series = seriesOf.get(k.id) ?? [];
    const [last, before] = latest.get(k.id) ?? [];
    const positions = series.map((p) => p.position).filter((p): p is number => p !== null);
    return {
      id: k.id,
      keyword: k.keyword,
      engine: k.engine,
      device: k.device,
      location: { name: k.locationName, countryCode: k.countryCode },
      languageCode: k.languageCode,
      paused: k.paused,
      latest: last
        ? { day: last.day, checkedAt: last.checkedAt.toISOString(), position: last.position, url: last.url, depth: last.depth }
        : null,
      change: last?.position != null && before?.position != null ? before.position - last.position : null,
      best: positions.length ? Math.min(...positions) : null,
      series,
      pending: inFlight.has(k.id),
    };
  });
  return { from: range.from, to: range.to, tracking, keywords: views };
}

/** The range of a read: `from`/`to` as given, defaulting to the last 90 days. A string is the refusal. */
export function rankingsRange(query: unknown, today: string): { from: string; to: string } | string {
  const parsed = RankingsQuerySchema.safeParse(query ?? {});
  if (!parsed.success) return 'from and to are days, YYYY-MM-DD';
  const to = parsed.data.to ?? today;
  const from = parsed.data.from ?? shiftDay(to, -(DEFAULT_RANGE_DAYS - 1));
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) return 'from and to are days, YYYY-MM-DD';
  if (from > to) return 'from is after to';
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return `a range is at most ${MAX_RANGE_DAYS} days`;
  return { from, to };
}

export function registerRankRoutes(app: FastifyInstance, deps: RankRouteDeps): void {
  const { repo, tracker, providers, io, resolveProject, requireInstanceAdmin, requirePlatformStaff, sessionPlatformRole, rl } = deps;

  /** Agency staff with access to THIS project, in an interactive session. */
  const staffOnProject = async (req: FastifyRequest<{ Params: { projectId: string } }>): Promise<ProjectContext> => {
    await requirePlatformStaff(req, 'change keyword tracking');
    return (await resolveProject(req, 'session-only')).ctx;
  };

  const readView = async (req: FastifyRequest<{ Params: { projectId: string } }>, range: { from: string; to: string }): Promise<ProjectRankings> => {
    const { project } = await resolveProject(req, 'content:read');
    const role = await sessionPlatformRole(req);
    const base = await projectRankings(repo, project.id, range);
    return role ? { ...base, canManage: true, status: await tracker.status() } : { ...base, canManage: false };
  };

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string> }>(
    '/projects/:projectId/rankings',
    { config: rl(60) },
    async (req, reply) => {
      const range = rankingsRange(req.query, utcDay(new Date()));
      if (typeof range === 'string') return reply.code(400).send({ error: range });
      return reply.send(await readView(req, range));
    },
  );

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/rankings/settings', { config: rl(30) }, async (req, reply) => {
    const ctx = await staffOnProject(req);
    const parsed = RankProjectSettingsInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    await repo.putProject(ctx.projectId, parsed.data);
    return reply.send({ tracking: await repo.getProject(ctx.projectId) });
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/rankings/keywords', { config: rl(30) }, async (req, reply) => {
    const ctx = await staffOnProject(req);
    const parsed = RankKeywordsInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    if (!(await repo.getProject(ctx.projectId))) {
      return reply.code(409).send({ error: 'set the domain to track first' });
    }
    const existing = await repo.countKeywords(ctx.projectId);
    if (existing + new Set(parsed.data.keywords).size > RANK_KEYWORDS_PER_PROJECT_MAX) {
      return reply.code(400).send({ error: `a project tracks at most ${RANK_KEYWORDS_PER_PROJECT_MAX} keywords` });
    }
    const result = await repo.addKeywords(ctx.projectId, parsed.data);
    return reply.code(201).send(result);
  });

  app.patch<{ Params: { projectId: string; keywordId: string } }>(
    '/projects/:projectId/rankings/keywords/:keywordId',
    { config: rl(60) },
    async (req, reply) => {
      const ctx = await staffOnProject(req);
      const parsed = RankKeywordPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
      if (!(await repo.setPaused(ctx.projectId, req.params.keywordId, parsed.data.paused))) {
        return reply.code(404).send({ error: 'keyword not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { projectId: string; keywordId: string } }>(
    '/projects/:projectId/rankings/keywords/:keywordId',
    { config: rl(60) },
    async (req, reply) => {
      const ctx = await staffOnProject(req);
      if (!(await repo.removeKeyword(ctx.projectId, req.params.keywordId))) return reply.code(404).send({ error: 'keyword not found' });
      return reply.send({ ok: true });
    },
  );

  // Spends money: a low limit, and the tracker still checks each keyword at most once a day.
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/rankings/check', { config: rl(6) }, async (req, reply) => {
    const ctx = await staffOnProject(req);
    const report = await tracker.checkNow(ctx.projectId);
    return reply.send(report);
  });

  app.get<{ Querystring: { country?: string; q?: string } }>('/rank-tracking/locations', { config: rl(60) }, async (req, reply) => {
    await requirePlatformStaff(req, 'look up search locations');
    const country = String(req.query.country ?? '').toUpperCase();
    const q = String(req.query.q ?? '').slice(0, 100);
    if (!/^[A-Z]{2}$/.test(country)) return reply.code(400).send({ error: 'country is an ISO code such as NA' });
    const usable = await usableProvider();
    if (!usable) return reply.code(409).send({ error: 'no rank-tracking provider is set up yet' });
    try {
      return reply.send({ locations: await usable.provider.searchLocations(usable.creds, country, q, io) });
    } catch (err) {
      if (err instanceof RankProviderError) return reply.code(502).send({ error: err.message });
      throw err;
    }
  });

  /** The active provider with its credentials, else the first one that has credentials. */
  async function usableProvider(): Promise<{ provider: RankProvider; creds: Readonly<Record<string, string>> } | null> {
    const config = await repo.getConfig();
    const order = [config.activeProvider, ...RankProviderIdSchema.options].filter((p): p is RankProviderId => p !== null);
    for (const id of order) {
      const raw = await repo.getCredentials(id);
      if (!raw) continue;
      try {
        return { provider: providers[id], creds: providers[id].parseCredentials(raw) };
      } catch {
        // unusable — try the next one
      }
    }
    return null;
  }

  async function adminView(): Promise<RankTrackingAdminView> {
    const config = await repo.getConfig();
    const now = new Date();
    const [spent, totals] = await Promise.all([
      repo.spentMicrosSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      repo.totals(),
    ]);
    const views: RankProviderView[] = [];
    for (const id of RankProviderIdSchema.options) {
      const provider = providers[id];
      const stored = (await repo.getCredentials(id)) ?? {};
      const values: Record<string, string> = {};
      const secretsSet: Record<string, boolean> = {};
      for (const f of provider.fields) {
        const v = stored[f.key];
        if (f.type === 'secret') secretsSet[f.key] = typeof v === 'string' && v.length > 0;
        else if (typeof v === 'string') values[f.key] = v;
      }
      views.push({
        id,
        label: provider.label,
        signupUrl: provider.signupUrl,
        fields: [...provider.fields],
        configured: Object.keys(stored).length > 0,
        values,
        secretsSet,
      });
    }
    return {
      activeProvider: config.activeProvider,
      monthlyBudgetUsd: config.monthlyBudgetMicros / 1_000_000,
      spentThisMonthUsd: spent / 1_000_000,
      providers: views,
      projectsTracked: totals.projects,
      keywordsTracked: totals.keywords,
      lastError: config.lastError ? { message: config.lastError.message, at: config.lastError.at.toISOString() } : null,
    };
  }

  app.get('/admin/rank-tracking', { config: rl(60) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    return reply.send(await adminView());
  });

  app.put('/admin/rank-tracking', { config: rl(30) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const parsed = RankTrackingAdminInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const input = parsed.data;

    // Credentials first, so choosing a provider in the same request can rely on them.
    let credentialsChanged = false;
    for (const [id, fields] of Object.entries(input.credentials ?? {}) as Array<[RankProviderId, Record<string, string> | null]>) {
      const provider = providers[id];
      if (fields === null) {
        await repo.putCredentials(id, null);
        credentialsChanged = true;
        continue;
      }
      const known = new Map(provider.fields.map((f) => [f.key, f]));
      const unknown = Object.keys(fields).find((k) => !known.has(k));
      if (unknown) return reply.code(400).send({ error: `${provider.label} has no field "${unknown}"` });
      const stored = (await repo.getCredentials(id)) ?? {};
      const merged: Record<string, string> = {};
      for (const f of provider.fields) {
        const given = fields[f.key];
        // A secret left out (or sent empty) keeps the stored one: the form never shows it, so it never resends it.
        const value = f.type === 'secret' && !given ? stored[f.key] : given !== undefined ? given : stored[f.key];
        if (value !== undefined && value !== '') merged[f.key] = value;
      }
      let normalized: Readonly<Record<string, string>>;
      try {
        normalized = provider.parseCredentials(merged);
      } catch (err) {
        if (err instanceof RankProviderError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      await repo.putCredentials(id, { ...normalized });
      credentialsChanged = true;
    }

    if (input.activeProvider) {
      const raw = await repo.getCredentials(input.activeProvider);
      if (!raw) return reply.code(400).send({ error: `add the ${providers[input.activeProvider].label} credentials first` });
    }
    await repo.putConfig({
      ...(input.activeProvider !== undefined ? { activeProvider: input.activeProvider } : {}),
      ...(input.monthlyBudgetUsd !== undefined ? { monthlyBudgetMicros: Math.round(input.monthlyBudgetUsd * 1_000_000) } : {}),
    });
    // New credentials or a new provider deserve a fresh try: the old refusal no longer describes them.
    if (credentialsChanged || input.activeProvider !== undefined) await repo.setLastError(null);
    return reply.send(await adminView());
  });

  app.post('/admin/rank-tracking/test', { config: rl(10) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const parsed = RankProviderIdSchema.safeParse((req.body as { provider?: unknown } | undefined)?.provider);
    if (!parsed.success) return reply.code(400).send({ error: 'provider is required' });
    const provider = providers[parsed.data];
    const raw = await repo.getCredentials(parsed.data);
    if (!raw) return reply.send({ ok: false, error: `no ${provider.label} credentials are stored` });
    try {
      const { balanceUsd } = await provider.account(provider.parseCredentials(raw), io);
      const config = await repo.getConfig();
      if (config.activeProvider === parsed.data && config.lastError) await repo.setLastError(null);
      return reply.send({ ok: true, balanceUsd });
    } catch (err) {
      if (err instanceof RankProviderError) return reply.send({ ok: false, error: err.message });
      throw err;
    }
  });
}

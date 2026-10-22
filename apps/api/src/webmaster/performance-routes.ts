import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SEARCH_PERFORMANCE_PERIODS, WebmasterServiceSchema, type SearchPerformanceAvailability, type SearchPerformancePeriod, type SearchPerformanceView } from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { SearchPerformance } from './performance.js';
import { WebmasterError } from './request.js';

/**
 * A project's search numbers, for anyone who may read the project (the client too, and a read token) — the same as
 * its search rankings:
 *
 *   GET /projects/:projectId/search-performance/available              which search engines have data (no request out)
 *   GET /projects/:projectId/search-performance?service=google&days=28 the numbers
 *
 * 404 when the site has no data at that search engine (not switched on and verified in the Search engines tile);
 * 502 with the search engine's refusal, worded for the viewer.
 */

export interface SearchPerformanceRouteDeps {
  performance: SearchPerformance;
  resolveProject: (req: FastifyRequest<{ Params: { projectId: string } }>, access: 'content:read') => Promise<{ ctx: ProjectContext }>;
  /** The website's Production URL as saved (`website.siteUrl`). */
  siteUrlOf: (ctx: ProjectContext) => Promise<string | undefined>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

const NAME = { google: 'Google', bing: 'Bing' } as const;

export function registerSearchPerformanceRoutes(app: FastifyInstance, deps: SearchPerformanceRouteDeps): void {
  const { performance, resolveProject, siteUrlOf, rl } = deps;

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/search-performance/available', { config: rl(60) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:read');
    return reply.send((await performance.available(ctx.projectId, await siteUrlOf(ctx))) satisfies SearchPerformanceAvailability);
  });

  app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>(
    '/projects/:projectId/search-performance',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      const service = WebmasterServiceSchema.safeParse(req.query.service);
      if (!service.success) return reply.code(400).send({ error: 'service is google or bing' });
      const days = Number(req.query.days ?? 28) as SearchPerformancePeriod;
      if (!SEARCH_PERFORMANCE_PERIODS.includes(days)) return reply.code(400).send({ error: `days is one of ${SEARCH_PERFORMANCE_PERIODS.join(', ')}` });
      let view: SearchPerformanceView | null;
      try {
        view = await performance.view(ctx.projectId, await siteUrlOf(ctx), service.data, days);
      } catch (err) {
        if (err instanceof WebmasterError) return reply.code(502).send({ error: err.message });
        throw err;
      }
      if (!view) return reply.code(404).send({ error: `This site has no search data at ${NAME[service.data]} yet` });
      return reply.send(view satisfies SearchPerformanceView);
    },
  );
}

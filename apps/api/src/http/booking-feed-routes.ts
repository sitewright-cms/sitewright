import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BookingConfig } from '@sitewright/schema';
import type { ApiKeyCapability } from '../db/schema.js';
import type { ProjectContext } from '../repo/context.js';
import type { BookingClaimsRepository } from '../booking/claims.js';
import { FEED_LIMITS, FEED_TOKEN_RE, newFeedToken, renderBookingFeed, type BookingFeedRepository, type FeedRow } from '../booking/feed.js';
import type { EncryptedSecret } from '../crypto/secret.js';

/**
 * THE BUSINESS'S BOOKINGS AS A CALENDAR FEED.
 *
 *   GET    /projects/:projectId/booking/feed         the feed's address, if it is on
 *   POST   /projects/:projectId/booking/feed         switch it on, or give it a new address (the old one stops)
 *   DELETE /projects/:projectId/booking/feed         switch it off
 *   GET    /b/:projectId/feed/:token.ics             the feed itself, for a calendar app (`?resource=` for one resource)
 *
 * ★ The feed lists customers and their contacts, so its address is a credential: writers only (as for the
 * outside calendars), never cached anywhere, and the same 404 for a wrong token, another project's token and a
 * switched-off feed. ★ The address is on the base the published site calls the booking API at, so it reads as
 * the business's own where the site is hosted on its domain.
 */

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface BookingFeedDeps {
  feeds: BookingFeedRepository;
  claims: BookingClaimsRepository;
  readConfig: (projectId: string) => Promise<BookingConfig | null>;
  /** The project's name if it may be served publicly (exists, not deleted); null otherwise. */
  publicProject: (projectId: string) => Promise<{ name: string } | null>;
  encrypt: (plaintext: string) => EncryptedSecret;
  decrypt: (envelope: FeedRow['token']) => string;
  resolveProject: (req: ProjectReq, access: ApiKeyCapability | 'session-only') => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  /** The base the published site calls the booking API at. Empty: the address is on the request's own origin. */
  publicBase: () => string;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  now?: () => number;
}

const RESOURCE_RE = /^[a-z0-9-]{1,48}$/;

export function registerBookingFeedRoutes(app: FastifyInstance, deps: BookingFeedDeps): void {
  const now = deps.now ?? Date.now;
  const writer = async (req: ProjectReq, access: ApiKeyCapability) => {
    const { ctx, project } = await deps.resolveProject(req, access);
    return { project, ok: deps.isWriter(ctx) };
  };
  const view = (req: FastifyRequest, row: FeedRow) => {
    const base = deps.publicBase().replace(/\/+$/, '') || `${req.protocol}://${req.host}`;
    const url = `${base}/b/${row.projectId}/feed/${deps.decrypt(row.token)}.ics`;
    return {
      url,
      // The same address for a calendar that subscribes on a click (Apple Calendar, Outlook on the desktop).
      webcalUrl: url.replace(/^https?:/i, 'webcal:'),
      createdAt: row.createdAt.getTime(),
      lastFetchedAt: row.lastFetchedAt ? row.lastFetchedAt.getTime() : null,
    };
  };
  const forbidden = { error: 'insufficient role for this operation' };

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/booking/feed', { config: deps.rl(60) }, async (req, reply) => {
    // ★ content:WRITE to read it: the address opens every customer's details to anyone, so a key minted only to
    // read the project's content (a report, an integration) must not be able to hand it out.
    const { project, ok } = await writer(req, 'content:write');
    if (!ok) return reply.code(403).send(forbidden);
    reply.header('cache-control', 'no-store');
    const row = await deps.feeds.get(project.id);
    return reply.send({ feed: row ? view(req, row) : null });
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/booking/feed', { config: deps.rl(10), bodyLimit: 1024 }, async (req, reply) => {
    const { project, ok } = await writer(req, 'content:write');
    if (!ok) return reply.code(403).send(forbidden);
    const token = newFeedToken();
    const row = await deps.feeds.replace(project.id, token, deps.encrypt(token), now());
    reply.header('cache-control', 'no-store');
    return reply.code(201).send({ feed: view(req, row) });
  });

  app.delete<{ Params: { projectId: string } }>('/projects/:projectId/booking/feed', { config: deps.rl(10) }, async (req, reply) => {
    const { project, ok } = await writer(req, 'content:write');
    if (!ok) return reply.code(403).send(forbidden);
    if (!(await deps.feeds.remove(project.id))) return reply.code(404).send({ error: 'the feed is not on' });
    return reply.send({ ok: true });
  });

  // A calendar service fetches many businesses' feeds from one address (Google's do): limited per feed, not per caller.
  const feedLimit = {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
      // Capped: a path is the caller's to choose (the limiter's store is an LRU besides).
      keyGenerator: (req: FastifyRequest) => `booking-feed|${req.ip}|${((req.params as { projectId?: string }).projectId ?? '').slice(0, 64)}`,
    },
  };
  app.get<{ Params: { projectId: string; file: string }; Querystring: { resource?: string } }>(
    '/b/:projectId/feed/:file',
    { config: feedLimit },
    async (req, reply) => {
      const notFound = () => reply.code(404).header('cache-control', 'no-store').send({ error: 'not found' });
      const token = /^(.+)\.ics$/.exec(req.params.file)?.[1];
      if (!token || !FEED_TOKEN_RE.test(token) || req.params.projectId.length > 64) return notFound();
      const row = await deps.feeds.byToken(token);
      if (!row || row.projectId !== req.params.projectId) return notFound();
      const project = await deps.publicProject(row.projectId);
      if (!project) return notFound();
      const config = await deps.readConfig(row.projectId);
      const resourceId = typeof req.query.resource === 'string' ? req.query.resource : undefined;
      const resource = resourceId === undefined ? undefined : RESOURCE_RE.test(resourceId) ? config?.resources.find((r) => r.id === resourceId) : undefined;
      if (resourceId !== undefined && !resource) return notFound();
      const at = now();
      const claims = await deps.claims.forFeed(row.projectId, at - FEED_LIMITS.pastMs, at + FEED_LIMITS.aheadMs, at, FEED_LIMITS.maxEvents, resource?.id);
      void deps.feeds.touched(row.projectId, at).catch((err: unknown) => req.log.warn({ err }, 'could not record a booking feed fetch'));
      const text = renderBookingFeed({
        projectId: row.projectId,
        calendarName: resource ? `${project.name}: ${resource.name}` : `${project.name}: bookings`,
        config,
        claims,
        now: at,
      });
      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('content-disposition', 'inline; filename="bookings.ics"')
        // Customers' details: never in a shared cache, and nothing to index.
        .header('cache-control', 'private, no-store')
        .header('x-robots-tag', 'noindex, nofollow')
        .send(text);
    },
  );
}

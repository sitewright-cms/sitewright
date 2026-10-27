import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BookingConfig } from '@sitewright/schema';
import type { ApiKeyCapability } from '../db/schema.js';
import type { ProjectContext } from '../repo/context.js';
import type { BookingClaimsRepository, ClaimRow } from '../booking/claims.js';
import type { BookingEvent } from '../booking/notify.js';
import type { BookingMailRepository } from '../booking/outbox.js';
import type { AnswerResult, BookingService } from '../booking/service.js';

/**
 * THE BOOKINGS TAB's routes: the project's bookings and requests with their customers' details, and the
 * business's answers.
 *
 *   GET  /projects/:projectId/bookings?view=upcoming|requests|past
 *   POST /projects/:projectId/bookings/:id/accept     a request becomes a booking
 *   POST /projects/:projectId/bookings/:id/decline    a request is turned down, its time freed
 *   POST /projects/:projectId/bookings/:id/cancel     a booking or request is called off, until it ends
 *
 * Reading needs content:read, answering content:write: the same rule as the shop's orders, whose routes
 * carry customers' details too. Every answer queues the customer's mail (and the business's calendars').
 */

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface BookingAdminDeps {
  bookings: BookingService;
  claims: BookingClaimsRepository;
  mails: BookingMailRepository;
  readConfig: (projectId: string) => Promise<BookingConfig | null>;
  notify: (event: BookingEvent) => Promise<void>;
  /** A booking's signed reference, for the link in its confirmation. */
  reference: (projectId: string, claimId: string) => string;
  resolveProject: (req: ProjectReq, access: ApiKeyCapability | 'session-only') => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  now?: () => number;
}

/** How many one listing returns. A small business has far fewer upcoming; the total says when there are more. */
const LIST_LIMIT = 200;
const VIEWS = new Set(['upcoming', 'requests', 'past']);

const STATUS: Record<Exclude<AnswerResult, { ok: true }>['reason'], number> = {
  'unknown-claim': 404,
  lapsed: 409,
  invalid: 409,
  ended: 409,
  busy: 503,
};

/** One booking as the tab shows it, named from the set-up as it is now. */
function view(c: ClaimRow, config: BookingConfig | null): Record<string, unknown> {
  const offering = config?.offerings.find((o) => o.id === c.offeringId);
  const resource = config?.resources.find((r) => r.id === c.resourceId);
  return {
    id: c.id,
    state: c.state,
    offering: { id: c.offeringId, name: offering?.name ?? c.offeringId, mode: offering?.mode ?? null, ...(offering?.mode === 'days' ? { unit: offering.unit } : {}) },
    resource: { id: c.resourceId, name: resource?.name ?? c.resourceId },
    timeZone: resource?.timeZone ?? 'UTC',
    start: c.startAt.getTime(),
    end: c.endAt.getTime(),
    quantity: c.units,
    customer: c.customer,
    // A request's deadline: when it lapses unanswered.
    expiresAt: c.expiresAt ? c.expiresAt.getTime() : null,
    createdAt: c.createdAt.getTime(),
  };
}

export function registerBookingAdminRoutes(app: FastifyInstance, deps: BookingAdminDeps): void {
  const now = deps.now ?? Date.now;

  app.get<{ Params: { projectId: string }; Querystring: { view?: string } }>('/projects/:projectId/bookings', { config: deps.rl(120) }, async (req, reply) => {
    const { project } = await deps.resolveProject(req, 'content:read');
    const which = (req.query.view ?? 'upcoming') as 'upcoming' | 'requests' | 'past';
    if (!VIEWS.has(which)) return reply.code(400).send({ error: 'view is upcoming, requests or past' });
    const [config, listed, waiting, undelivered] = await Promise.all([
      deps.readConfig(project.id),
      deps.claims.list(project.id, which, now(), LIST_LIMIT),
      // The requests view already counts them.
      which === 'requests' ? null : deps.claims.list(project.id, 'requests', now(), 1),
      deps.mails.undelivered(project.id),
    ]);
    reply.header('cache-control', 'no-store');
    return reply.send({
      bookings: listed.rows.map((c) => view(c, config)),
      total: listed.total,
      // Shown on the tab whatever view is open: requests are what needs the business's attention.
      requests: waiting ? waiting.total : listed.total,
      undelivered,
    });
  });

  const answer = (path: 'accept' | 'decline' | 'cancel'): void => {
    app.post<{ Params: { projectId: string; id: string } }>(`/projects/:projectId/bookings/:id/${path}`, { config: deps.rl(60) }, async (req, reply) => {
      const { project } = await deps.resolveProject(req as unknown as ProjectReq, 'content:write');
      const id = req.params.id;
      if (id.length > 64) return reply.code(404).send({ error: 'there is no such booking' });
      const result =
        path === 'accept'
          ? await deps.bookings.accept(project.id, id)
          : path === 'decline'
            ? await deps.bookings.decline(project.id, id)
            : await deps.bookings.cancelByBusiness(project.id, id);
      if (!result.ok) return refuse(reply, result);
      const config = await deps.readConfig(project.id);
      const offering = config?.offerings.find((o) => o.id === result.claim.offeringId);
      if (config && offering) {
        void deps.notify({
          kind: path === 'accept' ? 'booked' : path === 'decline' ? 'declined' : 'cancelled',
          projectId: project.id,
          claim: result.claim,
          offering,
          config,
          by: 'business',
          // The confirmation links to the booking's own page, as a booking made at once does.
          ...(path === 'accept' ? { reference: deps.reference(project.id, result.claim.id) } : {}),
        });
      } else {
        req.log.warn({ projectId: project.id, offeringId: result.claim.offeringId }, 'booking answered without mails: its offering no longer exists');
      }
      return reply.send({ ok: true, booking: path === 'accept' ? view(result.claim, config) : null });
    });
  };
  answer('accept');
  answer('decline');
  answer('cancel');
}

function refuse(reply: FastifyReply, result: Exclude<AnswerResult, { ok: true }>): FastifyReply {
  if (result.reason === 'busy') reply.header('retry-after', '5');
  return reply.code(STATUS[result.reason]).send({ error: result.detail, reason: result.reason });
}

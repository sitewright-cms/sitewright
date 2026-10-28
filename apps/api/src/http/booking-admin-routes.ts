import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DEFAULT_PAY_WINDOW_MIN, type BookingConfig } from '@sitewright/schema';
import type { ApiKeyCapability } from '../db/schema.js';
import type { ProjectContext } from '../repo/context.js';
import type { BookingClaimsRepository, ClaimRow } from '../booking/claims.js';
import type { BookingEvent } from '../booking/notify.js';
import type { BookingMailRepository } from '../booking/outbox.js';
import type { AnswerResult, BookingService } from '../booking/service.js';
import { BookingCancelLock } from '../booking/cancel-lock.js';

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
  /**
   * A paid booking the business cancelled: its money back in full. Undefined when nothing was paid; `manual` when the
   * provider would not refund it, so the business must, from its dashboard.
   */
  refundCancelled?: (projectId: string, claimId: string) => Promise<'refunded' | 'manual' | undefined>;
  /** One cancellation of a booking at a time; shared with the customer's own (booking-routes.ts). */
  cancelLock?: BookingCancelLock;
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
    // A request's deadline: when it lapses unanswered (an accepted paid request's: when it lapses unpaid).
    expiresAt: c.expiresAt ? c.expiresAt.getTime() : null,
    // Paid for: a request accepted is paid by the customer before it is booked.
    ...(offering?.price ? { priced: true } : {}),
    // An accepted paid request waiting for its payment (the business may still withdraw it); any other hold is a
    // customer's checkout in progress.
    ...(c.state === 'hold' && offering?.price && offering.confirmation === 'request' ? { awaitingPayment: true } : {}),
    createdAt: c.createdAt.getTime(),
  };
}

export function registerBookingAdminRoutes(app: FastifyInstance, deps: BookingAdminDeps): void {
  const now = deps.now ?? Date.now;
  const lock = deps.cancelLock ?? new BookingCancelLock();

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
      // ★ A paid booking's money goes back FIRST: a crash between the two then leaves a booking standing (the business
      // sees it and cancels again, its refund already made), never a cancelled booking nobody refunds. Only for one
      // the cancellation will take: a booking (not a checkout in progress) that has not ended. One cancellation of a
      // booking at a time, the customer's included (the lock is shared).
      const cancel = async (): Promise<{ refund: 'refunded' | 'manual' | undefined; result: AnswerResult }> => {
        let refund: 'refunded' | 'manual' | undefined;
        const claim = await deps.claims.get(project.id, id);
        if (claim && claim.state !== 'hold' && claim.endAt.getTime() > now()) {
          refund = await deps.refundCancelled?.(project.id, id).catch((err: unknown) => {
            req.log.error({ err, projectId: project.id }, 'a cancelled booking could not be refunded');
            return 'manual' as const;
          });
        }
        return { refund, result: await deps.bookings.cancelByBusiness(project.id, id) };
      };
      // A PAID request accepted is held for the customer to pay, within its offering's window; any other is booked.
      const accept = async (): Promise<AnswerResult> => {
        const claim = await deps.claims.get(project.id, id);
        const offered = claim ? (await deps.readConfig(project.id))?.offerings.find((o) => o.id === claim.offeringId) : undefined;
        return deps.bookings.accept(project.id, id, offered?.price ? { payWithinMs: (offered.payWindowMin ?? DEFAULT_PAY_WINDOW_MIN) * 60_000 } : {});
      };
      const { refund, result } =
        path === 'accept'
          ? { refund: undefined, result: await accept() }
          : path === 'decline'
            ? { refund: undefined, result: await deps.bookings.decline(project.id, id) }
            : await lock.run(project.id, id, cancel);
      if (!result.ok) {
        // Refunded, yet not cancelled (a busy moment): the business is told both, and cancels again.
        if (refund) req.log.warn({ projectId: project.id, reason: result.reason, refund }, 'a booking was refunded but its cancellation was refused');
        return refund ? refuseRefunded(reply, result, refund) : refuse(reply, result);
      }
      const config = await deps.readConfig(project.id);
      const offering = config?.offerings.find((o) => o.id === result.claim.offeringId);
      if (config && offering) {
        // Accepted and paid for later: the customer is asked to pay, by its deadline, on the booking's own page.
        const toPay = path === 'accept' && result.claim.state === 'hold' && result.claim.expiresAt !== null;
        void deps.notify({
          kind: toPay ? 'accepted' : path === 'accept' ? 'booked' : path === 'decline' ? 'declined' : 'cancelled',
          projectId: project.id,
          claim: result.claim,
          offering,
          config,
          by: 'business',
          ...(refund ? { refund } : {}),
          ...(toPay ? { payBy: result.claim.expiresAt!.getTime() } : {}),
          // The confirmation (or the request to pay) links to the booking's own page, as a booking made at once does.
          ...(path === 'accept' ? { reference: deps.reference(project.id, result.claim.id) } : {}),
        });
      } else {
        req.log.warn({ projectId: project.id, offeringId: result.claim.offeringId }, 'booking answered without mails: its offering no longer exists');
      }
      return reply.send({ ok: true, booking: path === 'accept' ? view(result.claim, config) : null, ...(refund ? { refund } : {}) });
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

/** A refusal after the booking's money already went back: said, so the business does not refund it again by hand. */
function refuseRefunded(reply: FastifyReply, result: Exclude<AnswerResult, { ok: true }>, refund: 'refunded' | 'manual'): FastifyReply {
  if (result.reason === 'busy') reply.header('retry-after', '5');
  const money = refund === 'refunded' ? 'its payment has been refunded' : 'its refund could not be confirmed: check your payment provider’s dashboard';
  return reply.code(STATUS[result.reason]).send({ error: `${result.detail}; ${money}`, reason: result.reason, refund });
}

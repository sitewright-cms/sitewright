import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  FormFieldSchema,
  MIN_SUBMIT_ELAPSED_MS,
  minorUnitExponent,
  refundsInFull,
  validateFormSubmission,
  type BookingConfig,
  type BookingOffering,
  type CaptchaProvider,
} from '@sitewright/schema';
import type { Availability, BookingRequest } from '../booking/availability.js';
import { BOOKING_PAY_LIMITS, type BookingPayments } from '../booking/payments.js';
import { BookingCancelLock, PAID_CANCEL_MARGIN_MS } from '../booking/cancel-lock.js';
import { signBookingRef, verifyBookingRef } from '../booking/reference.js';
import type { BookingService, ClaimFailure } from '../booking/service.js';
import type { BookingEvent } from '../booking/notify.js';
import { DAY_MS } from '../booking/zoned.js';
import type { CaptchaVerifier } from '../mail/captcha.js';
import { createPowChallenge, powScope, verifyPowSolution, type PowClaim } from './form-pow.js';
import { parseSubmission, rejected } from './form-routes.js';

/**
 * PUBLIC BOOKING ROUTES — what a published site's booking widget calls. Unauthenticated, from any origin
 * (an exported site is hosted elsewhere and calls the platform), so CORS is `*` with no credentials, and
 * every answer says only what a visitor of the site may know.
 *
 *   GET  /b/:projectId/:offeringId/availability   what can be booked between `from` and `to`
 *   GET  /b/:projectId/:offeringId/challenge      a proof-of-work challenge, when the set-up asks for one
 *   POST /b/:projectId/:offeringId                book (`?preview=1`: check only, write nothing)
 *   GET  /b/:projectId/_booking/:reference        a booking's state, for whoever holds its reference
 *   POST /b/:projectId/_booking/:reference/cancel the visitor cancels, until it starts
 *
 * `_booking` cannot be an offering id (ids have no underscore), so the two families of paths never meet.
 *
 * Every error answers `{ error: <code>, detail? }` with a stable, hyphenated code a widget can act on:
 * `not-found`, `invalid-window`, `invalid`, `invalid-fields` (+ `fields`), `booking-unavailable` (a bot trap,
 * deliberately unexplained), `challenge-failed` (fetch a new proof-of-work challenge and retry),
 * `captcha-failed`, `captcha-unavailable`, and the booking outcomes: `taken`, `not-offered`, `too-soon`,
 * `too-far`, `unknown-resource`, `full`, `busy` (try again shortly), `started`.
 *
 * ★ What a public answer withholds: other customers' details always; exact seats unless the offering
 * sells set times with seats (and then never more than one booking may take); the resources' names unless
 * the visitor is meant to pick one (`chooseResource`).
 *
 * The request runs the form routes' spam pipeline in the same order (honeypot, time trap, interaction,
 * field validation, proof of work, captcha). A trap answers a GENERIC refusal rather than the forms'
 * silent success: a visitor waiting for a booking reference needs to know it did not happen.
 */

export interface BookingRoutesDeps {
  /** THE shared service: its per-project queue is what keeps two visitors off the same time. */
  readonly bookings: BookingService;
  /** The project exists, is not deleted, and is not the instance's global library. */
  readonly isPublicProject: (projectId: string) => Promise<boolean>;
  readonly captcha: CaptchaVerifier;
  readonly getProjectCaptcha: (projectId: string) => Promise<{ provider: CaptchaProvider; secret: string | null; minScore?: number } | null>;
  /** Signs proof-of-work challenges and booking references (the instance secret). */
  readonly getSecret: () => string;
  readonly claimPowChallenge: PowClaim;
  readonly rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  readonly now?: () => number;
  /** Queues the mails of a booking, a request or a cancellation. Never throws; the booking stands either way. */
  readonly notify?: (event: BookingEvent) => Promise<void>;
  /** Opens a priced booking's payment (booking/payments.ts). Absent: priced offerings cannot be booked. */
  readonly payments?: Pick<BookingPayments, 'start'>;
  /**
   * Where the payment provider sends the customer back to: the business's own booking page (with the booking's
   * reference), and where a cancelled payment goes. White-label: never the platform's address. Null: no site to go to.
   */
  readonly returnUrls?: (projectId: string, reference: string, statusPath: string | undefined) => Promise<{ return: string; cancel: string } | null>;
  /** Whether a booking was paid for, and whether that payment was refunded since: then cancelling decides its money first. */
  readonly payment?: (projectId: string, claimId: string) => Promise<'paid' | 'refunded' | undefined>;
  /** A cancelled booking's money: refunded in full (`inFull`) or kept. See BookingPayments.cancelMoney. */
  readonly cancelMoney?: (projectId: string, claimId: string, inFull: boolean) => Promise<'refunded' | 'manual' | 'none' | undefined>;
  /** One cancellation of a booking at a time; shared with the Bookings tab's. */
  readonly cancelLock?: BookingCancelLock;
  /** Where a booking's payments stand: one gone through, and how many checkouts opened since `since` are still open. */
  readonly payState?: (projectId: string, claimId: string, since: Date) => Promise<{ paid: boolean; open: number }>;
}

/** A page language as the widget reports it (`<html lang>`); the notifier keeps it only if the site has it. */
const LANG_RE = /^[A-Za-z0-9-]{1,35}$/;

/** What a booking asks of the visitor. The same validator as a form's, so the same rules apply. */
const CUSTOMER_FIELDS = [
  FormFieldSchema.parse({ name: 'name', label: 'Name', type: 'text', required: true }),
  FormFieldSchema.parse({ name: 'email', label: 'Email', type: 'email', required: true }),
  FormFieldSchema.parse({ name: 'phone', label: 'Phone', type: 'tel' }),
  FormFieldSchema.parse({ name: 'note', label: 'Note', type: 'textarea' }),
];
const MAX_BODY_BYTES = 32 * 1024;
/** How long a request waits for the owner to accept or decline it. */
export const REQUEST_HOLD_MS = 3 * DAY_MS;

const setCors = (reply: FastifyReply): void => {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  reply.header('access-control-allow-headers', 'content-type');
  reply.header('access-control-max-age', '600');
};

/** The offering as the widget needs it: how it is booked, never who else booked it. */
function publicOffering(o: BookingOffering, config: BookingConfig): Record<string, unknown> {
  const timeZone = config.resources.find((r) => r.id === o.resourceIds[0])?.timeZone;
  // All of an offering's resources share one time zone (the schema insists), so the first one's is the offering's.
  const base = {
    id: o.id,
    name: o.name,
    mode: o.mode,
    confirmation: o.confirmation,
    maxQuantity: o.maxQuantity,
    minNoticeMin: o.minNoticeMin,
    maxAdvanceDays: o.maxAdvanceDays,
    timeZone,
    // A paid offering: what it costs, in the currency's own decimals, so the widget shows the total before the
    // visitor goes to pay. The server prices the booking itself; this is only what is shown.
    ...(o.price && config.payment
      ? { price: { amountMinor: o.price.amountMinor, per: o.price.per, currency: config.payment.currency, digits: minorUnitExponent(config.payment.currency) } }
      : {}),
  };
  const resources = o.chooseResource
    ? { resources: o.resourceIds.map((id) => ({ id, name: config.resources.find((r) => r.id === id)?.name ?? id })) }
    : {};
  if (o.mode === 'duration') return { ...base, durationMin: o.durationMin, ...resources };
  if (o.mode === 'range') return { ...base, minMin: o.minMin, maxMin: o.maxMin, stepMin: o.stepMin, ...resources };
  if (o.mode === 'days') return { ...base, unit: o.unit, minUnits: o.minUnits, maxUnits: o.maxUnits, checkIn: o.checkIn, checkOut: o.checkOut, ...resources };
  return { ...base, ...resources };
}

/** The offering as a booking's own page shows it. */
function bookingSummary(o: BookingOffering, config: BookingConfig): Record<string, unknown> {
  const timeZone = config.resources.find((r) => r.id === o.resourceIds[0])?.timeZone;
  return {
    id: o.id,
    name: o.name,
    mode: o.mode,
    timeZone,
    ...(o.mode === 'days' ? { unit: o.unit } : {}),
  };
}

/** The listing as a visitor may see it. */
function publicAvailability(a: Availability, o: BookingOffering): Record<string, unknown> {
  const pick = o.chooseResource;
  if (a.kind === 'times') {
    const times = a.times.map((t) => ({
      start: t.start,
      end: t.end,
      // Seats only where seats are what is sold, and never more than one booking may take.
      ...(o.mode === 'slots' ? { places: Math.min(t.seatsLeft, o.maxQuantity) } : {}),
      ...(pick ? { resources: t.resourceIds } : {}),
    }));
    return { kind: a.kind, times, truncated: a.truncated };
  }
  if (a.kind === 'windows') {
    return { kind: a.kind, windows: a.windows.map((w) => ({ start: w.start, end: w.end, ...(pick ? { resource: w.resourceId } : {}) })), truncated: a.truncated };
  }
  return { kind: a.kind, days: a.days.map((d) => ({ date: d.date, ...(pick ? { resources: d.resourceIds } : {}) })), truncated: a.truncated };
}

/** The booking a request body asks for. Values arrive as text, as from a form. */
function requestFrom(o: BookingOffering, f: Readonly<Record<string, string>>): BookingRequest {
  // Whole numbers only: no `0x10`, `1e3` or ` 7 `, which Number() would take.
  const num = (k: string): number | undefined => {
    // eslint-disable-next-line security/detect-object-injection -- k is one of a few literal keys below
    const v = f[k];
    if (v === undefined || v === '') return undefined;
    return /^-?\d{1,16}$/.test(v) ? Number(v) : Number.NaN;
  };
  const quantity = num('quantity');
  // A resource is only ever the visitor's to choose when the offering lets them.
  const resourceId = o.chooseResource && f.resource ? f.resource : undefined;
  const extra = { ...(quantity !== undefined ? { quantity } : {}), ...(resourceId !== undefined ? { resourceId } : {}) };
  if (o.mode === 'days') return { date: f.date ?? '', units: num('units') ?? Number.NaN, ...extra };
  const end = num('end');
  return { start: num('start') ?? Number.NaN, ...(end !== undefined ? { end } : {}), ...extra };
}

const STATUS: Record<ClaimFailure, number> = {
  invalid: 400,
  'unknown-resource': 422,
  'unknown-offering': 404,
  'not-offered': 422,
  'too-soon': 422,
  'too-far': 422,
  taken: 409,
  full: 503,
  busy: 503,
};

export function registerBookingRoutes(app: FastifyInstance, deps: BookingRoutesDeps): void {
  const { bookings, rl } = deps;
  const now = deps.now ?? Date.now;
  const lock = deps.cancelLock ?? new BookingCancelLock();
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not-found' });
  const unavailable = (reply: FastifyReply) => reply.code(400).send({ error: 'booking-unavailable' });

  for (const path of ['/b/:projectId/:offeringId', '/b/:projectId/_booking/:reference/cancel', '/b/:projectId/_booking/:reference/pay']) {
    app.options(path, { config: rl(20) }, async (_req, reply) => {
      setCors(reply);
      return reply.code(204).send();
    });
  }

  app.get<{ Params: { projectId: string; offeringId: string }; Querystring: { from?: string; to?: string; resource?: string } }>(
    '/b/:projectId/:offeringId/availability',
    { config: rl(60) },
    async (req, reply) => {
      setCors(reply);
      reply.header('cache-control', 'no-store');
      const { projectId, offeringId } = req.params;
      if (!(await deps.isPublicProject(projectId))) return notFound(reply);
      const found = await bookings.offering(projectId, offeringId);
      if (!found) return notFound(reply);
      const instant = (v: string | undefined): number => (v !== undefined && /^\d{1,16}$/.test(v) ? Number(v) : Number.NaN);
      const from = instant(req.query.from);
      const to = instant(req.query.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return reply.code(400).send({ error: 'invalid-window', detail: 'from and to are instants in milliseconds, from before to' });
      }
      const resource = found.offering.chooseResource && req.query.resource ? req.query.resource : undefined;
      const a = await bookings.availability(projectId, offeringId, from, to, resource);
      if (!a) return notFound(reply);
      return reply.send({ offering: publicOffering(found.offering, found.config), ...publicAvailability(a, found.offering) });
    },
  );

  // Mints for any well-formed path, protected or not: answering "no challenge needed" would map which
  // set-ups are unprotected. Bound to the offering, so a solution is good there and nowhere else.
  app.get<{ Params: { projectId: string; offeringId: string } }>('/b/:projectId/:offeringId/challenge', { config: rl(30) }, async (req, reply) => {
    setCors(reply);
    reply.header('cache-control', 'no-store');
    return reply.send(createPowChallenge(deps.getSecret(), powScope(req.params.projectId, `book:${req.params.offeringId}`)));
  });

  app.post<{ Params: { projectId: string; offeringId: string }; Querystring: { preview?: string } }>(
    '/b/:projectId/:offeringId',
    { config: rl(10), bodyLimit: MAX_BODY_BYTES },
    async (req, reply) => {
      setCors(reply);
      const { projectId, offeringId } = req.params;
      if (!(await deps.isPublicProject(projectId))) return notFound(reply);
      const found = await bookings.offering(projectId, offeringId);
      if (!found) return notFound(reply);
      const parsed = parseSubmission(req.body);
      if (rejected(parsed)) return reply.code(400).send({ error: 'invalid', detail: parsed.reason });

      // The bot traps, cheapest first. None is named in the answer.
      const ix = parsed.interaction;
      const trap = parsed.honeypotFilled ? 'honeypot' : (parsed.elapsed ?? 0) < MIN_SUBMIT_ELAPSED_MS ? 'too-fast' : !ix || ix.pointer + ix.key === 0 ? 'no-interaction' : null;
      if (trap) {
        req.log.info({ projectId, offeringId, reason: trap }, 'booking filtered by a bot trap');
        return unavailable(reply);
      }
      const f = parsed.fields;
      const customer = { name: f.name ?? '', email: f.email ?? '', phone: f.phone ?? '', note: f.note ?? '' };
      const invalid = validateFormSubmission(CUSTOMER_FIELDS, customer);
      if (invalid.length > 0) return reply.code(400).send({ error: 'invalid-fields', fields: invalid });

      if (found.config.pow) {
        const verdict = await verifyPowSolution(deps.getSecret(), powScope(projectId, `book:${offeringId}`), parsed.powSolution, deps.claimPowChallenge);
        if (verdict !== 'ok') {
          req.log.info({ projectId, offeringId, verdict }, 'booking filtered by proof-of-work');
          // Named, unlike the traps: a visitor whose solution went stale needs a new challenge, and the
          // challenge route is public, so naming it tells a bot nothing it could not ask for.
          return reply.code(400).send({ error: 'challenge-failed' });
        }
      }
      const preview = req.query.preview === '1';
      // A captcha token is single-use, so a preview dry run never spends one.
      if (found.config.captcha && !preview) {
        const refusal = await verifyCaptcha(deps, projectId, parsed.captchaToken, req.ip);
        if (refusal) return reply.code(refusal.status).send({ error: refusal.error });
      }

      const request = requestFrom(found.offering, f);
      const stored = Object.fromEntries(Object.entries(customer).filter(([, v]) => v.trim() !== '')) as Record<string, string>;
      if (preview) {
        const check = await bookings.check(projectId, offeringId, request);
        if (!check.ok) return reply.code(STATUS[check.reason]).send({ error: check.reason, detail: check.detail });
        return reply.send({ ok: true, preview: true });
      }
      // ★ A priced offering booked AT ONCE is paid before it is booked: its time is HELD while the customer pays, and the
      // payment's webhook confirms it (no confirmation mail before then). A priced REQUEST is paid once it is accepted.
      const priced = !!found.offering.price && found.offering.confirmation === 'instant';
      if (priced && (!deps.payments || !deps.returnUrls)) return reply.code(503).send({ error: 'payment-unavailable', detail: 'payment is not available here' });
      const state = priced ? 'hold' : found.offering.confirmation === 'request' ? 'pending' : 'booked';
      const result = await bookings.claim(projectId, offeringId, request, {
        state,
        holdMs: priced ? BOOKING_PAY_LIMITS.holdMs : REQUEST_HOLD_MS,
        customer: stored,
      });
      if (!result.ok) {
        // `busy` passes; `full` is a cap that stays until the owner acts, so it promises no retry.
        if (result.reason === 'busy') reply.header('retry-after', '60');
        return reply.code(STATUS[result.reason]).send({ error: result.reason, detail: result.detail });
      }
      const c = result.claim;
      const reference = signBookingRef(projectId, c.id, deps.getSecret());
      if (priced) {
        const urls = await deps.returnUrls!(projectId, reference, found.config.statusPath);
        const started = urls
          ? await deps.payments!.start(projectId, c, found.offering, found.config, stored, urls, f.lang && LANG_RE.test(f.lang) ? f.lang : undefined)
          : { ok: false as const, error: 'the site has no address to come back to after paying' };
        if (!started.ok) {
          // The time goes back at once (a second release of a hold already given back is harmless).
          await bookings.releaseHold(projectId, c.id).catch(() => undefined);
          return reply.code(503).send({ error: 'payment-unavailable', detail: started.error });
        }
        return reply.send({ ok: true, reference, state: c.state, start: c.startAt.getTime(), end: c.endAt.getTime(), pay: started.redirectUrl });
      }
      // The customer's confirmation (or acknowledgement) and the business's notice, queued, not awaited.
      void deps.notify?.({
        kind: c.state === 'pending' ? 'requested' : 'booked',
        projectId,
        claim: c,
        offering: found.offering,
        config: found.config,
        reference,
        ...(f.lang && LANG_RE.test(f.lang) ? { locale: f.lang } : {}),
      });
      return reply.send({ ok: true, reference, state: c.state, start: c.startAt.getTime(), end: c.endAt.getTime() });
    },
  );

  app.get<{ Params: { projectId: string; reference: string } }>('/b/:projectId/_booking/:reference', { config: rl(60) }, async (req, reply) => {
    setCors(reply);
    reply.header('cache-control', 'no-store');
    const { projectId } = req.params;
    const claimId = verifyBookingRef(projectId, req.params.reference, deps.getSecret());
    if (!claimId || !(await deps.isPublicProject(projectId))) return notFound(reply);
    const c = await bookings.get(projectId, claimId);
    if (!c) return notFound(reply);
    const found = await bookings.offering(projectId, c.offeringId);
    const start = c.startAt.getTime();
    const payment = c.state === 'booked' ? await deps.payment?.(projectId, claimId) : undefined;
    const paid = payment !== undefined;
    return reply.send({
      state: c.state,
      start,
      end: c.endAt.getTime(),
      quantity: c.units,
      // What the status page needs to say when it is: the offering's clock, and whether it is booked by the night.
      offering: found ? bookingSummary(found.offering, found.config) : null,
      cancellable: paid ? start - now() > PAID_CANCEL_MARGIN_MS : start > now(),
      // An accepted PAID request: the customer pays here, by its deadline.
      ...(payable(c, found?.offering) ? { payable: true, payBy: (c.payBy ?? c.expiresAt)!.getTime() } : {}),
      // A paid booking: what cancelling it now does with the money, said before the customer confirms.
      // (Its money already back, from a cancellation tried before: refunded in full, whatever the deadline says now.)
      ...(paid ? { refund: payment === 'refunded' || refundsInFull(found?.offering, start, now()) ? 'full' : 'none' } : {}),
    });
  });

  // An ACCEPTED PAID REQUEST is paid from its own page: a checkout for its price, on the business's provider. Its time
  // stays held whatever happens here (the customer may try again until its deadline). ★ One attempt at a time per
  // booking (the lock it shares with cancelling), none while a payment is already going through, and at most a few
  // checkouts open at once; a second payment that goes through all the same is refunded.
  app.post<{ Params: { projectId: string; reference: string }; Body: unknown }>(
    '/b/:projectId/_booking/:reference/pay',
    { config: rl(10) },
    async (req, reply) => {
      setCors(reply);
      const { projectId } = req.params;
      const claimId = verifyBookingRef(projectId, req.params.reference, deps.getSecret());
      if (!claimId || !(await deps.isPublicProject(projectId))) return notFound(reply);
      return lock.run(projectId, claimId, async () => {
        const c = await bookings.get(projectId, claimId);
        if (!c) return notFound(reply);
        const found = await bookings.offering(projectId, c.offeringId);
        if (!found || !payable(c, found.offering)) return reply.code(409).send({ error: 'not-payable', detail: 'there is nothing to pay for this booking' });
        if (!deps.payments || !deps.returnUrls || !deps.payState) return reply.code(503).send({ error: 'payment-unavailable', detail: 'payment is not available here' });
        const state = await deps.payState(projectId, claimId, new Date(now() - BOOKING_PAY_LIMITS.attemptWindowMs));
        if (state.paid) return reply.code(409).send({ error: 'already-paid', detail: 'its payment is going through' });
        if (state.open >= BOOKING_PAY_LIMITS.attemptsPerBooking) {
          return reply.code(429).send({ error: 'too-many', detail: 'too many payments were started for this booking just now' });
        }
        const reference = req.params.reference;
        const urls = await deps.returnUrls(projectId, reference, found.config.statusPath);
        if (!urls) return reply.code(503).send({ error: 'payment-unavailable', detail: 'the site has no address to come back to after paying' });
        const lang = typeof (req.body as { lang?: unknown } | null)?.lang === 'string' ? (req.body as { lang: string }).lang : undefined;
        const started = await deps.payments.start(projectId, c, found.offering, found.config, { ...c.customer }, urls, lang && LANG_RE.test(lang) ? lang : undefined, {
          keepHold: true,
        });
        if (!started.ok) return reply.code(503).send({ error: 'payment-unavailable', detail: started.error });
        // A checkout begun close to the deadline keeps the time a little longer, so a payment made in time is not
        // refunded for arriving a moment late. ★ Capped at one checkout's time past the business's deadline (and
        // never past its start): starting checkouts again and again cannot hold the time any longer.
        const deadline = (c.payBy ?? c.expiresAt)!.getTime();
        const until = Math.min(now() + BOOKING_PAY_LIMITS.holdMs, deadline + BOOKING_PAY_LIMITS.holdMs, c.startAt.getTime());
        if (c.expiresAt !== null && until > c.expiresAt.getTime()) {
          const extended = await bookings.extend(projectId, claimId, until - now());
          if (!extended.ok) req.log.warn({ projectId, reason: extended.reason }, 'an accepted request’s hold could not be kept for its checkout');
        }
        return reply.send({ ok: true, pay: started.redirectUrl });
      });
    },
  );

  app.post<{ Params: { projectId: string; reference: string } }>('/b/:projectId/_booking/:reference/cancel', { config: rl(10) }, async (req, reply) => {
    setCors(reply);
    const { projectId } = req.params;
    const claimId = verifyBookingRef(projectId, req.params.reference, deps.getSecret());
    if (!claimId || !(await deps.isPublicProject(projectId))) return notFound(reply);
    return lock.run(projectId, claimId, async () => {
      // ★ A paid BOOKING's money is decided FIRST (in full until the offering's deadline, kept after): a failure
      // between the two then leaves a booking standing that the customer cancels again (its money already decided),
      // never a cancelled booking nobody refunds. A checkout still in progress (a hold) has no money to decide: its
      // payment, should it come after all, finds the hold gone and is refunded.
      let refund: 'refunded' | 'manual' | 'none' | undefined;
      const before = await bookings.get(projectId, claimId);
      if (before?.state === 'booked' && (await deps.payment?.(projectId, claimId)) !== undefined) {
        const start = before.startAt.getTime();
        if (start - now() <= PAID_CANCEL_MARGIN_MS) return reply.code(409).send({ error: 'started', detail: 'it starts too soon to cancel online' });
        const offered = await bookings.offering(projectId, before.offeringId).catch(() => null);
        refund = await (deps.cancelMoney?.(projectId, claimId, refundsInFull(offered?.offering, start, now())) ?? Promise.resolve(undefined)).catch(
          (err: unknown) => {
            req.log.error({ err, projectId }, 'the money of a booking the customer cancelled could not be settled');
            return 'manual' as const;
          },
        );
      }
      const result = await bookings.cancel(projectId, claimId);
      if (result.ok) {
        // Both sides hear of it; a booking already in calendars is taken out of them again.
        const found = await bookings.offering(projectId, result.claim.offeringId).catch(() => null);
        if (found) void deps.notify?.({ kind: 'cancelled', projectId, claim: result.claim, offering: found.offering, config: found.config, ...(refund ? { refund } : {}) });
        // The offering was removed from the set-up since: there is no name or address left to write with.
        else req.log.warn({ projectId, offeringId: result.claim.offeringId }, 'booking cancelled without mails: its offering no longer exists');
        return reply.send({ ok: true, ...(refund ? { refund } : {}) });
      }
      // Its money decided, yet not cancelled (a busy moment): logged, and the customer tries again (the retry finds
      // the money already decided, and mails it).
      if (refund) req.log.warn({ projectId, reason: result.reason, refund }, "a booking's money was settled but its cancellation was refused");
      if (result.reason === 'unknown-claim') return notFound(reply);
      if (result.reason === 'busy') reply.header('retry-after', '60');
      return reply.code(result.reason === 'started' ? 409 : 503).send({ error: result.reason, detail: result.detail, ...(refund ? { refund } : {}) });
    });
  });
}

/** An accepted PAID request, waiting for its customer to pay (a hold of a priced offering on request, still live). */
function payable(c: { state: string; expiresAt: Date | null }, o: BookingOffering | undefined): boolean {
  return c.state === 'hold' && c.expiresAt !== null && !!o?.price && o.confirmation === 'request';
}

/** The project's captcha, verified. Fails CLOSED: no usable configuration means no booking. */
async function verifyCaptcha(deps: BookingRoutesDeps, projectId: string, token: string | undefined, ip: string): Promise<{ status: number; error: string } | null> {
  let config: Awaited<ReturnType<BookingRoutesDeps['getProjectCaptcha']>>;
  try {
    config = await deps.getProjectCaptcha(projectId);
  } catch {
    return { status: 503, error: 'captcha-unavailable' };
  }
  if (!config?.secret) return { status: 503, error: 'captcha-unavailable' };
  const ok = await deps.captcha.verify({
    provider: config.provider,
    secret: config.secret,
    token,
    remoteip: ip,
    ...(config.minScore !== undefined ? { minScore: config.minScore } : {}),
  });
  return ok ? null : { status: 400, error: 'captcha-failed' };
}


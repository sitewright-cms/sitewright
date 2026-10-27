import { BOOKING_LIMITS, type BookingConfig, type BookingOffering } from '@sitewright/schema';
import { KeyedQueue } from '../runtime/keyed-queue.js';
import { checkRequest, listAvailability, type Availability, type BookingRequest, type CheckFailure } from './availability.js';
import { BOOKING_CLAIM_LIMITS, type BookingClaimsRepository, type ClaimRow, type ClaimState } from './claims.js';
import { DAY_MS, MINUTE_MS } from './zoned.js';

/**
 * BOOKING: availability and claims for one project, over its configuration and the claims table.
 *
 * ★ A claim is a read-modify-write: read what is busy, check the request against it, write the claim.
 * Two visitors claiming the same time must not both pass the check, and a libsql transaction is not a
 * compare-and-swap, so every write to a project's claims runs one at a time through a per-project queue,
 * with the clock read INSIDE it: a claim, and the owner confirming, extending or releasing one. That holds
 * on the one API process the platform runs, and only if the app builds ONE BookingService and every route
 * and tool shares it: a second instance has a queue of its own.
 *
 * Calendars are not read here yet: their busy times join the claims' in a later step.
 */

export interface BookingServiceDeps {
  readonly claims: BookingClaimsRepository;
  /** The project's booking configuration, or null when it has none. */
  readonly readConfig: (projectId: string) => Promise<BookingConfig | null>;
  readonly now?: () => number;
}

export interface ClaimOptions {
  readonly state: ClaimState;
  /** How long a hold or a request keeps its time. Ignored for a ledger booking. */
  readonly holdMs?: number;
  readonly customer: Readonly<Record<string, string>>;
}

export type ClaimFailure = CheckFailure | 'unknown-offering' | 'full' | 'busy';
export type ClaimResult = { readonly ok: true; readonly claim: ClaimRow } | { readonly ok: false; readonly reason: ClaimFailure; readonly detail: string };
export type ChangeResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'unknown-claim' | 'lapsed' | 'invalid' | 'busy'; readonly detail: string };

/** A hold's default life: long enough to write a calendar event or pay, short enough not to block others. */
export const DEFAULT_HOLD_MS = 15 * MINUTE_MS;

export const BOOKING_SERVICE_LIMITS = {
  /** The shortest and longest a hold or request may keep its time. */
  minHoldMs: MINUTE_MS,
  maxHoldMs: 7 * DAY_MS,
  /** Claims for one project waiting their turn. Past this a claim is refused rather than queued for ever. */
  maxWaiting: 20,
  /** The customer's details: a few short fields, never a document. */
  customerFields: 12,
  customerValueChars: 2000,
  customerBytes: 8 * 1024,
} as const;

/** How far ahead availability is read: the furthest anything can start (730 days) plus the longest stay. */
const READ_AHEAD_MS = (BOOKING_LIMITS.maxAdvanceDays + 366) * DAY_MS;
/** Margin either side of a read window: covers any time zone, buffer or check-in hour. */
const MARGIN_MS = 3 * DAY_MS;

/** The stretch a booking of `o` occupies, buffers included. */
function occupied(o: BookingOffering, start: number, end: number): { busyStart: number; busyEnd: number } {
  if (o.mode !== 'duration') return { busyStart: start, busyEnd: end };
  return { busyStart: start - o.bufferBeforeMin * MINUTE_MS, busyEnd: end + o.bufferAfterMin * MINUTE_MS };
}

/** How long after its start a booking of `o` can reach, buffers included. */
function reach(o: BookingOffering): number {
  if (o.mode === 'duration') return (o.durationMin + o.bufferAfterMin) * MINUTE_MS;
  if (o.mode === 'slots') return Math.max(...o.slots.map((s) => s.durationMin)) * MINUTE_MS;
  if (o.mode === 'range') return o.maxMin * MINUTE_MS;
  return o.maxUnits * DAY_MS;
}

/** The stretch whose claims a request can collide with. Null for a request the engine will refuse anyway. */
function requestWindow(o: BookingOffering, req: BookingRequest): { from: number; to: number } | null {
  if ('date' in req) {
    const day = typeof req.date === 'string' ? Date.parse(`${req.date}T00:00Z`) : Number.NaN;
    const units = typeof req.units === 'number' ? req.units : Number.NaN;
    if (!Number.isFinite(day) || !Number.isFinite(units) || units < 0 || units > 366) return null;
    return { from: day - MARGIN_MS, to: day + units * DAY_MS + MARGIN_MS };
  }
  if (!('start' in req) || typeof req.start !== 'number' || !Number.isFinite(req.start)) return null;
  return { from: req.start - MARGIN_MS, to: req.start + reach(o) + MARGIN_MS };
}

/** A customer's details: a few named text fields of sensible size. */
function validCustomer(c: unknown): c is Readonly<Record<string, string>> {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const entries = Object.entries(c);
  if (entries.length > BOOKING_SERVICE_LIMITS.customerFields) return false;
  if (!entries.every(([k, v]) => /^[a-z][a-z0-9_]{0,39}$/i.test(k) && typeof v === 'string' && v.length <= BOOKING_SERVICE_LIMITS.customerValueChars)) return false;
  return Buffer.byteLength(JSON.stringify(c)) <= BOOKING_SERVICE_LIMITS.customerBytes;
}

const validHold = (ms: number): boolean => Number.isFinite(ms) && ms >= BOOKING_SERVICE_LIMITS.minHoldMs && ms <= BOOKING_SERVICE_LIMITS.maxHoldMs;

export class BookingService {
  private readonly queue = new KeyedQueue();
  private readonly now: () => number;

  constructor(private readonly deps: BookingServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  private async offering(projectId: string, offeringId: string): Promise<{ config: BookingConfig; offering: BookingOffering } | null> {
    const config = await this.deps.readConfig(projectId);
    const offering = config?.offerings.find((o) => o.id === offeringId);
    return config && offering ? { config, offering } : null;
  }

  /** Runs `work` in the project's queue, or refuses when too much is already waiting there. */
  private queued<T extends { ok: boolean }>(projectId: string, work: () => Promise<T>): Promise<T | { ok: false; reason: 'busy'; detail: string }> {
    if (this.queue.waiting(projectId) >= BOOKING_SERVICE_LIMITS.maxWaiting) {
      return Promise.resolve({ ok: false, reason: 'busy', detail: 'too many bookings are being made right now; try again in a moment' });
    }
    return this.queue.run(projectId, work);
  }

  /** What can be booked of `offeringId` between `from` and `to`. Null when there is no such offering. */
  async availability(projectId: string, offeringId: string, from: number, to: number, resourceId?: string): Promise<Availability | null> {
    const found = await this.offering(projectId, offeringId);
    if (!found) return null;
    const now = this.now();
    const query = { offering: found.offering, resources: found.config.resources, now, from, to, ...(resourceId !== undefined ? { resourceId } : {}) };
    if (!Number.isFinite(from) || !Number.isFinite(to)) return listAvailability({ ...query, busy: new Map() });
    // Only the claims the window can collide with: a booking's buffers and a stay's length reach past it.
    const readFrom = Math.max(from, now) - MARGIN_MS;
    const readTo = Math.min(to, now + READ_AHEAD_MS) + reach(found.offering) + MARGIN_MS;
    const busy = await this.deps.claims.busy(projectId, found.offering.resourceIds, readFrom, Math.max(readFrom, readTo), now);
    return listAvailability({ ...query, busy });
  }

  /**
   * Claims `req` if it can be booked right now: checked and written as one step for the project, so two
   * visitors can never both get the last place.
   */
  async claim(projectId: string, offeringId: string, req: BookingRequest, opts: ClaimOptions): Promise<ClaimResult> {
    const holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
    if (opts.state !== 'booked' && !validHold(holdMs)) return { ok: false, reason: 'invalid', detail: 'a hold lasts between a minute and a week' };
    if (!validCustomer(opts.customer)) return { ok: false, reason: 'invalid', detail: 'the customer details are too many or too long' };
    return this.queued(projectId, async (): Promise<ClaimResult> => {
      const found = await this.offering(projectId, offeringId);
      if (!found) return { ok: false, reason: 'unknown-offering', detail: 'there is no such offering' };
      const { offering, config } = found;
      const now = this.now();
      const window = requestWindow(offering, req);
      const busy = window ? await this.deps.claims.busy(projectId, offering.resourceIds, window.from, window.to, now) : new Map();
      const check = checkRequest({ offering, resources: config.resources, busy, now }, req);
      if (!check.ok) return check;
      const full = await this.isFull(projectId, check.resourceId, opts.state, now);
      if (full) return { ok: false, reason: 'full', detail: full };
      const claim = await this.deps.claims.insert(
        {
          projectId,
          resourceId: check.resourceId,
          offeringId,
          state: opts.state,
          start: check.start,
          end: check.end,
          ...occupied(offering, check.start, check.end),
          units: req.quantity ?? 1,
          exclusive: offering.mode === 'slots',
          expiresAt: opts.state === 'booked' ? null : now + holdMs,
          customer: opts.customer,
        },
        now,
      );
      return { ok: true, claim };
    });
  }

  /** Why the project, or the resource, can take no more claims of `state`; null when it can. */
  private async isFull(projectId: string, resourceId: string, state: ClaimState, now: number): Promise<string | null> {
    if (state === 'booked') {
      return (await this.deps.claims.countBooked(projectId)) >= BOOKING_CLAIM_LIMITS.bookedPerProject ? 'this site is taking no more bookings for now' : null;
    }
    if ((await this.deps.claims.countUnconfirmed(projectId, now, resourceId)) >= BOOKING_CLAIM_LIMITS.unconfirmedPerResource) return 'too many bookings are waiting to be confirmed here';
    if ((await this.deps.claims.countUnconfirmed(projectId, now)) >= BOOKING_CLAIM_LIMITS.unconfirmedPerProject) return 'too many bookings are waiting to be confirmed on this site';
    return null;
  }

  /** A hold or request becomes a ledger booking, if it has not lapsed. */
  async confirm(projectId: string, claimId: string): Promise<ChangeResult> {
    return this.change(projectId, claimId, 'booked', null);
  }

  /** A hold or request keeps its time for `holdMs` more from now, if it has not lapsed. */
  async extend(projectId: string, claimId: string, holdMs: number): Promise<ChangeResult> {
    if (!validHold(holdMs)) return { ok: false, reason: 'invalid', detail: 'a hold lasts between a minute and a week' };
    return this.change(projectId, claimId, undefined, holdMs);
  }

  /** Gives a claim's time back: a declined request, an abandoned hold, a cancelled ledger booking. */
  async release(projectId: string, claimId: string): Promise<ChangeResult> {
    return this.queued(projectId, async (): Promise<ChangeResult> =>
      (await this.deps.claims.remove(projectId, claimId)) ? { ok: true } : { ok: false, reason: 'unknown-claim', detail: 'there is no such booking' },
    );
  }

  private async change(projectId: string, claimId: string, state: ClaimState | undefined, holdMs: number | null): Promise<ChangeResult> {
    return this.queued(projectId, async (): Promise<ChangeResult> => {
      const row = await this.deps.claims.get(projectId, claimId);
      if (!row) return { ok: false, reason: 'unknown-claim', detail: 'there is no such booking' };
      if (row.state === 'booked') return { ok: false, reason: 'invalid', detail: 'that booking is already confirmed' };
      const now = this.now();
      const next = state ?? row.state;
      const moved = await this.deps.claims.advance(projectId, claimId, next, holdMs === null ? null : now + holdMs, now);
      return moved ? { ok: true } : { ok: false, reason: 'lapsed', detail: 'its time ran out and may have been booked by someone else' };
    });
  }
}

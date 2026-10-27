import { BOOKING_LIMITS, type BookingConfig, type BookingOffering } from '@sitewright/schema';
import { KeyedQueue } from '../runtime/keyed-queue.js';
import { checkRequest, listAvailability, type Availability, type BookingRequest, type CheckFailure } from './availability.js';
import { BOOKING_CLAIM_LIMITS, type BookingClaimsRepository, type ClaimRow, type ClaimState } from './claims.js';
import { DAY_MS, MINUTE_MS } from './zoned.js';
import type { ExternalBusy } from './calendars.js';
import type { Busy } from './occupancy.js';

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
  /** The resources' outside calendars (iCalendar feeds), read for their busy times. None: only the claims count. */
  readonly external?: ExternalBusy;
  /**
   * Told after every change a claim goes through (taken, confirmed, extended, accepted, given back), once it is
   * committed: the calendars that take the bookings are brought in line with it. Never fails the change.
   */
  readonly onChange?: (projectId: string, claim: { id: string; resourceId: string }) => void;
  readonly now?: () => number;
}

/** Two busy maps as one. */
function mergeBusy(a: Map<string, Busy[]>, b: Map<string, Busy[]>): Map<string, Busy[]> {
  if (b.size === 0) return a;
  const out = new Map(a);
  for (const [id, list] of b) out.set(id, [...(out.get(id) ?? []), ...list]);
  return out;
}

export interface ClaimOptions {
  readonly state: ClaimState;
  /** How long a hold or a request keeps its time. Ignored for a ledger booking. */
  readonly holdMs?: number;
  readonly customer: Readonly<Record<string, string>>;
}

export type ClaimFailure = CheckFailure | 'unknown-offering' | 'full' | 'busy';
export type ClaimResult = { readonly ok: true; readonly claim: ClaimRow } | { readonly ok: false; readonly reason: ClaimFailure; readonly detail: string };
export type ChangeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unknown-claim' | 'lapsed' | 'invalid' | 'busy' | 'started'; readonly detail: string };
/** The business's answer to a request, or its cancellation: the claim as it now stands, for the mails about it. */
export type AnswerResult =
  | { readonly ok: true; readonly claim: ClaimRow }
  | { readonly ok: false; readonly reason: 'unknown-claim' | 'lapsed' | 'invalid' | 'ended' | 'busy'; readonly detail: string };
/** A cancellation hands back what was cancelled, so the mails about it can still be written. */
export type CancelResult = { readonly ok: true; readonly claim: ClaimRow } | Extract<ChangeResult, { ok: false }>;

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
  /**
   * New claims one project takes in an hour, and live claims one email address may hold there. The bot
   * traps are evidence a script can forge, so these bound what a forged stream can take from a business:
   * it runs out of budget long before the caps on holds and bookings fill.
   */
  claimsPerProjectHour: 60,
  liveClaimsPerEmail: 10,
} as const;

const HOUR_MS = 60 * MINUTE_MS;

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

/**
 * The stretch whose claims a request can collide with. Null for a request the engine will refuse anyway,
 * including one for a time nowhere near now: a date in the year 275760 is not a booking, and as a query
 * bound it is not even a valid date.
 */
function requestWindow(o: BookingOffering, req: BookingRequest, now: number): { from: number; to: number } | null {
  const near = (t: number): boolean => Number.isFinite(t) && Math.abs(t - now) <= READ_AHEAD_MS;
  if ('date' in req) {
    const day = typeof req.date === 'string' ? Date.parse(`${req.date}T00:00Z`) : Number.NaN;
    const units = typeof req.units === 'number' ? req.units : Number.NaN;
    if (!near(day) || !Number.isFinite(units) || units < 0 || units > 366) return null;
    return { from: day - MARGIN_MS, to: day + units * DAY_MS + MARGIN_MS };
  }
  if (!('start' in req) || typeof req.start !== 'number' || !near(req.start)) return null;
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
  /** When each project's recent claims were taken, for the hourly budget. Only projects with claims in the last hour. */
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly deps: BookingServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** The project's set-up and one of its offerings, or null when either is missing. */
  async offering(projectId: string, offeringId: string): Promise<{ config: BookingConfig; offering: BookingOffering } | null> {
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
    // Only the claims the window can collide with: a booking's buffers and a stay's length reach past it.
    // Clamped to the bookable stretch first, so a window in the far future never becomes an invalid date.
    const start = Math.min(Math.max(from, now), now + READ_AHEAD_MS);
    const end = Math.min(to, now + READ_AHEAD_MS);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return listAvailability({ ...query, busy: new Map() });
    const from_ = start - MARGIN_MS;
    const to_ = end + reach(found.offering) + MARGIN_MS;
    const busy = mergeBusy(
      await this.deps.claims.busy(projectId, found.offering.resourceIds, from_, to_, now),
      await this.outsideBusy(projectId, found.offering, found.config, from_, to_, false),
    );
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
    // A request that would fail anyway is answered before it queues, so failing requests (a script
    // hammering a taken time) cannot fill the queue that real visitors wait in.
    const pre = await this.check(projectId, offeringId, req);
    if (!pre.ok) return pre;
    // The outside calendars, read afresh, BEFORE the queue: a slow feed must not hold up everyone else's booking.
    const before = await this.offering(projectId, offeringId);
    const reach_ = before ? requestWindow(before.offering, req, this.now()) : null;
    const outside = before && reach_ ? await this.outsideBusy(projectId, before.offering, before.config, reach_.from, reach_.to, true) : new Map<string, Busy[]>();
    return this.queued(projectId, async (): Promise<ClaimResult> => {
      const found = await this.offering(projectId, offeringId);
      if (!found) return { ok: false, reason: 'unknown-offering', detail: 'there is no such offering' };
      const { offering, config } = found;
      const now = this.now();
      const window = requestWindow(offering, req, now);
      const busy = window ? mergeBusy(await this.deps.claims.busy(projectId, offering.resourceIds, window.from, window.to, now), outside) : new Map();
      const check = checkRequest({ offering, resources: config.resources, busy, now }, req);
      if (!check.ok) return check;
      const full = await this.isFull(projectId, check.resourceId, opts.state, now);
      if (full) return { ok: false, reason: 'full', detail: full };
      const email = opts.customer.email?.trim();
      if (email && (await this.deps.claims.countLiveForEmail(projectId, email, now)) >= BOOKING_SERVICE_LIMITS.liveClaimsPerEmail) {
        return { ok: false, reason: 'full', detail: 'this email address already holds as many bookings as it may' };
      }
      if (!this.spendBudget(projectId, now)) return { ok: false, reason: 'busy', detail: 'this site is taking a lot of bookings right now; try again later' };
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
          // A hold or request never outlives the booking's own start: a request for tomorrow cannot still
          // be waiting for the owner after the time has passed.
          expiresAt: opts.state === 'booked' ? null : Math.max(now + BOOKING_SERVICE_LIMITS.minHoldMs, Math.min(now + holdMs, check.start)),
          customer: opts.customer,
        },
        now,
      );
      this.changed(projectId, claim);
      return { ok: true, claim };
    });
  }

  /** Takes one claim from the project's hourly budget; false when it has none left. */
  private spendBudget(projectId: string, now: number): boolean {
    const times = (this.recent.get(projectId) ?? []).filter((t) => t > now - HOUR_MS);
    if (times.length >= BOOKING_SERVICE_LIMITS.claimsPerProjectHour) {
      this.recent.set(projectId, times);
      return false;
    }
    times.push(now);
    this.recent.set(projectId, times);
    // Forget projects whose hour has passed, so the map holds only the busy ones.
    for (const [id, ts] of this.recent) if (ts.every((t) => t <= now - HOUR_MS)) this.recent.delete(id);
    return true;
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

  /**
   * Whether `req` could be booked right now, writing nothing: what a preview of the site does, so a draft
   * page can be tried without taking a real time.
   */
  async check(projectId: string, offeringId: string, req: BookingRequest): Promise<ClaimResult | { ok: true; claim: null }> {
    const found = await this.offering(projectId, offeringId);
    if (!found) return { ok: false, reason: 'unknown-offering', detail: 'there is no such offering' };
    const now = this.now();
    const window = requestWindow(found.offering, req, now);
    const busy = window
      ? mergeBusy(
          await this.deps.claims.busy(projectId, found.offering.resourceIds, window.from, window.to, now),
          await this.outsideBusy(projectId, found.offering, found.config, window.from, window.to, false),
        )
      : new Map();
    const check = checkRequest({ offering: found.offering, resources: found.config.resources, busy, now }, req);
    return check.ok ? { ok: true, claim: null } : check;
  }

  /** The offering's resources' outside calendars between `from` and `to`. `fresh`: a booking is being made. */
  private async outsideBusy(projectId: string, offering: BookingOffering, config: BookingConfig, from: number, to: number, fresh: boolean): Promise<Map<string, Busy[]>> {
    if (!this.deps.external) return new Map();
    const resources = config.resources.filter((r) => offering.resourceIds.includes(r.id)).map((r) => ({ id: r.id, timeZone: r.timeZone }));
    return this.deps.external.busy(projectId, resources, from, to, { fresh });
  }

  /** One claim, if it is still in force. A lapsed hold or request reads as gone. */
  async get(projectId: string, claimId: string): Promise<ClaimRow | null> {
    const row = await this.deps.claims.get(projectId, claimId);
    if (!row) return null;
    return row.expiresAt === null || row.expiresAt.getTime() > this.now() ? row : null;
  }

  /** The visitor cancels their own booking: allowed until it starts, in the project's queue. */
  async cancel(projectId: string, claimId: string): Promise<CancelResult> {
    return this.queued(projectId, async (): Promise<CancelResult> => {
      const row = await this.deps.claims.get(projectId, claimId);
      const now = this.now();
      if (!row || (row.expiresAt !== null && row.expiresAt.getTime() <= now)) return { ok: false, reason: 'unknown-claim', detail: 'there is no such booking' };
      if (row.startAt.getTime() <= now) return { ok: false, reason: 'started', detail: 'it has already started' };
      await this.deps.claims.remove(projectId, claimId);
      this.changed(projectId, row);
      return { ok: true, claim: row };
    });
  }

  /**
   * The BUSINESS answers a request: accepted, it becomes a booking (if it has not lapsed); declined, its time
   * goes back. Each hands back the claim as it now stands, for the mails about it.
   */
  async accept(projectId: string, claimId: string): Promise<AnswerResult> {
    return this.queued(projectId, async (): Promise<AnswerResult> => {
      const row = await this.answerable(projectId, claimId);
      if (!row.ok) return row;
      const now = this.now();
      if (!(await this.deps.claims.advance(projectId, claimId, 'booked', null, now))) {
        return { ok: false, reason: 'lapsed', detail: 'its time ran out and may have been booked by someone else' };
      }
      this.changed(projectId, row.claim);
      return { ok: true, claim: { ...row.claim, state: 'booked', expiresAt: null, updatedAt: new Date(now) } };
    });
  }

  async decline(projectId: string, claimId: string): Promise<AnswerResult> {
    return this.queued(projectId, async (): Promise<AnswerResult> => {
      const row = await this.answerable(projectId, claimId);
      if (!row.ok) return row;
      await this.deps.claims.remove(projectId, claimId);
      this.changed(projectId, row.claim);
      return row;
    });
  }

  /**
   * The BUSINESS cancels a booking or a request, until it ends (a booking under way can still be called off). Not a
   * hold: that is a customer's checkout in progress, nothing the business booked or was asked for.
   */
  async cancelByBusiness(projectId: string, claimId: string): Promise<AnswerResult> {
    return this.queued(projectId, async (): Promise<AnswerResult> => {
      const row = await this.get(projectId, claimId);
      if (!row) return { ok: false, reason: 'unknown-claim', detail: 'there is no such booking' };
      if (row.state === 'hold') return { ok: false, reason: 'invalid', detail: 'that is a checkout in progress, not a booking' };
      if (row.endAt.getTime() <= this.now()) return { ok: false, reason: 'ended', detail: 'it has already ended' };
      await this.deps.claims.remove(projectId, claimId);
      this.changed(projectId, row);
      return { ok: true, claim: row };
    });
  }

  /** A request still waiting for an answer. Run inside the project's queue. */
  private async answerable(projectId: string, claimId: string): Promise<AnswerResult> {
    const row = await this.get(projectId, claimId);
    if (!row) return { ok: false, reason: 'unknown-claim', detail: 'there is no such request, or it has lapsed' };
    if (row.state !== 'pending') return { ok: false, reason: 'invalid', detail: 'only a request waits for an answer' };
    // A request's time that has already begun cannot be accepted (nor declined: there is nothing left to free).
    if (row.startAt.getTime() <= this.now()) return { ok: false, reason: 'ended', detail: 'its time has already begun' };
    return { ok: true, claim: row };
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
    return this.queued(projectId, async (): Promise<ChangeResult> => {
      const row = await this.deps.claims.get(projectId, claimId);
      if (!row || !(await this.deps.claims.remove(projectId, claimId))) return { ok: false, reason: 'unknown-claim', detail: 'there is no such booking' };
      this.changed(projectId, row);
      return { ok: true };
    });
  }

  private async change(projectId: string, claimId: string, state: ClaimState | undefined, holdMs: number | null): Promise<ChangeResult> {
    return this.queued(projectId, async (): Promise<ChangeResult> => {
      const row = await this.deps.claims.get(projectId, claimId);
      if (!row) return { ok: false, reason: 'unknown-claim', detail: 'there is no such booking' };
      if (row.state === 'booked') return { ok: false, reason: 'invalid', detail: 'that booking is already confirmed' };
      const now = this.now();
      const next = state ?? row.state;
      const moved = await this.deps.claims.advance(projectId, claimId, next, holdMs === null ? null : now + holdMs, now);
      if (moved) this.changed(projectId, row);
      return moved ? { ok: true } : { ok: false, reason: 'lapsed', detail: 'its time ran out and may have been booked by someone else' };
    });
  }

  /** Tells `onChange` of a committed change. A listener's failure is its own: the change stands. */
  private changed(projectId: string, claim: { id: string; resourceId: string }): void {
    try {
      this.deps.onChange?.(projectId, { id: claim.id, resourceId: claim.resourceId });
    } catch {
      // The listener queues work of its own and reports its own failures.
    }
  }
}

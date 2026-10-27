import { WEEKDAYS, clockMinutes, isLocalDate, type BookingOffering, type BookingResource } from '@sitewright/schema';
import { Occupancy, blockedBetween, openBetween, type Busy, type Interval } from './occupancy.js';
import { DAY_MS, MINUTE_MS, addDays, datesBetween, formatYmd, localDateOf, parseYmd, weekdayIndex, zonedParts, zonedToInstant, type Ymd } from './zoned.js';

/**
 * THE AVAILABILITY ENGINE. Pure: everything it knows comes in as arguments (the offering, its resources,
 * what is already busy, and the time now), so the same question always gets the same answer.
 *
 * Two jobs:
 *   - LIST what can be booked in a window, for the booking widget to show;
 *   - CHECK one request exactly, at the moment it is made. The check is the authority: a list shown a
 *     minute ago proves nothing, and nothing the browser sends is trusted beyond the request itself.
 *
 * The listing returns everything the engine knows (which resources, how many seats). What a PUBLIC answer
 * may show of that is the route's decision: exact seat counts and resource ids say something about other
 * customers' bookings.
 */

/** The longest window one listing covers: a minute-level calendar, and a nightly or daily one. */
export const MAX_LIST_DAYS = { minutes: 62, days: 400 } as const;
/** No listing returns more entries than this; one that would is marked `truncated`. */
export const MAX_LIST_ENTRIES = 2000;

export interface AvailabilityQuery {
  readonly offering: BookingOffering;
  /** The project's resources. Only those the offering names are used. */
  readonly resources: readonly BookingResource[];
  /** What is already taken, per resource id: existing bookings, holds, events from its calendars. */
  readonly busy: ReadonlyMap<string, readonly Busy[]>;
  /** The server's clock. Never the visitor's: notice and horizon are measured from it. */
  readonly now: number;
  /** Only this resource, when the visitor picked one. */
  readonly resourceId?: string;
}

export interface ListQuery extends AvailabilityQuery {
  readonly from: number;
  readonly to: number;
}

/** A bookable time (`duration` and `slots`): the resources free for it, and how many seats are left. */
export interface TimeOption {
  readonly start: number;
  readonly end: number;
  readonly resourceIds: string[];
  readonly seatsLeft: number;
}

/** A stretch a `range` booking can be placed in: both ends on the offering's time grid. */
export interface FreeWindow extends Interval {
  readonly resourceId: string;
}

/**
 * A night or day (`days`) that can be booked, and the resources free for it. A stay of several needs them
 * all on ONE resource: a run of dates is only bookable where their `resourceIds` share one.
 */
export interface DayOption {
  readonly date: string;
  readonly resourceIds: string[];
}

export type Availability =
  | { readonly kind: 'times'; readonly times: TimeOption[]; readonly truncated: boolean }
  | { readonly kind: 'windows'; readonly windows: FreeWindow[]; readonly truncated: boolean }
  | { readonly kind: 'days'; readonly days: DayOption[]; readonly truncated: boolean };

export type BookingRequest =
  | { readonly start: number; readonly end?: number; readonly quantity?: number; readonly resourceId?: string }
  | { readonly date: string; readonly units: number; readonly quantity?: number; readonly resourceId?: string };

export type CheckFailure = 'invalid' | 'unknown-resource' | 'too-soon' | 'too-far' | 'not-offered' | 'taken';
export type CheckResult =
  | { readonly ok: true; readonly resourceId: string; readonly start: number; readonly end: number }
  | { readonly ok: false; readonly reason: CheckFailure; readonly detail: string };

type DurationOffering = Extract<BookingOffering, { mode: 'duration' }>;
type SlotsOffering = Extract<BookingOffering, { mode: 'slots' }>;
type RangeOffering = Extract<BookingOffering, { mode: 'range' }>;
type DaysOffering = Extract<BookingOffering, { mode: 'days' }>;

/** One bookable start for one resource, and what must be free for it. */
interface Option {
  readonly start: number;
  readonly end: number;
  /** The stretch checked for room: the booking plus any buffers. */
  readonly guard: Interval;
  readonly capacity: number;
  /** Which overlapping bookings share this option's seats (`slots`: the same slot). */
  readonly shares?: (b: Busy) => boolean;
}

const weekdayOf = (day: string): number => WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
const isMinute = (ms: unknown): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms % MINUTE_MS === 0;

/** The offering's resources, in its own order; just `only` when one was picked. */
function resourcesFor(q: AvailabilityQuery, only: string | undefined): BookingResource[] {
  const ids = only !== undefined ? q.offering.resourceIds.filter((id) => id === only) : q.offering.resourceIds;
  return ids.map((id) => q.resources.find((r) => r.id === id)).filter((r): r is BookingResource => r !== undefined);
}

/** Bookings start no sooner than the notice allows, and no further ahead than the offering allows. */
function timing(q: AvailabilityQuery, start: number): 'ok' | 'too-soon' | 'too-far' {
  if (start < q.now + q.offering.minNoticeMin * MINUTE_MS) return 'too-soon';
  if (start > q.now + q.offering.maxAdvanceDays * DAY_MS) return 'too-far';
  return 'ok';
}

/** How far a booking reaches before and after its start, buffers included. */
interface Extent {
  readonly before: number;
  readonly after: number;
}

/** The extent of the offering's bookings; for `days`, of the single night or day a listing looks at. */
function extent(o: BookingOffering): Extent {
  if (o.mode === 'duration') return { before: o.bufferBeforeMin * MINUTE_MS, after: (o.durationMin + o.bufferAfterMin) * MINUTE_MS };
  if (o.mode === 'slots') return { before: 0, after: Math.max(...o.slots.map((s) => s.durationMin)) * MINUTE_MS };
  if (o.mode === 'range') return { before: 0, after: o.maxMin * MINUTE_MS };
  return { before: 0, after: 2 * DAY_MS };
}

/**
 * Local dates to look at for bookings starting between instants `from` and `to`: their whole `reach`, and
 * one day of margin either side, which covers any offset. Covering the whole booking matters: a weekly
 * block beyond the dates goes unseen, and the check would accept what it must refuse.
 */
function datesFor(r: BookingResource, reach: Extent, from: number, to: number): Ymd[] {
  return [...datesBetween(addDays(localDateOf(from - reach.before, r.timeZone), -1), addDays(localDateOf(to + reach.after, r.timeZone), 1))];
}

/** What takes up `r` on local dates `dates` (the caller's busy list plus its blocked times), indexed. */
function occupancyFor(q: AvailabilityQuery, r: BookingResource, dates: Ymd[]): Occupancy {
  return new Occupancy([...(q.busy.get(r.id) ?? []), ...blockedBetween(r, dates[0]!, dates[dates.length - 1]!)]);
}

function* durationOptions(o: DurationOffering, r: BookingResource, dates: Ymd[]): Generator<Option> {
  const length = o.durationMin * MINUTE_MS;
  const step = (o.stepMin ?? o.durationMin) * MINUTE_MS;
  // A config that skipped validation must not spin the event loop for ever.
  if (!(length >= MINUTE_MS) || !(step >= MINUTE_MS)) return;
  const { anchors, merged } = openBetween(r, dates);
  for (const open of anchors) {
    // Starts lie in this date's opening; the booking may run on into an opening that continues it.
    const reach = merged.find((m) => m.start <= open.start && open.start < m.end)?.end ?? open.end;
    for (let start = open.start; start < open.end && start + length <= reach; start += step) {
      const end = start + length;
      yield { start, end, guard: { start: start - o.bufferBeforeMin * MINUTE_MS, end: end + o.bufferAfterMin * MINUTE_MS }, capacity: r.capacity };
    }
  }
}

function* slotOptions(o: SlotsOffering, r: BookingResource, dates: Ymd[]): Generator<Option> {
  for (const date of dates) {
    const wd = weekdayIndex(date);
    for (const slot of o.slots) {
      if (!slot.days.some((d) => weekdayOf(d) === wd)) continue;
      const start = zonedToInstant(date, clockMinutes(slot.at), r.timeZone);
      const end = start + slot.durationMin * MINUTE_MS;
      // Seats on the same slot of the same offering are shared; anything else there takes the resource.
      const shares = (b: Busy): boolean => b.offeringId === o.id && b.start === start;
      yield { start, end, guard: { start, end }, capacity: slot.capacity ?? r.capacity, shares };
    }
  }
}

function timeOptions(o: BookingOffering, r: BookingResource, dates: Ymd[]): Iterable<Option> {
  if (o.mode === 'duration') return durationOptions(o, r, dates);
  if (o.mode === 'slots') return slotOptions(o, r, dates);
  return [];
}

/** The stretch `units` nights or days of a `days` offering occupy, starting on `date`. */
function unitSpan(o: DaysOffering, r: BookingResource, date: Ymd, units: number): Interval {
  if (o.unit === 'day') return { start: zonedToInstant(date, 0, r.timeZone), end: zonedToInstant(addDays(date, units), 0, r.timeZone) };
  return {
    start: zonedToInstant(date, clockMinutes(o.checkIn), r.timeZone),
    end: zonedToInstant(addDays(date, units), clockMinutes(o.checkOut), r.timeZone),
  };
}

/** The window a listing really covers: from now at the earliest, and no wider than its mode allows. */
function listWindow(q: ListQuery): Interval | null {
  if (![q.from, q.to, q.now].every(Number.isFinite)) return null;
  const from = Math.max(q.from, q.now);
  const span = (q.offering.mode === 'days' ? MAX_LIST_DAYS.days : MAX_LIST_DAYS.minutes) * DAY_MS;
  const to = Math.min(q.to, from + span, q.now + (q.offering.maxAdvanceDays + 1) * DAY_MS);
  return to > from ? { start: from, end: to } : null;
}

function listTimes(q: AvailabilityQuery, w: Interval): Availability {
  const byStart = new Map<number, { end: number; resourceIds: string[]; seatsLeft: number }>();
  for (const r of resourcesFor(q, q.resourceId)) {
    const dates = datesFor(r, extent(q.offering), w.start, w.end);
    const occupancy = occupancyFor(q, r, dates);
    for (const opt of timeOptions(q.offering, r, dates)) {
      if (opt.start < w.start || opt.start >= w.end || timing(q, opt.start) !== 'ok') continue;
      const left = opt.capacity - occupancy.peak(opt.guard.start, opt.guard.end, opt.shares);
      if (left < 1) continue;
      const t = byStart.get(opt.start);
      if (!t) byStart.set(opt.start, { end: opt.end, resourceIds: [r.id], seatsLeft: left });
      else if (!t.resourceIds.includes(r.id)) {
        t.resourceIds.push(r.id);
        t.seatsLeft += left;
      }
    }
  }
  const times = [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, t]) => ({ start, ...t }));
  return { kind: 'times', times: times.slice(0, MAX_LIST_ENTRIES), truncated: times.length > MAX_LIST_ENTRIES };
}

/** Minutes past local midnight at instant `ms`. */
function clockOf(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * The first point of the local `stepMin` grid at or after `ms` (`direction` 1), or at or before it (−1).
 * Moves in REAL time, a whole number of minutes at a time, rechecking the clock after each move: going
 * back through wall-clock time instead would, on a night the clocks fall back, land on the first of two
 * 02:30s, before the point it started from. A few moves at most: the grid divides the day.
 */
function snapToGrid(ms: number, stepMin: number, timeZone: string, direction: 1 | -1): number {
  let t = (direction === 1 ? Math.ceil(ms / MINUTE_MS) : Math.floor(ms / MINUTE_MS)) * MINUTE_MS;
  for (let i = 0; i < 4; i += 1) {
    const off = clockOf(t, timeZone) % stepMin;
    if (off === 0) return t;
    t += (direction === 1 ? stepMin - off : -off) * MINUTE_MS;
  }
  return t;
}

function listWindows(q: AvailabilityQuery, o: RangeOffering, w: Interval): Availability {
  const earliest = Math.max(w.start, q.now + o.minNoticeMin * MINUTE_MS);
  const out: FreeWindow[] = [];
  for (const r of resourcesFor(q, q.resourceId)) {
    const dates = datesFor(r, extent(q.offering), w.start, w.end);
    const occupancy = occupancyFor(q, r, dates);
    for (const open of openBetween(r, dates).merged) {
      const within = { start: Math.max(open.start, earliest), end: open.end };
      if (within.start >= w.end || within.end - within.start < o.minMin * MINUTE_MS) continue;
      for (const free of occupancy.free(within, r.capacity, 1)) {
        // Both ends on the grid a booking must use, so everything shown can be booked.
        const start = snapToGrid(free.start, o.stepMin, r.timeZone, 1);
        const end = snapToGrid(free.end, o.stepMin, r.timeZone, -1);
        if (end - start < o.minMin * MINUTE_MS || start >= w.end || timing(q, start) === 'too-far') continue;
        out.push({ resourceId: r.id, start, end });
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  return { kind: 'windows', windows: out.slice(0, MAX_LIST_ENTRIES), truncated: out.length > MAX_LIST_ENTRIES };
}

function listDays(q: AvailabilityQuery, o: DaysOffering, w: Interval): Availability {
  const byDate = new Map<string, string[]>();
  for (const r of resourcesFor(q, q.resourceId)) {
    const dates = datesFor(r, extent(q.offering), w.start, w.end);
    const occupancy = occupancyFor(q, r, dates);
    for (const date of dates) {
      const span = unitSpan(o, r, date, 1);
      if (span.start < w.start || span.start >= w.end || timing(q, span.start) !== 'ok') continue;
      if (occupancy.peak(span.start, span.end) + 1 > r.capacity) continue;
      const key = formatYmd(date);
      byDate.set(key, [...(byDate.get(key) ?? []), r.id]);
    }
  }
  const days = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, resourceIds]) => ({ date, resourceIds }));
  return { kind: 'days', days: days.slice(0, MAX_LIST_ENTRIES), truncated: days.length > MAX_LIST_ENTRIES };
}

/**
 * What can be booked between `q.from` and `q.to`, in the shape the offering's mode calls for. The window
 * starts no earlier than now and is cut to {@link MAX_LIST_DAYS} and the offering's horizon here, whatever
 * the caller asked: the work grows with it, not just the answer. A window that makes no sense lists nothing.
 */
export function listAvailability(q: ListQuery): Availability {
  const o = q.offering;
  const w = listWindow(q);
  const kind = o.mode === 'range' ? 'windows' : o.mode === 'days' ? 'days' : 'times';
  if (!w) return kind === 'windows' ? { kind, windows: [], truncated: false } : kind === 'days' ? { kind, days: [], truncated: false } : { kind, times: [], truncated: false };
  if (o.mode === 'range') return listWindows(q, o, w);
  if (o.mode === 'days') return listDays(q, o, w);
  return listTimes(q, w);
}

const fail = (reason: CheckFailure, detail: string): CheckResult => ({ ok: false, reason, detail });
const TOO_SOON = 'that is too soon to book';
const TOO_FAR = 'that is too far ahead to book';

/** Whether `quantity` more fit into the option, given what already occupies its resource. */
function fits(occupancy: Occupancy, opt: Option, quantity: number): boolean {
  return occupancy.peak(opt.guard.start, opt.guard.end, opt.shares) + quantity <= opt.capacity;
}

/** `duration` and `slots`: the start must be one the offering offers, on a resource with room. */
function checkTime(q: AvailabilityQuery, rs: BookingResource[], start: number, quantity: number): CheckResult {
  let offered = false;
  for (const r of rs) {
    const dates = datesFor(r, extent(q.offering), start, start);
    let occupancy: Occupancy | undefined;
    for (const opt of timeOptions(q.offering, r, dates)) {
      if (opt.start !== start) continue;
      offered = true;
      occupancy ??= occupancyFor(q, r, dates);
      if (fits(occupancy, opt, quantity)) return { ok: true, resourceId: r.id, start: opt.start, end: opt.end };
    }
  }
  return offered ? fail('taken', 'that time is no longer free') : fail('not-offered', 'that is not a time this can be booked at');
}

/** `range`: a length within the limits, on the clock grid, inside one opening, on a resource with room. */
function checkRange(q: AvailabilityQuery, o: RangeOffering, rs: BookingResource[], start: number, end: number, quantity: number): CheckResult {
  const length = (end - start) / MINUTE_MS;
  if (!(length >= o.minMin && length <= o.maxMin)) return fail('invalid', `a booking lasts ${o.minMin}–${o.maxMin} minutes`);
  let offered = false;
  for (const r of rs) {
    if (clockOf(start, r.timeZone) % o.stepMin !== 0 || clockOf(end, r.timeZone) % o.stepMin !== 0) continue;
    const dates = datesFor(r, { before: 0, after: end - start }, start, start);
    if (!openBetween(r, dates).merged.some((m) => m.start <= start && end <= m.end)) continue;
    offered = true;
    if (fits(occupancyFor(q, r, dates), { start, end, guard: { start, end }, capacity: r.capacity }, quantity)) return { ok: true, resourceId: r.id, start, end };
  }
  return offered ? fail('taken', 'that time is no longer free') : fail('not-offered', 'that is outside the opening hours, or off the time grid');
}

/** `days`: a whole number of nights or days within the limits, all free on one resource. */
function checkDays(q: AvailabilityQuery, o: DaysOffering, rs: BookingResource[], date: string, units: number, quantity: number): CheckResult {
  if (!isLocalDate(date) || !Number.isInteger(units)) return fail('invalid', 'a start date and a whole number of nights or days');
  if (units < o.minUnits || units > o.maxUnits) return fail('invalid', `${o.minUnits}–${o.maxUnits} ${o.unit === 'night' ? 'nights' : 'days'}`);
  let timingFailure: 'too-soon' | 'too-far' | null = null;
  let anyInTime = false;
  for (const r of rs) {
    const span = unitSpan(o, r, parseYmd(date), units);
    const t = timing(q, span.start);
    if (t !== 'ok') {
      timingFailure = t;
      continue;
    }
    anyInTime = true;
    if (fits(occupancyFor(q, r, datesFor(r, { before: 0, after: span.end - span.start }, span.start, span.start)), { ...span, guard: span, capacity: r.capacity }, quantity)) return { ok: true, resourceId: r.id, ...span };
  }
  if (anyInTime || !timingFailure) return fail('taken', 'those dates are no longer free');
  return fail(timingFailure, timingFailure === 'too-soon' ? TOO_SOON : TOO_FAR);
}

/**
 * Whether `req` can be booked now, and on which resource. With several resources the first in the
 * offering's order that has room takes it. Times are whole minutes; anything else is refused.
 */
export function checkRequest(q: AvailabilityQuery, req: BookingRequest): CheckResult {
  const o = q.offering;
  if (!req || typeof req !== 'object') return fail('invalid', 'a booking request');
  const quantity = req.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > o.maxQuantity) return fail('invalid', `book 1–${o.maxQuantity} at a time`);
  const chosen = req.resourceId ?? q.resourceId;
  if (chosen !== undefined && (typeof chosen !== 'string' || !o.resourceIds.includes(chosen))) return fail('unknown-resource', 'not a resource of this offering');
  const rs = resourcesFor(q, chosen);
  if (rs.length === 0) return fail('unknown-resource', 'this offering has no resource to book');

  if (o.mode === 'days') {
    if (!('date' in req) || typeof req.date !== 'string' || typeof req.units !== 'number') return fail('invalid', 'a start date and a number of nights or days');
    return checkDays(q, o, rs, req.date, req.units, quantity);
  }
  if (!('start' in req) || !isMinute(req.start)) return fail('invalid', 'a start time, in whole minutes');
  const t = timing(q, req.start);
  if (t !== 'ok') return fail(t, t === 'too-soon' ? TOO_SOON : TOO_FAR);
  if (o.mode === 'range') {
    if (!isMinute(req.end) || req.end <= req.start) return fail('invalid', 'an end after the start, in whole minutes');
    return checkRange(q, o, rs, req.start, req.end, quantity);
  }
  return checkTime(q, rs, req.start, quantity);
}

import { WEEKDAYS, clockMinutes, type BookingResource } from '@sitewright/schema';
import { DAY_MS, addDays, datesBetween, parseYmd, weekdayIndex, zonedToInstant, type Ymd } from './zoned.js';

/**
 * What a resource is doing, as instants: when it is open, and how much of it is taken when.
 */

/** A stretch of time, `[start, end)` in epoch milliseconds. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/**
 * Something that takes up a resource for a while. A stored booking's stretch INCLUDES its own buffers, so
 * the room it needed after it stays kept whatever is booked next.
 *   `units`       how many of its seats or units it takes. Absent: ALL of them: an event read from the
 *                 owner's own calendar, a blocked time. Nothing else may share the resource then.
 *   `exclusive`   a `slots` booking: it shares seats only with bookings of the same slot (`offeringId` +
 *                 `start`), and takes the whole resource for anything else, as the tour takes its guide.
 *   `offeringId`  which offering it was booked through.
 */
export interface Busy extends Interval {
  readonly units?: number;
  readonly exclusive?: boolean;
  readonly offeringId?: string;
}

const weekdayOf = (day: string): number => WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);

/** The resource's opening intervals on one local date, merged and in order. */
export function openOn(resource: BookingResource, date: Ymd): Interval[] {
  const wd = weekdayIndex(date);
  const spans = resource.hours
    .filter((r) => r.days.some((d) => weekdayOf(d) === wd))
    .map((r) => ({
      start: zonedToInstant(date, clockMinutes(r.from), resource.timeZone),
      end: zonedToInstant(date, clockMinutes(r.to), resource.timeZone),
    }))
    .filter((s) => s.end > s.start);
  return merge(spans);
}

/**
 * Opening hours over several dates. `anchors` are each date's own openings: a grid of start times begins at
 * each of them, so it never depends on how far back a question looked. `merged` joins openings that touch
 * across midnight (Monday until 24:00, Tuesday from 00:00), so a booking may run on through it.
 */
export function openBetween(resource: BookingResource, dates: readonly Ymd[]): { anchors: Interval[]; merged: Interval[] } {
  const anchors = dates.flatMap((date) => openOn(resource, date));
  return { anchors, merged: merge(anchors) };
}

/** Overlapping or touching intervals joined, in order. */
export function merge(spans: readonly Interval[]): Interval[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) out[out.length - 1] = { start: last.start, end: Math.max(last.end, s.end) };
    else out.push(s);
  }
  return out;
}

/** The resource's blocked times that fall on local dates `from`–`to`, as busy stretches taking all of it. */
export function blockedBetween(resource: BookingResource, from: Ymd, to: Ymd): Busy[] {
  const tz = resource.timeZone;
  const out: Busy[] = [];
  for (const b of resource.blocks) {
    if (b.kind === 'dates') {
      out.push({ start: zonedToInstant(parseYmd(b.from), 0, tz), end: zonedToInstant(addDays(parseYmd(b.to), 1), 0, tz) });
    } else if (b.kind === 'once') {
      out.push({
        start: zonedToInstant(parseYmd(b.start.slice(0, 10)), clockMinutes(b.start.slice(11)), tz),
        end: zonedToInstant(parseYmd(b.end.slice(0, 10)), clockMinutes(b.end.slice(11)), tz),
      });
    } else {
      const days = new Set(b.days.map(weekdayOf));
      for (const date of datesBetween(from, to)) {
        if (!days.has(weekdayIndex(date))) continue;
        out.push({ start: zonedToInstant(date, clockMinutes(b.from), tz), end: zonedToInstant(date, clockMinutes(b.to), tz) });
      }
    }
  }
  return out;
}

/** Who shares a resource with whom, by default: every booking counts its units, except a slot's. */
export const sharesByDefault = (b: Busy): boolean => !b.exclusive;

/**
 * The most seats or units in use at any one moment of `[start, end)`. Infinity when something taking the
 * whole resource overlaps it. Two bookings one after the other never add up: a 09–10 and a 10–11 booking
 * leave room for a 09–11 one on a resource with a capacity of two.
 *
 * `shares` decides which overlapping bookings count their units; the rest take the whole resource.
 */
export function peakUse(busy: readonly Busy[], start: number, end: number, shares: (b: Busy) => boolean = sharesByDefault): number {
  const edges: Array<[number, number]> = [];
  for (const b of busy) {
    if (b.end <= start || b.start >= end) continue;
    if (b.units === undefined || !shares(b)) return Infinity;
    edges.push([Math.max(b.start, start), b.units], [Math.min(b.end, end), -b.units]);
  }
  // At the same instant an ending is counted before a starting: back-to-back bookings do not overlap.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let used = 0;
  let peak = 0;
  for (const [, delta] of edges) {
    used += delta;
    peak = Math.max(peak, used);
  }
  return peak;
}

/**
 * The stretches of `within` where at least `need` units are free, given what is `busy`. Used for `range`
 * offerings, where the visitor picks the start and the end. One sweep over the edges, so it stays cheap
 * however many bookings fall inside a long opening.
 */
export function freeWithin(busy: readonly Busy[], within: Interval, capacity: number, need: number): Interval[] {
  // [time, units, closures]: a booking moves the units in use, anything taking the whole resource the closures.
  const edges: Array<[number, number, number]> = [];
  for (const b of busy) {
    if (b.end <= within.start || b.start >= within.end) continue;
    const whole = b.units === undefined || !sharesByDefault(b);
    edges.push([Math.max(b.start, within.start), whole ? 0 : b.units!, whole ? 1 : 0]);
    edges.push([Math.min(b.end, within.end), whole ? 0 : -b.units!, whole ? -1 : 0]);
  }
  edges.sort((a, b) => a[0] - b[0]);
  const free: Interval[] = [];
  let units = 0;
  let closures = 0;
  let i = 0;
  for (let cursor = within.start; cursor < within.end; ) {
    // Everything changing at or before the cursor applies to the stretch that starts there.
    for (; i < edges.length && edges.at(i)![0] <= cursor; i += 1) {
      units += edges.at(i)![1];
      closures += edges.at(i)![2];
    }
    const next = i < edges.length ? Math.min(edges.at(i)![0], within.end) : within.end;
    if (closures === 0 && units + need <= capacity) free.push({ start: cursor, end: next });
    cursor = next;
  }
  return merge(free);
}

/** The index of the first element of `sorted` whose `key` is at least `value`. */
function lowerBound<T>(sorted: readonly T[], value: number, key: (t: T) => number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(sorted.at(mid)!) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * One resource's busy list, indexed once so each question about it is cheap. A listing asks it tens of
 * thousands of times (every start on the grid, on every day, for every resource), so a linear scan per
 * question does not scale: 20 resources, a 5-minute grid and 200 weekly blocks took 15 s that way.
 *
 *   - Stretches taking the WHOLE resource (blocked times, events from the owner's own calendar) are merged
 *     into sorted, disjoint intervals: "is anything closing it here?" is one binary search.
 *   - Bookings with units stay sorted by start. Only those starting after `start − longest booking` and
 *     before `end` can overlap `[start, end)`, so only those are looked at.
 */
export class Occupancy {
  private readonly closed: Interval[];
  /** Bookings of up to a day, sorted by start: only those starting within a day before a stretch can overlap it. */
  private readonly booked: Busy[];
  /** Longer bookings (stays, rentals): few, and looked at one by one, so one of them cannot widen every search. */
  private readonly long: Busy[];

  constructor(busy: readonly Busy[]) {
    this.closed = merge(busy.filter((b) => b.units === undefined && b.end > b.start));
    const units = busy.filter((b) => b.units !== undefined && b.end > b.start);
    this.booked = units.filter((b) => b.end - b.start <= DAY_MS).sort((a, b) => a.start - b.start);
    this.long = units.filter((b) => b.end - b.start > DAY_MS);
  }

  /** Whether something taking the whole resource overlaps `[start, end)`. */
  private isClosed(start: number, end: number): boolean {
    const i = lowerBound(this.closed, start + 1, (c) => c.end);
    const c = this.closed.at(i);
    return c !== undefined && c.start < end;
  }

  /** The bookings that overlap `[start, end)`. */
  private bookedDuring(start: number, end: number): Busy[] {
    const from = lowerBound(this.booked, start - DAY_MS, (b) => b.start);
    const to = lowerBound(this.booked, end, (b) => b.start);
    const short = this.booked.slice(from, to).filter((b) => b.end > start);
    return [...short, ...this.long.filter((b) => b.start < end && b.end > start)];
  }

  /** {@link peakUse} over this resource. */
  peak(start: number, end: number, shares?: (b: Busy) => boolean): number {
    if (this.isClosed(start, end)) return Infinity;
    return peakUse(this.bookedDuring(start, end), start, end, shares);
  }

  /** {@link freeWithin} over this resource. */
  free(within: Interval, capacity: number, need: number): Interval[] {
    const i = lowerBound(this.closed, within.start + 1, (c) => c.end);
    const closing: Busy[] = [];
    for (const c of this.closed.slice(i)) {
      if (c.start >= within.end) break;
      closing.push(c);
    }
    return freeWithin([...closing, ...this.bookedDuring(within.start, within.end)], within, capacity, need);
  }
}

/**
 * Wall-clock time in an IANA time zone, with the runtime's own time-zone data (Intl). No library: the only
 * questions asked are "what does the clock show in zone Z at instant T" and its inverse.
 *
 * The inverse is the hard one, because a wall-clock time is not always one instant:
 *   - in a spring-forward GAP it names no instant (02:30 on the night Berlin skips from 02:00 to 03:00).
 *     It is moved forward by the gap, so 02:30 is 03:30: the time a clock-watcher would actually meet.
 *   - in a fall-back OVERLAP it names two (02:30 happens twice). The EARLIER is taken, so a booking never
 *     starts an hour later than the time it was offered at.
 * These are the "compatible" rules Temporal and RFC 5545 use.
 */

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

/** A calendar date with no time zone. */
export interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

export interface ZonedParts extends Ymd {
  readonly hour: number;
  readonly minute: number;
}

/** Bounds on the caches below: every tenant's time zones share one process. */
const MAX_FORMATTERS = 512;
const MAX_CACHED_DAYS = 50_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    if (formatters.size >= MAX_FORMATTERS) formatters.clear();
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The clock and calendar in `timeZone` at instant `ms` (seconds dropped). */
export function zonedParts(ms: number, timeZone: string): ZonedParts & { second: number } {
  const out: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(ms)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year!, m: out.month!, d: out.day!, hour: out.hour! % 24, minute: out.minute!, second: out.second! };
}

/** How far `timeZone`'s clock is ahead of UTC at instant `ms`, in milliseconds. */
export function offsetAt(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * The offset in force for the whole of `date`, or null when the clock changes during it. Asked once per
 * zone and date: a listing converts the same few dates tens of thousands of times, and each exact
 * conversion costs several Intl calls (about 14 µs).
 */
const dayOffsets = new Map<string, number | null>();

function steadyOffset(date: Ymd, timeZone: string): number | null {
  const key = `${timeZone}|${date.y}-${date.m}-${date.d}`;
  let o = dayOffsets.get(key);
  if (o === undefined) {
    const midnight = Date.UTC(date.y, date.m - 1, date.d);
    const atStart = midnight - exactInstant(date, 0, timeZone);
    const atEnd = midnight + DAY_MS - exactInstant(date, 1440, timeZone);
    o = atStart === atEnd ? atStart : null;
    if (dayOffsets.size >= MAX_CACHED_DAYS) dayOffsets.clear();
    dayOffsets.set(key, o);
  }
  return o;
}

/**
 * The instant at which `timeZone`'s clock shows `minuteOfDay` on `date`. `minuteOfDay` may be 1440 (the
 * next midnight) or more. Gaps move forward, overlaps take the earlier instant (see the module comment).
 */
export function zonedToInstant(date: Ymd, minuteOfDay: number, timeZone: string): number {
  if (minuteOfDay >= 0 && minuteOfDay <= 1440) {
    const o = steadyOffset(date, timeZone);
    if (o !== null) return Date.UTC(date.y, date.m - 1, date.d, 0, minuteOfDay) - o;
  }
  return exactInstant(date, minuteOfDay, timeZone);
}

/** {@link zonedToInstant} worked out from scratch, with no cache. Exported for the tests that compare the two. */
export function exactInstant(date: Ymd, minuteOfDay: number, timeZone: string): number {
  const wall = Date.UTC(date.y, date.m - 1, date.d, 0, minuteOfDay);
  // The offset in force just before and just after: a day either side brackets any one transition.
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const valid = [wall - before, wall - after].filter((t) => wall - offsetAt(t, timeZone) === t);
  if (valid.length > 0) return Math.min(...valid);
  // A gap: no instant shows this time. The offset from before the jump lands just after it.
  return wall - before;
}

/** The calendar date `timeZone` shows at instant `ms`. */
export function localDateOf(ms: number, timeZone: string): Ymd {
  const p = zonedParts(ms, timeZone);
  return { y: p.y, m: p.m, d: p.d };
}

/** `date` moved by `days` calendar days. */
export function addDays(date: Ymd, days: number): Ymd {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 0 = Monday … 6 = Sunday, matching `WEEKDAYS`. */
export function weekdayIndex(date: Ymd): number {
  return (new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay() + 6) % 7;
}

export function parseYmd(value: string): Ymd {
  const [y, m, d] = value.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

export function formatYmd(date: Ymd): string {
  return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

/** Negative, zero or positive as `a` is before, the same as or after `b`. */
export function compareYmd(a: Ymd, b: Ymd): number {
  return Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
}

/** Every calendar date from `from` to `to`, inclusive. */
export function* datesBetween(from: Ymd, to: Ymd): Generator<Ymd> {
  for (let d = from; compareYmd(d, to) <= 0; d = addDays(d, 1)) yield d;
}

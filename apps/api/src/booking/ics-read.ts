import ICAL from 'ical.js';
import { DAY_MS, zonedToInstant } from './zoned.js';
import type { Interval } from './occupancy.js';

/**
 * READING A CALENDAR'S BUSY TIMES from an iCalendar feed (RFC 5545): a Google calendar's secret address, an
 * Outlook published calendar, an Apple calendar, a rental platform's export.
 *
 * Every event that blocks time becomes a busy interval: one-off events, all-day ones, and each occurrence of a
 * recurring one (RRULE/RDATE, minus EXDATE, with moved or changed occurrences honoured). Events marked
 * free (TRANSP:TRANSPARENT) or cancelled do not block.
 *
 * ★ Times are converted WITHOUT ical.js's global time-zone registry: that registry is one per process, and a
 * tenant's calendar defining its own "Europe/Berlin" would change how every other tenant's calendar reads. A
 * named zone is read with the platform's own zone code, a zone the calendar defines in a VTIMEZONE is used for
 * that calendar alone, and a floating time or an all-day date is on the resource's clock.
 * ★ Without the registry ical.js treats a named zone's time as FLOATING, so every comparison it would make across
 * zones is wrong (a UTC UNTIL, a UTC EXDATE, an RDATE in another zone, a DTEND in another zone). ical.js therefore
 * only steps through the rule, on the series' own clock. Everything else is done here, on instants.
 * ★ Bounded: the feed's size, its events, the occurrences one event may expand to, and the intervals kept.
 * ★ Runs in a worker thread in production (`ics-isolated.ts`): ical.js can loop forever inside one call. So this
 * module is light (no schema package) and erasable TypeScript (Node strips its types when a test runs it there).
 */

export const ICS_LIMITS = {
  /** A feed larger than this is refused rather than parsed. */
  maxBytes: 5 * 1024 * 1024,
  maxEvents: 20_000,
  /** Occurrences one recurring event is walked through, from its first, before giving up on the calendar. */
  maxStepsPerEvent: 50_000,
  /** Steps (events, occurrences, extra dates) across the whole calendar. */
  maxSteps: 400_000,
  /** Wall-clock time one reading may take. */
  maxMs: 5_000,
  /** Busy intervals kept for one calendar. Past this the reading is incomplete, and treated as unreadable. */
  maxIntervals: 50_000,
  /** Work done between two yields to the event loop, so other requests are served while a big feed is read. */
  sliceSteps: 2_000,
} as const;

export type IcsParseResult = { ok: true; intervals: Interval[]; events: number } | { ok: false; error: string };

export interface IcsReadOptions {
  from: number;
  to: number;
  /** The resource's clock, for floating times and all-day dates. */
  timeZone: string;
  /** Events this project wrote itself (`<claim>@<project>`), which a subscribed copy of its own feed would count twice. */
  ownUidSuffix?: string;
  now?: () => number;
}

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;
type Event = InstanceType<typeof ICAL.Event>;
type Zone = { kind: 'iana'; name: string } | { kind: 'vtimezone'; zone: InstanceType<typeof ICAL.Timezone> } | { kind: 'utc' } | { kind: 'local' };
/** A "this and future" change: every occurrence after `at` stands `delta` later, `length` long. */
type Shift = { at: number; delta: number; length: number };

const NOT_ICS = 'this is not an iCalendar (.ics) file';
export const TOO_BIG = 'the calendar is too large to read';
export const UNREADABLE = 'the calendar could not be read';
const TOO_FREQUENT = 'the calendar has a recurring event too frequent to read';

/** True for an IANA time zone this runtime knows. (The schema package's check, kept here to keep this module light.) */
function isTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Thrown to stop a reading that is over its budget. */
class OverBudget extends Error {}

/**
 * The busy intervals of an iCalendar text between `from` and `to`, merged and in order.
 *
 * ★ Never reads less than is there: a recurring event that could not be walked to the end of the window, or a
 * calendar beyond the budgets, is UNREADABLE (so the resource fails closed), not read as free.
 * ★ Yields to the event loop as it goes, and gives up after `maxMs`: one tenant's feed never stalls the others.
 */
export async function readIcsBusy(text: string, opts: IcsReadOptions): Promise<IcsParseResult> {
  if (text.length > ICS_LIMITS.maxBytes) return { ok: false, error: 'the calendar is larger than 5 MB' };
  let jcal: unknown;
  try {
    jcal = ICAL.parse(text);
  } catch {
    return { ok: false, error: NOT_ICS };
  }
  const [name, , children] = Array.isArray(jcal) ? (jcal as [unknown, unknown, unknown]) : [];
  if (name !== 'vcalendar' || !Array.isArray(children)) return { ok: false, error: NOT_ICS };
  const parts = children as Array<[string, ...unknown[]]>;
  const events = parts.filter((c) => c[0] === 'vevent');
  if (events.length > ICS_LIMITS.maxEvents) return { ok: false, error: `the calendar has more than ${ICS_LIMITS.maxEvents} events` };
  try {
    const reading = new IcsReading(parts, opts);
    const error = await reading.read(events);
    return error ? { ok: false, error } : { ok: true, intervals: mergeIntervals(reading.out), events: events.length };
  } catch (err) {
    return { ok: false, error: err instanceof OverBudget ? TOO_BIG : UNREADABLE };
  }
}

class IcsReading {
  out: Interval[] = [];
  private readonly zonesRoot: Component;
  /** The calendar's own zone definitions, for this calendar only. */
  private readonly defined = new Map<string, InstanceType<typeof ICAL.Timezone>>();
  /** Each TZID resolved once: checking a zone name builds an Intl formatter, far too slow per occurrence. */
  private readonly zones = new Map<string, Zone>();
  private readonly opts: IcsReadOptions;
  private readonly clock: () => number;
  private readonly deadline: number;
  private work = 0;
  /** Overlapping intervals (many series at one time) are joined before they count against the cap. */
  private compactAt: number = ICS_LIMITS.maxIntervals;

  constructor(parts: Array<[string, ...unknown[]]>, opts: IcsReadOptions) {
    this.opts = opts;
    this.clock = opts.now ?? Date.now;
    this.deadline = this.clock() + ICS_LIMITS.maxMs;
    // ★ The events hang off a calendar holding ONLY the zone definitions: ical.js looks a TZID up in the event's
    // calendar on every date it reads, does not remember a miss, and scans all the calendar's parts each time. A
    // Google or Apple feed names zones it does not define, so 20 000 events took minutes. Now a miss scans the zones.
    this.zonesRoot = new ICAL.Component(['vcalendar', [], parts.filter((c) => c[0] === 'vtimezone')]);
    for (const vtz of this.zonesRoot.getAllSubcomponents('vtimezone')) {
      try {
        const tz = new ICAL.Timezone(vtz);
        if (tz.tzid) this.defined.set(String(tz.tzid), tz);
      } catch {
        // A zone that does not parse: its times fall back to the resource's clock.
      }
    }
  }

  /** Reads every event; the error that made the calendar unreadable, if one did. */
  async read(data: Array<[string, ...unknown[]]>): Promise<string | null> {
    // A recurring event and its changed occurrences (RECURRENCE-ID) share a UID. A changed occurrence is read at
    // its own time, and its original time is skipped in the series. Two recurring events with one UID are both read.
    const masters: Event[] = [];
    const replaced = new Map<string, Set<number>>();
    const shifts = new Map<string, Shift[]>();
    for (const raw of data) {
      await this.step();
      const v = new ICAL.Component(raw, this.zonesRoot);
      // An event with no start is not a time (RFC 5545 requires one); it blocks nothing.
      if (!v.hasProperty('dtstart')) continue;
      // ★ No exceptions given: else ical.js relates EVERY changed occurrence in the calendar to this event,
      // whatever its UID (and scans the whole calendar per event to find them).
      const ev = new ICAL.Event(v, { exceptions: [] });
      const uid = String(ev.uid);
      if (this.opts.ownUidSuffix && uid.endsWith(this.opts.ownUidSuffix)) continue;
      if (v.hasProperty('recurrence-id')) {
        const originals = this.instantsOf(v, 'recurrence-id');
        const set = replaced.get(uid) ?? new Set<number>();
        for (const at of originals) set.add(at);
        replaced.set(uid, set);
        const own = this.span(v, ev.startDate, ev.endDate);
        if (String(v.getFirstProperty('recurrence-id')?.getParameter('range') ?? '').toUpperCase() === 'THISANDFUTURE') {
          const list = shifts.get(uid) ?? [];
          for (const at of originals) list.push({ at, delta: own.start - at, length: own.end - own.start });
          shifts.set(uid, list);
        }
        // A changed occurrence stands at its own time, whether its series is here or not.
        if (!this.add(v, own.start, own.end)) return TOO_BIG;
      } else if (ev.isRecurring()) {
        masters.push(ev);
      } else {
        const own = this.span(v, ev.startDate, ev.endDate);
        if (!this.add(v, own.start, own.end)) return TOO_BIG;
      }
    }
    for (const ev of masters) {
      const uid = String(ev.uid);
      const error = await this.readSeries(ev, replaced.get(uid) ?? new Set(), [...(shifts.get(uid) ?? [])].sort((a, b) => a.at - b.at));
      if (error) return error;
    }
    return null;
  }

  /**
   * One recurring event. ical.js walks the RRULE on the series' clock; the limits, the extra dates (RDATE), the
   * removed ones (EXDATE) and the changed ones are applied here, on instants.
   */
  private async readSeries(ev: Event, replaced: ReadonlySet<number>, moves: readonly Shift[]): Promise<string | null> {
    const c = ev.component;
    const tzid = this.tzidOf(c, 'dtstart');
    const first = this.span(c, ev.startDate, ev.endDate);
    // RFC 5545 §3.8.5.3: every occurrence lasts exactly as long as the first, with DTEND and DTSTART each read on
    // their own clock. A DURATION is a span of the series' clock (a day is a calendar day across a clock change).
    const exact = first.end - first.start;
    const nominal = ev.duration;
    const byDuration = !c.hasProperty('dtend');
    const endOf = (start: Time, at: number, zone: string | undefined): number => {
      const wall = start.clone();
      wall.addDuration(nominal);
      const byClock = this.instant(wall, zone);
      if (start.isDate) return byClock > at ? byClock : at + DAY_MS;
      return byDuration ? Math.max(at + exact, byClock) : at + exact;
    };

    const last = this.lastStart(c, tzid, ev.startDate.isDate);
    const extra = await this.extraDates(c, endOf);
    const skip = new Set([...replaced, ...this.instantsOf(c, 'exdate')]);
    // ★ ical.js would compare these with the occurrences as floating times: they are applied here instead.
    c.removeAllProperties('rdate');
    c.removeAllProperties('exdate');

    const earliest = moves.reduce((m, s) => Math.min(m, s.delta), 0);
    const reach = moves.reduce((m, s) => Math.max(m, s.delta + s.length), Math.max(0, exact, nominal.toSeconds() * 1000)) + DAY_MS;
    const occur = (at: number, end: number): boolean => {
      if (skip.has(at)) return true;
      if (!this.add(c, at, end)) return false;
      // After a "this and future" change the later occurrences stand moved too. Both times count: keeping free a
      // time that may be taken is the one mistake this must not make.
      let move: Shift | undefined;
      for (const m of moves) {
        if (m.at >= at) break;
        move = m;
      }
      return !move || this.add(c, at + move.delta, at + move.delta + move.length);
    };

    for (const x of extra) {
      await this.step();
      if (!occur(x.at, x.end)) return TOO_BIG;
    }
    const it = ev.iterator();
    for (let n = 0; n < ICS_LIMITS.maxStepsPerEvent; n += 1) {
      await this.step();
      const next = it.next();
      const at = next ? this.instant(next, tzid) : Infinity;
      // Occurrences come in the order of their original times: once one is past the limit or the window, the rest are.
      if (at > last || at + earliest >= this.opts.to) return null;
      // Ended before the window: passed over without working out its end (most of a long series' cost).
      if (at + reach <= this.opts.from) continue;
      if (!occur(at, endOf(next!, at, tzid))) return TOO_BIG;
    }
    // Walked as far as allowed without reaching the window's end: what is left is unknown, so unreadable.
    return TOO_FREQUENT;
  }

  /**
   * The latest instant an occurrence may start at, from the rules' UNTIL (inclusive). ★ Taken off the rules: ical.js
   * would compare a UTC UNTIL with a floating time and drop the last occurrence east of UTC. Several rules: the
   * latest limit, and none if any rule has none (too many occurrences, never too few).
   */
  private lastStart(c: Component, tzid: string | undefined, isDateSeries: boolean): number {
    const rules = c.getAllProperties('rrule');
    if (rules.length === 0) return Infinity;
    let last = -Infinity;
    for (const p of rules) {
      const rule = p.getFirstValue() as InstanceType<typeof ICAL.Recur> | null;
      if (!rule?.until) return Infinity;
      // A date UNTIL on a timed series (not what RFC 5545 allows, but written): that whole day, generously.
      const limit = rule.until.isDate && !isDateSeries ? this.instant(rule.until, tzid) + 2 * DAY_MS : this.instant(rule.until, tzid);
      last = Math.max(last, limit);
      rule.until = null;
    }
    return last;
  }

  /** The extra dates (RDATE) of a series, each on its own clock; a PERIOD with its own end. */
  private async extraDates(c: Component, endOf: (start: Time, at: number, zone: string | undefined) => number): Promise<Array<{ at: number; end: number }>> {
    const out: Array<{ at: number; end: number }> = [];
    for (const p of c.getAllProperties('rdate')) {
      const zone = p.getParameter('tzid') as string | undefined;
      for (const v of p.getValues()) {
        await this.step();
        if (v instanceof ICAL.Period) {
          const at = this.instant(v.start, zone);
          out.push({ at, end: this.instant(v.getEnd(), zone) });
        } else if (v instanceof ICAL.Time) {
          const at = this.instant(v, zone);
          out.push({ at, end: endOf(v, at, zone) });
        }
      }
    }
    return out;
  }

  /** Counts one step of work; every slice, yields to the event loop and checks the budgets. */
  private async step(): Promise<void> {
    this.work += 1;
    if (this.work % ICS_LIMITS.sliceSteps !== 0) return;
    await yieldNow();
    if (this.clock() > this.deadline || this.work > ICS_LIMITS.maxSteps) throw new OverBudget();
  }

  private blocks(c: Component): boolean {
    const transp = String(c.getFirstPropertyValue('transp') ?? '').toUpperCase();
    const status = String(c.getFirstPropertyValue('status') ?? '').toUpperCase();
    return transp !== 'TRANSPARENT' && status !== 'CANCELLED';
  }

  /** Records a busy interval if the event blocks time. False once the calendar has more than may be kept. */
  private add(c: Component, s: number, e: number): boolean {
    if (!this.blocks(c)) return true;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return true;
    if (e <= this.opts.from || s >= this.opts.to) return true;
    this.out.push({ start: Math.max(s, this.opts.from), end: Math.min(e, this.opts.to) });
    if (this.out.length <= this.compactAt) return true;
    this.out = mergeIntervals(this.out);
    this.compactAt = Math.max(ICS_LIMITS.maxIntervals, this.out.length * 2);
    return this.out.length <= ICS_LIMITS.maxIntervals;
  }

  /** An event's own start and end, each read on its own clock. No end: a day for a date, else an instant. */
  private span(c: Component, start: Time, end: Time): Interval {
    const s = this.instant(start, this.tzidOf(c, 'dtstart'));
    const e = this.instant(end, this.tzidOf(c, 'dtend'));
    return { start: s, end: start.isDate && e <= s ? s + DAY_MS : e };
  }

  private tzidOf(c: Component, prop: 'dtstart' | 'dtend'): string | undefined {
    // An end with no zone of its own (or no end, only a duration) is on the start's clock.
    return (c.getFirstProperty(prop)?.getParameter('tzid') ?? (prop === 'dtend' ? c.getFirstProperty('dtstart')?.getParameter('tzid') : undefined)) as
      | string
      | undefined;
  }

  /** The instants a property's values name (EXDATE may list several; RECURRENCE-ID names one). */
  private instantsOf(c: Component, name: 'exdate' | 'recurrence-id'): number[] {
    return c.getAllProperties(name).flatMap((p) => {
      const tzid = p.getParameter('tzid') as string | undefined;
      return p.getValues().flatMap((v) => (v instanceof ICAL.Time ? [this.instant(v, tzid)] : []));
    });
  }

  private zoneOf(tzid: string | undefined, t: Time): Zone {
    if (t.zone === ICAL.Timezone.utcTimezone) return { kind: 'utc' };
    if (!tzid) return { kind: 'local' };
    let z = this.zones.get(tzid);
    if (!z) {
      const own = this.defined.get(tzid);
      // A named zone is read with the platform's own zone code even where the calendar redefines it; a zone only
      // the calendar defines uses its definition; an unknown one is on the resource's clock (most calendars are).
      z = isTimeZone(tzid) ? { kind: 'iana', name: tzid } : own ? { kind: 'vtimezone', zone: own } : { kind: 'local' };
      this.zones.set(tzid, z);
    }
    return z;
  }

  private instant(t: Time, tzid: string | undefined): number {
    if (t.isDate) return zonedToInstant({ y: t.year, m: t.month, d: t.day }, 0, this.opts.timeZone);
    const z = this.zoneOf(tzid, t);
    if (z.kind === 'utc') return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
    if (z.kind === 'vtimezone') return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - z.zone.utcOffset(t) * 1000;
    return zonedToInstant({ y: t.year, m: t.month, d: t.day }, t.hour * 60 + t.minute, z.kind === 'iana' ? z.name : this.opts.timeZone) + t.second * 1000;
  }
}

/** Overlapping and touching intervals joined, in order. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) out[out.length - 1] = { start: last.start, end: Math.max(last.end, i.end) };
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

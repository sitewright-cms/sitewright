import { and, count, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { bookingCalendars } from '../db/schema.js';
import { newId } from '../id.js';
import type { Busy, Interval } from './occupancy.js';
import { readIcsIsolated } from './ics-isolated.js';
import type { IcsParseResult, IcsReadOptions } from './ics-read.js';
import { DAY_MS } from './zoned.js';

/**
 * THE OUTSIDE CALENDARS a resource's busy times are read from, and the reader that keeps them current.
 *
 * ★ A feed is read once and worked out for a long stretch (three days back, two years ahead), then cached for a
 * few minutes: a listing only slices it. At booking time a reading older than a minute is refreshed first.
 * ★ FAILS CLOSED. A feed that cannot be read keeps its last good reading for a day; after that, or if it was never
 * read, its resource reads as BUSY. A missed outside appointment is a double booking, which is worse than a time
 * not offered for a while, and the business sees why on its calendar's row.
 */

export const CALENDAR_LIMITS = {
  /** Calendars one project may connect. */
  perProject: 50,
  /** A listing reads a feed again after this long. */
  freshMs: 5 * 60_000,
  /** A booking reads a feed again if its reading is older than this. */
  claimFreshMs: 60_000,
  /** How long a feed's last good reading is shown while it cannot be read. */
  staleMs: DAY_MS,
  /** How long it may be relied on for a BOOKING: shorter, since a time taken meanwhile would be double-booked. */
  claimStaleMs: 6 * 60 * 60_000,
  /** How far the busy times are worked out: from a little before now to the furthest anyone may book. */
  pastMs: 3 * DAY_MS,
  aheadMs: 732 * DAY_MS,
  /** Feeds kept read at once, across all projects. */
  cacheEntries: 500,
} as const;

export type CalendarRow = typeof bookingCalendars.$inferSelect;

export class BookingCalendarRepository {
  constructor(private readonly db: Database) {}

  async list(projectId: string): Promise<CalendarRow[]> {
    return this.db.select().from(bookingCalendars).where(eq(bookingCalendars.projectId, projectId)).orderBy(bookingCalendars.createdAt);
  }

  async forResources(projectId: string, resourceIds: readonly string[]): Promise<CalendarRow[]> {
    if (resourceIds.length === 0) return [];
    return this.db
      .select()
      .from(bookingCalendars)
      .where(and(eq(bookingCalendars.projectId, projectId), inArray(bookingCalendars.resourceId, [...resourceIds])));
  }

  async get(projectId: string, id: string): Promise<CalendarRow | undefined> {
    const [row] = await this.db.select().from(bookingCalendars).where(and(eq(bookingCalendars.projectId, projectId), eq(bookingCalendars.id, id)));
    return row;
  }

  async count(projectId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(bookingCalendars).where(eq(bookingCalendars.projectId, projectId));
    return row?.n ?? 0;
  }

  async insert(c: Pick<CalendarRow, 'projectId' | 'resourceId' | 'kind' | 'name' | 'url' | 'host'> & { writes?: boolean }, now: number): Promise<CalendarRow> {
    const at = new Date(now);
    const row: CalendarRow = { id: newId(16), ...c, writes: c.writes ?? false, writeError: null, wroteAt: null, lastOkAt: null, lastError: null, lastEvents: null, createdAt: at, updatedAt: at };
    await this.db.insert(bookingCalendars).values(row);
    return row;
  }

  /** Switches putting bookings into a CalDAV calendar on or off. Not the address: the reading stays cached. */
  async setWrites(projectId: string, id: string, writes: boolean): Promise<boolean> {
    const res = await this.db
      .update(bookingCalendars)
      .set({ writes, writeError: null })
      .where(and(eq(bookingCalendars.projectId, projectId), eq(bookingCalendars.id, id), inArray(bookingCalendars.kind, ['caldav', 'google'])))
      .returning({ id: bookingCalendars.id });
    return res.length > 0;
  }

  /** The outcome of putting a booking in (or taking one out): null clears an earlier error; `wrote` marks a put. */
  async recordWrite(id: string, error: string | null, wrote?: number): Promise<void> {
    await this.db
      .update(bookingCalendars)
      .set(wrote !== undefined ? { writeError: error, wroteAt: new Date(wrote) } : { writeError: error })
      .where(eq(bookingCalendars.id, id));
  }

  /**
   * The CalDAV calendars of a resource a booking's change is synced to: those taking the bookings, and those that
   * took them before (switched off since), so a booking cancelled meanwhile is still taken out of them.
   */
  async syncTargetsFor(projectId: string, resourceId: string): Promise<CalendarRow[]> {
    return this.db
      .select()
      .from(bookingCalendars)
      .where(
        and(
          eq(bookingCalendars.projectId, projectId),
          eq(bookingCalendars.resourceId, resourceId),
          inArray(bookingCalendars.kind, ['caldav', 'google']),
          or(eq(bookingCalendars.writes, true), isNotNull(bookingCalendars.wroteAt)),
        ),
      );
  }

  async remove(projectId: string, id: string): Promise<boolean> {
    const gone = await this.db
      .delete(bookingCalendars)
      .where(and(eq(bookingCalendars.projectId, projectId), eq(bookingCalendars.id, id)))
      .returning({ id: bookingCalendars.id });
    return gone.length > 0;
  }

  /** The outcome of a reading, for the business to see. Written only when a feed is actually fetched. */
  async recordReading(id: string, outcome: { ok: true; events: number } | { ok: false; error: string }, now: number): Promise<void> {
    await this.db
      .update(bookingCalendars)
      .set(outcome.ok ? { lastOkAt: new Date(now), lastError: null, lastEvents: outcome.events } : { lastError: outcome.error })
      .where(eq(bookingCalendars.id, id));
  }
}

/** Fetches a feed's text, or says why it could not, in words the business can act on. */
export type FetchFeed = (url: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;

/** What the booking service asks: each resource's busy times from its outside calendars between `from` and `to`. */
export interface ExternalBusy {
  busy(
    projectId: string,
    resources: ReadonlyArray<{ id: string; timeZone: string }>,
    from: number,
    to: number,
    opts: { fresh: boolean },
  ): Promise<Map<string, Busy[]>>;
}

interface Reading {
  /** The clock it was worked out on: floating times and all-day dates are the resource's. */
  timeZone: string;
  /** When the feed was last fetched (whatever came of it). */
  fetchedAt: number;
  /** When it was last read successfully, and what it said then. */
  okAt: number | null;
  intervals: Interval[];
  /** The stretch those intervals were worked out for. Outside it nothing is known, so it is busy. */
  covers: Interval;
  error?: string;
}

export interface CalendarReaderDeps {
  calendars: BookingCalendarRepository;
  fetchFeed: FetchFeed;
  /** The feed's address from its stored envelope. */
  decrypt: (url: CalendarRow['url']) => string;
  /** A CalDAV calendar's events overlapping [from, to), as one iCalendar text. Absent: CalDAV calendars read as unreadable. */
  readCalDav?: (source: { url: string; username: string; password: string }, from: number, to: number) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  /** A Google calendar's busy times (through the platform's service account). Absent: Google calendars are unreadable. */
  readGoogle?: (calendarId: string, opts: { from: number; to: number; timeZone: string; ownUidSuffix: string }) => Promise<IcsParseResult>;
  /** Works out a feed's busy times. Default: in a worker thread, stopped at a deadline (see `ics-isolated.ts`). */
  read?: (text: string, opts: Omit<IcsReadOptions, 'now'>) => Promise<IcsParseResult>;
  now?: () => number;
  log?: { warn: (o: unknown, m: string) => void };
}

/** The parts of [from, to) outside what a reading covers. */
function uncovered(covers: Interval, from: number, to: number): Interval[] {
  const out: Interval[] = [];
  if (from < covers.start) out.push({ start: from, end: Math.min(to, covers.start) });
  if (to > covers.end) out.push({ start: Math.max(from, covers.end), end: to });
  return out;
}

/** The intervals of a sorted, merged list that overlap [from, to), by binary search. */
function slice(list: readonly Interval[], from: number, to: number): Interval[] {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.end <= from) lo = mid + 1;
    else hi = mid;
  }
  const out: Interval[] = [];
  for (let i = lo; i < list.length && list[i]!.start < to; i += 1) out.push(list[i]!);
  return out;
}

export class CalendarReader implements ExternalBusy {
  private readonly readings = new Map<string, Reading>();
  private readonly inflight = new Map<string, Promise<Reading>>();
  private readonly now: () => number;
  private readonly read: NonNullable<CalendarReaderDeps['read']>;

  constructor(private readonly deps: CalendarReaderDeps) {
    this.now = deps.now ?? Date.now;
    this.read = deps.read ?? readIcsIsolated;
  }

  async busy(
    projectId: string,
    resources: ReadonlyArray<{ id: string; timeZone: string }>,
    from: number,
    to: number,
    opts: { fresh: boolean },
  ): Promise<Map<string, Busy[]>> {
    const out = new Map<string, Busy[]>();
    const zones = new Map(resources.map((r) => [r.id, r.timeZone]));
    const rows = await this.deps.calendars.forResources(projectId, [...zones.keys()]);
    await Promise.all(
      rows.map(async (row) => {
        const timeZone = zones.get(row.resourceId) ?? 'UTC';
        const reading = await this.reading(projectId, row, timeZone, opts.fresh);
        const limit = opts.fresh ? CALENDAR_LIMITS.claimStaleMs : CALENDAR_LIMITS.staleMs;
        const usable = reading.okAt !== null && this.now() - reading.okAt <= limit;
        // Unreadable for too long, or never read: the resource is busy, not free. So is any stretch the reading
        // does not cover (the far end of the booking horizon, a day after an old reading was made).
        const busy = usable ? [...slice(reading.intervals, from, to), ...uncovered(reading.covers, from, to)] : [{ start: from, end: to }];
        out.set(row.resourceId, [...(out.get(row.resourceId) ?? []), ...busy]);
      }),
    );
    return out;
  }

  /**
   * Reads a feed now, whatever is cached: the "test connection" of the editor, and the first reading of a new
   * calendar. Returns what came of it.
   */
  async readNow(projectId: string, row: CalendarRow, timeZone: string): Promise<Reading> {
    const reading = await this.fetchAndRead(projectId, row, timeZone, this.readings.get(this.key(row)));
    this.store(this.key(row), reading);
    return reading;
  }

  /** Forgets a calendar's reading (removed, or its address changed); one being made is not kept either. */
  forget(row: Pick<CalendarRow, 'id'>): void {
    for (const k of [...this.readings.keys()]) if (k.startsWith(`${row.id}|`)) this.readings.delete(k);
    for (const k of [...this.inflight.keys()]) if (k.startsWith(`${row.id}|`)) this.inflight.delete(k);
  }

  private key(row: CalendarRow): string {
    // The address is part of the row; a changed row (updatedAt) is a different feed.
    return `${row.id}|${row.updatedAt.getTime()}`;
  }

  /**
   * The feed's reading, as current as the caller needs. ★ A listing never waits for a feed it has read before: a
   * usable reading past its freshness is served while a new one is made in the background. A booking waits for a
   * reading under a minute old. A reading on another clock (the resource moved zone) is read again, and stands as
   * the fallback if that fails.
   */
  private async reading(projectId: string, row: CalendarRow, timeZone: string, fresh: boolean): Promise<Reading> {
    const key = this.key(row);
    const cached = this.readings.get(key);
    const age = cached ? this.now() - cached.fetchedAt : Infinity;
    const sameClock = cached?.timeZone === timeZone;
    if (cached && sameClock && age < (fresh ? CALENDAR_LIMITS.claimFreshMs : CALENDAR_LIMITS.freshMs)) return cached;
    // One fetch per feed and clock at a time: everyone asking meanwhile waits for the same answer.
    const flight = `${key}|${timeZone}`;
    const refresh = (): Promise<Reading> => {
      const pending = this.inflight.get(flight);
      if (pending) return pending;
      const p: Promise<Reading> = this.fetchAndRead(projectId, row, timeZone, cached).then(
        (reading) => {
          // Kept only if still wanted: a calendar removed meanwhile is not brought back.
          if (this.inflight.get(flight) === p) {
            this.inflight.delete(flight);
            this.store(key, reading);
          }
          return reading;
        },
        (err: unknown) => {
          if (this.inflight.get(flight) === p) this.inflight.delete(flight);
          throw err;
        },
      );
      this.inflight.set(flight, p);
      return p;
    };
    if (!fresh && cached && sameClock && cached.okAt !== null && this.now() - cached.okAt <= CALENDAR_LIMITS.staleMs) {
      void refresh().catch(() => undefined);
      return cached;
    }
    return refresh();
  }

  /** Fetches and reads a feed, and records how that went. Never rejects. */
  private async fetchAndRead(projectId: string, row: CalendarRow, timeZone: string, previous: Reading | undefined): Promise<Reading> {
    const now = this.now();
    const covers = { start: now - CALENDAR_LIMITS.pastMs, end: now + CALENDAR_LIMITS.aheadMs };
    let outcome: IcsParseResult;
    try {
      const secret = this.deps.decrypt(row.url);
      if (row.kind === 'google') {
        // Google expands and answers the busy times itself: nothing to parse here.
        outcome = this.deps.readGoogle
          ? await this.deps.readGoogle(secret, { from: covers.start, to: covers.end, timeZone, ownUidSuffix: `@${projectId}` })
          : { ok: false, error: 'Google calendars are not available on this server' };
      } else {
        const fetched = row.kind === 'caldav' ? await this.readCalDav(secret, covers) : await this.deps.fetchFeed(secret);
        outcome = fetched.ok ? await this.read(fetched.text, { from: covers.start, to: covers.end, timeZone, ownUidSuffix: `@${projectId}` }) : fetched;
      }
    } catch {
      outcome = { ok: false, error: 'the calendar could not be read' };
    }
    const reading: Reading = outcome.ok
      ? { timeZone, fetchedAt: now, okAt: now, intervals: outcome.intervals, covers }
      : // The last good intervals stand meanwhile, even if worked out on the resource's previous clock: an hour off
        // for a floating time beats nothing. Stamped with the clock asked for, so a failing feed is not refetched on
        // every request.
        { timeZone, fetchedAt: now, okAt: previous?.okAt ?? null, intervals: previous?.intervals ?? [], covers: previous?.covers ?? covers, error: outcome.error };
    await this.deps.calendars
      .recordReading(row.id, outcome.ok ? { ok: true, events: outcome.events } : { ok: false, error: outcome.error }, now)
      .catch((err: unknown) => this.deps.log?.warn({ err, calendarId: row.id }, 'could not record a calendar reading'));
    if (!outcome.ok) this.deps.log?.warn({ projectId, calendarId: row.id, error: outcome.error }, 'booking calendar could not be read');
    return reading;
  }

  /** A CalDAV calendar's events for the stretch a reading covers. Its secret is `{url, username, password}`. */
  private async readCalDav(secret: string, covers: Interval): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    if (!this.deps.readCalDav) return { ok: false, error: 'CalDAV calendars are not available on this server' };
    let source: { url: string; username: string; password: string };
    try {
      source = JSON.parse(secret) as typeof source;
    } catch {
      return { ok: false, error: 'the calendar could not be read' };
    }
    return this.deps.readCalDav(source, covers.start, covers.end);
  }

  private store(key: string, reading: Reading): void {
    this.readings.delete(key);
    this.readings.set(key, reading);
    // The oldest reading goes first once the cache is full.
    while (this.readings.size > CALENDAR_LIMITS.cacheEntries) this.readings.delete(this.readings.keys().next().value as string);
  }
}

/** `webcal://` is `https://` by another name; anything else must already be https. */
export function feedUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(trimmed);
    return u.protocol === 'https:' && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

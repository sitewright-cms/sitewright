import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { BookingConfig } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { bookingCalendarWrites } from '../db/schema.js';
import { newId } from '../id.js';
import type { DavTransport } from './caldav.js';
import type { BookingCalendarRepository, CalendarRow } from './calendars.js';
import type { ClaimRow } from './claims.js';
import { bookingEventLines } from './feed.js';
import { ICS_PRODID, icsFold } from './ics.js';

/**
 * BOOKINGS KEPT IN A CALDAV CALENDAR: a booking or a request is in it (confirmed, or tentative); once cancelled,
 * declined or lapsed, it is not. For each calendar that takes the bookings, a booking's change queues "sync it",
 * and a single-flight pass brings the calendar in line, retrying with a back-off.
 *
 * ★ What to do is decided when it is SENT, from the booking as it then stands: there, it goes in (written fresh);
 * gone, it comes out. So the order events arrive in never matters (taken and cancelled at once ends cancelled), a
 * snapshot can never put back a booking cancelled meanwhile, and no customer detail waits in the queue.
 * ★ The event's UID is the booking's (`<claim>@<project>`), as in its invitation and the feed: reading the same
 * calendar back skips it, so a booking never blocks its own time twice.
 */

export const CALENDAR_WRITE_LIMITS = {
  /** Syncs one pass sends. */
  batch: 20,
  /** Upcoming bookings synced into a calendar when it starts taking them. */
  backfill: 1_000,
  /** How long a sync being sent is held from other passes. */
  leaseMs: 2 * 60_000,
  /** Between attempts; then it is given up on. */
  backoffMs: [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000],
  /** How long a sync given up on is kept, to show why. */
  failedRetentionMs: 7 * 24 * 3_600_000,
} as const;

export type CalendarWriteRow = typeof bookingCalendarWrites.$inferSelect;

export class BookingCalendarWriteRepository {
  constructor(private readonly db: Database) {}

  /** The booking is to be brought in line in the calendar. A newer call supersedes an older one still waiting. */
  async want(w: { projectId: string; calendarId: string; claimId: string }, now: number): Promise<void> {
    const at = new Date(now);
    await this.db
      .insert(bookingCalendarWrites)
      .values({ id: newId(16), ...w, seq: 1, state: 'pending', attempts: 0, nextAt: at, lastError: null, createdAt: at })
      .onConflictDoUpdate({
        target: [bookingCalendarWrites.calendarId, bookingCalendarWrites.claimId],
        set: { seq: sql`${bookingCalendarWrites.seq} + 1`, state: 'pending', attempts: 0, nextAt: at, lastError: null },
      });
  }

  /** Due syncs, each leased to this pass (another pass skips it until the lease runs out). */
  async claimDue(now: number, limit: number): Promise<CalendarWriteRow[]> {
    const due = await this.db
      .select()
      .from(bookingCalendarWrites)
      .where(and(eq(bookingCalendarWrites.state, 'pending'), lte(bookingCalendarWrites.nextAt, new Date(now))))
      .orderBy(asc(bookingCalendarWrites.nextAt))
      .limit(Math.max(1, limit));
    const leased = new Date(now + CALENDAR_WRITE_LIMITS.leaseMs);
    const out: CalendarWriteRow[] = [];
    for (const r of due) {
      const res = await this.db
        .update(bookingCalendarWrites)
        .set({ nextAt: leased })
        .where(and(eq(bookingCalendarWrites.id, r.id), eq(bookingCalendarWrites.seq, r.seq), eq(bookingCalendarWrites.state, 'pending'), eq(bookingCalendarWrites.nextAt, r.nextAt)));
      if ((res.rowsAffected ?? 0) > 0) out.push({ ...r, nextAt: leased });
    }
    return out;
  }

  /** Done: the row goes, unless a newer change superseded it meanwhile (that one is still to do). */
  async done(id: string, seq: number): Promise<void> {
    await this.db.delete(bookingCalendarWrites).where(and(eq(bookingCalendarWrites.id, id), eq(bookingCalendarWrites.seq, seq)));
  }

  /** Not done: tried again at `nextAt`, or given up on (`failed`) without one. False when superseded meanwhile. */
  async again(id: string, seq: number, attempts: number, nextAt: number | null, error: string, now: number): Promise<boolean> {
    const res = await this.db
      .update(bookingCalendarWrites)
      .set(nextAt !== null ? { attempts, nextAt: new Date(nextAt), lastError: error } : { attempts, state: 'failed', nextAt: new Date(now), lastError: error })
      .where(and(eq(bookingCalendarWrites.id, id), eq(bookingCalendarWrites.seq, seq)));
    return (res.rowsAffected ?? 0) > 0;
  }

  /** The syncs given up on in a calendar, tried again (its sign-in was fixed, or it takes the bookings again). */
  async retryFailed(calendarId: string, now: number): Promise<void> {
    await this.db
      .update(bookingCalendarWrites)
      .set({ state: 'pending', attempts: 0, nextAt: new Date(now), lastError: null })
      .where(and(eq(bookingCalendarWrites.calendarId, calendarId), eq(bookingCalendarWrites.state, 'failed')));
  }

  /** A calendar removed: what was still to be done in it goes too. */
  async forget(calendarId: string): Promise<void> {
    await this.db.delete(bookingCalendarWrites).where(eq(bookingCalendarWrites.calendarId, calendarId));
  }

  /** Syncs given up on long enough ago. */
  async sweep(now: number): Promise<number> {
    const gone = await this.db
      .delete(bookingCalendarWrites)
      .where(and(eq(bookingCalendarWrites.state, 'failed'), lte(bookingCalendarWrites.nextAt, new Date(now - CALENDAR_WRITE_LIMITS.failedRetentionMs))))
      .returning({ id: bookingCalendarWrites.id });
    return gone.length;
  }
}

/** A booking as the iCalendar object a CalDAV calendar stores (RFC 4791 §4.1: one event, no METHOD). */
export function calendarObject(projectId: string, claim: Pick<ClaimRow, 'id' | 'state' | 'startAt' | 'endAt' | 'units' | 'customer' | 'resourceId' | 'offeringId'>, config: BookingConfig | null, now: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    ...bookingEventLines(claim, {
      projectId,
      offering: config?.offerings.find((o) => o.id === claim.offeringId),
      resource: config?.resources.find((r) => r.id === claim.resourceId),
      stamp: now,
    }),
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** A booking that belongs in the calendar: booked, or a request still waiting. A hold is a checkout in progress. */
export function belongsInCalendar(claim: Pick<ClaimRow, 'state' | 'expiresAt'> | undefined, now: number): boolean {
  if (!claim) return false;
  if (claim.state === 'booked') return true;
  return claim.state === 'pending' && (claim.expiresAt === null || claim.expiresAt.getTime() > now);
}

export interface CalendarWriterDeps {
  calendars: BookingCalendarRepository;
  writes: BookingCalendarWriteRepository;
  /** Starts a pass (single-flight), after a sync was queued. */
  kick: () => void;
  now?: () => number;
}

export class CalendarWriter {
  private readonly now: () => number;

  constructor(private readonly deps: CalendarWriterDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** A booking changed: it is synced to each calendar of its resource that takes (or took) the bookings. */
  async sync(projectId: string, claim: { id: string; resourceId: string }): Promise<void> {
    const calendars = await this.deps.calendars.syncTargetsFor(projectId, claim.resourceId);
    if (calendars.length === 0) return;
    const now = this.now();
    for (const c of calendars) await this.deps.writes.want({ projectId, calendarId: c.id, claimId: claim.id }, now);
    this.deps.kick();
  }

  /** The upcoming bookings of a calendar's resource, synced into it (it starts taking them), and what failed retried. */
  async backfill(calendar: Pick<CalendarRow, 'id' | 'projectId'>, claims: readonly Pick<ClaimRow, 'id'>[]): Promise<number> {
    const now = this.now();
    await this.deps.writes.retryFailed(calendar.id, now);
    const some = claims.slice(0, CALENDAR_WRITE_LIMITS.backfill);
    for (const claim of some) await this.deps.writes.want({ projectId: calendar.projectId, calendarId: calendar.id, claimId: claim.id }, now);
    this.deps.kick();
    return some.length;
  }
}

export interface CalendarWriteRunnerDeps {
  calendars: BookingCalendarRepository;
  writes: BookingCalendarWriteRepository;
  /** The booking as it now stands, if it is still there. */
  claimOf: (projectId: string, claimId: string) => Promise<ClaimRow | undefined>;
  readConfig: (projectId: string) => Promise<BookingConfig | null>;
  transport: DavTransport;
  /** A calendar's stored secret, decrypted: `{url, username, password}` as JSON. */
  decrypt: (envelope: CalendarRow['url']) => string;
  now?: () => number;
  log?: { warn: (o: unknown, m: string) => void };
}

/** A booking's object in the calendar: `<calendar>/<claim>.ics`, always under the calendar's own address. */
export function objectUrl(calendarUrl: string, claimId: string): string {
  const base = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
  return new URL(`${encodeURIComponent(claimId)}.ics`, base).href;
}

/** Sends due syncs, a batch at a time. `more`: a full batch went, so more may be waiting. */
export async function runCalendarWrites(deps: CalendarWriteRunnerDeps): Promise<{ done: number; more: boolean }> {
  const clock = deps.now ?? Date.now;
  let done = 0;
  let tried = 0;
  for (; tried < CALENDAR_WRITE_LIMITS.batch; tried += 1) {
    const [row] = await deps.writes.claimDue(clock(), 1);
    if (!row) break;
    try {
      if (await attempt(deps, row, clock)) done += 1;
    } catch (err) {
      // Not the server's answer, but something here: backed off like a failure (not retried every lease).
      deps.log?.warn({ err, projectId: row.projectId, writeId: row.id }, 'booking calendar sync failed unexpectedly');
      await fail(deps, row, row.calendarId, 'the booking could not be prepared for the calendar', clock, false).catch(() => undefined);
    }
  }
  return { done, more: tried === CALENDAR_WRITE_LIMITS.batch };
}

async function attempt(deps: CalendarWriteRunnerDeps, row: CalendarWriteRow, clock: () => number): Promise<boolean> {
  const calendar = await deps.calendars.get(row.projectId, row.calendarId);
  if (!calendar || calendar.kind !== 'caldav') {
    await deps.writes.done(row.id, row.seq);
    return true;
  }
  const now = clock();
  const claim = await deps.claimOf(row.projectId, row.claimId);
  const put = belongsInCalendar(claim, now);
  // Not taking the bookings now: nothing goes in. What we put in before still comes out when cancelled.
  if ((put && !calendar.writes) || (!put && !calendar.writes && !calendar.wroteAt)) {
    await deps.writes.done(row.id, row.seq);
    return true;
  }
  let source: { url: string; username: string; password: string };
  try {
    source = JSON.parse(deps.decrypt(calendar.url)) as typeof source;
  } catch {
    return fail(deps, row, calendar.id, 'the calendar’s sign-in could not be read: connect it again', clock, true);
  }
  const authorization = `Basic ${Buffer.from(`${source.username}:${source.password}`, 'utf8').toString('base64')}`;
  const url = objectUrl(source.url, row.claimId);
  const res = put
    ? await deps.transport(url, { method: 'PUT', headers: { authorization, 'content-type': 'text/calendar; charset=utf-8' }, body: calendarObject(row.projectId, claim!, await deps.readConfig(row.projectId), now) })
    : await deps.transport(url, { method: 'DELETE', headers: { authorization } });
  if (!res.ok) return fail(deps, row, calendar.id, res.error, clock, false);
  // Taking out what is not there any more is done.
  if ((res.status >= 200 && res.status < 300) || (!put && (res.status === 404 || res.status === 410))) {
    await deps.writes.done(row.id, row.seq);
    if (put || calendar.writeError) await deps.calendars.recordWrite(calendar.id, null, put ? now : undefined);
    return true;
  }
  // What trying again cannot fix: the business has to act (sign in again, connect the calendar again).
  const final: Record<number, string> = {
    401: 'the calendar server no longer accepts the username or password',
    403: 'the calendar server refused to store the booking',
    404: 'the calendar is no longer at its address: connect it again',
    409: 'the calendar is no longer at its address: connect it again',
  };
  if (final[res.status]) return fail(deps, row, calendar.id, final[res.status]!, clock, true);
  if (res.status >= 300 && res.status < 400) return fail(deps, row, calendar.id, 'the calendar server sent the booking elsewhere: connect the calendar again', clock, true);
  return fail(deps, row, calendar.id, `the calendar server answered ${res.status}`, clock, false);
}

async function fail(deps: CalendarWriteRunnerDeps, row: CalendarWriteRow, calendarId: string, error: string, clock: () => number, final: boolean): Promise<false> {
  const attempts = row.attempts + 1;
  const wait = final ? undefined : CALENDAR_WRITE_LIMITS.backoffMs[attempts - 1];
  const now = clock();
  const current = await deps.writes.again(row.id, row.seq, attempts, wait === undefined ? null : now + wait, error, now);
  // Given up on (a retry may still succeed): the business sees it on the calendar's row. Not for an attempt a newer
  // change superseded meanwhile: that one is still to do.
  if (current && wait === undefined) await deps.calendars.recordWrite(calendarId, `a booking could not be written: ${error}`);
  deps.log?.warn({ projectId: row.projectId, calendarId, attempts, error }, 'booking calendar sync failed');
  return false;
}

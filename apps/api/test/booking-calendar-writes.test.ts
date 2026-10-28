import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { BookingConfig } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { bookingCalendarWrites, projects } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import { BookingCalendarRepository, type CalendarRow } from '../src/booking/calendars.js';
import { BookingCalendarWriteRepository, CALENDAR_WRITE_LIMITS, CalendarWriter, belongsInCalendar, calendarObject, objectUrl, runCalendarWrites } from '../src/booking/calendar-writes.js';
import type { ClaimRow } from '../src/booking/claims.js';
import type { DavTransport } from '../src/booking/caldav.js';

/**
 * Bookings kept in a CalDAV calendar: a booking's change queues "sync it", and the pass decides from the booking AS
 * IT THEN STANDS whether it goes in (written fresh) or comes out. So the order of events never matters, and no
 * customer detail waits in the queue.
 */

const NOW = Date.UTC(2026, 9, 27, 12);
const SECRET = JSON.stringify({ url: 'https://cloud.example/dav/anna/personal', username: 'anna', password: 'pw' });
const CONFIG: BookingConfig = {
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', capacity: 1, hours: [], blocks: [] }],
  offerings: [],
  pow: false,
  captcha: false,
};

let db: Database;
let calendars: BookingCalendarRepository;
let writes: BookingCalendarWriteRepository;
let projectId: string;
let calendar: CalendarRow;
let clock: number;
let sent: Array<{ method: string; url: string; body?: string; auth?: string }>;
let answer: (method: string) => Awaited<ReturnType<DavTransport>>;
/** The bookings as they stand: what the pass reads. */
let claims: Map<string, ClaimRow>;

const claim = (id: string, over: Partial<ClaimRow> = {}): ClaimRow => ({
  id,
  projectId,
  resourceId: 'anna',
  offeringId: 'cut',
  state: 'booked',
  startAt: new Date(Date.UTC(2026, 10, 3, 9)),
  endAt: new Date(Date.UTC(2026, 10, 3, 10)),
  busyStart: new Date(Date.UTC(2026, 10, 3, 9)),
  busyEnd: new Date(Date.UTC(2026, 10, 3, 10)),
  units: 1,
  exclusive: false,
  expiresAt: null,
  customer: { name: 'Ada' },
  paidTxnId: null,
  locale: null,
  remindedAt: null,
  payBy: null,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  ...over,
});
const transport: DavTransport = async (url, init) => {
  sent.push({ method: init.method, url, body: init.body, auth: init.headers.authorization });
  return answer(init.method);
};
const run = () =>
  runCalendarWrites({ calendars, writes, transport, decrypt: (e) => e.ct, now: () => clock, claimOf: async (_p, id) => claims.get(id), readConfig: async () => CONFIG });
const rows = () => db.select().from(bookingCalendarWrites);
const want = (claimId: string) => writes.want({ projectId, calendarId: calendar.id, claimId }, clock);

beforeEach(async () => {
  db = await makeTestDb();
  calendars = new BookingCalendarRepository(db);
  writes = new BookingCalendarWriteRepository(db);
  projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, name: 'P', slug: `p-${projectId.slice(0, 8)}`, createdAt: new Date() });
  calendar = await calendars.insert({ projectId, resourceId: 'anna', kind: 'caldav', name: 'Anna', url: { iv: '', ct: SECRET, tag: '' }, host: 'cloud.example', writes: true }, NOW);
  clock = NOW;
  sent = [];
  claims = new Map();
  answer = () => ({ ok: true, status: 201, headers: {}, text: '' });
});

describe('★ decided when sent, from the booking as it then stands', () => {
  it('puts a booking in, written fresh, signed in, under its own address', async () => {
    claims.set('c/1', claim('c/1'));
    await want('c/1');
    expect(await run()).toEqual({ done: 1, more: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'PUT', url: 'https://cloud.example/dav/anna/personal/c%2F1.ics', auth: `Basic ${Buffer.from('anna:pw').toString('base64')}` });
    expect(sent[0]!.body).toContain('STATUS:CONFIRMED');
    expect(await rows()).toEqual([]);
    expect((await calendars.get(projectId, calendar.id))?.wroteAt?.getTime()).toBe(NOW);
  });

  it('★ takes out a booking cancelled before its sync went: the order of events does not matter', async () => {
    claims.set('c1', claim('c1'));
    await want('c1');
    // Cancelled (the claim is gone) before the pass ran: only taken out.
    claims.delete('c1');
    await want('c1');
    answer = () => ({ ok: true, status: 404, headers: {}, text: '' });
    await run();
    expect(sent.map((s) => s.method)).toEqual(['DELETE']);
    expect(await rows()).toEqual([]);
  });

  it('★ a backfill cannot put back a booking cancelled meanwhile', async () => {
    const writer = new CalendarWriter({ calendars, writes, kick: () => undefined, now: () => clock });
    // The backfill read X as booked; X is cancelled before the pass runs.
    await writer.backfill(calendar, [{ id: 'x' }]);
    await run();
    expect(sent.map((s) => s.method)).toEqual(['DELETE']);
  });

  it('puts a request in as tentative, and a request lapsed (or a hold) is not a booking', () => {
    expect(belongsInCalendar(claim('a', { state: 'pending', expiresAt: new Date(NOW + 1) }), NOW)).toBe(true);
    expect(belongsInCalendar(claim('a', { state: 'pending', expiresAt: new Date(NOW) }), NOW)).toBe(false);
    expect(belongsInCalendar(claim('a', { state: 'hold', expiresAt: new Date(NOW + 1) }), NOW)).toBe(false);
    expect(belongsInCalendar(undefined, NOW)).toBe(false);
    expect(calendarObject(projectId, claim('a', { state: 'pending' }), CONFIG, NOW)).toContain('STATUS:TENTATIVE');
  });

  it('★ a calendar no longer taking bookings gets none, but what was put in still comes out when cancelled', async () => {
    claims.set('in', claim('in'));
    await want('in');
    await run();
    await calendars.setWrites(projectId, calendar.id, false);
    // A new booking: not put in.
    claims.set('new', claim('new'));
    await want('new');
    // The earlier one cancelled: still taken out (the calendar was written into).
    claims.delete('in');
    await want('in');
    await run();
    expect(sent.map((s) => `${s.method} ${s.url.split('/').pop()}`)).toEqual(['PUT in.ics', 'DELETE in.ics']);
    expect(await calendars.syncTargetsFor(projectId, 'anna')).toHaveLength(1);
  });
});

describe('when it does not work', () => {
  it('★ gives up at once on what trying again cannot fix, and tells the business on the calendar', async () => {
    for (const [status, message] of [
      [401, 'the calendar server no longer accepts the username or password'],
      [404, 'the calendar is no longer at its address: connect it again'],
      [302, 'the calendar server sent the booking elsewhere: connect the calendar again'],
    ] as const) {
      claims.set(`c${status}`, claim(`c${status}`));
      answer = () => ({ ok: true, status, headers: {}, text: '' });
      await want(`c${status}`);
      await run();
      expect((await rows()).find((r) => r.claimId === `c${status}`)).toMatchObject({ state: 'failed', lastError: message });
      expect((await calendars.get(projectId, calendar.id))?.writeError).toBe(`a booking could not be written: ${message}`);
    }
    // A later good write clears it.
    answer = () => ({ ok: true, status: 204, headers: {}, text: '' });
    claims.set('ok', claim('ok'));
    await want('ok');
    await run();
    expect((await calendars.get(projectId, calendar.id))?.writeError).toBeNull();
  });

  it('tries a server error again later, backing off, then gives up; a backfill tries it again', async () => {
    claims.set('c1', claim('c1'));
    answer = () => ({ ok: true, status: 503, headers: {}, text: '' });
    await want('c1');
    for (const wait of CALENDAR_WRITE_LIMITS.backoffMs) {
      await run();
      const [row] = await rows();
      expect(row).toMatchObject({ state: 'pending', lastError: 'the calendar server answered 503' });
      expect(row!.nextAt.getTime()).toBe(clock + wait);
      expect((await run()).done).toBe(0);
      clock += wait;
    }
    await run();
    expect(await rows()).toMatchObject([{ state: 'failed' }]);
    // Switched on again (or the sign-in fixed): what failed is tried again.
    answer = () => ({ ok: true, status: 201, headers: {}, text: '' });
    await new CalendarWriter({ calendars, writes, kick: () => undefined, now: () => clock }).backfill(calendar, []);
    await run();
    expect(await rows()).toEqual([]);
  });

  it('does not show an error from an attempt a newer change superseded', async () => {
    claims.set('c1', claim('c1'));
    answer = () => ({ ok: true, status: 401, headers: {}, text: '' });
    await want('c1');
    const [leased] = await writes.claimDue(clock, 1);
    await want('c1');
    expect(await writes.again(leased!.id, leased!.seq, 1, null, 'x', clock)).toBe(false);
    expect(await rows()).toMatchObject([{ state: 'pending', seq: 2 }]);
  });

  it('backs off on an unexpected failure here, rather than retrying it at every lease', async () => {
    await want('c1');
    const broken = await runCalendarWrites({ calendars, writes, transport, decrypt: (e) => e.ct, now: () => clock, claimOf: async () => Promise.reject(new Error('db down')), readConfig: async () => CONFIG });
    expect(broken.done).toBe(0);
    const [row] = await rows();
    expect(row).toMatchObject({ state: 'pending', attempts: 1, lastError: 'the booking could not be prepared for the calendar' });
    expect(row!.nextAt.getTime()).toBe(clock + CALENDAR_WRITE_LIMITS.backoffMs[0]);
  });

  it('drops the syncs of a calendar removed, and forgets what was given up on a week later', async () => {
    await writes.want({ projectId, calendarId: 'gone', claimId: 'c2' }, clock);
    await run();
    expect(sent).toEqual([]);
    expect(await rows()).toEqual([]);
    claims.set('c1', claim('c1'));
    answer = () => ({ ok: true, status: 403, headers: {}, text: '' });
    await want('c1');
    await run();
    expect(await writes.sweep(clock + CALENDAR_WRITE_LIMITS.failedRetentionMs - 1)).toBe(0);
    expect(await writes.sweep(clock + CALENDAR_WRITE_LIMITS.failedRetentionMs)).toBe(1);
  });
});

describe('what goes into the calendar', () => {
  it('is one event under the calendar’s address, without a METHOD (RFC 4791)', () => {
    expect(objectUrl('https://cloud.example/dav/cal', 'abc')).toBe('https://cloud.example/dav/cal/abc.ics');
    expect(objectUrl('https://cloud.example/dav/cal/', '../x')).toBe('https://cloud.example/dav/cal/..%2Fx.ics');
    const text = calendarObject('p1', claim('c1', { state: 'pending' }), CONFIG, NOW);
    expect(text).not.toContain('METHOD');
    expect(text).toContain('UID:c1@p1');
    expect(text).toContain('SUMMARY:Booking: Ada (request)');
  });
});

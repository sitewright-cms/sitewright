import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { projects } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import { BookingCalendarRepository, CALENDAR_LIMITS, CalendarReader, feedUrl, type CalendarRow, type FetchFeed } from '../src/booking/calendars.js';
import { readIcsBusy } from '../src/booking/ics-read.js';

/**
 * The reader of the resources' outside calendars. ★ It FAILS CLOSED: a feed it cannot read keeps its last good
 * reading for a day (six hours for a booking), and after that (or if it was never read) its resource reads as
 * busy, not free. ★ A listing never waits for a feed it has read before.
 */

const NOW = Date.UTC(2026, 9, 27, 12);
const DAY_MS_ = 86_400_000;
const ICS = (start: string, end: string, uid = 'e1') =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', `DTSTART:${start}`, `DTEND:${end}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
const BERLIN = [{ id: 'anna', timeZone: 'Europe/Berlin' }];
const DAY = { from: Date.UTC(2026, 9, 28), to: Date.UTC(2026, 9, 29) };

let db: Database;
let repo: BookingCalendarRepository;
let projectId: string;
let clock: number;
let fetches: number;
let feed: Awaited<ReturnType<FetchFeed>>;
let row: CalendarRow;

const reader = (): CalendarReader =>
  new CalendarReader({
    calendars: repo,
    fetchFeed: async () => {
      fetches += 1;
      return feed;
    },
    decrypt: (u) => u.ct,
    now: () => clock,
    // In this thread: these tests are about the cache. The worker is exercised end to end in booking-calendar-api.
    read: readIcsBusy,
  });

beforeEach(async () => {
  db = await makeTestDb();
  repo = new BookingCalendarRepository(db);
  projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, name: 'P', slug: `p-${projectId.slice(0, 8)}`, createdAt: new Date() });
  row = await repo.insert({ projectId, resourceId: 'anna', kind: 'ics', name: 'Anna', url: { iv: '', ct: 'https://cal.example/a.ics', tag: '' }, host: 'cal.example' }, NOW);
  clock = NOW;
  fetches = 0;
  feed = { ok: true, text: ICS('20261028T090000Z', '20261028T100000Z') };
});

describe('reading', () => {
  it('reads a resource’s busy times, records the reading, and keeps it for listings a few minutes', async () => {
    const r = reader();
    const busy = await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    expect(busy.get('anna')).toEqual([{ start: Date.UTC(2026, 9, 28, 9), end: Date.UTC(2026, 9, 28, 10) }]);
    expect(await repo.get(projectId, row.id)).toMatchObject({ lastError: null, lastEvents: 1, lastOkAt: new Date(NOW) });
    clock += CALENDAR_LIMITS.freshMs - 1;
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    expect(fetches).toBe(1);
    clock += 2;
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    expect(fetches).toBe(2);
  });

  it('★ serves a listing the reading it has while a slow feed is read again in the background', async () => {
    let release: (v: Awaited<ReturnType<FetchFeed>>) => void = () => undefined;
    let slow = false;
    const r = new CalendarReader({
      calendars: repo,
      fetchFeed: async () => {
        fetches += 1;
        return slow ? new Promise((resolve) => (release = resolve)) : feed;
      },
      decrypt: (u) => u.ct,
      now: () => clock,
      read: readIcsBusy,
    });
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    slow = true;
    clock += CALENDAR_LIMITS.freshMs + 1;
    // Answered at once from the old reading, though the feed has not answered yet.
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 9));
    expect(fetches).toBe(2);
    // Asking again meanwhile does not ask the feed again.
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    expect(fetches).toBe(2);
    release({ ok: true, text: ICS('20261028T130000Z', '20261028T140000Z') });
    await vi.waitFor(async () => expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 13)));
  });

  it('reads again when the resource’s clock changed, keeping the old reading if that fails', async () => {
    // A floating time: on the resource's own clock.
    feed = { ok: true, text: ICS('20261028T090000', '20261028T100000') };
    const r = reader();
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 8));
    const LONDON = [{ id: 'anna', timeZone: 'Europe/London' }];
    expect((await r.busy(projectId, LONDON, DAY.from, DAY.to, { fresh: false })).get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 9));
    expect(fetches).toBe(2);
    feed = { ok: false, error: 'the calendar could not be reached' };
    const PARIS = [{ id: 'anna', timeZone: 'Europe/Paris' }];
    expect((await r.busy(projectId, PARIS, DAY.from, DAY.to, { fresh: false })).get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 9));
    // The failed attempt is remembered: a failing feed is not asked on every request.
    await r.busy(projectId, PARIS, DAY.from, DAY.to, { fresh: false });
    expect(fetches).toBe(3);
  });

  it('★ reads again before a booking if its reading is older than a minute', async () => {
    const r = reader();
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    clock += CALENDAR_LIMITS.claimFreshMs + 1;
    // A new appointment was added outside meanwhile.
    feed = { ok: true, text: ICS('20261028T130000Z', '20261028T140000Z') };
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 9));
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: true })).get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 13));
  });

  it('asks the feed once for everyone asking at the same moment', async () => {
    const r = reader();
    await Promise.all([1, 2, 3].map(() => r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: true })));
    expect(fetches).toBe(1);
  });

  it('skips this project’s own bookings, which a subscribed copy of its feed would count twice', async () => {
    feed = { ok: true, text: ICS('20261028T090000Z', '20261028T100000Z', `claim1@${projectId}`) };
    expect((await reader().busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')).toEqual([]);
  });

  it('counts nothing for a resource with no calendar', async () => {
    expect((await reader().busy(projectId, [{ id: 'ben', timeZone: 'Europe/Berlin' }], DAY.from, DAY.to, { fresh: false })).size).toBe(0);
  });
});

describe('★ failing closed', () => {
  it('keeps the last good reading for a day while the feed cannot be read, and says why', async () => {
    const r = reader();
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    feed = { ok: false, error: 'the calendar could not be reached' };
    clock += CALENDAR_LIMITS.freshMs + 1;
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')).toEqual([{ start: Date.UTC(2026, 9, 28, 9), end: Date.UTC(2026, 9, 28, 10) }]);
    await vi.waitFor(async () => expect(await repo.get(projectId, row.id)).toMatchObject({ lastError: 'the calendar could not be reached', lastOkAt: new Date(NOW) }));
  });

  it('★ relies on it for a booking for six hours only', async () => {
    const r = reader();
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    feed = { ok: false, error: 'the calendar could not be reached' };
    clock += CALENDAR_LIMITS.claimStaleMs - 1;
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: true })).get('anna')![0]!.end).toBe(Date.UTC(2026, 9, 28, 10));
    clock += 2;
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: true })).get('anna')).toEqual([{ start: DAY.from, end: DAY.to }]);
    // A listing still shows it, until a day has passed.
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')![0]!.end).toBe(Date.UTC(2026, 9, 28, 10));
  });

  it('reads the resource as busy once the last good reading is more than a day old', async () => {
    const r = reader();
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    feed = { ok: false, error: 'the calendar answered 404' };
    clock += CALENDAR_LIMITS.staleMs + 1;
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')).toEqual([{ start: DAY.from, end: DAY.to }]);
  });

  it('reads the resource as busy if its calendar was never read', async () => {
    feed = { ok: false, error: 'this is not an iCalendar (.ics) file' };
    expect((await reader().busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false })).get('anna')).toEqual([{ start: DAY.from, end: DAY.to }]);
  });

  it('reads the resource as busy if the feed fetcher throws', async () => {
    const r = new CalendarReader({ calendars: repo, fetchFeed: async () => Promise.reject(new Error('boom')), decrypt: (u) => u.ct, now: () => clock, read: readIcsBusy });
    expect((await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: true })).get('anna')).toEqual([{ start: DAY.from, end: DAY.to }]);
    expect((await repo.get(projectId, row.id))?.lastError).toBe('the calendar could not be read');
  });
});

describe('the rest', () => {
  it('forgets a removed calendar’s reading', async () => {
    const r = reader();
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    r.forget(row);
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    expect(fetches).toBe(2);
  });

  it('does not keep a reading that finishes after its calendar was removed', async () => {
    let release: () => void = () => undefined;
    const r = new CalendarReader({
      calendars: repo,
      fetchFeed: async () => {
        fetches += 1;
        if (fetches === 1) await new Promise<void>((resolve) => (release = resolve));
        return feed;
      },
      decrypt: (u) => u.ct,
      now: () => clock,
      read: readIcsBusy,
    });
    const first = r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    await vi.waitFor(() => expect(fetches).toBe(1));
    r.forget(row);
    release();
    await first;
    await r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: false });
    expect(fetches).toBe(2);
  });

  it('★ reads as busy whatever lies beyond the stretch the reading was worked out for', async () => {
    const far = NOW + CALENDAR_LIMITS.aheadMs;
    expect((await reader().busy(projectId, BERLIN, far - DAY_MS_, far + DAY_MS_, { fresh: false })).get('anna')).toEqual([{ start: far, end: far + DAY_MS_ }]);
  });

  it('reads a feed for two clocks at once as two readings, not one on the wrong clock', async () => {
    const r = reader();
    const LONDON = [{ id: 'anna', timeZone: 'Europe/London' }];
    feed = { ok: true, text: ICS('20261028T090000', '20261028T100000') };
    const [berlin, london] = await Promise.all([r.busy(projectId, BERLIN, DAY.from, DAY.to, { fresh: true }), r.busy(projectId, LONDON, DAY.from, DAY.to, { fresh: true })]);
    expect(berlin.get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 8));
    expect(london.get('anna')![0]!.start).toBe(Date.UTC(2026, 9, 28, 9));
    expect(fetches).toBe(2);
  });

  it('takes https and webcal addresses only', () => {
    expect(feedUrl('webcal://p01-calendars.icloud.com/published/2/abc')).toBe('https://p01-calendars.icloud.com/published/2/abc');
    expect(feedUrl(' https://calendar.google.com/calendar/ical/x/private-y/basic.ics ')).toBe('https://calendar.google.com/calendar/ical/x/private-y/basic.ics');
    expect(feedUrl('http://cal.example/a.ics')).toBeNull();
    expect(feedUrl('file:///etc/passwd')).toBeNull();
    expect(feedUrl('not an address')).toBeNull();
  });
});

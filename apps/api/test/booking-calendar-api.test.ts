import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { bookingCalendars } from '../src/db/schema.js';
import type { FetchFeed } from '../src/booking/calendars.js';

/**
 * ★ Outside calendars, end to end: connected in the project (the address is a credential: encrypted, never
 * returned), and read for their busy times, so a time taken in the business's own calendar is neither listed
 * nor bookable. A calendar that cannot be read blocks its resource, never frees it.
 */

const ALL_DAY = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '24:00' }];
const CONFIG = {
  resources: [
    { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: ALL_DAY },
    { id: 'ben', name: 'Ben', timeZone: 'Europe/Berlin', hours: ALL_DAY },
  ],
  offerings: [
    { id: 'anna-hour', name: 'With Anna', mode: 'duration', durationMin: 60, resourceIds: ['anna'] },
    { id: 'ben-hour', name: 'With Ben', mode: 'duration', durationMin: 60, resourceIds: ['ben'] },
  ],
};
const SECRET = 'https://calendar.google.com/calendar/ical/anna%40studio.example/private-0123456789abcdef/basic.ics';
const HUMAN = { _hpt: '', _elapsed: '5000', _ix: '3.2.2', name: 'Ada', email: 'ada@example.test' };
const H = 3_600_000;

let h: Harness;
let client: TestClient;
let pid: string;
let feeds: Map<string, Awaited<ReturnType<FetchFeed>>>;
let fetched: string[];

/** A feed with one appointment, `hours` long, starting `fromNow` hours from now on the hour. */
const busyFeed = (fromNow: number, hours: number): string => {
  const start = Math.ceil(Date.now() / H) * H + fromNow * H;
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:dentist', 'DTSTAMP:20261001T000000Z', `DTSTART:${fmt(start)}`, `DTEND:${fmt(start + hours * H)}`, 'SUMMARY:Dentist', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
};
const listing = async (offering: string) => {
  const from = Date.now();
  const res = await h.app.inject({ method: 'GET', url: `/b/${pid}/${offering}/availability?from=${from}&to=${from + 2 * 86_400_000}` });
  return res.json().times as Array<{ start: number }>;
};
const connect = (body: Record<string, unknown>) => client.post(`/projects/${pid}/booking/calendars`, body);

beforeEach(async () => {
  feeds = new Map();
  fetched = [];
  h = await makeHarness({
    bookingFeedFetch: async (url) => {
      fetched.push(url);
      return feeds.get(url) ?? { ok: false, error: 'the calendar could not be reached' };
    },
  });
  client = await h.signup({ email: 'owner@studio.example', admin: true });
  pid = await client.createProject('Studio', 'studio');
  expect((await client.put(`/projects/${pid}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
});
afterEach(() => h.close());

describe('connecting a calendar', () => {
  it('★ reads it at once, keeps its address encrypted, and never gives the address back', async () => {
    feeds.set(SECRET, { ok: true, text: busyFeed(3, 2) });
    const res = await connect({ resourceId: 'anna', name: 'Anna’s Google calendar', url: SECRET });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ calendar: { resourceId: 'anna', kind: 'ics', name: 'Anna’s Google calendar', host: 'calendar.google.com', lastEvents: 1, lastError: null }, reading: { ok: true } });
    expect(fetched).toEqual([SECRET]);
    const list = await client.get(`/projects/${pid}/booking/calendars`);
    expect(list.json().calendars).toHaveLength(1);
    for (const body of [res.body, list.body]) {
      expect(body).not.toContain('private-0123456789abcdef');
      expect(body).not.toContain('"url"');
    }
    const [stored] = await h.db.select().from(bookingCalendars);
    expect(JSON.stringify(stored!.url)).not.toContain('private-0123456789abcdef');
  });

  it('takes a webcal address as https, and says when a calendar cannot be read', async () => {
    const res = await connect({ resourceId: 'anna', name: 'iCloud', url: 'webcal://p01-calendars.icloud.com/published/2/abc' });
    expect(res.statusCode).toBe(201);
    expect(fetched).toEqual(['https://p01-calendars.icloud.com/published/2/abc']);
    expect(res.json()).toMatchObject({ reading: { ok: false, error: 'the calendar could not be reached' }, calendar: { lastError: 'the calendar could not be reached' } });
  });

  it('refuses what it cannot use', async () => {
    expect((await connect({ resourceId: 'anna', name: 'x', url: 'http://cal.example/a.ics' })).statusCode).toBe(400);
    expect((await connect({ resourceId: 'nobody', name: 'x', url: SECRET })).statusCode).toBe(400);
    expect((await connect({ resourceId: 'anna', name: '', url: SECRET })).statusCode).toBe(400);
    expect((await connect({ resourceId: 'anna', name: 'x', url: SECRET, extra: 1 })).statusCode).toBe(400);
  });

  it('is the project’s alone', async () => {
    feeds.set(SECRET, { ok: true, text: busyFeed(3, 2) });
    const { calendar } = (await connect({ resourceId: 'anna', name: 'x', url: SECRET })).json();
    const stranger = await h.signup({ email: 'stranger@example.test' });
    expect((await stranger.get(`/projects/${pid}/booking/calendars`)).statusCode).toBe(403);
    expect((await stranger.post(`/projects/${pid}/booking/calendars`, { resourceId: 'anna', name: 'x', url: SECRET })).statusCode).toBe(403);
    expect((await stranger.del(`/projects/${pid}/booking/calendars/${calendar.id}`)).statusCode).toBe(403);
  });
});

describe('★ the busy times', () => {
  it('take a time out of the listing, and refuse a booking of it', async () => {
    const before = await listing('anna-hour');
    feeds.set(SECRET, { ok: true, text: busyFeed(3, 2) });
    await connect({ resourceId: 'anna', name: 'x', url: SECRET });
    const after = await listing('anna-hour');
    const taken = before.filter((t) => !after.some((a) => a.start === t.start));
    // The two hours of the appointment, and the hour before it that would run into it.
    expect(taken.length).toBeGreaterThanOrEqual(2);
    const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/anna-hour`, payload: { ...HUMAN, start: String(taken[0]!.start) } });
    expect(res.statusCode).toBe(409);
    // Ben's own times are untouched.
    expect((await listing('ben-hour')).length).toBe(before.length);
  });

  it('block a resource whose calendar cannot be read, and only that one', async () => {
    await connect({ resourceId: 'anna', name: 'broken', url: 'https://cal.example/missing.ics' });
    expect(await listing('anna-hour')).toEqual([]);
    expect((await listing('ben-hour')).length).toBeGreaterThan(0);
  });

  it('go when the calendar is removed, and a test reads it again', async () => {
    feeds.set(SECRET, { ok: true, text: busyFeed(3, 2) });
    const { calendar } = (await connect({ resourceId: 'anna', name: 'x', url: SECRET })).json();
    const withCalendar = (await listing('anna-hour')).length;
    const test = await client.post(`/projects/${pid}/booking/calendars/${calendar.id}/test`, {});
    expect(test.json()).toMatchObject({ reading: { ok: true } });
    expect(fetched).toHaveLength(2);
    expect((await client.del(`/projects/${pid}/booking/calendars/${calendar.id}`)).statusCode).toBe(200);
    expect((await listing('anna-hour')).length).toBeGreaterThan(withCalendar);
    expect((await client.del(`/projects/${pid}/booking/calendars/${calendar.id}`)).statusCode).toBe(404);
  });
});

describe('★ a CalDAV calendar', () => {
  const CAL = 'https://cloud.example/remote.php/dav/calendars/anna/personal/';
  const BASIC = `Basic ${Buffer.from('anna:app-pass-1234').toString('base64')}`;
  let dav: string[];

  beforeEach(async () => {
    await h.close();
    dav = [];
    h = await makeHarness({
      bookingDavFetch: async (url, init) => {
        dav.push(`${init.method} ${url}`);
        if (init.headers.authorization !== BASIC) return { ok: true, status: 401, headers: {}, text: '' };
        if (url === 'https://cloud.example/.well-known/caldav' && init.method === 'PROPFIND') {
          return {
            ok: true,
            status: 207,
            headers: {},
            text: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/remote.php/dav/calendars/anna/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
          };
        }
        if (url === 'https://cloud.example/remote.php/dav/calendars/anna/' && init.method === 'PROPFIND') {
          return {
            ok: true,
            status: 207,
            headers: {},
            text: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/remote.php/dav/calendars/anna/personal/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Personal</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
          };
        }
        if (url === CAL && init.method === 'REPORT') {
          return {
            ok: true,
            status: 207,
            headers: {},
            text: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/x.ics</d:href><d:propstat><d:prop><c:calendar-data>${busyFeed(3, 2)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
          };
        }
        return { ok: true, status: 404, headers: {}, text: '' };
      },
    });
    client = await h.signup({ email: 'owner@studio.example', admin: true });
    pid = await client.createProject('Studio', 'studio');
    expect((await client.put(`/projects/${pid}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
  });

  it('finds the account’s calendars for writers, and says when the password is wrong', async () => {
    const found = await client.post(`/projects/${pid}/booking/calendars/discover`, { url: 'https://cloud.example', username: 'anna', password: 'app-pass-1234' });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json()).toEqual({ calendars: [{ url: CAL, name: 'Personal' }] });
    const wrong = await client.post(`/projects/${pid}/booking/calendars/discover`, { url: 'https://cloud.example', username: 'anna', password: 'nope' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toMatch(/username or password/);
    const stranger = await h.signup({ email: 'stranger@example.test' });
    expect((await stranger.post(`/projects/${pid}/booking/calendars/discover`, { url: 'https://cloud.example', username: 'anna', password: 'app-pass-1234' })).statusCode).toBe(403);
  });

  it('★ is connected with its password encrypted and never given back, and its busy times count', async () => {
    const before = await listing('anna-hour');
    const res = await connect({ kind: 'caldav', resourceId: 'anna', name: 'Nextcloud', url: CAL, username: 'anna', password: 'app-pass-1234' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ calendar: { kind: 'caldav', host: 'cloud.example', lastEvents: 1 }, reading: { ok: true } });
    const list = await client.get(`/projects/${pid}/booking/calendars`);
    for (const body of [res.body, list.body]) {
      expect(body).not.toContain('app-pass-1234');
      expect(body).not.toContain('"username"');
    }
    const [stored] = await h.db.select().from(bookingCalendars);
    expect(JSON.stringify(stored)).not.toContain('app-pass-1234');
    expect(JSON.stringify(stored)).not.toContain('anna@');
    const after = await listing('anna-hour');
    expect(before.length - after.length).toBeGreaterThanOrEqual(2);
    expect(dav).toContain(`REPORT ${CAL}`);
  });

  it('refuses a CalDAV connection without its credentials, or on a plain-http address', async () => {
    expect((await connect({ kind: 'caldav', resourceId: 'anna', name: 'x', url: CAL })).statusCode).toBe(400);
    expect((await connect({ kind: 'caldav', resourceId: 'anna', name: 'x', url: 'http://cloud.example/cal/', username: 'a', password: 'b' })).statusCode).toBe(400);
  });
});

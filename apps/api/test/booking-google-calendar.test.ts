import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { FetchLike } from '../src/payments/executor.js';
import { AccessTokens } from '../src/webmaster/request.js';
import { checkGoogleCalendar, deleteGoogleEvent, eventIdFor, googleEventFor, googleProofCode, putGoogleEvent, readGoogleCalendar } from '../src/booking/google-calendar.js';
import type { GoogleServiceAccountKey } from '../src/webmaster/google.js';

/**
 * A Google calendar through the platform's ONE service account: the business shares its calendar with the account,
 * and its busy times are read (failing closed, our own bookings skipped) and its bookings written by an event id
 * made from the booking. The fake Google keeps a calendar in memory and checks the token's scopes.
 */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY: GoogleServiceAccountKey = { clientEmail: 'booking@platform-123.iam.gserviceaccount.com', privateKey, privateKeyId: 'a1b2c3d4e5f6', projectId: 'platform-123' };
const CAL = 'studio@group.calendar.google.com';
const FROM = Date.UTC(2026, 9, 26);
const TO = Date.UTC(2026, 10, 9);

let shared: Map<string, { access: 'writer' | 'reader' }>;
let events: Map<string, Record<string, unknown>>;
let pages: Array<Array<Record<string, unknown>>> | null;
let scopes: string[];
let log: string[];

const json = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const fakeGoogle: FetchLike = async (url, init) => {
  log.push(`${init.method} ${url.split('?')[0]}`);
  if (url === 'https://oauth2.googleapis.com/token') {
    const assertion = new URLSearchParams(init.body).get('assertion')!;
    scopes = (JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString()) as { scope: string }).scope.split(' ');
    return json(200, { access_token: 'ya29.calendar', expires_in: 3599 });
  }
  expect(init.headers.authorization).toBe('Bearer ya29.calendar');
  const m = /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/?]+)(\/events(?:\/([^/?]+))?)?/.exec(url);
  const calendarId = m ? decodeURIComponent(m[1]!) : '';
  const access = shared.get(calendarId);
  if (!m || !access) return json(404, { error: { code: 404, message: 'Not Found' } });
  if (!m[2]) return json(200, { summary: 'Studio', description: 'booking-0123456789ab' });
  if (init.method === 'GET') {
    if (pages) {
      const token = new URL(url).searchParams.get('pageToken');
      const i = token ? Number(token) : 0;
      return json(200, { timeZone: 'Europe/Berlin', items: pages[i], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) });
    }
    return json(200, { timeZone: 'Europe/Berlin', items: [...events.values()] });
  }
  if (access.access === 'reader') return json(403, { error: { code: 403, errors: [{ reason: 'requiredAccessLevel' }] } });
  const id = m[3];
  if (init.method === 'PUT') {
    if (!id || !events.has(id)) return json(404, {});
    events.set(id, JSON.parse(init.body!));
    return json(200, {});
  }
  if (init.method === 'POST') {
    const body = JSON.parse(init.body!) as { id: string };
    events.set(body.id, body);
    return json(200, body);
  }
  if (init.method === 'DELETE') return events.delete(id!) ? json(204, {}) : json(410, {});
  return json(400, {});
};
const io = () => ({ fetch: fakeGoogle, tokens: new AccessTokens() });

beforeEach(() => {
  shared = new Map([[CAL, { access: 'writer' }]]);
  events = new Map();
  pages = null;
  scopes = [];
  log = [];
});

describe('connecting', () => {
  it('★ asks for the calendar scopes, and says to share the calendar with the platform’s account when it is not', async () => {
    expect(await checkGoogleCalendar(KEY, io(), CAL)).toEqual({ ok: true, name: 'Studio', description: 'booking-0123456789ab' });
    expect(scopes).toEqual(['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']);
    expect(await checkGoogleCalendar(KEY, io(), 'other@group.calendar.google.com')).toEqual({
      ok: false,
      error: 'the calendar is not shared with booking@platform-123.iam.gserviceaccount.com, or its id is wrong',
    });
  });
});

describe('★ reading', () => {
  const opts = { from: FROM, to: TO, timeZone: 'Europe/Berlin', ownUidSuffix: '@p1' };

  it('reads the busy times, all-day events on the calendar’s clock, and skips free, cancelled and our own events', async () => {
    events.set('a', { status: 'confirmed', start: { dateTime: '2026-10-28T10:00:00+01:00' }, end: { dateTime: '2026-10-28T11:00:00+01:00' } });
    events.set('b', { status: 'confirmed', start: { date: '2026-11-02' }, end: { date: '2026-11-03' } });
    events.set('free', { status: 'confirmed', transparency: 'transparent', start: { dateTime: '2026-10-29T10:00:00Z' }, end: { dateTime: '2026-10-29T11:00:00Z' } });
    events.set('gone', { status: 'cancelled', start: { dateTime: '2026-10-30T10:00:00Z' }, end: { dateTime: '2026-10-30T11:00:00Z' } });
    events.set('ours', { iCalUID: 'claim1@p1', creator: { email: KEY.clientEmail }, status: 'confirmed', start: { dateTime: '2026-10-31T10:00:00Z' }, end: { dateTime: '2026-10-31T11:00:00Z' } });
    // ★ Our UID on an event someone else made (an invitation can carry any UID): it still blocks its time.
    events.set('forged', { iCalUID: 'claim2@p1', creator: { email: 'someone@example.com' }, status: 'confirmed', start: { dateTime: '2026-11-04T10:00:00Z' }, end: { dateTime: '2026-11-04T11:00:00Z' } });
    expect(await readGoogleCalendar(KEY, io(), CAL, opts)).toEqual({
      ok: true,
      events: 6,
      intervals: [
        { start: Date.UTC(2026, 9, 28, 9), end: Date.UTC(2026, 9, 28, 10) },
        { start: Date.UTC(2026, 10, 1, 23), end: Date.UTC(2026, 10, 2, 23) },
        { start: Date.UTC(2026, 10, 4, 10), end: Date.UTC(2026, 10, 4, 11) },
      ],
    });
  });

  it('★ reads every page, and fails closed on what it cannot read in full', async () => {
    const one = (h: number) => ({ status: 'confirmed', start: { dateTime: `2026-10-28T${String(h).padStart(2, '0')}:00:00Z` }, end: { dateTime: `2026-10-28T${String(h).padStart(2, '0')}:30:00Z` } });
    pages = [[one(8)], [one(10)], [one(12)]];
    const r = await readGoogleCalendar(KEY, io(), CAL, opts);
    expect(r.ok && r.intervals).toHaveLength(3);
    pages = Array.from({ length: 21 }, (_, i) => [one(i % 24)]);
    expect(await readGoogleCalendar(KEY, io(), CAL, opts)).toEqual({ ok: false, error: 'the calendar has more events than can be read' });
    pages = [[{ status: 'confirmed', start: { dateTime: 'soon' }, end: { dateTime: 'later' } }]];
    expect(await readGoogleCalendar(KEY, io(), CAL, opts)).toEqual({ ok: false, error: 'the calendar has an event that could not be read' });
    shared.clear();
    expect(await readGoogleCalendar(KEY, io(), CAL, opts)).toMatchObject({ ok: false, error: /not shared with/ });
  });
});

describe('★ writing', () => {
  const claim = { id: 'c1', state: 'pending' as const, startAt: new Date(Date.UTC(2026, 10, 3, 9)), endAt: new Date(Date.UTC(2026, 10, 3, 10)), units: 1, customer: { name: 'Ada' }, resourceId: 'anna', offeringId: 'cut' };

  it('adds the booking’s event, updates it by the same id, and takes it out', async () => {
    const event = googleEventFor('p1', claim, null);
    expect(event).toMatchObject({ id: eventIdFor('p1', 'c1'), iCalUID: 'c1@p1', status: 'tentative', summary: 'Booking: Ada (request)', start: { dateTime: '2026-11-03T09:00:00.000Z' } });
    expect(await putGoogleEvent(KEY, io(), CAL, event)).toEqual({ ok: true });
    // Not there yet: the update is answered 404, so it is added.
    expect(log.filter((l) => !l.includes('oauth2'))).toEqual([`PUT https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL)}/events/${event.id}`, `POST https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL)}/events`]);
    expect(await putGoogleEvent(KEY, io(), CAL, googleEventFor('p1', { ...claim, state: 'booked' }, null))).toEqual({ ok: true });
    expect(events.get(event.id)).toMatchObject({ status: 'confirmed', transparency: 'opaque' });
    expect(await deleteGoogleEvent(KEY, io(), CAL, event.id)).toEqual({ ok: true });
    // Already gone is done.
    expect(await deleteGoogleEvent(KEY, io(), CAL, event.id)).toEqual({ ok: true });
  });

  it('★ stops for good on a calendar shared read-only, or no longer shared', async () => {
    shared.set(CAL, { access: 'reader' });
    expect(await putGoogleEvent(KEY, io(), CAL, googleEventFor('p1', claim, null))).toMatchObject({ ok: false, final: true, error: /“Make changes to events”/ });
    shared.clear();
    expect(await putGoogleEvent(KEY, io(), CAL, googleEventFor('p1', claim, null))).toMatchObject({ ok: false, final: true });
  });

  it('★ writes a customer’s note as text, never as markup Google would show as a link', () => {
    const e = googleEventFor('p1', { ...claim, customer: { name: 'Ada', note: '<a href="https://evil.example">Click</a> & more' } }, null);
    expect(e.description).toContain('Note: &lt;a href="https://evil.example"&gt;Click&lt;/a&gt; &amp; more');
  });

  it('writes a rental by the day as whole days, and an event id in Google’s alphabet', () => {
    const config = {
      resources: [{ id: 'anna', name: 'Flat', timeZone: 'Europe/Berlin', capacity: 1, hours: [], blocks: [] }],
      offerings: [{ id: 'cut', name: 'Bikes', mode: 'days' as const, unit: 'day' as const, minUnits: 1, maxUnits: 7, checkIn: '15:00', checkOut: '11:00', resourceIds: ['anna'], confirmation: 'instant' as const, minNoticeMin: 0, maxAdvanceDays: 90, maxQuantity: 1, chooseResource: false }],
      pow: false,
      captcha: false,
    };
    const e = googleEventFor('p1', { ...claim, startAt: new Date(Date.UTC(2026, 10, 2, 23)), endAt: new Date(Date.UTC(2026, 10, 4, 23)) }, config);
    expect(e.start).toEqual({ date: '2026-11-03' });
    expect(e.end).toEqual({ date: '2026-11-05' });
    expect(eventIdFor('p1', 'c1')).toMatch(/^[0-9a-v]{52}$/);
    expect(eventIdFor('p1', 'c1')).toBe(eventIdFor('p1', 'c1'));
    expect(eventIdFor('p2', 'c1')).not.toBe(eventIdFor('p1', 'c1'));
  });
});

describe('the proof code', () => {
  it('is the same for a project every time, and differs between projects and platforms', () => {
    const secret = Buffer.alloc(32, 7);
    expect(googleProofCode('p1', secret)).toMatch(/^booking-[0-9a-f]{12}$/);
    expect(googleProofCode('p1', secret)).toBe(googleProofCode('p1', secret));
    expect(googleProofCode('p2', secret)).not.toBe(googleProofCode('p1', secret));
    expect(googleProofCode('p1', Buffer.alloc(32, 8))).not.toBe(googleProofCode('p1', secret));
  });
});

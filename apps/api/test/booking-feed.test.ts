import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import ICAL from 'ical.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { addProjectMember } from '../src/repo/accounts.js';
import { bookingFeeds, projects } from '../src/db/schema.js';
import { renderBookingFeed } from '../src/booking/feed.js';
import { maskUrlSecrets } from '../src/http/log-redact.js';
import type { ClaimRow } from '../src/booking/claims.js';

/**
 * ★ The business's bookings as a calendar feed its own calendar subscribes to. The feed names customers and their
 * contacts: its address is a secret, for writers only, and a wrong, foreign, replaced or switched-off address
 * answers one and the same 404.
 */

const ALL_DAY = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '24:00' }];
const CONFIG = {
  resources: [
    { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: ALL_DAY },
    { id: 'ben', name: 'Ben', timeZone: 'Europe/Berlin', hours: ALL_DAY },
  ],
  offerings: [
    { id: 'massage', name: 'Massage', mode: 'duration', durationMin: 60, resourceIds: ['ben'] },
    { id: 'ask', name: 'Consultation', mode: 'duration', durationMin: 60, resourceIds: ['anna'], confirmation: 'request' },
  ],
};
const HUMAN = { _hpt: '', _elapsed: '5000', _ix: '3.2.2' };
const ME = { name: 'Ada Lovelace', email: 'ada@example.test', phone: '+49 30 1234', note: 'First visit; ring twice' };

let h: Harness;
let client: TestClient;
let pid: string;

beforeEach(async () => {
  h = await makeHarness();
  client = await h.signup({ email: 'owner@studio.example', admin: true });
  pid = await client.createProject('Studio Nord', 'studio');
  expect((await client.put(`/projects/${pid}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
});
afterEach(() => h.close());

const book = async (offering: string, nth = 3) => {
  const from = Date.now();
  const list = await h.app.inject({ method: 'GET', url: `/b/${pid}/${offering}/availability?from=${from}&to=${from + 7 * 86_400_000}` });
  const start = list.json().times[nth].start as number;
  const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/${offering}`, payload: { ...HUMAN, ...ME, start: String(start) } });
  expect(res.statusCode, res.body).toBe(200);
  return start;
};
const switchOn = async () => {
  const res = await client.post(`/projects/${pid}/booking/feed`, {});
  expect(res.statusCode, res.body).toBe(201);
  return res.json().feed as { url: string; webcalUrl: string; createdAt: number; lastFetchedAt: number | null };
};
/** The feed fetched as a calendar app would (no session). */
const fetchFeed = (url: string) => h.app.inject({ method: 'GET', url: new URL(url).pathname + new URL(url).search });
const events = (text: string) => new ICAL.Component(ICAL.parse(text) as unknown as unknown[]).getAllSubcomponents('vevent');

describe('switching it on', () => {
  it('★ gives writers an address with a long secret, shows it again, and never to anyone else', async () => {
    expect((await client.get(`/projects/${pid}/booking/feed`)).json()).toEqual({ feed: null });
    const feed = await switchOn();
    expect(feed.url).toMatch(new RegExp(`/b/${pid}/feed/[A-Za-z0-9_-]{32}\\.ics$`));
    expect(feed.webcalUrl).toBe(feed.url.replace(/^https?:/, 'webcal:'));
    expect((await client.get(`/projects/${pid}/booking/feed`)).json().feed.url).toBe(feed.url);
    // The token is kept encrypted, and found by its hash.
    const [row] = await h.db.select().from(bookingFeeds);
    const token = /feed\/(.+)\.ics$/.exec(feed.url)![1]!;
    expect(JSON.stringify(row)).not.toContain(token);

    const member = await h.signup({ email: 'member@studio.example' });
    await addProjectMember(h.db, member.userId, pid, 'member');
    expect((await member.get(`/projects/${pid}/booking/feed`)).json().feed.url).toBe(feed.url);
    const stranger = await h.signup({ email: 'stranger@example.test' });
    for (const res of [await stranger.get(`/projects/${pid}/booking/feed`), await stranger.post(`/projects/${pid}/booking/feed`, {}), await stranger.del(`/projects/${pid}/booking/feed`)]) {
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(token);
    }
  });

  it('is on the base the published site calls the booking API at, when the instance has one', async () => {
    await h.close();
    h = await makeHarness({ publicUrl: 'https://book.studio.example/' });
    client = await h.signup({ email: 'owner@studio.example', admin: true });
    pid = await client.createProject('Studio Nord', 'studio');
    expect((await switchOn()).url).toMatch(new RegExp(`^https://book\\.studio\\.example/b/${pid}/feed/`));
  });
});

describe('★ the feed', () => {
  it('lists the bookings and the open requests, the requests tentative, with the customer’s details', async () => {
    const booked = await book('massage');
    const asked = await book('ask', 5);
    const feed = await switchOn();
    const res = await fetchFeed(feed.url);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.body).toContain('X-WR-CALNAME:Studio Nord: bookings');
    const list = events(res.body).map((e) => ({
      uid: String(e.getFirstPropertyValue('uid')),
      start: (e.getFirstPropertyValue('dtstart') as InstanceType<typeof ICAL.Time>).toJSDate().getTime(),
      status: e.getFirstPropertyValue('status'),
      summary: e.getFirstPropertyValue('summary'),
      description: String(e.getFirstPropertyValue('description')),
    }));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ start: booked, status: 'CONFIRMED', summary: 'Massage: Ada Lovelace' });
    expect(list[1]).toMatchObject({ start: asked, status: 'TENTATIVE', summary: 'Consultation: Ada Lovelace (request)' });
    // The same UID as the booking's invitations, so a calendar knows them for the same booking.
    for (const e of list) expect(e.uid).toMatch(new RegExp(`@${pid}$`));
    expect(list[0]!.description).toContain('With: Ben');
    expect(list[0]!.description).toContain('Phone: +49 30 1234');
    expect(list[0]!.description).toContain('Note: First visit; ring twice');
  });

  it('can be one resource’s alone', async () => {
    await book('massage');
    await book('ask', 5);
    const feed = await switchOn();
    const res = await fetchFeed(`${feed.url}?resource=anna`);
    expect(res.body).toContain('X-WR-CALNAME:Studio Nord: Anna');
    expect(events(res.body).map((e) => e.getFirstPropertyValue('summary'))).toEqual(['Consultation: Ada Lovelace (request)']);
    expect((await fetchFeed(`${feed.url}?resource=nobody`)).statusCode).toBe(404);
  });

  it('★ answers one 404 for a wrong token, another project’s token, a replaced one and a switched-off feed', async () => {
    const first = await switchOn();
    const path = new URL(first.url).pathname;
    expect((await fetchFeed(first.url)).statusCode).toBe(200);
    // Wrong token, and nothing like a token.
    expect((await h.app.inject({ method: 'GET', url: path.replace(/feed\/.{4}/, 'feed/AAAA') })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: `/b/${pid}/feed/x.ics` })).statusCode).toBe(404);
    // This project's token under another project's address.
    const other = await client.createProject('Other', 'other');
    expect((await h.app.inject({ method: 'GET', url: path.replace(pid, other) })).statusCode).toBe(404);
    // A new address: the old one stops at once.
    const second = await switchOn();
    expect(second.url).not.toBe(first.url);
    expect((await fetchFeed(first.url)).statusCode).toBe(404);
    expect((await fetchFeed(second.url)).statusCode).toBe(200);
    // Switched off.
    expect((await client.del(`/projects/${pid}/booking/feed`)).statusCode).toBe(200);
    expect((await fetchFeed(second.url)).statusCode).toBe(404);
    expect((await client.del(`/projects/${pid}/booking/feed`)).statusCode).toBe(404);
  });

  it('stops with a deleted project', async () => {
    const feed = await switchOn();
    await h.db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, pid));
    expect((await fetchFeed(feed.url)).statusCode).toBe(404);
  });

  it('tells the business that a calendar fetches it', async () => {
    const feed = await switchOn();
    expect(feed.lastFetchedAt).toBeNull();
    await fetchFeed(feed.url);
    for (let i = 0; i < 50; i += 1) {
      if ((await client.get(`/projects/${pid}/booking/feed`)).json().feed.lastFetchedAt) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await client.get(`/projects/${pid}/booking/feed`)).json().feed.lastFetchedAt).toBeGreaterThan(0);
  });
});

describe('★ the address is a credential', () => {
  it('is masked in the request log', () => {
    expect(maskUrlSecrets('/b/p1/feed/AbCdEfGhIjKlMnOpQrStUvWxYz012345.ics?resource=anna')).toBe('/b/p1/feed/***.ics?resource=anna');
    expect(maskUrlSecrets('/b/p1/feed/whatever')).toBe('/b/p1/feed/***');
    expect(maskUrlSecrets('/sites/studio/b/p1/feed/AbCdEfGhIjKlMnOpQrStUvWxYz012345.ics')).toBe('/sites/studio/b/p1/feed/***.ics');
    expect(maskUrlSecrets('/b/p1/massage/availability?from=1')).toBe('/b/p1/massage/availability?from=1');
  });

  it('is not handed to an API key that may only read the project', async () => {
    await switchOn();
    const key = await client.post(`/projects/${pid}/api-keys`, { name: 'report', role: 'owner', expiresInDays: 30, capabilities: ['content:read'] });
    expect(key.statusCode, key.body).toBe(201);
    const res = await h.app.inject({ method: 'GET', url: `/projects/${pid}/booking/feed`, headers: { authorization: `Bearer ${key.json().token}` } });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('/feed/');
  });
});

describe('renderBookingFeed', () => {
  const claim = (over: Partial<ClaimRow>): ClaimRow => ({
    id: 'c1',
    projectId: 'p1',
    resourceId: 'flat',
    offeringId: 'bikes',
    state: 'booked',
    startAt: new Date(Date.UTC(2026, 10, 2, 23)),
    endAt: new Date(Date.UTC(2026, 10, 4, 23)),
    busyStart: new Date(Date.UTC(2026, 10, 2, 23)),
    busyEnd: new Date(Date.UTC(2026, 10, 4, 23)),
    units: 3,
    exclusive: false,
    expiresAt: null,
    customer: { email: 'grace@example.test' },
    paidTxnId: null,
    locale: null,
    remindedAt: null,
    payBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  });

  it('writes whole days as dates on the resource’s clock, and names a customer by email when there is no name', () => {
    const text = renderBookingFeed({
      projectId: 'p1',
      calendarName: 'Bikes, boats: bookings',
      config: {
        resources: [{ id: 'flat', name: 'Bike shed', timeZone: 'Europe/Berlin', capacity: 10, hours: [], blocks: [] }],
        offerings: [
          {
            id: 'bikes',
            name: 'Bikes',
            mode: 'days',
            unit: 'day',
            minUnits: 1,
            maxUnits: 7,
            checkIn: '15:00',
            checkOut: '11:00',
            resourceIds: ['flat'],
            confirmation: 'instant',
            minNoticeMin: 0,
            maxAdvanceDays: 90,
            maxQuantity: 5,
            chooseResource: false,
          },
        ],
        pow: false,
        captcha: false,
      },
      claims: [claim({})],
      now: 0,
    });
    // 3 and 4 November in Berlin: the end date is exclusive.
    expect(text).toContain('DTSTART;VALUE=DATE:20261103');
    expect(text).toContain('DTEND;VALUE=DATE:20261105');
    expect(text).toContain('SUMMARY:Bikes: grace@example.test');
    expect(text).toContain('X-WR-CALNAME:Bikes\\, boats: bookings');
    expect(text).toContain('For: 3');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('still lists a booking whose offering or resource is gone from the set-up', () => {
    const text = renderBookingFeed({ projectId: 'p1', calendarName: 'x', config: null, claims: [claim({ customer: {} })], now: 0 });
    expect(text).toContain('SUMMARY:Booking: a customer');
    expect(text).toContain('DTSTART:20261102T230000Z');
  });
});

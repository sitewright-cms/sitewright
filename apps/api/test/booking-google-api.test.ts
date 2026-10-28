import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import type { FetchLike } from '../src/payments/executor.js';
import { eventIdFor } from '../src/booking/google-calendar.js';

/**
 * ★ A Google calendar, end to end: the platform's ONE service account (stored by staff in System Settings) is the
 * address a business shares its calendar with; connecting proves it is shared, the calendar's busy times count, and
 * the bookings go into it and come out again.
 */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const EMAIL = 'booking@platform-123.iam.gserviceaccount.com';
const KEY_FILE = JSON.stringify({ type: 'service_account', project_id: 'platform-123', private_key_id: 'a1b2c3d4e5f60718', private_key: privateKey, client_email: EMAIL });
const CAL = 'studio@group.calendar.google.com';
const ALL_DAY = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '24:00' }];
const CONFIG = {
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: ALL_DAY }],
  offerings: [{ id: 'anna-hour', name: 'With Anna', mode: 'duration', durationMin: 60, resourceIds: ['anna'] }],
};
const HUMAN = { _hpt: '', _elapsed: '5000', _ix: '3.2.2', name: 'Ada', email: 'ada@example.test' };
const H = 3_600_000;

let h: Harness;
let client: TestClient;
let pid: string;
let shared: boolean;
/** The calendar's description: where its owner puts the project's proof code. */
let description: string;
let events: Map<string, Record<string, unknown>>;
let writes: string[];

const json = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const fakeGoogle: FetchLike = async (url, init) => {
  if (url === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'ya29.x', expires_in: 3599 });
  const m = /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/?]+)(\/events(?:\/([^/?]+))?)?/.exec(url);
  if (!m || decodeURIComponent(m[1]!) !== CAL || !shared) return json(404, {});
  if (!m[2]) return json(200, { summary: 'Studio', description });
  if (init.method === 'GET') return json(200, { timeZone: 'Europe/Berlin', items: [...events.values()] });
  writes.push(`${init.method} ${m[3] ?? ''}`);
  if (init.method === 'PUT') return m[3] && events.has(m[3]) ? (events.set(m[3], JSON.parse(init.body!)), json(200, {})) : json(404, {});
  if (init.method === 'POST') {
    const body = JSON.parse(init.body!) as { id: string };
    events.set(body.id, body);
    return json(200, body);
  }
  return events.delete(m[3]!) ? json(204, {}) : json(410, {});
};

beforeEach(async () => {
  shared = false;
  description = '';
  events = new Map();
  writes = [];
  h = await makeHarness({ webmasterFetch: fakeGoogle });
  client = await h.signup({ email: 'owner@studio.example', admin: true });
  expect((await client.put('/admin/webmaster-accounts', { google: { keyFile: KEY_FILE } })).statusCode).toBe(200);
  pid = await client.createProject('Studio', 'studio');
  expect((await client.put(`/projects/${pid}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
});
afterEach(() => h.close());

const listing = async () => {
  const from = Date.now();
  return (await h.app.inject({ method: 'GET', url: `/b/${pid}/anna-hour/availability?from=${from}&to=${from + 2 * 86_400_000}` })).json().times as Array<{ start: number }>;
};
const connect = (body: Record<string, unknown>) => client.post(`/projects/${pid}/booking/calendars`, { kind: 'google', resourceId: 'anna', name: 'Studio', calendarId: CAL, ...body });

/** Shares the calendar with the platform's account, and puts this project's proof code into its description. */
const shareAsOwner = async () => {
  shared = true;
  description = `Studio bookings\n${(await client.get(`/projects/${pid}/booking/google`)).json().proofCode}`;
};

describe('connecting a Google calendar', () => {
  it('★ names the address to share with, and refuses until the calendar is shared with it', async () => {
    const google = (await client.get(`/projects/${pid}/booking/google`)).json();
    expect(google).toEqual({ serviceAccount: EMAIL, proofCode: expect.stringMatching(/^booking-[0-9a-f]{12}$/) });
    const refused = await connect({});
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(new RegExp(`^the calendar is not shared with ${EMAIL.replace(/\./g, '\\.')}, or its description does not carry booking-[0-9a-f]{12} yet`));
    await shareAsOwner();
    const ok = await connect({});
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ calendar: { kind: 'google', host: 'calendar.google.com', writes: false }, reading: { ok: true } });
    expect((await connect({ calendarId: 'not an id' })).statusCode).toBe(400);
  });

  it('★ refuses a calendar shared with the platform but not proven to be this project’s', async () => {
    shared = true;
    const refused = await connect({});
    expect(refused.statusCode).toBe(400);
    // ★ The same answer as "not shared": connecting does not tell which calendars the platform's account can see.
    const unshared = await (async () => {
      shared = false;
      const r = (await connect({})).json().error as string;
      shared = true;
      return r;
    })();
    expect(refused.json().error).toBe(unshared);
    // Another project's code proves nothing for this one.
    const other = await client.createProject('Other', 'other');
    description = (await client.get(`/projects/${other}/booking/google`)).json().proofCode;
    expect(description).not.toBe((await client.get(`/projects/${pid}/booking/google`)).json().proofCode);
    expect((await connect({})).statusCode).toBe(400);
    await shareAsOwner();
    expect((await connect({})).statusCode).toBe(201);
  });

  it('counts its busy times', async () => {
    await shareAsOwner();
    const before = await listing();
    const start = Math.ceil(Date.now() / H) * H + 3 * H;
    events.set('dentist', { status: 'confirmed', start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(start + 2 * H).toISOString() } });
    await connect({});
    expect(before.length - (await listing()).length).toBeGreaterThanOrEqual(2);
  });
});

describe('★ bookings into a Google calendar', () => {
  it('goes in as it is made, under an id made from it, and comes out when cancelled', async () => {
    await shareAsOwner();
    expect((await connect({ writes: true })).json().calendar.writes).toBe(true);
    const times = await listing();
    expect((await h.app.inject({ method: 'POST', url: `/b/${pid}/anna-hour`, payload: { ...HUMAN, start: String(times[2]!.start) } })).statusCode).toBe(200);
    const [booking] = (await client.get(`/projects/${pid}/bookings`)).json().bookings as Array<{ id: string }>;
    const id = eventIdFor(pid, booking!.id);
    for (let i = 0; i < 200 && !events.has(id); i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(events.get(id)).toMatchObject({ iCalUID: `${booking!.id}@${pid}`, status: 'confirmed', summary: 'With Anna: Ada' });
    // Read back, our own event is skipped: the time is the booking's, not blocked twice.
    expect((await client.post(`/projects/${pid}/booking/calendars/${(await client.get(`/projects/${pid}/booking/calendars`)).json().calendars[0].id}/test`, {})).json().reading.ok).toBe(true);
    expect((await client.post(`/projects/${pid}/bookings/${booking!.id}/cancel`, {})).statusCode).toBe(200);
    for (let i = 0; i < 200 && events.has(id); i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(events.has(id)).toBe(false);
    expect(writes).toEqual([`PUT ${id}`, 'POST ', `DELETE ${id}`]);
  });

  it('is offered only when the platform has a Google account', async () => {
    expect((await client.put('/admin/webmaster-accounts', { google: null })).statusCode).toBe(200);
    expect((await client.get(`/projects/${pid}/booking/google`)).json()).toEqual({ serviceAccount: null, proofCode: null });
    shared = true;
    expect((await connect({})).json().error).toMatch(/no Google account/);
  });
});

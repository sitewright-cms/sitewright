import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { signBookingRef, verifyBookingRef } from '../src/booking/reference.js';

/**
 * The public booking routes, end to end through the app. The set-up is open around the clock, so the
 * tests hold whenever they run.
 */

const ALL_DAY = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '24:00' }];
const CONFIG = {
  resources: [
    { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: ALL_DAY },
    { id: 'ben', name: 'Ben', timeZone: 'Europe/Berlin', hours: ALL_DAY },
    { id: 'guide', name: 'Guide', timeZone: 'Europe/Berlin', capacity: 6 },
    { id: 'flat', name: 'Flat', timeZone: 'Europe/Berlin' },
    { id: 'room', name: 'Room', timeZone: 'Europe/Berlin', hours: ALL_DAY },
  ],
  offerings: [
    { id: 'consult', name: 'Consultation', mode: 'duration', durationMin: 60, resourceIds: ['anna'] },
    { id: 'either', name: 'With anyone', mode: 'duration', durationMin: 60, resourceIds: ['anna', 'ben'], chooseResource: true },
    { id: 'ask', name: 'On request', mode: 'duration', durationMin: 60, resourceIds: ['ben'], confirmation: 'request' },
    {
      id: 'tour',
      name: 'Tour',
      mode: 'slots',
      maxQuantity: 4,
      resourceIds: ['guide'],
      slots: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], at: '10:00', durationMin: 60 }],
    },
    { id: 'stay', name: 'Stay', mode: 'days', minUnits: 2, maxUnits: 7, maxAdvanceDays: 60, resourceIds: ['flat'] },
    { id: 'hire', name: 'Room hire', mode: 'range', minMin: 60, maxMin: 240, stepMin: 30, resourceIds: ['room'] },
  ],
};
/** What the widget sends besides the booking: the form runtime's evidence of a person. */
const HUMAN = { _hpt: '', _elapsed: '5000', _ix: '3.2.2' };
const ME = { name: 'Ada Lovelace', email: 'ada@example.test', phone: '+49 30 1234', note: 'First visit' };

let h: Harness;
let client: TestClient;
let pid: string;

async function setUp(config: object = CONFIG): Promise<void> {
  const put = await client.put(`/projects/${pid}/content/booking/booking`, config);
  expect(put.statusCode, put.body).toBe(200);
}
const window = () => ({ from: Date.now(), to: Date.now() + 7 * 86_400_000 });
const availability = (offering: string, extra = '') => {
  const w = window();
  return h.app.inject({ method: 'GET', url: `/b/${pid}/${offering}/availability?from=${w.from}&to=${w.to}${extra}` });
};
/** A bookable start a little ahead: the first one could pass between listing it and booking it. */
const firstStart = async (offering: string): Promise<number> => (await availability(offering)).json().times[3].start as number;
const book = (offering: string, body: Record<string, unknown>, query = '') =>
  h.app.inject({ method: 'POST', url: `/b/${pid}/${offering}${query}`, payload: { ...HUMAN, ...ME, ...body } });

beforeEach(async () => {
  h = await makeHarness();
  client = await h.signup({ email: 'owner@e2e.test', admin: true });
  pid = await client.createProject('Rooms', 'rooms');
  await setUp();
});
afterEach(() => h.close());

describe('availability', () => {
  it('lists what can be booked, with the offering as the widget needs it, to any origin, never cached', async () => {
    const res = await availability('consult');
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.offering).toEqual({
      id: 'consult',
      name: 'Consultation',
      mode: 'duration',
      confirmation: 'instant',
      maxQuantity: 1,
      minNoticeMin: 0,
      maxAdvanceDays: 90,
      timeZone: 'Europe/Berlin',
      durationMin: 60,
    });
    expect(body.kind).toBe('times');
    expect(body.times.length).toBeGreaterThan(100);
    // ★ Who serves it, and how many seats are left, are not a visitor's business here.
    expect(Object.keys(body.times[0]).sort()).toEqual(['end', 'start']);
  });

  it('★ names the resources only where the visitor picks one, and filters by the one picked', async () => {
    const body = (await availability('either')).json();
    expect(body.offering.resources).toEqual([{ id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }]);
    expect(body.times[0].resources).toEqual(['anna', 'ben']);
    const onlyBen = (await availability('either', '&resource=ben')).json();
    expect(onlyBen.times[0].resources).toEqual(['ben']);
    // An offering that does not let them pick ignores the parameter.
    expect(Object.keys((await availability('consult', '&resource=ben')).json().times[0]).sort()).toEqual(['end', 'start']);
  });

  it('★ seats are shown only for set times, and never more than one booking may take', async () => {
    const body = (await availability('tour')).json();
    // Six seats, at most four per booking: four is all a visitor is told.
    expect(body.times[0].places).toBe(4);
  });

  it('refuses a malformed window, and knows nothing of unknown offerings or projects', async () => {
    for (const q of ['from=x&to=1', 'from=5&to=1', 'from=&to=5', 'from=1e3&to=1e9', 'from=10000000000000000&to=20000000000000000']) {
      const res = await h.app.inject({ method: 'GET', url: `/b/${pid}/consult/availability?${q}` });
      expect(res.statusCode, q).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid-window' });
    }
    // ★ Far in the future but well-formed: nothing to book, and never a server error.
    const far = await h.app.inject({ method: 'GET', url: `/b/${pid}/consult/availability?from=9000000000000000&to=9999999999999999` });
    expect(far.statusCode).toBe(200);
    expect(far.json().times).toEqual([]);
    expect((await availability('nope')).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: `/b/nope/consult/availability?from=1&to=2` })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: `/b/__global__/consult/availability?from=1&to=2` })).statusCode).toBe(404);
  });

  it('a deleted project takes no bookings', async () => {
    expect((await client.del(`/projects/${pid}`)).statusCode).toBeLessThan(300);
    expect((await availability('consult')).statusCode).toBe(404);
  });
});

describe('booking', () => {
  it('★ books a free time, answers a signed reference, and the same time cannot be booked twice', async () => {
    const start = await firstStart('consult');
    const res = await book('consult', { start: String(start) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, state: 'booked', start, end: start + 3_600_000 });
    expect(typeof body.reference).toBe('string');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect((await book('consult', { start: String(start) })).json()).toMatchObject({ error: 'taken' });
    expect((await book('consult', { start: String(start) })).statusCode).toBe(409);
  });

  it('an offering on request makes a pending request, held for the owner', async () => {
    const start = await firstStart('ask');
    expect((await book('ask', { start: String(start) })).json()).toMatchObject({ ok: true, state: 'pending' });
  });

  it('a picked resource is honoured where picking is allowed, and ignored where it is not', async () => {
    const start = await firstStart('either');
    expect((await book('either', { start: String(start), resource: 'ben' })).statusCode).toBe(200);
    // Ben is taken now; Anna is still free at that time.
    expect((await book('either', { start: String(start), resource: 'ben' })).statusCode).toBe(409);
    expect((await book('either', { start: String(start), resource: 'anna' })).statusCode).toBe(200);
    // Where picking is not allowed the field is ignored: Ben does not even serve this offering.
    expect((await book('consult', { start: String(await firstStart('consult')), resource: 'ben' })).statusCode).toBe(200);
  });

  it('seats on a set time are shared up to the most one booking may take', async () => {
    const start = (await availability('tour')).json().times[1].start as number;
    expect((await book('tour', { start: String(start), quantity: '4' })).statusCode).toBe(200);
    expect((await book('tour', { start: String(start), quantity: '5' })).statusCode).toBe(400);
    // Two of six seats are left now.
    const after = (await availability('tour')).json().times.find((t: { start: number }) => t.start === start);
    expect(after.places).toBe(2);
    expect((await book('tour', { start: String(start), quantity: '3' })).json()).toMatchObject({ error: 'taken' });
  });

  it('refuses what is not a bookable time, too soon or too far, by name', async () => {
    const start = await firstStart('consult');
    expect((await book('consult', { start: String(start + 60_000) })).json()).toMatchObject({ error: 'not-offered' });
    expect((await book('consult', { start: String(start + 400 * 86_400_000) })).json()).toMatchObject({ error: 'too-far' });
    // Whole numbers written plainly: not even a real start time passes as `…e3`.
    for (const bad of ['soon', '0x10', '1e12', String(start) + '.5', `${start / 1000}e3`]) expect((await book('consult', { start: bad })).statusCode, bad).toBe(400);
    // Far from now: refused as a booking, never a server error.
    expect((await book('consult', { start: '9000000000000000' })).json()).toMatchObject({ error: 'too-far' });
    expect((await book('either', { start: String(await firstStart('either')), resource: 'guide' })).statusCode).toBe(422);
  });

  it('asks for a name and a valid email, and names what is missing', async () => {
    const start = await firstStart('consult');
    const res = await book('consult', { start: String(start), email: 'not-an-email', name: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid-fields', fields: expect.arrayContaining(['name', 'email']) });
  });

  it('★ a bot trap answers a generic refusal and books nothing', async () => {
    const start = await firstStart('consult');
    for (const trap of [{ _hpt: 'http://spam' }, { _elapsed: '50' }, { _elapsed: undefined }, { _ix: '0.0.0' }, { _ix: undefined }]) {
      const res = await book('consult', { start: String(start), ...trap });
      expect(res.statusCode, JSON.stringify(trap)).toBe(400);
      expect(res.json()).toEqual({ error: 'booking-unavailable' });
    }
    expect((await book('consult', { start: String(start) })).statusCode).toBe(200);
  });

  it('★ a preview checks without taking the time', async () => {
    const start = await firstStart('consult');
    expect((await book('consult', { start: String(start) }, '?preview=1')).json()).toEqual({ ok: true, preview: true });
    expect((await book('consult', { start: String(start) })).statusCode).toBe(200);
    expect((await book('consult', { start: String(start) }, '?preview=1')).json()).toMatchObject({ error: 'taken' });
  });

  it('with proof of work switched on, a request without a solution is refused; the challenge is never cached', async () => {
    await setUp({ ...CONFIG, pow: true });
    const start = await firstStart('consult');
    // Named: a visitor whose solution went stale fetches a new challenge and tries again.
    expect((await book('consult', { start: String(start) })).json()).toEqual({ error: 'challenge-failed' });
    const challenge = await h.app.inject({ method: 'GET', url: `/b/${pid}/consult/challenge` });
    expect(challenge.statusCode).toBe(200);
    expect(challenge.headers['cache-control']).toBe('no-store');
    expect(challenge.json()).toHaveProperty('challenge');
  });

  it('with the captcha switched on but none configured, it fails closed', async () => {
    await setUp({ ...CONFIG, captcha: true });
    const start = await firstStart('consult');
    const res = await book('consult', { start: String(start) });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'captcha-unavailable' });
  });

  it('★ nights: a stay of whole nights, checked from the start date', async () => {
    const days = (await availability('stay')).json();
    expect(days.kind).toBe('days');
    expect(days.offering).toMatchObject({ unit: 'night', minUnits: 2, maxUnits: 7, checkIn: '15:00', checkOut: '11:00' });
    const date = days.days[2].date as string;
    expect((await book('stay', { date, units: '1' })).json()).toMatchObject({ error: 'invalid' });
    expect((await book('stay', { date, units: '2' })).json()).toMatchObject({ ok: true, state: 'booked' });
    expect((await book('stay', { date, units: '2' })).json()).toMatchObject({ error: 'taken' });
    expect((await book('stay', { date: '275760-09-13', units: '2' })).statusCode).toBe(400);
  });

  it('★ a room by the hour: start and end on the grid', async () => {
    const windows = (await availability('hire')).json();
    expect(windows.kind).toBe('windows');
    const start = Math.ceil((Date.now() + 3 * 3_600_000) / 1_800_000) * 1_800_000;
    expect((await book('hire', { start: String(start), end: String(start + 2 * 3_600_000) })).json()).toMatchObject({ ok: true });
    expect((await book('hire', { start: String(start + 3_600_000), end: String(start + 3 * 3_600_000) })).json()).toMatchObject({ error: 'taken' });
    expect((await book('hire', { start: String(start + 4 * 3_600_000) })).json()).toMatchObject({ error: 'invalid' });
  });

  it('answers the browser’s preflight, for booking and for cancelling', async () => {
    for (const url of [`/b/${pid}/consult`, `/b/${pid}/_booking/x-y/cancel`]) {
      const res = await h.app.inject({ method: 'OPTIONS', url });
      expect(res.statusCode, url).toBe(204);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    }
  });
});

describe('the reference: status and cancelling', () => {
  async function booked(): Promise<{ reference: string; start: number }> {
    const start = await firstStart('consult');
    const res = await book('consult', { start: String(start) });
    return { reference: res.json().reference as string, start };
  }
  const status = (ref: string) => h.app.inject({ method: 'GET', url: `/b/${pid}/_booking/${encodeURIComponent(ref)}` });
  const cancel = (ref: string) => h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${encodeURIComponent(ref)}/cancel` });

  it('★ shows the booking to whoever holds the reference, without the customer’s details', async () => {
    const { reference, start } = await booked();
    const res = await status(reference);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ state: 'booked', start, end: start + 3_600_000, quantity: 1, offering: { id: 'consult', name: 'Consultation' }, cancellable: true });
    expect(res.body).not.toContain('ada@example.test');
  });

  it('★ a forged or altered reference, or one from another project, finds nothing', async () => {
    const { reference } = await booked();
    const [id] = reference.split('-');
    expect((await status(`${id}-${'A'.repeat(27)}`)).statusCode).toBe(404);
    expect((await status(reference.slice(0, -1) + (reference.endsWith('A') ? 'B' : 'A'))).statusCode).toBe(404);
    expect((await status('nonsense')).statusCode).toBe(404);
    const other = await client.createProject('Other', 'other');
    expect((await h.app.inject({ method: 'GET', url: `/b/${other}/_booking/${encodeURIComponent(reference)}` })).statusCode).toBe(404);
  });

  it('a request waiting for the owner can be withdrawn the same way', async () => {
    const start = await firstStart('ask');
    const reference = (await book('ask', { start: String(start) })).json().reference as string;
    expect((await status(reference)).json()).toMatchObject({ state: 'pending', cancellable: true });
    expect((await cancel(reference)).json()).toEqual({ ok: true });
    expect((await status(reference)).statusCode).toBe(404);
  });

  it('cancels, after which the booking is gone and its time free again', async () => {
    const { reference, start } = await booked();
    expect((await cancel(reference)).json()).toEqual({ ok: true });
    expect((await status(reference)).statusCode).toBe(404);
    expect((await cancel(reference)).statusCode).toBe(404);
    expect((await book('consult', { start: String(start) })).statusCode).toBe(200);
  });
});

describe('signed references', () => {
  it('bind the booking to its project under the secret', () => {
    const ref = signBookingRef('p1', 'abc123', 'secret');
    expect(verifyBookingRef('p1', ref, 'secret')).toBe('abc123');
    expect(verifyBookingRef('p2', ref, 'secret')).toBeNull();
    expect(verifyBookingRef('p1', ref, 'other-secret')).toBeNull();
    expect(verifyBookingRef('p1', `abc124${ref.slice(6)}`, 'secret')).toBeNull();
    for (const bad of [undefined, 5, '', '-x', 'a b-c', 'x'.repeat(200)]) expect(verifyBookingRef('p1', bad, 'secret')).toBeNull();
  });
});

describe('on a site host', () => {
  it('★ the booking routes reach the platform rather than the site’s pages', async () => {
    const site = await makeHarness({ sitesDomain: 'agency.site', publicUrl: 'https://cms.agency.com' });
    try {
      const owner = await site.signup({ admin: true });
      const id = await owner.createProject('Example', 'example', { localHosting: false });
      expect((await owner.put(`/projects/${id}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
      const w = window();
      const host = { host: 'example.agency.site' };
      const res = await site.app.inject({ method: 'GET', url: `/b/${id}/consult/availability?from=${w.from}&to=${w.to}`, headers: host });
      expect(res.statusCode, res.body).toBe(200);
      const start = res.json().times[3].start as number;
      const booked = await site.app.inject({ method: 'POST', url: `/b/${id}/consult`, headers: host, payload: { ...HUMAN, ...ME, start: String(start) } });
      expect(booked.statusCode, booked.body).toBe(200);
      const reference = booked.json().reference as string;
      expect((await site.app.inject({ method: 'GET', url: `/b/${id}/_booking/${reference}`, headers: host })).statusCode).toBe(200);
      expect((await site.app.inject({ method: 'POST', url: `/b/${id}/_booking/${reference}/cancel`, headers: host })).statusCode).toBe(200);
      // ★ …while the site's own pages under /b/ stay the site's: a GET of any other shape is never taken.
      // (No site is published here, so the site's answer is a 404 naming the site path it was rewritten to.)
      for (const page of ['/b/2024/my-post', `/b/${id}/consult`, '/b/team/jane/']) {
        const own = await site.app.inject({ method: 'GET', url: page, headers: host });
        expect(own.headers['access-control-allow-origin'], page).toBeUndefined();
        expect(own.body, page).toContain('/sites/example/b/');
      }
    } finally {
      await site.close();
    }
  });
});

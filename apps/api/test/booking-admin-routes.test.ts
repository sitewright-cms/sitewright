import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { addProjectMember } from '../src/repo/accounts.js';
import { bookingClaims } from '../src/db/schema.js';
import type { SubmissionMail } from '../src/mail/mailer.js';

/**
 * ★ The Bookings tab's routes, end to end: what the business sees of its bookings and requests, and its answers,
 * each of which mails the customer (and takes the booking in or out of the calendars that hold it).
 */

const ALL_DAY = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '24:00' }];
const CONFIG = {
  resources: [
    { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: ALL_DAY, email: 'anna@studio.example' },
    { id: 'ben', name: 'Ben', timeZone: 'Europe/Berlin', hours: ALL_DAY },
  ],
  offerings: [
    { id: 'massage', name: 'Massage', mode: 'duration', durationMin: 60, resourceIds: ['ben'] },
    { id: 'ask', name: 'Consultation', mode: 'duration', durationMin: 60, resourceIds: ['anna'], confirmation: 'request' },
  ],
  statusPath: '/my-booking/',
  notifyEmail: 'hello@studio.example',
};
const HUMAN = { _hpt: '', _elapsed: '5000', _ix: '3.2.2' };
const ME = { name: 'Ada Lovelace', email: 'ada@example.test', phone: '+49 30 1234', note: 'First visit' };

let h: Harness;
let client: TestClient;
let pid: string;
let sent: SubmissionMail[];

beforeEach(async () => {
  sent = [];
  h = await makeHarness({ mailer: { send: async (m: SubmissionMail) => (sent.push(m), true) } });
  client = await h.signup({ email: 'owner@studio.example', admin: true });
  expect((await client.put('/admin/settings', { formModes: { globalSmtp: true } })).statusCode).toBe(200);
  pid = await client.createProject('Studio', 'studio');
  expect(
    (await client.put(`/projects/${pid}/content/settings/settings`, { identity: { name: 'Studio Nord' }, website: { siteUrl: 'https://studio.example' }, settings: {} })).statusCode,
  ).toBe(200);
  expect((await client.put(`/projects/${pid}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
});
afterEach(() => h.close());

const book = async (offering: string, nth = 3) => {
  const from = Date.now();
  const list = await h.app.inject({ method: 'GET', url: `/b/${pid}/${offering}/availability?from=${from}&to=${from + 7 * 86_400_000}` });
  const start = list.json().times[nth].start as number;
  const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/${offering}`, payload: { ...HUMAN, ...ME, start: String(start) } });
  expect(res.statusCode, res.body).toBe(200);
  return { reference: res.json().reference as string, start };
};
const settle = async (n: number) => {
  for (let i = 0; i < 200 && sent.length < n; i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(sent.length).toBe(n);
};
const listed = async (view = 'upcoming') => {
  const res = await client.get(`/projects/${pid}/bookings?view=${view}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const answer = (id: string, what: string) => client.post(`/projects/${pid}/bookings/${id}/${what}`, {});
const to = (addr: string) => sent.filter((m) => m.recipient === addr);

describe('listing', () => {
  it('shows bookings and requests soonest first, with the customer’s details, and counts the requests', async () => {
    await book('massage', 5);
    await book('ask', 2);
    const body = await listed();
    expect(body.total).toBe(2);
    expect(body.requests).toBe(1);
    expect(body.undelivered).toEqual({ failed: 0, retrying: 0 });
    const [first, second] = body.bookings;
    expect(first.start).toBeLessThan(second.start);
    expect(first).toMatchObject({
      state: 'pending',
      offering: { id: 'ask', name: 'Consultation', mode: 'duration' },
      resource: { id: 'anna', name: 'Anna' },
      timeZone: 'Europe/Berlin',
      quantity: 1,
      customer: ME,
    });
    expect(first.expiresAt).toBeGreaterThan(Date.now());
    expect(second).toMatchObject({ state: 'booked', expiresAt: null, resource: { name: 'Ben' } });
    // The requests alone.
    expect((await listed('requests')).bookings.map((b: { offering: { id: string } }) => b.offering.id)).toEqual(['ask']);
    // Nothing has ended yet.
    expect((await listed('past')).bookings).toEqual([]);
    expect((await client.get(`/projects/${pid}/bookings?view=all`)).statusCode).toBe(400);
  });

  it('lists the bookings that have ended, latest first, while they are kept', async () => {
    await book('massage');
    // As if it had happened yesterday.
    const yesterday = Date.now() - 86_400_000;
    await h.db.update(bookingClaims).set({ startAt: new Date(yesterday), endAt: new Date(yesterday + 3_600_000) });
    expect((await listed()).bookings).toEqual([]);
    expect((await listed('past')).bookings).toHaveLength(1);
  });

  it('★ shows the customers’ details to the project and to nobody else', async () => {
    await book('massage');
    const member = await h.signup({ email: 'member@studio.example' });
    await addProjectMember(h.db, member.userId, pid, 'member');
    expect((await member.get(`/projects/${pid}/bookings`)).statusCode).toBe(200);
    const stranger = await h.signup({ email: 'stranger@example.test' });
    const res = await stranger.get(`/projects/${pid}/bookings`);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('ada@example.test');
    expect((await stranger.post(`/projects/${pid}/bookings/x/cancel`, {})).statusCode).toBe(403);
  });
});

describe('answering a request', () => {
  it('accepts it: a booking, a confirmation to the customer, and the invitation to the resource’s calendar', async () => {
    const { reference } = await book('ask');
    await settle(3); // the customer's acknowledgement, the business's and Anna's notices
    sent = [];
    const [request] = (await listed('requests')).bookings;
    const res = await answer(request.id, 'accept');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().booking).toMatchObject({ state: 'booked', expiresAt: null });
    expect((await listed('requests')).requests).toBe(0);
    await settle(3);
    const [customer] = to('ada@example.test');
    expect(customer!.subject).toBe('Booking confirmed: Consultation');
    // The same reference the visitor already has, so the link in both mails is the same page.
    expect(customer!.rendered!.text).toContain(`https://studio.example/my-booking/#t=${encodeURIComponent(reference)}`);
    expect(customer!.rendered!.attachments![0]!.content).toContain('METHOD:PUBLISH');
    expect(to('anna@studio.example')[0]!.rendered!.icalEvent?.method).toBe('REQUEST');
    expect(to('hello@studio.example')[0]!.rendered!.text).toContain('You accepted Ada Lovelace’s request');
  });

  it('declines it: the time is free again, and only the customer is told', async () => {
    await book('ask');
    await settle(3);
    sent = [];
    const [request] = (await listed('requests')).bookings;
    expect((await answer(request.id, 'decline')).statusCode).toBe(200);
    expect((await listed()).bookings).toEqual([]);
    await settle(1);
    expect(sent[0]!.recipient).toBe('ada@example.test');
    expect(sent[0]!.subject).toBe('Booking request declined: Consultation');
    expect(sent[0]!.rendered!.text).toContain('we cannot take your request');
    expect(sent[0]!.rendered!.attachments).toBeUndefined();
  });

  it('refuses to accept or decline what is not a request, or is gone', async () => {
    await book('massage');
    const [booking] = (await listed()).bookings;
    expect((await answer(booking.id, 'accept')).statusCode).toBe(409);
    expect((await answer(booking.id, 'decline')).statusCode).toBe(409);
    expect((await answer('no-such-booking', 'accept')).statusCode).toBe(404);
    // A request whose time ran out cannot be accepted: someone else may have the time by now.
    await book('ask');
    const [request] = (await listed('requests')).bookings;
    await h.db.update(bookingClaims).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(bookingClaims.id, request.id));
    expect((await answer(request.id, 'accept')).statusCode).toBe(404);
  });
});

describe('what cannot be answered', () => {
  it('does not cancel a checkout in progress (a hold), nor tell its customer anything', async () => {
    await book('massage');
    await settle(2);
    sent = [];
    await h.db.update(bookingClaims).set({ state: 'hold', expiresAt: new Date(Date.now() + 600_000) });
    const [row] = await h.db.select().from(bookingClaims);
    const res = await answer(row!.id, 'cancel');
    expect(res.statusCode).toBe(409);
    expect(await h.db.select().from(bookingClaims)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toEqual([]);
  });

  it('does not accept a request whose time has already begun', async () => {
    await book('ask');
    const [request] = (await listed('requests')).bookings;
    await h.db.update(bookingClaims).set({ startAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 600_000) }).where(eq(bookingClaims.id, request.id));
    const res = await answer(request.id, 'accept');
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('ended');
  });
});

describe('cancelling', () => {
  it('cancels a booking, tells the customer, and takes it out of the calendars', async () => {
    await book('massage');
    await settle(2); // Ben has no address: the customer's and the business's
    sent = [];
    const [booking] = (await listed()).bookings;
    expect((await answer(booking.id, 'cancel')).statusCode).toBe(200);
    expect((await listed()).bookings).toEqual([]);
    await settle(2);
    const [customer] = to('ada@example.test');
    expect(customer!.subject).toBe('Booking cancelled: Massage');
    expect(customer!.rendered!.attachments![0]!.content).toMatch(/STATUS:CANCELLED/);
    expect(to('hello@studio.example')[0]!.rendered!.text).toContain('The booking of Massage for Ada Lovelace is cancelled');
  });

  it('cannot cancel what has ended', async () => {
    await book('massage');
    await h.db.update(bookingClaims).set({ startAt: new Date(Date.now() - 7_200_000), endAt: new Date(Date.now() - 3_600_000) });
    const [booking] = (await listed('past')).bookings;
    const res = await answer(booking.id, 'cancel');
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('ended');
  });
});

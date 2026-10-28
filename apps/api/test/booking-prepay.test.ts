import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { PaymentGatewayStoredSchema, BookingConfigSchema } from '@sitewright/schema';
import { bookingClaims, bookingMails, content, instanceSettings, INSTANCE_SETTINGS_ID, shopTransactions } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';
import { encryptSecret } from '../src/crypto/secret.js';
import { BOOKING_PAY_LIMITS, priceOf } from '../src/booking/payments.js';

/**
 * ★ BOOKING PREPAYMENT, end to end: a priced offering's time is HELD while the customer pays on the provider's page,
 * the provider's webhook (the only thing that resolves a payment) confirms it, a failed payment gives the time
 * back, and a payment that arrives after its time was lost is refunded rather than booked over someone else.
 */

const KEY = Buffer.alloc(32, 7);
const WHSEC = 'whsec_test_abc';
const GATEWAY = PaymentGatewayStoredSchema.parse({
  id: 'mock',
  name: 'Mock',
  apiBase: { test: 'https://mock-pay.invalid', live: 'https://mock-pay.invalid' },
  auth: { kind: 'bearer', secretField: 'apiKey' },
  credentialFields: [
    { key: 'apiKey', label: 'API key', kind: 'secret' },
    { key: 'webhookSecret', label: 'Webhook secret', kind: 'secret' },
  ],
  checkout: {
    request: { method: 'POST', path: '/sessions', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}', currency: '${AMOUNT:currency}', ret: '${URL:return}' } },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  status: { request: { method: 'GET', path: '/sessions/${TXN:reference}', format: 'json', headers: {} }, statePath: 'state', states: { paid: 'paid', open: 'recheck' } },
  refund: { request: { method: 'POST', path: '/payments/${TXN:reference}/refunds', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}', currency: '${AMOUNT:currency}' } } },
  verification: { scheme: 'hmac-sha256-header', header: 'x-mock-signature', encoding: 'hex', secretField: 'webhookSecret' },
  events: { eventIdPath: 'event_id', refPath: 'session_id', typePath: 'type', types: { 'session.paid': 'paid', 'session.failed': 'failed' }, amountMinorPath: 'amount', currencyPath: 'currency' },
  allowedOrigins: ['https://mock-pay.invalid'],
  enabled: true,
  verified: true,
});
const ALL_DAY = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '24:00' }];
const CONFIG = {
  resources: [
    { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: ALL_DAY },
    { id: 'guide', name: 'Guide', timeZone: 'Europe/Berlin', capacity: 10 },
    { id: 'flat', name: 'Flat', timeZone: 'Europe/Berlin' },
  ],
  offerings: [
    // Refunded if the customer cancels at least an hour before it starts.
    { id: 'cut', name: 'Haircut', mode: 'duration', durationMin: 60, resourceIds: ['anna'], price: { amountMinor: 4500 }, refundUntilMin: 60 },
    { id: 'tour', name: 'Tour', mode: 'slots', maxQuantity: 4, resourceIds: ['guide'], slots: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], at: '10:00', durationMin: 60 }], price: { amountMinor: 1500, per: 'unit' } },
    { id: 'stay', name: 'Stay', mode: 'days', resourceIds: ['flat'], price: { amountMinor: 9000, per: 'night' } },
    { id: 'free', name: 'Free chat', mode: 'duration', durationMin: 30, resourceIds: ['anna'] },
  ],
  payment: { gatewayId: 'mock', currency: 'EUR' },
  statusPath: '/my-booking/',
  notifyEmail: 'hello@studio.example',
};
const HUMAN = { _hpt: '', _elapsed: '5000', _ix: '3.2.2', name: 'Ada', email: 'ada@example.test' };

let h: Harness;
let owner: TestClient;
let pid: string;
let calls: Array<{ url: string; body?: string }>;
let session = 0;

const fakeProvider = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
  calls.push({ url, ...(init.body !== undefined ? { body: init.body } : {}) });
  if (url.endsWith('/sessions')) {
    session += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: `sess_${session}`, url: `https://mock-pay.invalid/s/${session}` }) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ id: 're_1' }) };
};
const sign = (raw: string) => createHmac('sha256', WHSEC).update(Buffer.from(raw, 'utf8')).digest('hex');
const webhook = (body: Record<string, unknown>) => {
  const raw = JSON.stringify(body);
  return h.app.inject({ method: 'POST', url: `/pay/${pid}/webhook/mock`, headers: { 'content-type': 'application/json', 'x-mock-signature': sign(raw) }, payload: raw });
};

beforeEach(async () => {
  calls = [];
  session = 0;
  h = await makeHarness({ encryptionKey: KEY, publicUrl: 'https://sw.test', paymentFetch: fakeProvider });
  owner = await h.signup({ email: 'owner@studio.example', admin: true });
  pid = await owner.createProject('Studio', 'studio');
  const formModes = { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false };
  await h.db
    .insert(instanceSettings)
    .values({ id: INSTANCE_SETTINGS_ID, data: { formModes, paymentsEnabled: true }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { data: { formModes, paymentsEnabled: true }, updatedAt: new Date() } });
  await ensureGlobalProject(h.db);
  await h.db.insert(content).values({ id: 'gw_mock', projectId: GLOBAL_SCOPE_ID, kind: 'payment_gateway', entityId: 'mock', scope: '', data: GATEWAY, createdAt: new Date(), updatedAt: new Date() });
  await h.db.insert(content).values({
    id: 'bind_1',
    projectId: pid,
    kind: 'project_payment',
    entityId: 'settings',
    scope: '',
    data: { gatewayId: 'mock', mode: 'test', values: { test: { apiKey: encryptSecret('sk_test_x', KEY), webhookSecret: encryptSecret(WHSEC, KEY) } } },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  expect((await owner.put(`/projects/${pid}/content/settings/settings`, { identity: { name: 'Studio' }, website: { siteUrl: 'https://studio.example' }, settings: {} })).statusCode).toBe(200);
  const put = await owner.put(`/projects/${pid}/content/booking/booking`, CONFIG);
  expect(put.statusCode, put.body).toBe(200);
});
afterEach(() => h.close());

const times = async (offering: string, days = 3) => {
  const from = Date.now();
  return (await h.app.inject({ method: 'GET', url: `/b/${pid}/${offering}/availability?from=${from}&to=${from + days * 86_400_000}` })).json().times as Array<{ start: number; end?: number }>;
};
const book = async (offering: string, extra: Record<string, string> = {}, nth = 2) => {
  const t = (await times(offering))[nth]!;
  return h.app.inject({ method: 'POST', url: `/b/${pid}/${offering}`, payload: { ...HUMAN, start: String(t.start), ...extra } });
};
const txns = () => h.db.select().from(shopTransactions);
const claim = async () => (await h.db.select().from(bookingClaims))[0];

describe('★ paying for a booking', () => {
  it('holds the time and opens the provider’s checkout for the offering’s price, coming back to the business’s own page', async () => {
    const res = await book('cut');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, state: 'hold', pay: 'https://mock-pay.invalid/s/1' });
    const sent = JSON.parse(calls[0]!.body!) as { amount: number; currency: string; ret: string };
    expect(sent).toEqual({ amount: 4500, currency: 'EUR', ret: `https://studio.example/my-booking/#t=${encodeURIComponent(body.reference)}` });
    expect((await claim())).toMatchObject({ state: 'hold' });
    const [txn] = await txns();
    expect(txn).toMatchObject({ channelKey: 'booking', totalMinor: 4500, currency: 'EUR', status: 'created', bookingClaimId: (await claim())!.id });
    // No confirmation before the money: nothing queued.
    expect(await h.db.select().from(bookingMails)).toEqual([]);
  });

  it('★ confirms the booking when the provider says it is paid, with the booking’s own mails and nothing of the shop’s', async () => {
    await book('cut');
    const res = await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    expect(res.statusCode).toBe(200);
    expect(await claim()).toMatchObject({ state: 'booked', expiresAt: null });
    const [txn] = await txns();
    expect(txn).toMatchObject({ status: 'paid', notifyState: 'na', receiptState: 'na' });
    const mails = await h.db.select().from(bookingMails);
    expect(mails.length).toBeGreaterThanOrEqual(1);
    // A repeated report of the same payment changes nothing.
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    expect((await h.db.select().from(bookingMails)).length).toBe(mails.length);
  });

  it('gives the time back when the payment fails', async () => {
    await book('cut');
    const before = (await times('cut')).length;
    await webhook({ event_id: 'ev_2', session_id: 'sess_1', type: 'session.failed' });
    expect(await claim()).toBeUndefined();
    expect((await times('cut')).length).toBe(before + 1);
  });

  it('★ refunds a payment that came after its hold ran out, and tells both sides it is not booked', async () => {
    const first = (await times('cut'))[2]!.start;
    await h.app.inject({ method: 'POST', url: `/b/${pid}/cut`, payload: { ...HUMAN, start: String(first) } });
    // The hold runs out: the time may be someone else's by now.
    await h.db.update(bookingClaims).set({ expiresAt: new Date(Date.now() - 1) });
    const late = await webhook({ event_id: 'ev_3', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    expect(late.statusCode).toBe(200);
    expect(calls.some((c) => c.url.endsWith('/payments/sess_1/refunds'))).toBe(true);
    const [txn] = await txns();
    expect(txn).toMatchObject({ status: 'refunded', refundedMinor: 4500 });
    expect(txn!.bookingSettledAt).not.toBeNull();
    expect((await claim())?.state).not.toBe('booked');
    const subjects = (await h.db.select().from(bookingMails)).map((m) => m.subject);
    expect(subjects).toContain('Not booked: Haircut');
    expect(subjects.some((x) => x.startsWith('Payment refunded: Haircut'))).toBe(true);
  });

  it('★ refunds a payment that arrives after its checkout was closed as failed: the money was taken all the same', async () => {
    await book('cut');
    await webhook({ event_id: 'ev_f', session_id: 'sess_1', type: 'session.failed' });
    expect(await claim()).toBeUndefined();
    const late = await webhook({ event_id: 'ev_p', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    expect(late.statusCode).toBe(200);
    expect(calls.some((c) => c.url.endsWith('/payments/sess_1/refunds'))).toBe(true);
    const [txn] = await txns();
    expect(txn).toMatchObject({ status: 'refunded', refundedMinor: 4500, notifyState: 'na' });
    // The mails still know the booking, though its claim is long gone.
    const mails = await h.db.select().from(bookingMails);
    const customer = mails.find((m) => m.recipient === 'ada@example.test')!;
    expect(customer.subject).toBe('Not booked: Haircut');
    expect(customer.body.text).toContain('Your payment will be refunded.');
    expect(await claim()).toBeUndefined();
  });

  it('★ refunds a paid booking the business cancels, in full, and the customer reads so', async () => {
    await book('cut');
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    const c = (await claim())!;
    await h.db.delete(bookingMails);
    const res = await owner.post(`/projects/${pid}/bookings/${c.id}/cancel`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, refund: 'refunded' });
    expect(calls.filter((x) => x.url.endsWith('/refunds'))).toHaveLength(1);
    expect((await txns())[0]).toMatchObject({ status: 'refunded', refundedMinor: 4500 });
    const customer = (await h.db.select().from(bookingMails)).find((m) => m.recipient === 'ada@example.test')!;
    expect(customer.body.text).toContain('Your payment will be refunded.');
    // A free booking cancelled says nothing of money.
    await h.db.delete(bookingMails);
    await book('free');
    const free = (await h.db.select().from(bookingClaims)).find((x) => x.offeringId === 'free')!;
    const r2 = await owner.post(`/projects/${pid}/bookings/${free.id}/cancel`, {});
    expect(r2.json().refund).toBeUndefined();
  });

  it('★ refunds before it cancels: a cancellation refused afterwards says the money already went back', async () => {
    await book('cut');
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    const c = (await claim())!;
    // The booking ended meanwhile: nothing to cancel, and so nothing refunded either.
    await h.db.update(bookingClaims).set({ endAt: new Date(Date.now() - 60_000), startAt: new Date(Date.now() - 3_600_000) });
    const ended = await owner.post(`/projects/${pid}/bookings/${c.id}/cancel`, {});
    expect(ended.statusCode).toBe(409);
    expect(calls.filter((x) => x.url.endsWith('/refunds'))).toHaveLength(0);
    expect((await txns())[0]).toMatchObject({ status: 'paid', refundedMinor: 0 });
  });

  it('★ refunds a customer’s cancellation in full until the offering’s deadline, and says so before and after', async () => {
    const reference = (await book('cut')).json().reference as string;
    const status = async () => (await h.app.inject({ method: 'GET', url: `/b/${pid}/_booking/${reference}` })).json();
    // While it is being paid for, the customer may still walk away: nothing was paid, so nothing is said of money.
    expect(await status()).toMatchObject({ cancellable: true });
    expect((await status()).refund).toBeUndefined();
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    expect(await status()).toMatchObject({ state: 'booked', cancellable: true, refund: 'full' });
    await h.db.delete(bookingMails);
    const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${reference}/cancel` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, refund: 'refunded' });
    expect(calls.filter((x) => x.url.endsWith('/refunds'))).toHaveLength(1);
    expect((await txns())[0]).toMatchObject({ status: 'refunded', refundedMinor: 4500 });
    expect(await claim()).toBeUndefined();
    const mails = await h.db.select().from(bookingMails);
    expect(mails.find((m) => m.recipient === 'ada@example.test')!.body.text).toContain('Your payment will be refunded.');
    expect(mails.find((m) => m.recipient === 'hello@studio.example')!.body.text).toContain('The payment has been refunded.');
  });

  it('★ keeps the payment of a booking the customer cancels after its deadline, and tells both sides', async () => {
    const reference = (await book('cut')).json().reference as string;
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    // It starts in half an hour: inside the hour before it, where cancelling refunds nothing.
    const soon = Date.now() + 30 * 60_000;
    await h.db.update(bookingClaims).set({ startAt: new Date(soon), endAt: new Date(soon + 3_600_000), busyEnd: new Date(soon + 3_600_000) });
    const status = (await h.app.inject({ method: 'GET', url: `/b/${pid}/_booking/${reference}` })).json();
    expect(status).toMatchObject({ cancellable: true, refund: 'none' });
    await h.db.delete(bookingMails);
    const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${reference}/cancel` });
    expect(res.json()).toMatchObject({ ok: true, refund: 'none' });
    expect(calls.filter((x) => x.url.endsWith('/refunds'))).toHaveLength(0);
    expect((await txns())[0]).toMatchObject({ status: 'paid', refundedMinor: 0 });
    const mails = await h.db.select().from(bookingMails);
    expect(mails.find((m) => m.recipient === 'ada@example.test')!.body.text).toContain('so your payment is not refunded');
    expect(mails.find((m) => m.recipient === 'hello@studio.example')!.body.text).toContain('the payment is kept');
  });

  it('★ one cancellation at a time: a double click refunds once and mails once', async () => {
    const reference = (await book('cut')).json().reference as string;
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    await h.db.delete(bookingMails);
    const cancel = () => h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${reference}/cancel` });
    const [a, b] = await Promise.all([cancel(), cancel()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 404]);
    expect((a.statusCode === 200 ? a : b).json()).toMatchObject({ refund: 'refunded' });
    expect(calls.filter((x) => x.url.endsWith('/refunds'))).toHaveLength(1);
    const toCustomer = (await h.db.select().from(bookingMails)).filter((m) => m.recipient === 'ada@example.test');
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]!.body.text).toContain('Your payment will be refunded.');
  });

  it('refuses to cancel a paid booking online in its last minute, and says so on its page', async () => {
    const reference = (await book('cut')).json().reference as string;
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    const soon = Date.now() + 30_000;
    await h.db.update(bookingClaims).set({ startAt: new Date(soon), endAt: new Date(soon + 3_600_000), busyEnd: new Date(soon + 3_600_000) });
    expect((await h.app.inject({ method: 'GET', url: `/b/${pid}/_booking/${reference}` })).json().cancellable).toBe(false);
    const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${reference}/cancel` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('started');
    expect(calls.filter((x) => x.url.endsWith('/refunds'))).toHaveLength(0);
    expect((await claim())?.state).toBe('booked');
  });

  it('a cancellation retried after its refund went out still tells both sides it was refunded', async () => {
    const reference = (await book('cut')).json().reference as string;
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    // The first attempt refunded it, then was refused (a busy moment): the payment reads refunded, the booking stands.
    await h.db.update(shopTransactions).set({ status: 'refunded', refundedMinor: 4500 });
    // Its page says so, even past the deadline (it starts within the hour now).
    const soon = Date.now() + 30 * 60_000;
    await h.db.update(bookingClaims).set({ startAt: new Date(soon), endAt: new Date(soon + 3_600_000), busyEnd: new Date(soon + 3_600_000) });
    expect((await h.app.inject({ method: 'GET', url: `/b/${pid}/_booking/${reference}` })).json().refund).toBe('full');
    await h.db.delete(bookingMails);
    const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${reference}/cancel` });
    expect(res.json()).toMatchObject({ ok: true, refund: 'refunded' });
    expect(calls.filter((x) => x.url.endsWith('/refunds'))).toHaveLength(0);
    const customer = (await h.db.select().from(bookingMails)).find((m) => m.recipient === 'ada@example.test')!;
    expect(customer.body.text).toContain('Your payment will be refunded.');
  });

  it('a free booking’s cancellation says nothing of money', async () => {
    const reference = (await book('free')).json().reference as string;
    const status = (await h.app.inject({ method: 'GET', url: `/b/${pid}/_booking/${reference}` })).json();
    expect(status.refund).toBeUndefined();
    const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${reference}/cancel` });
    expect(res.json()).toEqual({ ok: true });
  });

  it('confirms in the customer’s language, with the link to the booking’s own page', async () => {
    await book('cut', { lang: 'de' });
    expect((await txns())[0]!.bookingSnapshot).toContain('"locale":"de"');
    await webhook({ event_id: 'ev_1', session_id: 'sess_1', type: 'session.paid', amount: 4500, currency: 'EUR' });
    const customer = (await h.db.select().from(bookingMails)).find((m) => m.recipient === 'ada@example.test')!;
    expect(customer.body.text).toContain('https://studio.example/my-booking/#t=');
  });

  it('prices by the unit, and by the night', async () => {
    await book('tour', { quantity: '3' }, 0);
    expect(JSON.parse(calls[0]!.body!).amount).toBe(4500);
    const config = BookingConfigSchema.parse(CONFIG);
    const stay = config.offerings.find((o) => o.id === 'stay')!;
    const day = 86_400_000;
    // Three nights, across the clock change (a night of 25 hours is still one night).
    expect(priceOf(stay, 1, Date.UTC(2026, 9, 23, 14), Date.UTC(2026, 9, 26, 10) + 3_600_000)).toBe(27_000);
    expect(priceOf(config.offerings.find((o) => o.id === 'cut')!, 5, 0, day)).toBe(4500);
  });

  it('tells the widget what a paid offering costs, in its currency’s decimals, and a free one nothing', async () => {
    const listing = async (offering: string) =>
      (await h.app.inject({ method: 'GET', url: `/b/${pid}/${offering}/availability?from=${Date.now()}&to=${Date.now() + 86_400_000}` })).json().offering;
    expect((await listing('tour')).price).toEqual({ amountMinor: 1500, per: 'unit', currency: 'EUR', digits: 2 });
    expect((await listing('free')).price).toBeUndefined();
  });

  it('books a free offering as before, without a payment', async () => {
    const res = await book('free');
    expect(res.json()).toMatchObject({ state: 'booked' });
    expect(res.json().pay).toBeUndefined();
    expect(await txns()).toEqual([]);
  });

  it('holds nothing when the payment cannot start', async () => {
    await h.db.delete(content).where(eq(content.id, 'bind_1'));
    const res = await book('cut');
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('payment-unavailable');
    expect(await claim()).toBeUndefined();
  });
});

describe('the set-up', () => {
  it('needs a payment provider for a priced offering, and refuses a price on an offering on request (for now)', () => {
    expect(BookingConfigSchema.safeParse({ ...CONFIG, payment: undefined }).success).toBe(false);
    const onRequest = { ...CONFIG, offerings: [{ ...CONFIG.offerings[0]!, confirmation: 'request' }], resources: CONFIG.resources };
    expect(BookingConfigSchema.safeParse(onRequest).success).toBe(false);
    expect(BOOKING_PAY_LIMITS.holdMs).toBe(20 * 60_000);
  });
});

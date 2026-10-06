import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { MIN_SUBMIT_ELAPSED_MS, PaymentGatewayStoredSchema } from '@sitewright/schema';
import { shopCatalog, shopStock, shopTransactions, shopFiltered, instanceSettings, INSTANCE_SETTINGS_ID, content } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID } from '../src/repo/global-library.js';
import { encryptSecret } from '../src/crypto/secret.js';
import { ensureGlobalProject } from '../src/repo/global-library.js';

const KEY = Buffer.alloc(32, 7);
const WHSEC = 'whsec_test_abc';

/** A scripted provider the mock gateway's apiBase points at. */
let scripted: { responses: Array<{ ok?: boolean; status?: number; body: unknown }>; calls: Array<{ url: string; body?: string }> };

function makeFetch() {
  return async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    scripted.calls.push({ url, ...(init.body !== undefined ? { body: init.body } : {}) });
    const r = scripted.responses.shift() ?? { body: { id: 'sess_default', url: 'https://mock-pay.invalid/s/default' } };
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
}

let h: Harness;
let owner: TestClient;
let projectId: string;

/** The declarative gateway under test: points at the mock host, signs with a plain body HMAC. */
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
  verification: { scheme: 'hmac-sha256-header', header: 'x-mock-signature', encoding: 'hex', secretField: 'webhookSecret' },
  events: { eventIdPath: 'event_id', refPath: 'session_id', typePath: 'type', types: { 'session.paid': 'paid', 'session.failed': 'failed' }, amountMinorPath: 'amount', currencyPath: 'currency' },
  allowedOrigins: ['https://mock-pay.invalid'],
  enabled: true,
  verified: true,
});

/** Settings with a shop that has a checkout channel. */
const SHOP = {
  enabled: true,
  currency: { code: 'EUR', decimals: 2, position: 'before' },
  pricing: { shipping: { flatMinor: 499, freeOverMinor: 5000 } },
  channels: [{ kind: 'checkout', key: 'pay', gatewayId: 'mock', email: 'orders@shop.test', captcha: false, pow: false, returnPath: '/thank-you/', fields: [{ key: 'email', type: 'email', required: true }] }],
};

const ALL_FORM_MODES = { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false };

/** Writes the instance settings row with payments on or off. */
async function setInstanceSettings(paymentsEnabled: boolean): Promise<void> {
  const data = { formModes: ALL_FORM_MODES, paymentsEnabled };
  await h.db
    .insert(instanceSettings)
    .values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: new Date() } });
}

beforeEach(async () => {
  scripted = { responses: [], calls: [] };
  h = await makeHarness({ encryptionKey: KEY, publicUrl: 'https://sw.test', paymentFetch: makeFetch() });
  owner = await h.signup({ admin: true });
  projectId = await owner.createProject('Shop', 'shop');

  // Turn payments on for the instance. `formModes` must be COMPLETE: FormModesSchema requires every
  // mode, and a partial row fails the stored-settings parse on read.
  await setInstanceSettings(true);

  // The gateway definition, under the reserved global scope.
  await ensureGlobalProject(h.db);
  await h.db.insert(content).values({
    id: 'gw_mock',
    projectId: GLOBAL_SCOPE_ID,
    kind: 'payment_gateway',
    entityId: 'mock',
    scope: '',
    data: GATEWAY,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // The project's binding, with encrypted per-mode credentials.
  await h.db.insert(content).values({
    id: 'bind_1',
    projectId,
    kind: 'project_payment',
    entityId: 'settings',
    scope: '',
    data: {
      gatewayId: 'mock',
      mode: 'test',
      values: { test: { apiKey: encryptSecret('sk_test_x', KEY), webhookSecret: encryptSecret(WHSEC, KEY) } },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Shop settings.
  const put = await owner.project(projectId).putContent('settings', 'settings', {
    identity: { name: 'Shop', colors: { primary: '#0a7' } },
    website: { shop: SHOP },
    settings: {},
  });
  if (put.statusCode >= 400) throw new Error(`settings put failed (${put.statusCode}): ${put.body}`);

  // The live catalog snapshot.
  await h.db.insert(shopCatalog).values({
    projectId,
    mode: 'live',
    currency: 'EUR',
    items: { mug: { sku: 'mug', name: 'Mug', priceMinor: 1999 }, tee: { sku: 'tee', name: 'Tee', priceMinor: 2450, stock: 2 } },
    digest: 'cat_1',
    publishedAt: new Date(),
  });
  await h.db.insert(shopStock).values({ projectId, sku: 'tee', onStock: 2, sold: 0, reserved: 0, authoredAtPublish: 2, updatedAt: new Date() });
});

afterEach(async () => {
  // Guarded: a failing beforeEach leaves `h` unset, and an unguarded close masks the real error.
  await h?.close();
});

/** A well-formed checkout body that passes every bot gate. */
const body = (over: Record<string, unknown> = {}) => ({
  items: [{ sku: 'mug', qty: 1 }],
  fields: { email: 'ada@example.com' },
  _hpt: '',
  _elapsed: String(MIN_SUBMIT_ELAPSED_MS + 500),
  _ix: '3.5.1',
  ...over,
});

const checkout = (payload: unknown) => h.app.inject({ method: 'POST', url: `/pay/${projectId}/pay`, payload: payload as never });

const sign = (raw: string, secret = WHSEC) => createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');

const webhook = (raw: string, sig?: string) =>
  h.app.inject({
    method: 'POST',
    url: `/pay/${projectId}/webhook/mock`,
    headers: { 'content-type': 'application/json', 'x-mock-signature': sig ?? sign(raw) },
    payload: raw,
  });

describe('POST /pay/:projectId/:channelKey — the happy path', () => {
  it('re-prices server-side and returns the AUTHORITATIVE breakdown plus a redirect', async () => {
    scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
    const res = await checkout(body());
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.redirectUrl).toBe('https://mock-pay.invalid/s/1');
    expect(out.currency).toBe('EUR');
    // 19.99 + 4.99 shipping
    expect(out.amounts).toEqual({ subtotalMinor: 1999, shippingMinor: 499, taxMinor: 0, totalMinor: 2498 });
    expect(out.display.total).toBe('24.98');
    expect(out.token).toBeTruthy();
    // The provider was sent the PLATFORM's amount, as a JSON number.
    expect(JSON.parse(scripted.calls[0]!.body!)).toMatchObject({ amount: 2498, currency: 'EUR' });
  });

  it('★ the return URL carries the opaque token, and points at the configured page', async () => {
    scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
    const res = await checkout(body());
    const sent = JSON.parse(scripted.calls[0]!.body!);
    expect(sent.ret).toContain('/thank-you/');
    expect(sent.ret).toContain(`t=${encodeURIComponent(res.json().token)}`);
  });

  it('opens the transaction in `created` with nothing owed yet', async () => {
    scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
    await checkout(body());
    const [txn] = await h.db.select().from(shopTransactions).where(eq(shopTransactions.projectId, projectId));
    expect(txn).toMatchObject({ status: 'created', mode: 'test', notifyState: 'na', receiptState: 'na', totalMinor: 2498 });
    expect(txn?.customerEmail).toBe('ada@example.com');
  });
});

describe('★★ a tampered cart cannot change the charge', () => {
  it('ignores every price-shaped field a client invents', async () => {
    scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
    const res = await checkout(
      body({ items: [{ sku: 'mug', qty: 1, price: '0.01', priceMinor: 1, unitMinor: 1 }], total: 1, totalMinor: 1, amount: 1, currency: 'XOF' }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().amounts.totalMinor).toBe(2498);
    expect(res.json().currency).toBe('EUR');
    expect(JSON.parse(scripted.calls[0]!.body!).amount).toBe(2498);
  });

  it('refuses an unknown sku with a 409 that NAMES it, so the cart is recoverable', async () => {
    const res = await checkout(body({ items: [{ sku: 'ghost', qty: 1 }] }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'unknown-sku', sku: 'ghost' });
  });

  it('refuses a duplicate sku and a qty outside the bounds', async () => {
    expect((await checkout(body({ items: [{ sku: 'mug', qty: 1 }, { sku: 'mug', qty: 1 }] }))).statusCode).toBe(400);
    expect((await checkout(body({ items: [{ sku: 'mug', qty: 0 }] }))).statusCode).toBe(400);
    expect((await checkout(body({ items: [{ sku: 'mug', qty: 100 }] }))).statusCode).toBe(400);
    expect((await checkout(body({ items: [{ sku: 'mug', qty: -1 }] }))).statusCode).toBe(400);
    expect((await checkout(body({ items: [] }))).statusCode).toBe(400);
  });
});

describe('★ the bot gates refuse with an ERROR, not a silent 200', () => {
  it('refuses a filled honeypot, an instant submit and no interaction — all generically', async () => {
    for (const payload of [body({ _hpt: 'x' }), body({ _elapsed: '5' }), body({ _ix: '0.0.0' }), body({ _ix: undefined })]) {
      const res = await checkout(payload);
      // A buyer NEEDS the response to proceed. A silent success with no redirect is a lost sale.
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'checkout_unavailable' });
    }
  });

  it('★ never names which gate fired', async () => {
    const bodies = [body({ _hpt: 'x' }), body({ _elapsed: '5' }), body({ _ix: '0.0.0' })];
    const seen = new Set<string>();
    for (const b of bodies) seen.add((await checkout(b)).body);
    // One identical response for every trap: a bot must not learn which one caught it.
    expect(seen.size).toBe(1);
  });

  it('COUNTS each refusal, so "we blocked bots" and "we lost sales" stay distinguishable', async () => {
    await checkout(body({ _hpt: 'x' }));
    await checkout(body({ _elapsed: '5' }));
    await checkout(body({ _elapsed: '5' }));
    const rows = await h.db.select().from(shopFiltered).where(eq(shopFiltered.projectId, projectId));
    expect(rows.find((r) => r.reason === 'honeypot')?.count).toBe(1);
    expect(rows.find((r) => r.reason === 'too-fast')?.count).toBe(2);
  });

  it('enforces the channel’s declared required fields server-side', async () => {
    const res = await checkout(body({ fields: {} }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid fields', fields: ['email'] });
  });
});

describe('★ stock', () => {
  it('holds stock, then refuses an oversell naming the sku and what is left', async () => {
    scripted.responses.push({ body: { id: 's1', url: 'https://mock-pay.invalid/s/1' } }, { body: { id: 's2', url: 'https://mock-pay.invalid/s/2' } });
    expect((await checkout(body({ items: [{ sku: 'tee', qty: 2 }] }))).statusCode).toBe(200);
    const res = await checkout(body({ items: [{ sku: 'tee', qty: 1 }] }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'out_of_stock', sku: 'tee', available: 0 });
  });

  it('★ gives the hold BACK when the provider will not open a session', async () => {
    scripted.responses.push({ ok: false, status: 402, body: { error: 'declined' } });
    expect((await checkout(body({ items: [{ sku: 'tee', qty: 2 }] }))).statusCode).toBe(502);
    const [row] = await h.db.select().from(shopStock).where(and(eq(shopStock.projectId, projectId), eq(shopStock.sku, 'tee')));
    // Otherwise a provider outage makes a shop unsellable for the whole reservation TTL.
    expect(row?.reserved).toBe(0);
    const [txn] = await h.db.select().from(shopTransactions);
    expect(txn?.status).toBe('failed');
  });

  it('★ two concurrent checkouts for the last unit: exactly one gets a session', async () => {
    scripted.responses.push({ body: { id: 's1', url: 'https://mock-pay.invalid/s/1' } }, { body: { id: 's2', url: 'https://mock-pay.invalid/s/2' } });
    await h.db.update(shopStock).set({ onStock: 1 }).where(eq(shopStock.sku, 'tee'));
    const results = await Promise.all([checkout(body({ items: [{ sku: 'tee', qty: 1 }] })), checkout(body({ items: [{ sku: 'tee', qty: 1 }] }))]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);
  });
});

describe('★★ a PREVIEW checkout never touches the real stock ledger', () => {
  /** The draft snapshot a preview prices against. */
  async function seedDraftCatalog() {
    await h.db.insert(shopCatalog).values({
      projectId,
      mode: 'draft',
      currency: 'EUR',
      items: { tee: { sku: 'tee', name: 'Tee', priceMinor: 2450, stock: 2 } },
      digest: 'cat_draft',
      publishedAt: new Date(),
    });
  }

  const previewCheckout = (payload: unknown) =>
    h.app.inject({ method: 'POST', url: `/pay/${projectId}/pay?preview=1`, payload: payload as never });

  it('reserves NOTHING, so an author testing checkout cannot make a SKU unavailable', async () => {
    await seedDraftCatalog();
    scripted.responses.push({ body: { id: 'sess_p', url: 'https://mock-pay.invalid/s/p' } });
    const res = await previewCheckout(body({ items: [{ sku: 'tee', qty: 2 }] }));
    expect(res.statusCode).toBe(200);
    const [row] = await h.db.select().from(shopStock).where(and(eq(shopStock.projectId, projectId), eq(shopStock.sku, 'tee')));
    // `sold` is never decremented, so a rehearsal that held real units would understate availability
    // for every subsequent real buyer — permanently.
    expect(row).toMatchObject({ reserved: 0, sold: 0, onStock: 2 });
  });

  it('is not refused by stock it does not consume', async () => {
    await seedDraftCatalog();
    await h.db.update(shopStock).set({ onStock: 0 }).where(eq(shopStock.sku, 'tee'));
    scripted.responses.push({ body: { id: 'sess_p', url: 'https://mock-pay.invalid/s/p' } });
    // A sold-out shop must still be rehearsable.
    expect((await previewCheckout(body({ items: [{ sku: 'tee', qty: 1 }] }))).statusCode).toBe(200);
  });

  it('★ a PAID preview webhook does not commit stock', async () => {
    await seedDraftCatalog();
    scripted.responses.push({ body: { id: 'sess_p', url: 'https://mock-pay.invalid/s/p' } });
    const out = (await previewCheckout(body({ items: [{ sku: 'tee', qty: 2 }] }))).json();
    const raw = JSON.stringify({ event_id: 'evt_p', session_id: 'sess_p', type: 'session.paid', amount: out.amounts.totalMinor, currency: 'EUR' });
    expect((await webhook(raw)).statusCode).toBe(200);
    const [row] = await h.db.select().from(shopStock).where(eq(shopStock.sku, 'tee'));
    // Committing here would increment `sold` against stock the rehearsal never reserved.
    expect(row).toMatchObject({ sold: 0, reserved: 0 });
    // The transaction itself DID resolve — the point of a dry run is to prove this path works.
    const [txn] = await h.db.select().from(shopTransactions);
    expect(txn).toMatchObject({ status: 'paid', preview: true });
  });

  it('is marked `preview` and prices against the DRAFT snapshot', async () => {
    await seedDraftCatalog();
    scripted.responses.push({ body: { id: 'sess_p', url: 'https://mock-pay.invalid/s/p' } });
    await previewCheckout(body({ items: [{ sku: 'tee', qty: 1 }] }));
    const [txn] = await h.db.select().from(shopTransactions);
    expect(txn).toMatchObject({ preview: true, mode: 'test', catalogDigest: 'cat_draft' });
  });

  it('★ a preview requires TEST mode — it can never transact against the live account', async () => {
    await seedDraftCatalog();
    await h.db
      .update(content)
      .set({ data: { gatewayId: 'mock', mode: 'live', values: { live: { apiKey: encryptSecret('sk_live_x', KEY), webhookSecret: encryptSecret(WHSEC, KEY) } } } })
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'project_payment')));
    const res = await previewCheckout(body({ items: [{ sku: 'tee', qty: 1 }] }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'a preview checkout requires test mode' });
  });

  it('a REAL test-mode checkout still holds and commits stock — `mode` is not `preview`', async () => {
    // The distinction both flags exist for: a project legitimately running in test mode is still
    // running its real shop.
    scripted.responses.push({ body: { id: 'sess_r', url: 'https://mock-pay.invalid/s/r' } });
    const out = (await checkout(body({ items: [{ sku: 'tee', qty: 2 }] }))).json();
    expect((await h.db.select().from(shopStock).where(eq(shopStock.sku, 'tee')))[0]).toMatchObject({ reserved: 2 });
    const raw = JSON.stringify({ event_id: 'evt_r', session_id: 'sess_r', type: 'session.paid', amount: out.amounts.totalMinor, currency: 'EUR' });
    await webhook(raw);
    expect((await h.db.select().from(shopStock).where(eq(shopStock.sku, 'tee')))[0]).toMatchObject({ sold: 2, reserved: 0 });
  });
});

describe('POST /pay/:projectId/webhook/:gatewayId', () => {
  /** Runs a successful checkout and returns its session ref + token. */
  async function openSession(sku = 'mug', qty = 1) {
    scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
    const res = await checkout(body({ items: [{ sku, qty }] }));
    expect(res.statusCode).toBe(200);
    return { token: res.json().token as string, amounts: res.json().amounts };
  }

  it('★★ verifies the RAW body: a correct signature over the exact bytes is accepted', async () => {
    const { amounts } = await openSession();
    const raw = JSON.stringify({ event_id: 'evt_1', session_id: 'sess_1', type: 'session.paid', amount: amounts.totalMinor, currency: 'EUR' });
    const res = await webhook(raw);
    expect(res.statusCode).toBe(200);
    const [txn] = await h.db.select().from(shopTransactions);
    expect(txn?.status).toBe('paid');
    expect(txn?.paidAt).not.toBeNull();
    // ★ Both mail obligations armed, in the same write.
    expect(txn?.notifyState).toBe('pending');
    expect(txn?.receiptState).toBe('pending');
  });

  it('★★ a signature over a RE-SERIALIZED body is refused — the raw-body parser is load-bearing', async () => {
    const { amounts } = await openSession();
    const raw = JSON.stringify({ event_id: 'e', session_id: 'sess_1', type: 'session.paid', amount: amounts.totalMinor, currency: 'EUR' });
    // Sign a differently-spaced encoding of the same object. Key order/spacing differ on the wire for
    // real providers, which is exactly why the route must not verify over a re-serialized body.
    const other = JSON.stringify(JSON.parse(raw), null, 2);
    const res = await webhook(raw, sign(other));
    expect(res.statusCode).toBe(400);
    expect((await h.db.select().from(shopTransactions))[0]?.status).toBe('created');
  });

  it('refuses a wrong signature with a bare 400 and no detail', async () => {
    await openSession();
    const raw = JSON.stringify({ event_id: 'e', session_id: 'sess_1', type: 'session.paid' });
    const res = await webhook(raw, 'deadbeef');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid' });
  });

  it('★★ a REPLAYED event is acknowledged but changes nothing', async () => {
    const { amounts } = await openSession();
    const raw = JSON.stringify({ event_id: 'evt_dup', session_id: 'sess_1', type: 'session.paid', amount: amounts.totalMinor, currency: 'EUR' });
    expect((await webhook(raw)).statusCode).toBe(200);
    const first = (await h.db.select().from(shopTransactions))[0]!;
    const replay = await webhook(raw);
    // 200 so the provider stops retrying; `duplicate` so an operator can see it happened.
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ duplicate: true });
    const after = (await h.db.select().from(shopTransactions))[0]!;
    // Nothing moved — notably the mail obligations were not re-armed, so no second receipt.
    expect(after.paidAt?.getTime()).toBe(first.paidAt?.getTime());
    expect(after.notifyAttempts).toBe(first.notifyAttempts);
  });

  it('★★ REFUSES a paid event whose amount disagrees with the order', async () => {
    await openSession();
    const raw = JSON.stringify({ event_id: 'evt_x', session_id: 'sess_1', type: 'session.paid', amount: 1, currency: 'EUR' });
    const res = await webhook(raw);
    // 200 (verified, stop retrying) but NOT paid: recording a payment the shop did not ask for, in
    // either direction, is worse than leaving it for an operator.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mismatch: true });
    expect((await h.db.select().from(shopTransactions))[0]?.status).toBe('created');
    const rows = await h.db.select().from(shopFiltered).where(eq(shopFiltered.projectId, projectId));
    expect(rows.some((r) => r.reason === 'amount-mismatch')).toBe(true);
  });

  it('★ refuses a paid event in a different CURRENCY even when the number matches', async () => {
    const { amounts } = await openSession();
    const raw = JSON.stringify({ event_id: 'evt_c', session_id: 'sess_1', type: 'session.paid', amount: amounts.totalMinor, currency: 'USD' });
    expect((await webhook(raw)).json()).toMatchObject({ mismatch: true });
    expect((await h.db.select().from(shopTransactions))[0]?.status).toBe('created');
  });

  it('commits stock on paid, and releases it on failed', async () => {
    const { amounts } = await openSession('tee', 2);
    const paid = JSON.stringify({ event_id: 'e1', session_id: 'sess_1', type: 'session.paid', amount: amounts.totalMinor, currency: 'EUR' });
    await webhook(paid);
    const [committed] = await h.db.select().from(shopStock).where(eq(shopStock.sku, 'tee'));
    expect(committed).toMatchObject({ sold: 2, reserved: 0 });
  });

  it('releases the hold when the payment fails', async () => {
    await openSession('tee', 2);
    const failed = JSON.stringify({ event_id: 'e2', session_id: 'sess_1', type: 'session.failed' });
    expect((await webhook(failed)).statusCode).toBe(200);
    const [row] = await h.db.select().from(shopStock).where(eq(shopStock.sku, 'tee'));
    expect(row).toMatchObject({ sold: 0, reserved: 0 });
    expect((await h.db.select().from(shopTransactions))[0]?.status).toBe('failed');
  });

  it('★ an UNMAPPED event type is acknowledged and ignored, never guessed', async () => {
    await openSession();
    const raw = JSON.stringify({ event_id: 'e3', session_id: 'sess_1', type: 'session.whatever' });
    expect((await webhook(raw)).json()).toMatchObject({ ignored: true });
    expect((await h.db.select().from(shopTransactions))[0]?.status).toBe('created');
  });

  it('★ a verified event for an unknown transaction is acknowledged, not acted on', async () => {
    const raw = JSON.stringify({ event_id: 'e4', session_id: 'sess_nope', type: 'session.paid' });
    expect((await webhook(raw)).json()).toMatchObject({ unmatched: true });
  });

  it('★ is not an existence oracle: an unknown project answers exactly like a bad signature', async () => {
    const raw = JSON.stringify({ event_id: 'e5', session_id: 's', type: 'session.paid' });
    const unknown = await h.app.inject({
      method: 'POST',
      url: '/pay/does-not-exist/webhook/mock',
      headers: { 'content-type': 'application/json', 'x-mock-signature': sign(raw) },
      payload: raw,
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: 'invalid' });
  });

  it('★ a webhook naming a DIFFERENT gateway than the project configured is refused', async () => {
    const raw = JSON.stringify({ event_id: 'e6', session_id: 's', type: 'session.paid' });
    const res = await h.app.inject({
      method: 'POST',
      url: `/pay/${projectId}/webhook/stripe`,
      headers: { 'content-type': 'application/json', 'x-mock-signature': sign(raw) },
      payload: raw,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /pay/:projectId/txn/:token', () => {
  it('★ returns the buyer’s own view and leaks nothing about the merchant', async () => {
    scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
    const token = (await checkout(body())).json().token as string;
    const res = await h.app.inject({ method: 'GET', url: `/pay/${projectId}/txn/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.body;
    for (const leak of ['orders@shop.test', 'sess_1', 'mock', 'cat_1', token]) {
      expect(text, leak).not.toContain(leak);
    }
    expect(res.json().transaction).toMatchObject({ status: 'created', currency: 'EUR' });
    // Their own submitted field comes back, so the page can greet them.
    expect(text).toContain('ada@example.com');
  });

  it('★ a token from one project does not resolve under another', async () => {
    scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
    const token = (await checkout(body())).json().token as string;
    const other = await owner.createProject('Other', 'other');
    expect((await h.app.inject({ method: 'GET', url: `/pay/${other}/txn/${token}` })).statusCode).toBe(404);
  });

  it('404s for a bogus token', async () => {
    expect((await h.app.inject({ method: 'GET', url: `/pay/${projectId}/txn/notatoken` })).statusCode).toBe(404);
  });
});

describe('★ the instance gate and the configuration gates', () => {
  it('refuses every checkout when payments are off instance-wide', async () => {
    await setInstanceSettings(false);
    const res = await checkout(body());
    expect(res.statusCode).toBe(503);
  });

  it('★ 404s a channel key that is not configured, revealing nothing about the project', async () => {
    const res = await h.app.inject({ method: 'POST', url: `/pay/${projectId}/nosuchchannel`, payload: body() as never });
    expect(res.statusCode).toBe(404);
  });

  it('★ refuses when the gateway is UNVERIFIED and the project is live', async () => {
        await h.db.update(content).set({ data: { ...GATEWAY, verified: false } }).where(and(eq(content.projectId, GLOBAL_SCOPE_ID), eq(content.entityId, 'mock')));
    await h.db
      .update(content)
      .set({ data: { gatewayId: 'mock', mode: 'live', values: { live: { apiKey: encryptSecret('sk_live_x', KEY), webhookSecret: encryptSecret(WHSEC, KEY) } } } })
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'project_payment')));
    const res = await checkout(body());
    // An unproven gateway must never take live money.
    expect(res.statusCode).toBe(503);
  });

  it('★ refuses when the project has no credentials for its ACTIVE mode', async () => {
        await h.db
      .update(content)
      .set({ data: { gatewayId: 'mock', mode: 'test', values: {} } })
      .where(and(eq(content.projectId, projectId), eq(content.kind, 'project_payment')));
    expect((await checkout(body())).statusCode).toBe(503);
  });

  it('★ refuses when the snapshot predates a settlement-currency change', async () => {
    await h.db.update(shopCatalog).set({ currency: 'USD' }).where(eq(shopCatalog.projectId, projectId));
    // Charging against it would mean charging in a currency the shop no longer uses.
    expect((await checkout(body())).statusCode).toBe(503);
  });

  it('refuses when the shop has never been built', async () => {
    await h.db.delete(shopCatalog).where(eq(shopCatalog.projectId, projectId));
    expect((await checkout(body())).statusCode).toBe(503);
  });
});

describe('proof-of-work challenge', () => {
  it('mints a challenge on the live path AND the preview twin', async () => {
    for (const url of [`/pay/${projectId}/pay/challenge`, `/pay/${projectId}/pay/preview/challenge`]) {
      const res = await h.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toHaveProperty('challenge');
    }
  });
});

describe('CORS', () => {
  it('answers the preflight and allows a cross-origin post', async () => {
    const res = await h.app.inject({ method: 'OPTIONS', url: `/pay/${projectId}/pay` });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

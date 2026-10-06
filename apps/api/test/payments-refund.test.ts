import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { MIN_SUBMIT_ELAPSED_MS, PaymentGatewayStoredSchema } from '@sitewright/schema';
import { shopCatalog, shopStock, shopTransactions, instanceSettings, INSTANCE_SETTINGS_ID, content } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';
import { encryptSecret } from '../src/crypto/secret.js';

/**
 * REFUNDS.
 *
 * ★★ The invariant this file exists to defend: THE SAME MONEY CANNOT GO BACK TWICE. Everything else
 * here — partials, restocking, mode checks — is ordinary feature behaviour. The claim-before-call
 * ordering and what happens when the provider's answer is ambiguous are the parts where a bug costs
 * a merchant real money, so they are tested directly rather than inferred.
 */

const KEY = Buffer.alloc(32, 7);
const WHSEC = 'whsec_refund_test';

let scripted: { responses: Array<{ ok?: boolean; status?: number; body: unknown; throw?: string }>; calls: Array<{ url: string; body?: string }> };

function makeFetch() {
  return async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    scripted.calls.push({ url, ...(init.body !== undefined ? { body: init.body } : {}) });
    const r = scripted.responses.shift() ?? { body: { id: 'sess_default', url: 'https://mock-pay.invalid/s/default' } };
    // A thrown fetch is how a timeout or a DNS failure actually reaches the executor.
    if (r.throw) throw Object.assign(new Error(r.throw), { name: r.throw });
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
}

let h: Harness;
let owner: TestClient;
let projectId: string;

/** A gateway that CAN refund: the refund request is a template like any other. */
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
    request: { method: 'POST', path: '/sessions', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}' } },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  refund: {
    request: {
      method: 'POST',
      // ★ The reference is interpolated into the PATH, which is how a mistake here shows up as a
      // refund against the wrong payment rather than as an error.
      path: '/payments/${TXN:reference}/refunds',
      format: 'json',
      headers: {},
      body: { amount: '${#AMOUNT:minor}', currency: '${AMOUNT:currency}' },
    },
  },
  verification: { scheme: 'hmac-sha256-header', header: 'x-mock-signature', encoding: 'hex', secretField: 'webhookSecret' },
  events: {
    eventIdPath: 'event_id',
    refPath: 'session_id',
    typePath: 'type',
    types: { 'session.paid': 'paid', 'session.refunded': 'refunded' },
    amountMinorPath: 'amount',
    currencyPath: 'currency',
  },
  allowedOrigins: ['https://mock-pay.invalid'],
  enabled: true,
  verified: true,
});

const SHOP = {
  enabled: true,
  currency: { code: 'EUR', decimals: 2, position: 'before' },
  channels: [{ kind: 'checkout', key: 'pay', gatewayId: 'mock', email: 'orders@shop.test', captcha: false, pow: false, returnPath: '/thank-you/', fields: [] }],
};

const ALL_FORM_MODES = { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false };

beforeEach(async () => {
  scripted = { responses: [], calls: [] };
  h = await makeHarness({ encryptionKey: KEY, publicUrl: 'https://sw.test', paymentFetch: makeFetch() });
  owner = await h.signup({ admin: true });
  projectId = await owner.createProject('Shop', 'shop');

  const data = { formModes: ALL_FORM_MODES, paymentsEnabled: true };
  await h.db
    .insert(instanceSettings)
    .values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: new Date() } });

  await ensureGlobalProject(h.db);
  await h.db.insert(content).values({
    id: 'gw_mock', projectId: GLOBAL_SCOPE_ID, kind: 'payment_gateway', entityId: 'mock', scope: '',
    data: GATEWAY, createdAt: new Date(), updatedAt: new Date(),
  });
  await h.db.insert(content).values({
    id: 'bind_1', projectId, kind: 'project_payment', entityId: 'settings', scope: '',
    data: { gatewayId: 'mock', mode: 'test', values: { test: { apiKey: encryptSecret('sk_test_x', KEY), webhookSecret: encryptSecret(WHSEC, KEY) } } },
    createdAt: new Date(), updatedAt: new Date(),
  });

  const put = await owner.project(projectId).putContent('settings', 'settings', {
    identity: { name: 'Shop', colors: { primary: '#0a7' } },
    website: { shop: SHOP },
    settings: {},
  });
  if (put.statusCode >= 400) throw new Error(`settings put failed (${put.statusCode}): ${put.body}`);

  await h.db.insert(shopCatalog).values({
    projectId, mode: 'live', currency: 'EUR',
    items: { mug: { sku: 'mug', name: 'Mug', priceMinor: 2000, stock: 5 } },
    digest: 'cat_1', publishedAt: new Date(),
  });
  await h.db.insert(shopStock).values({ projectId, sku: 'mug', onStock: 5, sold: 0, reserved: 0, authoredAtPublish: 5, updatedAt: new Date() });
});

afterEach(async () => {
  await h?.close();
});

const sign = (raw: string, secret = WHSEC) => createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');

/** Runs a checkout and resolves it with a signed `paid` webhook. Returns the transaction id. */
async function paidOrder(qty = 1): Promise<string> {
  scripted.responses.push({ body: { id: 'sess_1', url: 'https://mock-pay.invalid/s/1' } });
  const res = await h.app.inject({
    method: 'POST',
    url: `/pay/${projectId}/pay`,
    payload: { items: [{ sku: 'mug', qty }], fields: {}, _hpt: '', _elapsed: String(MIN_SUBMIT_ELAPSED_MS + 500), _ix: '3.5.1' } as never,
  });
  expect(res.statusCode, res.body).toBe(200);
  const raw = JSON.stringify({ event_id: `e_${Math.random().toString(36).slice(2)}`, session_id: 'sess_1', type: 'session.paid', amount: res.json().amounts.totalMinor, currency: 'EUR' });
  const hook = await h.app.inject({
    method: 'POST', url: `/pay/${projectId}/webhook/mock`,
    headers: { 'content-type': 'application/json', 'x-mock-signature': sign(raw) }, payload: raw,
  });
  expect(hook.statusCode).toBe(200);
  const [txn] = await h.db.select().from(shopTransactions).where(eq(shopTransactions.projectId, projectId));
  expect(txn?.status).toBe('paid');
  scripted.calls.length = 0; // only the refund's calls matter from here
  return txn!.id;
}

const refund = (id: string, body: Record<string, unknown> = {}) =>
  owner.post(`/projects/${projectId}/transactions/${id}/refund`, body);

const read = async (id: string) => (await h.db.select().from(shopTransactions).where(eq(shopTransactions.id, id)))[0]!;

describe('a full refund', () => {
  it('calls the provider with the order amount and settles the order as refunded', async () => {
    const id = await paidOrder();
    scripted.responses.push({ body: { id: 're_1' } });
    const res = await refund(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ refundedMinor: 2000, refunded: '20.00', restocked: false });

    // The provider was asked for exactly the order's amount, against the payment's own reference.
    expect(scripted.calls).toHaveLength(1);
    expect(scripted.calls[0]!.url).toContain('/payments/sess_1/refunds');
    expect(JSON.parse(scripted.calls[0]!.body!)).toEqual({ amount: 2000, currency: 'EUR' });

    const row = await read(id);
    expect(row.status).toBe('refunded');
    expect(row.refundedMinor).toBe(2000);
  });

  it('defaults to everything outstanding, so an operator never computes the remainder', async () => {
    const id = await paidOrder();
    scripted.responses.push({ body: { id: 're_a' } });
    expect((await refund(id, { amountMinor: 500 })).statusCode).toBe(200);
    scripted.responses.push({ body: { id: 're_b' } });
    const res = await refund(id); // no amount: the remaining 1500
    expect(res.json().refundedMinor).toBe(1500);
    expect((await read(id)).status).toBe('refunded');
  });
});

describe('partial refunds', () => {
  it('leaves the order partially_refunded with the balance recorded', async () => {
    const id = await paidOrder();
    scripted.responses.push({ body: { id: 're_1' } });
    const res = await refund(id, { amountMinor: 750 });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(scripted.calls[0]!.body!).amount).toBe(750);
    const row = await read(id);
    expect(row.status).toBe('partially_refunded');
    expect(row.refundedMinor).toBe(750);
  });

  it('★ two partials that happen to sum to the total settle as fully refunded', async () => {
    const id = await paidOrder();
    for (const amt of [1200, 800]) {
      scripted.responses.push({ body: { id: `re_${amt}` } });
      expect((await refund(id, { amountMinor: amt })).statusCode).toBe(200);
    }
    const row = await read(id);
    // ★ Derived from the BALANCE, not from anyone noticing that the second one closed it out.
    expect(row.status).toBe('refunded');
    expect(row.refundedMinor).toBe(2000);
  });

  it('refuses more than is left, and NAMES what is left', async () => {
    const id = await paidOrder();
    scripted.responses.push({ body: { id: 're_1' } });
    await refund(id, { amountMinor: 1500 });
    scripted.calls.length = 0;
    const res = await refund(id, { amountMinor: 600 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ outstandingMinor: 500, outstanding: '5.00' });
    // ★ Nothing was sent to the provider — the claim is what refused it, before any money moved.
    expect(scripted.calls).toEqual([]);
    expect((await read(id)).refundedMinor).toBe(1500);
  });
});

describe('★★ the same money cannot go back twice', () => {
  it('two simultaneous full refunds: one succeeds, one is refused, one provider call', async () => {
    const id = await paidOrder();
    scripted.responses.push({ body: { id: 're_1' } }, { body: { id: 're_2' } });
    const [a, b] = await Promise.all([refund(id), refund(id)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    // The provider was asked ONCE.
    //
    // ★ Honest note: this test does NOT prove the conditional UPDATE is what stopped the second one.
    // Measured — with the decision taken out of the WHERE, this test still passes, because a route
    // has enough awaits before the claim that the two requests do not actually interleave here. The
    // mechanism is pinned by the repo-level test at the bottom of this file, which can create the
    // interleaving a route cannot. Both are kept: this one is the behaviour an operator sees, that
    // one is the reason it holds.
    expect(scripted.calls).toHaveLength(1);
    const row = await read(id);
    expect(row.refundedMinor).toBe(2000);
    expect(row.status).toBe('refunded');
  });

  it('a refunded order cannot be refunded again', async () => {
    const id = await paidOrder();
    scripted.responses.push({ body: { id: 're_1' } });
    await refund(id);
    scripted.calls.length = 0;
    const again = await refund(id, { amountMinor: 100 });
    expect(again.statusCode).toBe(409);
    expect(scripted.calls).toEqual([]);
  });

  it('an unpaid order cannot be refunded at all', async () => {
    scripted.responses.push({ body: { id: 'sess_u', url: 'https://mock-pay.invalid/s/u' } });
    const created = await h.app.inject({
      method: 'POST', url: `/pay/${projectId}/pay`,
      payload: { items: [{ sku: 'mug', qty: 1 }], fields: {}, _hpt: '', _elapsed: String(MIN_SUBMIT_ELAPSED_MS + 500), _ix: '3.5.1' } as never,
    });
    expect(created.statusCode).toBe(200);
    const [txn] = await h.db.select().from(shopTransactions).where(eq(shopTransactions.projectId, projectId));
    scripted.calls.length = 0;
    const res = await refund(txn!.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('created');
    expect(scripted.calls).toEqual([]);
  });
});

describe('★★ what happens when the provider does not simply say yes', () => {
  it('a 4xx is a DEFINITE refusal: the claim is released and nothing is owed', async () => {
    const id = await paidOrder();
    scripted.responses.push({ ok: false, status: 422, body: { error: 'already refunded' } });
    const res = await refund(id, { amountMinor: 900 });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ settled: true });
    const row = await read(id);
    // ★ Back where it started — the provider looked at it and said no, so the claim must not stand.
    expect(row.refundedMinor).toBe(0);
    expect(row.status).toBe('paid');
    // And the operator can try again.
    scripted.responses.push({ body: { id: 're_ok' } });
    expect((await refund(id, { amountMinor: 900 })).statusCode).toBe(200);
  });

  it('★★ a TIMEOUT keeps the claim: an ambiguous failure must not be refundable again', async () => {
    const id = await paidOrder();
    scripted.responses.push({ throw: 'AbortError', body: null });
    const res = await refund(id, { amountMinor: 900 });
    expect(res.statusCode).toBe(502);
    expect(res.json().settled).toBe(false);
    expect(res.json().error).toContain('may have gone through');
    const row = await read(id);
    // ★ The claim STANDS. The refund may well have happened at the provider; releasing it here is
    // how the same 9.00 goes back twice.
    expect(row.refundedMinor).toBe(900);
  });

  it('a 5xx is also ambiguous — the provider may have processed it before failing to answer', async () => {
    const id = await paidOrder();
    scripted.responses.push({ ok: false, status: 503, body: 'upstream down' });
    expect((await refund(id, { amountMinor: 400 })).json().settled).toBe(false);
    expect((await read(id)).refundedMinor).toBe(400);
  });

  it('a config error never reached the provider, so the claim is released', async () => {
    // A gateway whose refund template names a namespace that does not exist. (`${FIELD:x}` would
    // NOT do: a buyer field is deliberately allowed to be absent, because an optional input left
    // blank is normal — so it interpolates to '' rather than failing.)
    await h.db
      .update(content)
      .set({ data: { ...GATEWAY, refund: { request: { method: 'POST', path: '/r/${NOPE:x}', format: 'json', headers: {}, body: {} } } } })
      .where(eq(content.entityId, 'mock'));
    const id = await paidOrder();
    scripted.calls.length = 0;
    const res = await refund(id, { amountMinor: 100 });
    expect(res.statusCode).toBe(502);
    expect(res.json().settled).toBe(true);
    expect(scripted.calls).toEqual([]);
    expect((await read(id)).refundedMinor).toBe(0);
  });
});

describe('restocking is the operator’s call, never the platform’s', () => {
  it('does NOT restock by default', async () => {
    const id = await paidOrder(2);
    expect((await h.db.select().from(shopStock).where(eq(shopStock.projectId, projectId)))[0]!.sold).toBe(2);
    scripted.responses.push({ body: { id: 're_1' } });
    expect((await refund(id)).json().restocked).toBe(false);
    // ★ Still sold. A refund says money went back, not that a sellable item did.
    expect((await h.db.select().from(shopStock).where(eq(shopStock.projectId, projectId)))[0]!.sold).toBe(2);
  });

  it('puts the units back when the operator asks', async () => {
    const id = await paidOrder(2);
    scripted.responses.push({ body: { id: 're_1' } });
    expect((await refund(id, { restock: true })).json().restocked).toBe(true);
    expect((await h.db.select().from(shopStock).where(eq(shopStock.projectId, projectId)))[0]!.sold).toBe(0);
  });
});

describe('what a refund refuses to attempt', () => {
  it('★ a gateway with no refund template says so rather than pretending', async () => {
    const noRefund: Record<string, unknown> = { ...(GATEWAY as Record<string, unknown>) };
    delete noRefund.refund;
    await h.db.update(content).set({ data: noRefund }).where(eq(content.entityId, 'mock'));
    const id = await paidOrder();
    scripted.calls.length = 0;
    const res = await refund(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('cannot issue refunds');
    expect(scripted.calls).toEqual([]);
  });

  it('★ refuses when the project has since switched to a different gateway', async () => {
    const id = await paidOrder();
    await h.db.insert(content).values({
      id: 'gw_other', projectId: GLOBAL_SCOPE_ID, kind: 'payment_gateway', entityId: 'other', scope: '',
      data: { ...GATEWAY, id: 'other' }, createdAt: new Date(), updatedAt: new Date(),
    });
    await h.db
      .update(content)
      .set({ data: { gatewayId: 'other', mode: 'test', values: { test: { apiKey: encryptSecret('sk', KEY), webhookSecret: encryptSecret(WHSEC, KEY) } } } })
      .where(eq(content.entityId, 'settings'));
    scripted.calls.length = 0;
    const res = await refund(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('different gateway');
    expect(scripted.calls).toEqual([]);
  });

  it('★ refuses to refund a test-mode order with live credentials', async () => {
    const id = await paidOrder();
    await h.db
      .update(content)
      .set({ data: { gatewayId: 'mock', mode: 'live', values: { live: { apiKey: encryptSecret('sk_live', KEY), webhookSecret: encryptSecret(WHSEC, KEY) } } } })
      .where(eq(content.entityId, 'settings'));
    scripted.calls.length = 0;
    const res = await refund(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('mode');
    expect(scripted.calls).toEqual([]);
  });
});

describe('★★ an agent cannot refund', () => {
  it('a bearer token with content:write is refused — this route is session-only', async () => {
    const id = await paidOrder();
    const made = await owner.post(`/projects/${projectId}/api-keys`, {
      name: 'agent', role: 'owner', expiresInDays: 1,
      capabilities: ['content:read', 'content:write', 'publish', 'deploy'],
    });
    expect(made.statusCode).toBe(201);
    scripted.calls.length = 0;
    const res = await h.app.inject({
      method: 'POST',
      url: `/projects/${projectId}/transactions/${id}/refund`,
      headers: { authorization: `Bearer ${made.json().token}` },
      payload: {} as never,
    });
    // ★ Money leaving the merchant's account is not an agent capability at any role.
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
    expect(scripted.calls).toEqual([]);
    expect((await read(id)).refundedMinor).toBe(0);
  });
});

describe('a refund the provider reports itself (issued in their dashboard)', () => {
  const hook = (body: Record<string, unknown>) => {
    const raw = JSON.stringify(body);
    return h.app.inject({
      method: 'POST', url: `/pay/${projectId}/webhook/mock`,
      headers: { 'content-type': 'application/json', 'x-mock-signature': sign(raw) }, payload: raw,
    });
  };

  it('★★ a PARTIAL refund event does not mark the whole order refunded', async () => {
    const id = await paidOrder();
    const res = await hook({ event_id: 'ev_r1', session_id: 'sess_1', type: 'session.refunded', amount: 500, currency: 'EUR' });
    expect(res.statusCode).toBe(200);
    const row = await read(id);
    // ★ Marking this `refunded` would tell the shop it owes nothing more and hide the other 15.00.
    expect(row.status).toBe('partially_refunded');
    expect(row.refundedMinor).toBe(500);
  });

  it('an event for the full amount settles it as refunded', async () => {
    const id = await paidOrder();
    await hook({ event_id: 'ev_r2', session_id: 'sess_1', type: 'session.refunded', amount: 2000, currency: 'EUR' });
    const row = await read(id);
    expect(row.status).toBe('refunded');
    expect(row.refundedMinor).toBe(2000);
  });

  it('an event with no amount means the whole outstanding balance', async () => {
    const id = await paidOrder();
    await hook({ event_id: 'ev_r3', session_id: 'sess_1', type: 'session.refunded' });
    const row = await read(id);
    expect(row.status).toBe('refunded');
    expect(row.refundedMinor).toBe(2000);
  });

  it('★ a repeated event cannot drive the balance past the order', async () => {
    const id = await paidOrder();
    await hook({ event_id: 'ev_r4', session_id: 'sess_1', type: 'session.refunded', amount: 2000, currency: 'EUR' });
    await hook({ event_id: 'ev_r5', session_id: 'sess_1', type: 'session.refunded', amount: 2000, currency: 'EUR' });
    const row = await read(id);
    expect(row.refundedMinor).toBe(2000);
    expect(row.status).toBe('refunded');
  });

  it('★ a dashboard refund then an operator refund cannot exceed the order', async () => {
    const id = await paidOrder();
    await hook({ event_id: 'ev_r6', session_id: 'sess_1', type: 'session.refunded', amount: 1400, currency: 'EUR' });
    scripted.calls.length = 0;
    const over = await refund(id, { amountMinor: 1000 });
    expect(over.statusCode).toBe(409);
    expect(over.json().outstandingMinor).toBe(600);
    expect(scripted.calls).toEqual([]);
  });
});

describe('★★ the claim itself, under an interleaving no route can produce', () => {
  it('two overlapping claims for the full amount: one wins, and the balance is not doubled', async () => {
    const { ShopTransactionRepository } = await import('../src/repo/shop-transactions.js');
    const repo = new ShopTransactionRepository(h.db);
    const txn = await repo.create({
      projectId, channelKey: 'pay', gatewayId: 'mock', mode: 'test', currency: 'EUR',
      amounts: { subtotalMinor: 2000, shippingMinor: 0, taxMinor: 0, totalMinor: 2000 },
      lines: [{ sku: 'mug', name: 'Mug', unitMinor: 2000, qty: 1, lineMinor: 2000 }],
      buyer: {}, catalogDigest: 'c', owesNotification: false,
    });
    await repo.advance(txn.id, 'paid');

    // ★★ NO AWAIT BETWEEN THEM. Both calls read before either writes — exactly the window a
    // read-then-write claim leaves open. Measured: with the balance check taken out of the UPDATE's
    // WHERE, both win and `refundedMinor` lands on 4000, i.e. twice the order refunded.
    const [a, b] = await Promise.all([
      repo.claimRefund(projectId, txn.id, 2000),
      repo.claimRefund(projectId, txn.id, 2000),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await repo.byId(projectId, txn.id))?.refundedMinor).toBe(2000);
  });

  it('★ concurrent PARTIALS cannot sum past the order either', async () => {
    const { ShopTransactionRepository } = await import('../src/repo/shop-transactions.js');
    const repo = new ShopTransactionRepository(h.db);
    const txn = await repo.create({
      projectId, channelKey: 'pay', gatewayId: 'mock', mode: 'test', currency: 'EUR',
      amounts: { subtotalMinor: 1000, shippingMinor: 0, taxMinor: 0, totalMinor: 1000 },
      lines: [{ sku: 'mug', name: 'Mug', unitMinor: 1000, qty: 1, lineMinor: 1000 }],
      buyer: {}, catalogDigest: 'c', owesNotification: false,
    });
    await repo.advance(txn.id, 'paid');
    // Four claims of 400 against a 1000 order: at most two can be right.
    const results = await Promise.all([400, 400, 400, 400].map((amt) => repo.claimRefund(projectId, txn.id, amt)));
    const won = results.filter((r) => r.ok).length;
    expect(won).toBe(2);
    expect((await repo.byId(projectId, txn.id))?.refundedMinor).toBe(800);
  });
});

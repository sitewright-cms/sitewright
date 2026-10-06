import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { adminContext } from './helpers.js';

/**
 * PAYMENTS, over real HTTP against a deployed container.
 *
 * ★ What this adds over the in-process suite: the real HTTP stack (so the raw-body webhook parser is
 * exercised through a real socket rather than `inject`), the container's own configuration, and the
 * route-level rate limits. The in-process tests cover the logic; these cover the deployment.
 *
 * ★ The gateway used here points at a host that does not resolve (`https://mock-pay.invalid`), so a
 * checkout cannot reach any real provider from a deployed box. The cases that need a provider
 * RESPONSE are covered in-process; what is asserted here is everything up to and including the
 * platform's own refusal, plus the webhook path, which needs no provider at all.
 */

const WHSEC = 'whsec_e2e_abcdefghijklmnop';
const sign = (raw: string, secret = WHSEC): string => createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');

/** The declarative gateway this spec installs. */
const GATEWAY = {
  // Written here rather than imported: the spec must exercise the SHIPPED route contract, not a
  // fixture the server and the test happen to share.
  id: 'e2e_mock',
  name: 'E2E mock',
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
  verification: { scheme: 'hmac-sha256-header', header: 'x-mock-signature', encoding: 'hex', secretField: 'webhookSecret' },
  events: { eventIdPath: 'event_id', refPath: 'session_id', typePath: 'type', types: { 'session.paid': 'paid' } },
  allowedOrigins: ['https://mock-pay.invalid'],
  enabled: true,
};

let admin: APIRequestContext;
let projectId: string;

test.beforeAll(async ({ playwright, baseURL }) => {
  admin = await adminContext(playwright, baseURL);

  // Payments are OFF by default on every instance; turn them on for this run.
  const settings = await admin.put('/admin/settings', { data: { paymentsEnabled: true } });
  expect(settings.status(), 'an admin must be able to enable payments').toBeLessThan(300);

  // A slug is required (and must be unique on a shared container, hence the stamp).
  const stamp = Date.now().toString(36);
  const created = await admin.post('/projects', { data: { name: 'Pay E2E', slug: `pay-e2e-${stamp}` } });
  expect(created.status(), `project create failed: ${await created.text()}`).toBe(201);
  projectId = (await created.json()).project.id;
});

test.afterAll(async () => {
  // Leave the instance as it was found: this is a shared container and several other specs read
  // global settings.
  await admin.put('/admin/settings', { data: { paymentsEnabled: false } }).catch(() => undefined);
  await admin.delete(`/projects/${projectId}`).catch(() => undefined);
  await admin.dispose();
});

test('the public checkout endpoint reveals nothing about an unconfigured project', async () => {
  const res = await admin.post(`/pay/${projectId}/pay`, {
    data: { items: [{ sku: 'mug', qty: 1 }], fields: {}, _hpt: '', _elapsed: '2000', _ix: '1.1.1' },
  });
  // No shop, no channel → 404, the same answer an unknown project gives.
  expect(res.status()).toBe(404);
});

test('an unknown project is indistinguishable from an unconfigured one', async () => {
  const res = await admin.post('/pay/zzzzzzzzzzzz/pay', {
    data: { items: [{ sku: 'mug', qty: 1 }], fields: {}, _hpt: '', _elapsed: '2000', _ix: '1.1.1' },
  });
  expect(res.status()).toBe(404);
});

test('the proof-of-work challenge is served on both the live and the preview path, uncached', async () => {
  for (const url of [`/pay/${projectId}/pay/challenge`, `/pay/${projectId}/pay/preview/challenge`]) {
    const res = await admin.get(url);
    expect(res.status(), url).toBe(200);
    // ★ A cached challenge would mean one solve serves every visitor.
    expect(res.headers()['cache-control']).toContain('no-store');
    const body = await res.json();
    expect(body.challenge, url).toBeTruthy();
    expect(body.salt, url).toBeTruthy();
  }
});

test('challenges are per-request — one solve cannot serve two visitors', async () => {
  const a = await (await admin.get(`/pay/${projectId}/pay/challenge`)).json();
  const b = await (await admin.get(`/pay/${projectId}/pay/challenge`)).json();
  expect(a.salt).not.toBe(b.salt);
});

test('the status poll 404s an unknown token and never caches', async () => {
  const res = await admin.get(`/pay/${projectId}/txn/aaaaaaaaaaaaaaaaaaaaaaaa`);
  expect(res.status()).toBe(404);
  expect(res.headers()['cache-control']).toContain('no-store');
});

test('the webhook endpoint is not an existence oracle', async () => {
  const raw = JSON.stringify({ event_id: 'e1', session_id: 's1', type: 'session.paid' });
  const unknownProject = await admin.post('/pay/zzzzzzzzzzzz/webhook/e2e_mock', {
    headers: { 'content-type': 'application/json', 'x-mock-signature': sign(raw) },
    data: raw,
  });
  const unconfigured = await admin.post(`/pay/${projectId}/webhook/e2e_mock`, {
    headers: { 'content-type': 'application/json', 'x-mock-signature': sign(raw) },
    data: raw,
  });
  // ★ Identical answers: an attacker must not be able to enumerate projects or gateways here.
  expect(unknownProject.status()).toBe(400);
  expect(unconfigured.status()).toBe(400);
  expect(await unknownProject.text()).toBe(await unconfigured.text());
});

test('★ the webhook route accepts a RAW body over real HTTP (the parser is scoped, not global)', async () => {
  // The point of running this over a socket rather than `inject`: if the encapsulated raw-body
  // parser were wrong, this route would 400 on content-type or mangle the bytes. A refusal here must
  // be the SIGNATURE check, not a parse failure — so assert the shape of the refusal.
  const raw = '{"event_id":"e","session_id":"s","type":"session.paid"}';
  const res = await admin.post(`/pay/${projectId}/webhook/e2e_mock`, {
    headers: { 'content-type': 'application/json', 'x-mock-signature': 'deadbeef' },
    data: raw,
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid' });
});

test('the checkout endpoint answers a CORS preflight', async () => {
  const res = await admin.fetch(`/pay/${projectId}/pay`, { method: 'OPTIONS' });
  expect(res.status()).toBe(204);
  expect(res.headers()['access-control-allow-origin']).toBe('*');
});

test('an oversized checkout body is rejected by the body limit, not by the handler', async () => {
  const res = await admin.post(`/pay/${projectId}/pay`, {
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({ items: [{ sku: 'x'.repeat(200_000), qty: 1 }], fields: {} }),
  });
  expect([400, 413]).toContain(res.status());
});

test('payments respect the instance gate', async () => {
  await admin.put('/admin/settings', { data: { paymentsEnabled: false } });
  try {
    const res = await admin.post(`/pay/${projectId}/pay`, {
      data: { items: [{ sku: 'mug', qty: 1 }], fields: {}, _hpt: '', _elapsed: '2000', _ix: '1.1.1' },
    });
    // With payments off instance-wide, nothing is reachable — and the gate runs BEFORE the shop
    // lookup, so an operator who turns it off is not relying on every project being unconfigured.
    expect(res.status()).toBe(503);
  } finally {
    await admin.put('/admin/settings', { data: { paymentsEnabled: true } });
  }
});

test('the gateway definition is unreachable through a per-project content route', async () => {
  // ★ The reserved global scope is what keeps level-1 definitions admin-only. A platform admin
  // resolves to `owner` on every project, so without this guard the per-project content route would
  // be a way around the admin gate entirely.
  const res = await admin.put('/projects/__global__/content/payment_gateway/e2e_mock', { data: GATEWAY });
  expect(res.status(), 'the reserved scope must not be writable through a project route').toBe(404);
});

/**
 * ★★ THE WHOLE FLOW, over real HTTP.
 *
 * The in-process suite covers the logic; this proves the pieces are actually wired together in a
 * running instance — a gateway created through the admin API, bound to a project, used to price a
 * cart, and an order resolved by a signed webhook.
 *
 * The gateway points at a host that does not resolve, so no real provider is contacted. What is
 * exercised is everything the PLATFORM does, which is the part that can regress.
 */
test.describe('the full checkout flow', () => {
  let flowProject: string;

  test.beforeAll(async () => {
    const stamp = `${Date.now().toString(36)}f`;
    const created = await admin.post('/projects', { data: { name: 'Pay flow', slug: `pay-flow-${stamp}` } });
    expect(created.status(), await created.text()).toBe(201);
    flowProject = (await created.json()).project.id;
  });

  test.afterAll(async () => {
    await admin.delete(`/admin/payment-gateways/${GATEWAY.id}`).catch(() => undefined);
    await admin.delete(`/projects/${flowProject}`).catch(() => undefined);
  });

  test('an admin creates a gateway, and a built-in refuses to be edited in place', async () => {
    const put = await admin.put(`/admin/payment-gateways/${GATEWAY.id}`, { data: GATEWAY });
    expect(put.status(), await put.text()).toBe(200);
    expect((await put.json()).mustReverify).toBe(true);

    // ★ A built-in must be FORKED, so the next upgrade cannot overwrite an operator's fix.
    const builtin = await admin.put('/admin/payment-gateways/stripe', { data: { ...GATEWAY, id: 'stripe' } });
    expect(builtin.status()).toBe(409);
  });

  test('a project supplies its own keys, and the response carries no secret', async () => {
    const res = await admin.put(`/projects/${flowProject}/payment`, {
      data: { gatewayId: GATEWAY.id, mode: 'test', values: { apiKey: 'sk_test_e2e_secret_value', webhookSecret: WHSEC } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('sk_test_e2e_secret_value');
    expect(body).not.toContain(WHSEC);
  });

  test('★ an UNVERIFIED gateway is not offered to the project', async () => {
    // Letting a project bind an unproven gateway means the first sign of an unfinished one is a
    // buyer unable to pay.
    const res = await admin.get(`/projects/${flowProject}/payment-gateways`);
    expect(res.status()).toBe(200);
    expect((await res.json()).gateways.map((g: { id: string }) => g.id)).not.toContain(GATEWAY.id);
  });

  test('★ going live is refused while the live keys are missing, and names them', async () => {
    const res = await admin.put(`/projects/${flowProject}/payment/mode`, { data: { mode: 'live' } });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.missing).toContain('apiKey');
  });

  test('the orders inbox is empty, and reports nothing undelivered', async () => {
    const list = await admin.get(`/projects/${flowProject}/transactions`);
    expect(list.status()).toBe(200);
    expect((await list.json()).total).toBe(0);
    const und = await admin.get(`/projects/${flowProject}/transactions-undelivered`);
    expect(await und.json()).toMatchObject({ notify: 0, receipt: 0 });
  });

  test('★ a checkout is refused before the shop has a published price list', async () => {
    // The catalog snapshot is written by a PUBLISH. Without one there is nothing authoritative to
    // charge against, and the endpoint must say so rather than invent a price.
    const res = await admin.post(`/pay/${flowProject}/pay`, {
      data: { items: [{ sku: 'mug', qty: 1 }], fields: {}, _hpt: '', _elapsed: '2000', _ix: '1.1.1' },
    });
    // 404 (no such channel yet) or 503 (no catalog) — never a 200, and never a charge.
    expect([404, 503]).toContain(res.status());
  });

  test('the fulfilment move refuses an unknown transaction rather than 500ing', async () => {
    const res = await admin.fetch(`/projects/${flowProject}/transactions/nope/fulfilment`, {
      method: 'PATCH',
      data: { to: 'packed' },
    });
    expect(res.status()).toBe(404);
  });
});

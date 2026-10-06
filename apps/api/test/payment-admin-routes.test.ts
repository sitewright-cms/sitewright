import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { content, instanceSettings, INSTANCE_SETTINGS_ID } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';

const KEY = Buffer.alloc(32, 7);
let scripted: Array<{ ok?: boolean; status?: number; body: unknown }>;
let calls: string[];

function makeFetch() {
  return async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push(`${init.method} ${url}`);
    const r = scripted.shift() ?? { body: { id: 'sess', url: 'https://mock-pay.invalid/s/1' } };
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => JSON.stringify(r.body) };
  };
}

let h: Harness;
let admin: TestClient;
let member: TestClient;
let projectId: string;

/** A valid custom gateway definition — everything the input schema demands. */
const GATEWAY = {
  name: 'Acme Pay',
  apiBase: { test: 'https://mock-pay.invalid', live: 'https://mock-pay.invalid' },
  auth: { kind: 'bearer', secretField: 'apiKey' },
  credentialFields: [
    { key: 'apiKey', label: 'API key', kind: 'secret', required: true, perMode: true },
    { key: 'webhookSecret', label: 'Webhook secret', kind: 'secret', required: true, perMode: true },
  ],
  checkout: {
    request: { method: 'POST', path: '/sessions', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}' } },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'webhookSecret' },
  events: { refPath: 'id', types: {}, defaultKind: 'paid' },
  allowedOrigins: ['https://mock-pay.invalid'],
  enabled: true,
};

beforeEach(async () => {
  scripted = [];
  calls = [];
  h = await makeHarness({ encryptionKey: KEY, publicUrl: 'https://sw.test', paymentFetch: makeFetch() });
  admin = await h.signup({ admin: true });
  member = await h.signup();
  projectId = await admin.createProject('Shop', 'shop');
  await ensureGlobalProject(h.db);
  const data = { formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false }, paymentsEnabled: true };
  await h.db
    .insert(instanceSettings)
    .values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: new Date() } });
});

afterEach(async () => {
  await h?.close();
});

describe('level 1 — gateway definitions are instance-admin only', () => {
  it('an admin can list, and sees the built-ins', async () => {
    const res = await admin.get('/admin/payment-gateways');
    expect(res.statusCode).toBe(200);
    const ids = res.json().gateways.map((g: { id: string }) => g.id).sort();
    expect(ids).toEqual(['mock', 'mollie', 'paypal', 'stripe']);
    expect(res.json().gateways.every((g: { builtin: boolean }) => g.builtin)).toBe(true);
  });

  it('★ a non-admin project member is refused every level-1 operation', async () => {
    for (const res of [
      await member.get('/admin/payment-gateways'),
      await member.put('/admin/payment-gateways/acme', GATEWAY),
      await member.post('/admin/payment-gateways/stripe/fork', { id: 'stripe_eu' }),
      await member.del('/admin/payment-gateways/acme'),
    ]) {
      expect(res.statusCode).toBe(403);
    }
  });

  it('creates, updates and deletes a custom gateway', async () => {
    expect((await admin.put('/admin/payment-gateways/acme', GATEWAY)).statusCode).toBe(200);
    const listed = (await admin.get('/admin/payment-gateways')).json().gateways;
    expect(listed.find((g: { id: string }) => g.id === 'acme')).toMatchObject({ name: 'Acme Pay', builtin: false });
    expect((await admin.del('/admin/payment-gateways/acme')).statusCode).toBe(204);
    expect((await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme')).toBeUndefined();
  });

  it('★ a BUILT-IN cannot be edited in place — it must be forked', async () => {
    // Otherwise the next upgrade silently overwrites an operator's fix, and there is no longer a
    // shipped reference to compare against.
    const res = await admin.put('/admin/payment-gateways/stripe', { ...GATEWAY, name: 'Mine' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ forkable: true });
  });

  it('forks a built-in into an editable, disabled, unverified copy', async () => {
    const res = await admin.post('/admin/payment-gateways/stripe/fork', { id: 'stripe_eu', name: 'Stripe EU' });
    expect(res.statusCode).toBe(201);
    expect(res.json().gateway).toMatchObject({ id: 'stripe_eu', forkedFrom: 'stripe', enabled: false, verified: false });
    // The built-in is untouched.
    const listed = (await admin.get('/admin/payment-gateways')).json().gateways;
    expect(listed.find((g: { id: string }) => g.id === 'stripe')).toMatchObject({ builtin: true });
  });

  it('refuses a fork onto an id that already exists', async () => {
    await admin.post('/admin/payment-gateways/stripe/fork', { id: 'stripe_eu' });
    expect((await admin.post('/admin/payment-gateways/stripe/fork', { id: 'stripe_eu' })).statusCode).toBe(409);
    expect((await admin.post('/admin/payment-gateways/stripe/fork', { id: 'mollie' })).statusCode).toBe(409);
  });

  it('rejects a definition the input schema refuses, naming nothing sensitive', async () => {
    const bad = { ...GATEWAY, allowedOrigins: [] };
    expect((await admin.put('/admin/payment-gateways/acme', bad)).statusCode).toBe(400);
    const outside = { ...GATEWAY, allowedOrigins: ['https://elsewhere.test'] };
    expect((await admin.put('/admin/payment-gateways/acme', outside)).statusCode).toBe(400);
  });

  it('★ an EDIT clears `verified` and says so', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    const res = await admin.put('/admin/payment-gateways/acme', { ...GATEWAY, name: 'Acme v2' });
    // An operator who just edited a live gateway needs to know it must be re-proven.
    expect(res.json()).toMatchObject({ mustReverify: true });
    expect(res.json().gateway.verified).toBe(false);
  });
});

describe('★★ the dry run is the only thing that marks a gateway verified', () => {
  /** Creates the gateway and binds the project to it with test credentials. */
  async function configure() {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    await admin.inject({
      method: 'PUT',
      url: `/projects/${projectId}/payment`,
      payload: { gatewayId: 'acme', mode: 'test', values: { apiKey: 'sk_test_x', webhookSecret: 'whsec_x' } },
    });
  }

  it('performs a REAL test-mode checkout and flips the flag', async () => {
    await configure();
    scripted.push({ body: { id: 'sess_v', url: 'https://mock-pay.invalid/s/v' } });
    const res = await admin.post('/admin/payment-gateways/acme/verify', { projectId, mode: 'test' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verified: true, redirectUrl: 'https://mock-pay.invalid/s/v' });
    // A template can be syntactically perfect and still produce a request the provider rejects; the
    // only way to know is to send one.
    expect(calls).toContain('POST https://mock-pay.invalid/sessions');
    const gw = (await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme');
    expect(gw.verified).toBe(true);
  });

  it('★ REFUSES to verify in live mode — proving a gateway must never take a real payment', async () => {
    await configure();
    const res = await admin.post('/admin/payment-gateways/acme/verify', { projectId, mode: 'live' });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('does NOT flip the flag when the provider rejects the request', async () => {
    await configure();
    scripted.push({ ok: false, status: 400, body: { error: 'bad template' } });
    const res = await admin.post('/admin/payment-gateways/acme/verify', { projectId, mode: 'test' });
    expect(res.statusCode).toBe(422);
    expect(res.json().verified).toBe(false);
    const gw = (await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme');
    expect(gw.verified).toBe(false);
  });

  it('refuses when the named project has no credentials for the gateway', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    const res = await admin.post('/admin/payment-gateways/acme/verify', { projectId, mode: 'test' });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('not-configured');
  });
});

describe('level 2 — a project’s own credentials', () => {
  beforeEach(async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
  });

  it('★ is SESSION-ONLY — not even content:write reaches it', async () => {
    // An agent that can mint a live key into a project can redirect that project's revenue. A human
    // with the writer role sets payment credentials, in a browser.
    const created = await admin.post(`/projects/${projectId}/api-keys`, {
      name: 'agent',
      role: 'owner',
      expiresInDays: 30,
      capabilities: ['content:read', 'content:write'],
    });
    expect(created.statusCode).toBe(201);
    const token = created.json().token as string;
    for (const req of [
      { method: 'GET' as const, url: `/projects/${projectId}/payment` },
      { method: 'PUT' as const, url: `/projects/${projectId}/payment`, payload: { gatewayId: 'acme', mode: 'test', values: {} } },
      { method: 'PUT' as const, url: `/projects/${projectId}/payment/mode`, payload: { mode: 'live' } },
    ]) {
      const res = await h.app.inject({ ...req, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode, req.url).toBe(403);
    }
  });

  it('saves credentials and returns a MASK, never the value', async () => {
    const res = await admin.put(`/projects/${projectId}/payment`, {
      gatewayId: 'acme',
      mode: 'test',
      values: { apiKey: 'sk_test_abcdef123456', webhookSecret: 'whsec_abcdef123456' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('abcdef123456');
    expect(res.json().binding.complete).toBe(true);
  });

  it('surfaces the webhook URL to paste into the provider dashboard', async () => {
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
    const res = await admin.get(`/projects/${projectId}/payment`);
    expect(res.json().webhookUrl).toBe(`https://sw.test/pay/${projectId}/webhook/acme`);
  });

  it('★ REFUSES to go live while the live credentials are incomplete, and names what is missing', async () => {
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
    const res = await admin.put(`/projects/${projectId}/payment/mode`, { mode: 'live' });
    expect(res.statusCode).toBe(409);
    expect(res.json().missing.sort()).toEqual(['apiKey', 'webhookSecret']);
  });

  it('allows going live once the live credentials exist', async () => {
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'live', values: { apiKey: 'A', webhookSecret: 'B' } });
    expect((await admin.put(`/projects/${projectId}/payment/mode`, { mode: 'live' })).statusCode).toBe(200);
  });

  it('★ only ENABLED and VERIFIED gateways are offered to a project', async () => {
    // Letting a project bind an unproven gateway means the first sign of an unfinished one is a
    // buyer unable to pay.
    let offered = (await admin.get(`/projects/${projectId}/payment-gateways`)).json().gateways;
    expect(offered).toHaveLength(0);
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
    scripted.push({ body: { id: 's', url: 'https://mock-pay.invalid/s' } });
    await admin.post('/admin/payment-gateways/acme/verify', { projectId, mode: 'test' });
    offered = (await admin.get(`/projects/${projectId}/payment-gateways`)).json().gateways;
    expect(offered.map((g: { id: string }) => g.id)).toEqual(['acme']);
    // ★ And the offer carries public metadata only — no templates, no origins, no verification.
    const json = JSON.stringify(offered);
    for (const leak of ['allowedOrigins', 'apiBase', 'verification', 'checkout', 'auth']) expect(json, leak).not.toContain(leak);
  });

  it('refuses credentials for an undeclared field', async () => {
    const res = await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { bogus: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().details)).toContain('not a field this gateway declares');
  });

  it('a project member who is not a writer is refused', async () => {
    const other = await h.signup();
    expect((await other.get(`/projects/${projectId}/payment`)).statusCode).toBeGreaterThanOrEqual(403);
  });
});

describe('★ the gateway record is never reachable through the generic content API', () => {
  it('refuses both payment kinds on the member-accessible route', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    for (const kind of ['payment_gateway', 'project_payment']) {
      const read = await admin.get(`/projects/${projectId}/content/${kind}`);
      const write = await admin.put(`/projects/${projectId}/content/${kind}/acme`, GATEWAY);
      // A credential envelope must not be reachable by anything holding content:read.
      expect(read.statusCode, kind).toBeGreaterThanOrEqual(400);
      expect(write.statusCode, kind).toBeGreaterThanOrEqual(400);
    }
  });

  it('the stored definition really does live under the reserved global scope', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    const [row] = await h.db
      .select()
      .from(content)
      .where(and(eq(content.kind, 'payment_gateway'), eq(content.entityId, 'acme')));
    expect(row?.projectId).toBe(GLOBAL_SCOPE_ID);
  });
});

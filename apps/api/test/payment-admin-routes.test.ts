import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { content, instanceSettings, INSTANCE_SETTINGS_ID, shopTransactions } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';

const KEY = Buffer.alloc(32, 7);
let scripted: Array<{ ok?: boolean; status?: number; body: unknown }>;
let calls: string[];
/** Runs ONCE inside the next provider call — something happening while a request is in flight. */
let duringNextCall: (() => Promise<void>) | null = null;

function makeFetch() {
  return async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push(`${init.method} ${url}`);
    const during = duringNextCall;
    duringNextCall = null;
    if (during) await during();
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
  duringNextCall = null;
  await boot();
});

/** A harness with payments on. `scripted: false` keeps the app's OWN provider transport. */
async function boot(scriptedProvider = true): Promise<void> {
  h = await makeHarness({ encryptionKey: KEY, publicUrl: 'https://sw.test', ...(scriptedProvider ? { paymentFetch: makeFetch() } : {}) });
  admin = await h.signup({ admin: true });
  member = await h.signup();
  projectId = await admin.createProject('Shop', 'shop');
  await ensureGlobalProject(h.db);
  const data = { formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false }, paymentsEnabled: true };
  await h.db
    .insert(instanceSettings)
    .values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: new Date() } });
}

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

  it('★ names what the platform SHIPS for a built-in id — the one reference no author wrote', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    const listed = (await admin.get('/admin/payment-gateways')).json().gateways as Array<{ id: string; shipped?: { name: string; apiBase: { live: string }; allowedOrigins: string[] } }>;
    expect(listed.find((g) => g.id === 'stripe')?.shipped).toMatchObject({ name: 'Stripe Checkout', apiBase: { live: 'https://api.stripe.com' } });
    expect(listed.find((g) => g.id === 'acme')).not.toHaveProperty('shipped');
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
    const res = await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
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
    const res = await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'live' });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('does NOT flip the flag when the provider rejects the request', async () => {
    await configure();
    scripted.push({ ok: false, status: 400, body: { error: 'bad template' } });
    const res = await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
    expect(res.statusCode).toBe(422);
    expect(res.json().verified).toBe(false);
    const gw = (await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme');
    expect(gw.verified).toBe(false);
  });

  it('★★ the app’s own transport refuses a private address — and says so', async () => {
    // No scripted provider: this is the transport the deployed app calls with. The stored record is
    // pointed at a private LITERAL behind the input lint's back (as a name resolving there would be),
    // so the refusal needs no DNS and cannot reach the network.
    await h.close();
    await boot(false);
    await configure();
    const where = and(eq(content.kind, 'payment_gateway'), eq(content.entityId, 'acme'));
    const [row] = await h.db.select().from(content).where(where);
    // Loopback's closed discard port: should this guard ever regress, the request still goes nowhere.
    const internal = 'https://127.0.0.1:9';
    await h.db.update(content).set({ data: { ...(row!.data as object), apiBase: { test: internal, live: internal }, allowedOrigins: [internal] } }).where(where);
    const res = await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ verified: false, reason: 'config', message: expect.stringContaining('did not resolve to a public internet address') });
  });

  it('refuses when the named project has no credentials for the gateway', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    const res = await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
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
      { method: 'DELETE' as const, url: `/projects/${projectId}/payment/acme` },
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
    await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
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

  describe('★ several providers in one project', () => {
    beforeEach(async () => {
      await admin.put('/admin/payment-gateways/beta', { ...GATEWAY, name: 'Beta Pay' });
      await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
      await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'beta', mode: 'test', values: { apiKey: 'c', webhookSecret: 'd' } });
    });

    it('lists every provider with its own webhook URL — saving one never replaced the other', async () => {
      const res = (await admin.get(`/projects/${projectId}/payment`)).json() as { bindings: Array<{ gatewayId: string; webhookUrl: string; complete: boolean }> };
      expect(res.bindings.map((b) => [b.gatewayId, b.webhookUrl, b.complete])).toEqual([
        ['acme', `https://sw.test/pay/${projectId}/webhook/acme`, true],
        ['beta', `https://sw.test/pay/${projectId}/webhook/beta`, true],
      ]);
    });

    it('switches ONE provider live — and refuses to guess which when none is named', async () => {
      expect((await admin.put(`/projects/${projectId}/payment/mode`, { mode: 'live' })).statusCode).toBe(400);
      await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'beta', mode: 'live', values: { apiKey: 'C', webhookSecret: 'D' } });
      expect((await admin.put(`/projects/${projectId}/payment/mode`, { mode: 'live', gatewayId: 'beta' })).statusCode).toBe(200);
      const modes = ((await admin.get(`/projects/${projectId}/payment`)).json() as { bindings: Array<{ gatewayId: string; mode: string }> }).bindings;
      expect(modes.map((b) => [b.gatewayId, b.mode])).toEqual([['acme', 'test'], ['beta', 'live']]);
    });

    it('★ refuses to remove a provider while an order through it is still open', async () => {
      await h.db.insert(shopTransactions).values({
        id: 'txn_open', projectId, channelKey: 'pay', gatewayId: 'acme', mode: 'test', status: 'pending', currency: 'EUR',
        subtotalMinor: 100, totalMinor: 100, lines: [], buyer: {}, catalogDigest: 'd', publicToken: 'tok_open', createdAt: new Date(), updatedAt: new Date(),
      } as never);
      const res = await h.app.inject({ method: 'DELETE', url: `/projects/${projectId}/payment/acme`, cookies: { sw_session: admin.token } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain('still open');
      await h.db.update(shopTransactions).set({ status: 'expired' }).where(eq(shopTransactions.id, 'txn_open'));
      expect((await h.app.inject({ method: 'DELETE', url: `/projects/${projectId}/payment/acme`, cookies: { sw_session: admin.token } })).statusCode).toBe(204);
    });

    it('"settings" is not a gateway id — it is where older projects kept their one binding', async () => {
      expect((await admin.put('/admin/payment-gateways/settings', { ...GATEWAY, name: 'Clash' })).statusCode).toBe(400);
    });

    it('removes one provider — refused while a checkout channel still charges through it', async () => {
      await admin.project(projectId).putContent('settings', 'settings', {
        identity: { name: 'Shop', colors: { primary: '#0a7' } },
        website: { shop: { enabled: true, currency: { code: 'EUR' }, channels: [{ kind: 'checkout', key: 'pay', gatewayId: 'beta', email: 'o@shop.test' }] } },
        settings: {},
      });
      const refused = await h.app.inject({ method: 'DELETE', url: `/projects/${projectId}/payment/beta`, cookies: { sw_session: admin.token } });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error).toContain('"pay"');
      const removed = await h.app.inject({ method: 'DELETE', url: `/projects/${projectId}/payment/acme`, cookies: { sw_session: admin.token } });
      expect(removed.statusCode).toBe(204);
      const left = ((await admin.get(`/projects/${projectId}/payment`)).json() as { bindings: Array<{ gatewayId: string }> }).bindings;
      expect(left.map((b) => b.gatewayId)).toEqual(['beta']);
      expect((await h.app.inject({ method: 'DELETE', url: `/projects/${projectId}/payment/acme`, cookies: { sw_session: admin.token } })).statusCode).toBe(404);
    });
  });
});

describe('★ what an AGENT may read about a project\'s payments', () => {
  /** A project key the instance admin minted — `content:read` only, no payments capability at all. */
  async function readerToken(): Promise<string> {
    const made = await admin.post(`/projects/${projectId}/api-keys`, { name: 'reader', role: 'owner', expiresInDays: 1, capabilities: ['content:read'] });
    expect(made.statusCode).toBe(201);
    return made.json().token as string;
  }

  beforeEach(async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    await admin.put(`/projects/${projectId}/payment`, {
      gatewayId: 'acme',
      mode: 'test',
      values: { apiKey: 'sk_test_SECRETVALUE1234', webhookSecret: 'whsec_SECRETVALUE5678' },
    });
    scripted.push({ body: { id: 's', url: 'https://mock-pay.invalid/s' } });
    expect((await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' })).statusCode).toBe(200);
    await admin.project(projectId).putContent('settings', 'settings', {
      identity: { name: 'Shop', colors: { primary: '#0a7' } },
      website: {
        shop: {
          enabled: true,
          currency: { code: 'EUR' },
          channels: [
            { kind: 'checkout', key: 'pay', gatewayId: 'acme', email: 'o@shop.test' },
            { kind: 'checkout', key: 'ghost', gatewayId: 'ghost', email: 'o@shop.test' },
          ],
        },
      },
      settings: {},
    });
  });

  it('a content:read token sees each offered provider, how far its keys have got, and what would stop a checkout', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/projects/${projectId}/payment-gateways`, headers: { authorization: `Bearer ${await readerToken()}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { gateways: Array<Record<string, unknown>>; problems: string[] };
    expect(body.gateways).toHaveLength(1);
    expect(body.gateways[0]).toMatchObject({
      id: 'acme',
      webhookUrl: `https://sw.test/pay/${projectId}/webhook/acme`,
      keys: { mode: 'test', test: { complete: true, missing: [] }, live: { complete: false, missing: ['apiKey', 'webhookSecret'] } },
      channels: ['pay'],
    });
    expect(body.problems).toEqual([expect.stringMatching(/checkout channel "ghost" charges through "ghost", which this instance does not offer/)]);
  });

  it('★ and nothing of the keys themselves — no value, no mask, no tail', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/projects/${projectId}/payment-gateways`, headers: { authorization: `Bearer ${await readerToken()}` } });
    for (const leak of ['SECRETVALUE', '1234', '5678', '••••', 'sk_test', 'whsec_', 'display', 'hasValue']) expect(res.body, leak).not.toContain(leak);
    // The credential routes themselves stay closed to the same token.
    const keys = await h.app.inject({ method: 'GET', url: `/projects/${projectId}/payment`, headers: { authorization: `Bearer ${await readerToken()}` } });
    expect(keys.statusCode).toBe(403);
  });

  it('reports no keys as null, and says a person has to enter them', async () => {
    await admin.put('/admin/payment-gateways/beta', { ...GATEWAY, name: 'Beta Pay' });
    // Prove beta from a project that has keys, then look at one that has none.
    const other = await admin.createProject('Other', 'other');
    await admin.put(`/projects/${other}/payment`, { gatewayId: 'beta', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
    scripted.push({ body: { id: 's', url: 'https://mock-pay.invalid/s' } });
    expect((await admin.post(`/projects/${other}/payment/verify`, { gatewayId: 'beta', mode: 'test' })).statusCode).toBe(200);
    await admin.project(projectId).putContent('settings', 'settings', {
      identity: { name: 'Shop', colors: { primary: '#0a7' } },
      website: { shop: { enabled: true, currency: { code: 'EUR' }, channels: [{ kind: 'checkout', key: 'card', gatewayId: 'beta', email: 'o@shop.test' }] } },
      settings: {},
    });
    const body = (await admin.get(`/projects/${projectId}/payment-gateways`)).json() as { gateways: Array<{ id: string; keys: unknown }>; problems: string[] };
    expect(body.gateways.find((g) => g.id === 'beta')?.keys).toBeNull();
    expect(body.problems).toEqual([expect.stringContaining('no keys for "beta" yet')]);
  });
});

describe('★★ an agent may not change a LIVE gateway in place', () => {
  async function providerToken(): Promise<string> {
    const made = await admin.post(`/projects/${projectId}/api-keys`, {
      name: 'provider agent',
      role: 'owner',
      expiresInDays: 1,
      capabilities: ['content:read', 'payments:provider:write'],
    });
    return made.json().token as string;
  }
  const bearer = (token: string, method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    h.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as never } : {}) });

  async function makeLive(): Promise<void> {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
    scripted.push({ body: { id: 's', url: 'https://mock-pay.invalid/s' } });
    expect((await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' })).statusCode).toBe(200);
  }

  it('refuses an edit and a delete of an enabled, proven gateway — and leaves it proven', async () => {
    await makeLive();
    const token = await providerToken();
    const edit = await bearer(token, 'PUT', '/admin/payment-gateways/acme', { ...GATEWAY, apiBase: { test: 'https://evil.invalid', live: 'https://evil.invalid' }, allowedOrigins: ['https://evil.invalid'] });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ forkable: true });
    expect(edit.json().error).toContain('fork_gateway_definition');
    expect((await bearer(token, 'DELETE', '/admin/payment-gateways/acme')).statusCode).toBe(409);
    const still = (await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme');
    expect(still).toMatchObject({ verified: true, enabled: true, apiBase: GATEWAY.apiBase });
  });

  it('★ a MEMBER token is held to the same rule as a project key', async () => {
    await makeLive();
    const minted = await admin.post('/account/member-tokens', {
      name: 'fleet',
      expiresInDays: 1,
      currentPassword: 'Pw-secret-1',
      capabilities: ['content:read', 'payments:provider:write'],
    });
    expect(minted.statusCode).toBe(201);
    const token = minted.json().token as string;
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/acme', { ...GATEWAY, name: 'Member edit' })).statusCode).toBe(409);
    expect((await bearer(token, 'DELETE', '/admin/payment-gateways/acme')).statusCode).toBe(409);
    // …and may still write a new draft, which is what the capability is for.
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/member_draft', GATEWAY)).statusCode).toBe(200);
  });

  it('lets the agent fork it and edit the fork, which carries no live traffic until proven', async () => {
    await makeLive();
    const token = await providerToken();
    expect((await bearer(token, 'POST', '/admin/payment-gateways/acme/fork', { id: 'acme_v2' })).statusCode).toBe(201);
    const edit = await bearer(token, 'PUT', '/admin/payment-gateways/acme_v2', { ...GATEWAY, name: 'Acme v2' });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({ gateway: { verified: false }, mustReverify: true });
    expect((await bearer(token, 'DELETE', '/admin/payment-gateways/acme_v2')).statusCode).toBe(204);
  });

  it('an unproven gateway stays the agent\'s to change — and a person may still edit a live one', async () => {
    const token = await providerToken();
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/draft', GATEWAY)).statusCode).toBe(200);
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/draft', { ...GATEWAY, name: 'Draft 2' })).statusCode).toBe(200);
    await makeLive();
    expect((await admin.put('/admin/payment-gateways/acme', { ...GATEWAY, name: 'Renamed by a person' })).statusCode).toBe(200);
  });
});

describe('★★ once a project holds keys for an id, an agent may not change where they go', () => {
  async function providerToken(): Promise<string> {
    const made = await admin.post(`/projects/${projectId}/api-keys`, { name: 'provider agent', role: 'owner', expiresInDays: 1, capabilities: ['payments:provider:write'] });
    return made.json().token as string;
  }
  const bearer = (token: string, method: 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    h.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as never } : {}) });
  const EVIL = { apiBase: { test: 'https://evil.invalid', live: 'https://evil.invalid' }, allowedOrigins: ['https://evil.invalid'] };

  it('an unused draft is the agent\'s to change freely — destinations included', async () => {
    const token = await providerToken();
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/acme', GATEWAY)).statusCode).toBe(200);
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/acme', { ...GATEWAY, ...EVIL })).statusCode).toBe(200);
  });

  it('★ with keys in a project the definition is the agent\'s no longer — not its hosts, not its templates', async () => {
    const token = await providerToken();
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/acme', GATEWAY)).statusCode).toBe(200);
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'sk_test_real', webhookSecret: 'whsec_real' } });

    // A body tells the provider what to do with the keys — so a template change is refused like a host change.
    const templated = { ...GATEWAY, checkout: { ...GATEWAY.checkout, request: { ...GATEWAY.checkout.request, path: '/v2/sessions' } } };
    for (const change of [templated, { ...GATEWAY, ...EVIL }, { ...GATEWAY, name: 'Renamed' }]) {
      const res = await bearer(token, 'PUT', '/admin/payment-gateways/acme', change);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain('1 project holds keys for "acme"');
    }
    expect((await bearer(token, 'DELETE', '/admin/payment-gateways/acme')).statusCode).toBe(409);
    const stored = (await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme');
    expect(stored).toMatchObject({ name: 'Acme Pay', apiBase: GATEWAY.apiBase, checkout: { request: { path: '/sessions' } } });

    // The iteration loop: once the person removes the keys, the agent may change it again.
    expect((await h.app.inject({ method: 'DELETE', url: `/projects/${projectId}/payment/acme`, cookies: { sw_session: admin.token } })).statusCode).toBe(204);
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/acme', templated)).statusCode).toBe(200);
  });

  it('★ keys outlive a deleted definition — an agent may not re-create or fork onto that id', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'sk_test_real', webhookSecret: 'whsec_real' } });
    expect((await admin.del('/admin/payment-gateways/acme')).statusCode).toBe(204);
    const token = await providerToken();
    const recreate = await bearer(token, 'PUT', '/admin/payment-gateways/acme', { ...GATEWAY, ...EVIL });
    expect(recreate.statusCode).toBe(409);
    expect(recreate.json().error).toContain('Pick a new id');
    expect((await bearer(token, 'PUT', '/admin/payment-gateways/evil_src', { ...GATEWAY, ...EVIL })).statusCode).toBe(200);
    expect((await bearer(token, 'POST', '/admin/payment-gateways/evil_src/fork', { id: 'acme' })).statusCode).toBe(409);
    expect((await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme')).toBeUndefined();
    // A person may: they are the one the keys belong to.
    expect((await admin.put('/admin/payment-gateways/acme', GATEWAY)).statusCode).toBe(200);
  });
});

describe('★ what a TOKEN may do to an order — narrower than a person in the inbox', () => {
  async function agent() {
    const made = await admin.post(`/projects/${projectId}/api-keys`, { name: 'ops agent', role: 'owner', expiresInDays: 1, capabilities: ['content:read', 'content:write'] });
    const token = made.json().token as string;
    return (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
      h.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });
  }

  it('the order row says where each mail stands, so a reader can tell WHICH order owes one', async () => {
    const id = await insertTxn({ seq: 1, values: { notifyState: 'sent', receiptState: 'failed', receiptError: 'mailbox full' } });
    expect((await admin.get(`/projects/${projectId}/transactions/${id}`)).json().transaction).toMatchObject({
      notifyState: 'sent',
      receiptState: 'failed',
      receiptError: 'mailbox full',
    });
  });

  it('★ a token resends only a mail that failed — never one that arrived or is still queued', async () => {
    const call = await agent();
    const id = await insertTxn({ seq: 1, values: { notifyState: 'sent', receiptState: 'failed' } });
    const dup = await call('POST', `/projects/${projectId}/transactions/${id}/resend`, { kind: 'notify' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toContain('"sent", not failed');
    const queued = await insertTxn({ id: 2, seq: 2, values: { receiptState: 'pending' } });
    expect((await call('POST', `/projects/${projectId}/transactions/${queued}/resend`, { kind: 'receipt' })).statusCode).toBe(409);
    expect((await call('POST', `/projects/${projectId}/transactions/${id}/resend`, { kind: 'receipt' })).statusCode).toBe(200);
    const [row] = await h.db.select().from(shopTransactions).where(eq(shopTransactions.id, id));
    expect(row?.notifyState).toBe('sent');
    expect(row?.receiptState).toBe('pending');
    // A person may still resend a delivered one on purpose — the buyer lost it.
    expect((await admin.post(`/projects/${projectId}/transactions/${id}/resend`, { kind: 'notify' })).statusCode).toBe(200);
  });

  it('★ a token moves fulfilment only on a PAID order', async () => {
    const call = await agent();
    const unpaid = await insertTxn({ seq: 1, values: { status: 'pending' } });
    const refused = await call('PATCH', `/projects/${projectId}/transactions/${unpaid}/fulfilment`, { to: 'shipped' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toContain('"pending", not paid');
    const paid = await insertTxn({ id: 2, seq: 2 });
    expect((await call('PATCH', `/projects/${projectId}/transactions/${paid}/fulfilment`, { to: 'shipped', note: 'DHL' })).statusCode).toBe(200);
    expect((await call('PATCH', `/projects/${projectId}/transactions/txn_nope/fulfilment`, { to: 'shipped' })).statusCode).toBe(404);
  });
});

describe('★★ a proof stamps only the definition that was proven', () => {
  it('a definition edited while the dry run was at the provider is NOT marked proven', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    await admin.put(`/projects/${projectId}/payment`, { gatewayId: 'acme', mode: 'test', values: { apiKey: 'a', webhookSecret: 'b' } });
    // The provider call is where the window is: write a new definition while it is in flight.
    scripted.push({ body: { id: 's', url: 'https://mock-pay.invalid/s' } });
    duringNextCall = async () => {
      expect((await admin.put('/admin/payment-gateways/acme', { ...GATEWAY, name: 'Edited mid-proof' })).statusCode).toBe(200);
    };
    const res = await admin.post(`/projects/${projectId}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ verified: false, reason: 'changed' });
    const stored = (await admin.get('/admin/payment-gateways')).json().gateways.find((g: { id: string }) => g.id === 'acme');
    expect(stored).toMatchObject({ name: 'Edited mid-proof', verified: false });
  });
});

describe('★ a gateway definition is not deleted while an order through it is open, anywhere', () => {
  it('refuses with a 409 naming the count, then allows it once the order settled', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    const other = await admin.createProject('Other', 'other-orders');
    await h.db.insert(shopTransactions).values({
      id: 'txn_elsewhere', projectId: other, channelKey: 'pay', gatewayId: 'acme', mode: 'test', status: 'created', currency: 'EUR',
      subtotalMinor: 100, totalMinor: 100, lines: [], buyer: {}, catalogDigest: 'd', publicToken: 'tok_elsewhere', createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const refused = await admin.del('/admin/payment-gateways/acme');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toContain('1 order through "acme" is still open');
    await h.db.update(shopTransactions).set({ status: 'paid' }).where(eq(shopTransactions.id, 'txn_elsewhere'));
    expect((await admin.del('/admin/payment-gateways/acme')).statusCode).toBe(204);
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

// ---- the transactions inbox ---------------------------------------------------------------------
// ★ These five endpoints are the entire data source for the editor's orders inbox. They were the
// untested half of this file, which is how a reader of the coverage data finds them.

/** Inserts one order directly: the inbox reads rows, it does not care how they were created. */
async function insertTxn(over: Partial<Record<string, unknown>> = {}): Promise<string> {
  const id = `txn_${String(over.id ?? Math.abs(Number(over.seq ?? 1)))}`;
  await h.db.insert(shopTransactions).values({
    id,
    projectId,
    channelKey: 'pay',
    gatewayId: 'mock',
    mode: 'test',
    status: 'paid',
    fulfilment: 'new',
    currency: 'EUR',
    subtotalMinor: 1999,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 1999,
    lines: [{ sku: 'mug', name: 'Mug', unitMinor: 1999, qty: 1, lineMinor: 1999 }],
    buyer: { email: 'ada@example.com' },
    catalogDigest: 'cat_1',
    publicToken: `tok_${id}`,
    createdAt: new Date(1_700_000_000_000 + Number(over.seq ?? 1) * 1000),
    updatedAt: new Date(),
    ...(over.values as Record<string, unknown>),
  } as never);
  return id;
}

describe('the transactions inbox', () => {
  it('lists the project orders, newest first, with a total', async () => {
    await insertTxn({ seq: 1 });
    await insertTxn({ id: 2, seq: 2 });
    const res = await admin.get(`/projects/${projectId}/transactions`);
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
    expect(res.json().items).toHaveLength(2);
  });

  it('filters by status and honours limit/offset', async () => {
    await insertTxn({ seq: 1 });
    await insertTxn({ id: 2, seq: 2, values: { status: 'failed' } });
    expect((await admin.get(`/projects/${projectId}/transactions?status=failed`)).json().items).toHaveLength(1);
    expect((await admin.get(`/projects/${projectId}/transactions?limit=1`)).json().items).toHaveLength(1);
    const paged = await admin.get(`/projects/${projectId}/transactions?limit=1&offset=1`);
    expect(paged.json().items).toHaveLength(1);
    expect(paged.json().total).toBe(2);
  });

  it('reads one order by id, and 404s an unknown one', async () => {
    const id = await insertTxn({ seq: 1 });
    const res = await admin.get(`/projects/${projectId}/transactions/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().transaction).toMatchObject({ id, fulfilment: 'new', amounts: { totalMinor: 1999 } });
    expect((await admin.get(`/projects/${projectId}/transactions/txn_nope`)).statusCode).toBe(404);
  });

  it('counts the two undelivered mail kinds SEPARATELY', async () => {
    await insertTxn({ seq: 1, values: { notifyState: 'failed', notifyError: 'smtp refused' } });
    await insertTxn({ id: 2, seq: 2, values: { receiptState: 'pending' } });
    const res = await admin.get(`/projects/${projectId}/transactions-undelivered`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ notify: 1, receipt: 1 });
  });

  it('re-queues one mail kind without touching the other', async () => {
    const id = await insertTxn({ seq: 1, values: { notifyState: 'failed', receiptState: 'failed' } });
    const res = await admin.post(`/projects/${projectId}/transactions/${id}/resend`, { kind: 'notify' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ queued: true, kind: 'notify' });
    const [row] = await h.db.select().from(shopTransactions).where(eq(shopTransactions.id, id));
    expect(row?.notifyState).toBe('pending');
    expect(row?.receiptState).toBe('failed');
    expect((await admin.post(`/projects/${projectId}/transactions/txn_nope/resend`, { kind: 'receipt' })).statusCode).toBe(404);
  });

  it('moves fulfilment forward, and refuses a BACKWARDS move with a 409', async () => {
    const id = await insertTxn({ seq: 1 });
    const ok = await admin.patch(`/projects/${projectId}/transactions/${id}/fulfilment`, { to: 'packed', note: 'boxed' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().transaction).toMatchObject({ fulfilment: 'packed', fulfilmentNote: 'boxed' });
    // `packed` may go to shipped or cancelled — never back to `new`.
    const back = await admin.patch(`/projects/${projectId}/transactions/${id}/fulfilment`, { to: 'new' });
    expect(back.statusCode).toBe(409);
    expect((await admin.patch(`/projects/${projectId}/transactions/txn_nope/fulfilment`, { to: 'packed' })).statusCode).toBe(404);
  });

  it('★ a terminal fulfilment state cannot be moved at all', async () => {
    const id = await insertTxn({ seq: 1, values: { fulfilment: 'done' } });
    for (const to of ['packed', 'shipped', 'cancelled', 'new']) {
      expect((await admin.patch(`/projects/${projectId}/transactions/${id}/fulfilment`, { to })).statusCode, to).toBe(409);
    }
  });

  it('★ a non-member of the project reads nothing from the inbox', async () => {
    const id = await insertTxn({ seq: 1 });
    for (const res of [
      await member.get(`/projects/${projectId}/transactions`),
      await member.get(`/projects/${projectId}/transactions/${id}`),
      await member.get(`/projects/${projectId}/transactions-undelivered`),
      await member.post(`/projects/${projectId}/transactions/${id}/resend`, { kind: 'notify' }),
      await member.patch(`/projects/${projectId}/transactions/${id}/fulfilment`, { to: 'packed' }),
    ]) {
      expect(res.statusCode).toBeGreaterThanOrEqual(403);
    }
  });
});

// ---- the two cross-tenant holes the security review found ---------------------------------------

describe('★★ a dry run can only spend the credentials of a project the caller belongs to', () => {
  it('refuses a project the caller is not a member of', async () => {
    // A second owner, with their own project and their own stored credentials.
    const victim = await h.signup();
    const victimProject = await victim.createProject('Victim', 'victim');
    await admin.put('/admin/payment-gateways/acme', GATEWAY);

    // The attacker here is an INSTANCE ADMIN — the strongest caller the level-1 gate recognises —
    // and must still be refused, because instance admin is not membership of someone's shop.
    const res = await admin.post(`/projects/${victimProject}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
    // ★ And nothing was sent to the provider on the victim's behalf.
    expect(calls).toEqual([]);
  });

  it('★ the route no longer accepts a projectId in the body at all', async () => {
    const victim = await h.signup();
    const victimProject = await victim.createProject('Victim', 'victim');
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    // The old shape: name someone else's project in the body while addressing your own.
    const res = await admin.post(`/projects/${projectId}/payment/verify`, {
      gatewayId: 'acme',
      mode: 'test',
      projectId: victimProject,
    });
    // Whatever this answers, it must never have resolved the VICTIM's credentials — the only
    // project id that can reach `resolveCredentials` is the one in the path.
    expect(res.statusCode).not.toBe(200);
    expect(calls).toEqual([]);
  });

  it('a project writer who is not a gateway author cannot mark a definition verified', async () => {
    await admin.put('/admin/payment-gateways/acme', GATEWAY);
    // `member` is an owner of their OWN project but not an instance admin.
    const theirs = await member.createProject('Theirs', 'theirs');
    const res = await member.post(`/projects/${theirs}/payment/verify`, { gatewayId: 'acme', mode: 'test' });
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
  });
});

describe('★★ `payments:provider:write` is not enough on its own', () => {
  it('a key minted by a non-admin project owner cannot author gateway definitions', async () => {
    // `member` is an owner of their own project, so they may mint a key for it — with any
    // capability. That key must not reach instance-wide gateway definitions.
    const theirs = await member.createProject('Theirs', 'theirs');
    const made = await member.post(`/projects/${theirs}/api-keys`, {
      name: 'agent',
      role: 'owner',
      expiresInDays: 1,
      capabilities: ['content:read', 'content:write', 'payments:provider:write'],
    });
    expect(made.statusCode).toBe(201);
    const token = made.json().token as string;
    expect(token).toBeTruthy();

    const bearer = (method: 'GET' | 'PUT', url: string, payload?: unknown) =>
      h.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as never });

    for (const res of [
      await bearer('GET', '/admin/payment-gateways'),
      await bearer('PUT', '/admin/payment-gateways/evil', GATEWAY),
    ]) {
      expect(res.statusCode).toBeGreaterThanOrEqual(403);
    }
    // The definition really was not written.
    const [row] = await h.db.select().from(content).where(and(eq(content.kind, 'payment_gateway'), eq(content.entityId, 'evil')));
    expect(row).toBeUndefined();
  });

  it("★ the same capability on an ADMIN's key still works — the capability keeps its purpose", async () => {
    const made = await admin.post(`/projects/${projectId}/api-keys`, {
      name: 'admin agent',
      role: 'owner',
      expiresInDays: 1,
      capabilities: ['content:read', 'content:write', 'payments:provider:write'],
    });
    expect(made.statusCode).toBe(201);
    const token = made.json().token as string;
    const res = await h.app.inject({
      method: 'PUT',
      url: '/admin/payment-gateways/agentmade',
      headers: { authorization: `Bearer ${token}` },
      payload: GATEWAY as never,
    });
    expect(res.statusCode).toBe(200);
  });

  it('★ a MEMBER token is held to the same rule: the capability AND an instance-admin owner', async () => {
    const mintMember = async (who: TestClient) => {
      const res = await who.post('/account/member-tokens', {
        name: 'fleet',
        expiresInDays: 1,
        currentPassword: 'Pw-secret-1',
        capabilities: ['content:read', 'content:write', 'payments:provider:write'],
      });
      expect(res.statusCode).toBe(201);
      return res.json().token as string;
    };
    const put = (token: string, id: string) =>
      h.app.inject({ method: 'PUT', url: `/admin/payment-gateways/${id}`, headers: { authorization: `Bearer ${token}` }, payload: GATEWAY as never });

    // A developer is staff, so may hold a member token — but gateway code is an admin's to write.
    await member.createProject('Theirs', 'theirs-member-token');
    const refused = await put(await mintMember(member), 'evilmember');
    expect(refused.statusCode).toBeGreaterThanOrEqual(403);
    const [row] = await h.db.select().from(content).where(and(eq(content.kind, 'payment_gateway'), eq(content.entityId, 'evilmember')));
    expect(row).toBeUndefined();

    expect((await put(await mintMember(admin), 'membermade')).statusCode).toBe(200);
    // …and without the capability an admin's member token is refused like any other bearer.
    const plain = await admin.post('/account/member-tokens', { name: 'plain', expiresInDays: 1, currentPassword: 'Pw-secret-1', capabilities: ['content:read'] });
    expect((await put(plain.json().token as string, 'nocap')).statusCode).toBeGreaterThanOrEqual(403);
  });
});

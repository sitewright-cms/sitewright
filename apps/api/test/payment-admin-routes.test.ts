import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { content, instanceSettings, INSTANCE_SETTINGS_ID, shopTransactions } from '../src/db/schema.js';
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
});

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { projects } from '../src/db/schema.js';
import { ContentRepository } from '../src/repo/content.js';
import { ensureGlobalProject } from '../src/repo/global-library.js';
import { GatewayRepository } from '../src/payments/gateways.js';
import { BUILTIN_GATEWAYS } from '../src/payments/builtin-gateways.js';
import { PaymentGatewayStoredSchema, type PaymentGatewayStored } from '@sitewright/schema';
import type { ProjectContext } from '../src/repo/context.js';

const KEY = Buffer.alloc(32, 7);
const PROJECT = 'p_gw';
let db: Database;
let repo: GatewayRepository;
let ctx: ProjectContext;

beforeEach(async () => {
  db = await makeTestDb();
  await ensureGlobalProject(db);
  await db.insert(projects).values({ id: PROJECT, name: 'GW', slug: 'gw', createdAt: new Date() });
  repo = new GatewayRepository(new ContentRepository(db), KEY);
  ctx = { userId: 'u1', projectId: PROJECT, role: 'owner' };
});

const custom = (over: Partial<PaymentGatewayStored> = {}): PaymentGatewayStored =>
  PaymentGatewayStoredSchema.parse({
    id: 'acme',
    name: 'Acme',
    apiBase: { test: 'https://api.acme.test', live: 'https://api.acme.test' },
    auth: { kind: 'bearer', secretField: 'secretKey' },
    credentialFields: [
      { key: 'secretKey', label: 'Key', kind: 'secret', required: true, perMode: true },
      { key: 'region', label: 'Region', kind: 'choice', required: false, perMode: false, options: ['eu', 'us'] },
    ],
    checkout: { request: { method: 'POST', path: '/s', format: 'json', headers: {} }, refPath: 'id', redirectUrlPath: 'url' },
    verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'secretKey' },
    events: { refPath: 'id', types: {}, defaultKind: 'paid' },
    allowedOrigins: ['https://api.acme.test'],
    enabled: true,
    ...over,
  });

describe('★★ the gateway repository runs through the REAL ContentRepository', () => {
  it('writes and reads a gateway definition — the registration this proves was missing once', async () => {
    // The bug this pins: `payment_gateway` was not in the content-kind SCHEMAS map, so every write
    // threw `unknown content kind` — and the read path swallowed it into an empty list, so the
    // symptom was "no gateways configured" rather than an error. Planting rows directly in the test
    // would have kept passing throughout.
    const written = await repo.put(custom(), 'admin1');
    expect(written.id).toBe('acme');
    const read = await repo.byId('acme');
    expect(read?.gateway.name).toBe('Acme');
    expect(read?.builtin).toBe(false);
  });

  it('★ a broken read PROPAGATES rather than looking like "nothing configured"', async () => {
    // Guards the catch that used to hide the above. A repo pointed at a kind the content layer does
    // not know must throw, not return [].
    const broken = new GatewayRepository(
      { list: async () => { throw new Error('unknown content kind'); } } as never,
      KEY,
    );
    await expect(broken.list()).rejects.toThrow(/unknown content kind/);
  });

  it('lists the built-ins when nothing is stored', async () => {
    const all = await repo.list();
    expect(all.map((g) => g.gateway.id).sort()).toEqual([...BUILTIN_GATEWAYS].map((g) => g.id).sort());
    expect(all.every((g) => g.builtin)).toBe(true);
  });

  it('★ a stored record SHADOWS a built-in of the same id, so an upgrade cannot overwrite a fix', async () => {
    await repo.put(custom({ id: 'stripe', name: 'Our Stripe' }), 'admin1');
    const all = await repo.list();
    const stripe = all.find((g) => g.gateway.id === 'stripe')!;
    expect(stripe.gateway.name).toBe('Our Stripe');
    expect(stripe.builtin).toBe(false);
    // And the list still has exactly one entry per id.
    expect(all.filter((g) => g.gateway.id === 'stripe')).toHaveLength(1);
  });

  it('★ CLEARS `verified` on every write — an edited gateway is an unproven gateway', async () => {
    await repo.put(custom(), 'admin1');
    await repo.markVerified('acme', 'admin1');
    expect((await repo.byId('acme'))?.gateway.verified).toBe(true);
    // A template change can break a request shape in a way only a real round trip reveals.
    await repo.put(custom({ name: 'Acme v2' }), 'admin1');
    expect((await repo.byId('acme'))?.gateway.verified).toBe(false);
  });

  it('never lets `builtin` be set from input', async () => {
    const written = await repo.put(custom({ builtin: true }), 'admin1');
    expect(written.builtin).toBe(false);
  });

  it('forks a built-in into an editable, disabled, unverified copy', async () => {
    const fork = await repo.fork('stripe', 'stripe_eu', 'admin1');
    expect(fork).toMatchObject({ id: 'stripe_eu', forkedFrom: 'stripe', enabled: false, verified: false });
    expect((await repo.byId('stripe_eu'))?.builtin).toBe(false);
    // The built-in is untouched.
    expect((await repo.byId('stripe'))?.builtin).toBe(true);
  });

  it('removing a stored override reverts to the shipped built-in', async () => {
    await repo.put(custom({ id: 'stripe', name: 'Ours' }), 'admin1');
    await repo.remove('stripe', 'admin1');
    const stripe = await repo.byId('stripe');
    expect(stripe?.builtin).toBe(true);
    expect(stripe?.gateway.name).toBe('Stripe Checkout');
  });
});

describe('project bindings (level 2)', () => {
  beforeEach(async () => {
    await repo.put(custom(), 'admin1');
  });

  it('saves and masks per-mode credentials, never returning a secret', async () => {
    const saved = await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_abcdef1234', region: 'eu' } });
    expect(saved.ok).toBe(true);
    const pub = await repo.bindingPublic(ctx);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('sk_test_abcdef1234');
    // ★ PRESENCE ONLY for a stored secret. The value is an AES-GCM envelope, so the server cannot
    // show a tail of the plaintext without storing one alongside the ciphertext — and a last-4 hint
    // is four characters of a live API key. Several providers do display one; this deliberately does
    // not, because the editor already shows WHICH gateway and which mode, which is what an operator
    // actually needs to confirm.
    expect(pub?.fields.test.find((f) => f.key === 'secretKey')).toEqual({ key: 'secretKey', hasValue: true, display: '••••' });
    expect(pub?.complete).toBe(true);
  });

  it('★ saving the TEST mode does not touch LIVE values', async () => {
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'live', values: { secretKey: 'sk_live_zzzz9999' } });
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_aaaa1111' } });
    const pub = await repo.bindingPublic(ctx);
    expect(pub?.fields.live.find((f) => f.key === 'secretKey')?.hasValue).toBe(true);
    expect(pub?.fields.test.find((f) => f.key === 'secretKey')?.hasValue).toBe(true);
  });

  it('★ an OMITTED field retains what is stored; an explicit blank CLEARS it', async () => {
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_keep1234', region: 'eu' } });
    // Omitted → retained. This is what lets the editor render a form full of masks without the save
    // blanking everything it could not show.
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { region: 'us' } });
    let pub = await repo.bindingPublic(ctx);
    expect(pub?.fields.test.find((f) => f.key === 'secretKey')?.hasValue).toBe(true);
    expect(pub?.fields.test.find((f) => f.key === 'region')?.display).toBe('us');
    // Explicit blank → cleared, so an operator can remove a credential without deleting the binding.
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: '' } });
    pub = await repo.bindingPublic(ctx);
    expect(pub?.fields.test.find((f) => f.key === 'secretKey')?.hasValue).toBe(false);
    expect(pub?.complete).toBe(false);
  });

  it('rejects an undeclared field rather than storing an instant orphan', async () => {
    const r = await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { bogus: 'x' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('not a field this gateway declares');
  });

  it('validates at the INPUT boundary and names what is wrong', async () => {
    const r = await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'x', region: 'apac' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('must be one of');
  });

  it('★ refuses to bind a DISABLED gateway — the first sign must not be a buyer unable to pay', async () => {
    await repo.put(custom({ enabled: false }), 'admin1');
    const r = await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_x1234567' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('not enabled');
  });

  it('refuses an unknown gateway', async () => {
    const r = await repo.saveBinding(ctx, { gatewayId: 'nope', mode: 'test', values: {} });
    expect(r.ok).toBe(false);
  });

  it('★ switching gateway DISCARDS the old values rather than keeping them against new field names', async () => {
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_old12345' } });
    await repo.put(custom({ id: 'other', name: 'Other' }), 'admin1');
    await repo.saveBinding(ctx, { gatewayId: 'other', mode: 'test', values: { secretKey: 'sk_test_new12345' } });
    const stored = await repo.binding(ctx);
    expect(stored?.gatewayId).toBe('other');
    // A key for provider A is meaningless to provider B; carrying it over is how a "working" binding
    // ends up authenticating against nothing.
    expect(Object.keys(stored?.values?.test ?? {})).toEqual(['secretKey']);
  });

  it('saving credentials does NOT silently switch the active mode', async () => {
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'live', values: { secretKey: 'sk_live_x1234567' } });
    // Going live is a separate, deliberate act.
    expect((await repo.binding(ctx))?.mode).toBe('test');
  });
});

describe('setMode', () => {
  beforeEach(async () => {
    await repo.put(custom(), 'admin1');
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_x1234567' } });
  });

  it('★ REFUSES to go live while the live mode is incomplete, and names what is missing', async () => {
    const r = await repo.setMode(ctx, 'live');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(['secretKey']);
    expect((await repo.binding(ctx))?.mode).toBe('test');
  });

  it('allows it once live credentials exist', async () => {
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'live', values: { secretKey: 'sk_live_y1234567' } });
    expect(await repo.setMode(ctx, 'live')).toEqual({ ok: true });
    expect((await repo.binding(ctx))?.mode).toBe('live');
  });
});

describe('resolveCredentials', () => {
  it('decrypts the ACTIVE mode only', async () => {
    await repo.put(custom(), 'admin1');
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_plain123' } });
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'live', values: { secretKey: 'sk_live_plain123' } });
    const r = await repo.resolveCredentials(ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe('test');
      expect(r.cred.secretKey).toBe('sk_test_plain123');
    }
  });

  it('reports not-configured, disabled and incomplete distinctly', async () => {
    expect(await repo.resolveCredentials(ctx)).toEqual({ ok: false, reason: 'not-configured' });
    await repo.put(custom(), 'admin1');
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_x1234567' } });
    await repo.put(custom({ enabled: false }), 'admin1');
    expect(await repo.resolveCredentials(ctx)).toEqual({ ok: false, reason: 'disabled' });
  });

  it('★ LIVE mode requires a VERIFIED gateway; test mode deliberately does not', async () => {
    await repo.put(custom(), 'admin1');
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'live', values: { secretKey: 'sk_live_x1234567' } });
    await repo.setMode(ctx, 'live');
    expect(await repo.resolveCredentials(ctx)).toEqual({ ok: false, reason: 'unverified' });
    // The dry run is how a gateway BECOMES proven, so test mode must work without the flag.
    await repo.markVerified('acme', 'admin1');
    const r = await repo.resolveCredentials(ctx);
    expect(r.ok).toBe(true);
  });

  it('★ a credential that will not DECRYPT is reported MISSING, not thrown', async () => {
    await repo.put(custom(), 'admin1');
    await repo.saveBinding(ctx, { gatewayId: 'acme', mode: 'test', values: { secretKey: 'sk_test_x1234567' } });
    // The operator rotated or removed SW_ENCRYPTION_KEY. A 500 tells them nothing they can act on;
    // "this credential is missing" points straight at the cause.
    const wrongKey = new GatewayRepository(new ContentRepository(db), Buffer.alloc(32, 9));
    const r = await wrongKey.resolveCredentials(ctx);
    expect(r).toMatchObject({ ok: false, reason: 'incomplete', missing: ['secretKey'] });
  });
});

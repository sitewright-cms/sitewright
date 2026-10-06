import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { projects, shopTransactions } from '../src/db/schema.js';
import { ShopTransactionRepository, TRANSACTION_TTL_MS } from '../src/repo/shop-transactions.js';
import type { CreateTransactionInput } from '../src/repo/shop-transactions.js';

const PROJECT = 'p_txn';
let db: Database;
let repo: ShopTransactionRepository;

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(projects).values({ id: PROJECT, name: 'Txn', slug: 'txn', createdAt: new Date() });
  repo = new ShopTransactionRepository(db);
});

const input = (over: Partial<CreateTransactionInput> = {}): CreateTransactionInput => ({
  projectId: PROJECT,
  channelKey: 'pay',
  gatewayId: 'mock',
  mode: 'test',
  currency: 'EUR',
  amounts: { subtotalMinor: 1999, shippingMinor: 499, taxMinor: 0, totalMinor: 2498 },
  lines: [{ sku: 'mug', name: 'Mug', unitMinor: 1999, qty: 1, lineMinor: 1999 }],
  buyer: { name: 'Ada', email: 'ada@example.com' },
  catalogDigest: 'cat1',
  owesNotification: true,
  ...over,
});

describe('create', () => {
  it('opens in created, with no mail obligation yet', async () => {
    const row = await repo.create(input());
    expect(row.status).toBe('created');
    expect(row.fulfilment).toBe('new');
    expect(row.amounts.totalMinor).toBe(2498);
    const [raw] = await db.select().from(shopTransactions).where(eq(shopTransactions.id, row.id));
    // ★ `pending` must mean "somebody is owed an email". An unpaid session is not an obligation, and
    // a cancelled one must never become one.
    expect(raw?.notifyState).toBe('na');
    expect(raw?.receiptState).toBe('na');
  });

  it('★ mints a public token distinct from the id, and never reuses one', async () => {
    const a = await repo.create(input());
    const b = await repo.create(input());
    expect(a.publicToken).not.toBe(a.id);
    expect(a.publicToken).not.toBe(b.publicToken);
    expect(a.publicToken.length).toBeGreaterThanOrEqual(24);
  });

  it('sets a TTL so an abandoned session can be swept', async () => {
    const row = await repo.create(input());
    const [raw] = await db.select().from(shopTransactions).where(eq(shopTransactions.id, row.id));
    expect(raw?.expiresAt).toBeTruthy();
    expect(raw!.expiresAt!.getTime() - row.createdAt.getTime()).toBe(TRANSACTION_TTL_MS);
  });
});

describe('lookup', () => {
  it('finds by public token, scoped to the project', async () => {
    const row = await repo.create(input());
    expect((await repo.byPublicToken(PROJECT, row.publicToken))?.id).toBe(row.id);
    await db.insert(projects).values({ id: 'other', name: 'O', slug: 'o', createdAt: new Date() });
    // ★ A token from one project must not resolve under another's path.
    expect(await repo.byPublicToken('other', row.publicToken)).toBeUndefined();
  });

  it('rejects an absurd token before it reaches the database', async () => {
    expect(await repo.byPublicToken(PROJECT, 'short')).toBeUndefined();
    expect(await repo.byPublicToken(PROJECT, 'x'.repeat(5000))).toBeUndefined();
  });

  it('★ finds by provider ref PER GATEWAY — two providers may mint the same id', async () => {
    const a = await repo.create(input({ gatewayId: 'mock' }));
    const b = await repo.create(input({ gatewayId: 'stripe' }));
    await repo.attachProviderRef(a.id, 'cs_shared');
    await repo.attachProviderRef(b.id, 'cs_shared');
    expect((await repo.byProviderRef('mock', 'cs_shared'))?.id).toBe(a.id);
    expect((await repo.byProviderRef('stripe', 'cs_shared'))?.id).toBe(b.id);
  });
});

describe('advance — the conditional UPDATE', () => {
  it('moves created → paid and stamps paidAt', async () => {
    const row = await repo.create(input());
    const r = await repo.advance(row.id, 'paid', { owesNotification: true, customerEmail: 'ada@example.com' });
    expect(r.outcome).toBe('advanced');
    if (r.outcome === 'advanced') {
      expect(r.row.status).toBe('paid');
      expect(r.row.paidAt).not.toBeNull();
    }
  });

  it('★ arms BOTH mail obligations in the SAME statement that records the payment', async () => {
    const row = await repo.create(input());
    await repo.advance(row.id, 'paid', { owesNotification: true, customerEmail: 'ada@example.com' });
    const [raw] = await db.select().from(shopTransactions).where(eq(shopTransactions.id, row.id));
    // Arming them in a second statement risks losing them; arming them anywhere but here risks a
    // receipt for an order that was never paid.
    expect(raw?.notifyState).toBe('pending');
    expect(raw?.receiptState).toBe('pending');
    expect(raw?.notifyNextAt).not.toBeNull();
  });

  it('leaves the receipt as `na` when there is no customer address', async () => {
    const row = await repo.create(input());
    await repo.advance(row.id, 'paid', { owesNotification: true });
    const [raw] = await db.select().from(shopTransactions).where(eq(shopTransactions.id, row.id));
    expect(raw?.notifyState).toBe('pending');
    // A receipt nobody can receive is not an outstanding obligation — but the merchant is still owed one.
    expect(raw?.receiptState).toBe('na');
  });

  it('★★ a REPLAYED paid is reported stale, not advanced — this is what stops a second receipt', async () => {
    const row = await repo.create(input());
    expect((await repo.advance(row.id, 'paid', { owesNotification: true })).outcome).toBe('advanced');
    const second = await repo.advance(row.id, 'paid', { owesNotification: true });
    expect(second.outcome).toBe('stale');
    if (second.outcome === 'stale') expect(second.row.status).toBe('paid');
  });

  it('★★ a re-delivered OLD event cannot un-pay an order', async () => {
    const row = await repo.create(input());
    await repo.advance(row.id, 'paid', { owesNotification: true });
    for (const to of ['failed', 'expired', 'cancelled', 'pending'] as const) {
      const r = await repo.advance(row.id, to);
      expect(r.outcome, to).toBe('stale');
      if (r.outcome === 'stale') expect(r.row.status).toBe('paid');
    }
  });

  it('allows the one legal move out of paid: a refund', async () => {
    const row = await repo.create(input());
    await repo.advance(row.id, 'paid', { owesNotification: true });
    const r = await repo.advance(row.id, 'refunded', { refundedMinor: 2498 });
    expect(r.outcome).toBe('advanced');
    if (r.outcome === 'advanced') expect(r.row.refundedMinor).toBe(2498);
  });

  it('★ two concurrent paid deliveries: exactly one advances', async () => {
    const row = await repo.create(input());
    const [a, b] = await Promise.all([
      repo.advance(row.id, 'paid', { owesNotification: true }),
      repo.advance(row.id, 'paid', { owesNotification: true }),
    ]);
    expect([a.outcome, b.outcome].filter((o) => o === 'advanced')).toHaveLength(1);
    expect([a.outcome, b.outcome].filter((o) => o === 'stale')).toHaveLength(1);
  });

  it('reports not-found for an unknown id', async () => {
    expect(await repo.advance('nope', 'paid')).toEqual({ outcome: 'not-found' });
  });

  it('refuses a move to created from anywhere', async () => {
    const row = await repo.create(input());
    expect((await repo.advance(row.id, 'created')).outcome).toBe('stale');
  });
});

describe('claimEvent — replay defence', () => {
  it('★ claims once and refuses the replay', async () => {
    expect(await repo.claimEvent('mock', 'evt_1')).toBe(true);
    expect(await repo.claimEvent('mock', 'evt_1')).toBe(false);
  });

  it('is scoped per gateway: the same id from a different provider is a different event', async () => {
    expect(await repo.claimEvent('mock', 'evt_1')).toBe(true);
    expect(await repo.claimEvent('stripe', 'evt_1')).toBe(true);
  });

  it('★ two concurrent claims of one event: exactly one wins', async () => {
    const [a, b] = await Promise.all([repo.claimEvent('mock', 'evt_race'), repo.claimEvent('mock', 'evt_race')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('refuses an empty or absurd event id rather than storing it', async () => {
    expect(await repo.claimEvent('mock', '')).toBe(false);
    expect(await repo.claimEvent('mock', 'x'.repeat(300))).toBe(false);
  });

  it('reaps a spent id once the replay window has passed', async () => {
    const old = new Date(Date.now() - 10_000);
    await repo.claimEvent('mock', 'evt_old', old);
    expect(await repo.reapEvents(new Date())).toBe(1);
    // Reaping is safe precisely because the window has passed; the id is claimable again.
    expect(await repo.claimEvent('mock', 'evt_old')).toBe(true);
  });
});

describe('setFulfilment', () => {
  it('moves forward and records a note', async () => {
    const row = await repo.create(input());
    const r = await repo.setFulfilment(PROJECT, row.id, 'packed', 'boxed');
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.row.fulfilment).toBe('packed');
  });

  it('★ refuses a backwards or illegal move', async () => {
    const row = await repo.create(input());
    await repo.setFulfilment(PROJECT, row.id, 'shipped');
    expect(await repo.setFulfilment(PROJECT, row.id, 'packed')).toEqual({ ok: false, reason: 'illegal' });
    await repo.setFulfilment(PROJECT, row.id, 'done');
    // `done` is terminal.
    expect(await repo.setFulfilment(PROJECT, row.id, 'shipped')).toEqual({ ok: false, reason: 'illegal' });
  });

  it('★ two operators clicking at once: exactly one advances', async () => {
    const row = await repo.create(input());
    const [a, b] = await Promise.all([
      repo.setFulfilment(PROJECT, row.id, 'packed'),
      repo.setFulfilment(PROJECT, row.id, 'shipped'),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it('scopes to the project', async () => {
    const row = await repo.create(input());
    await db.insert(projects).values({ id: 'other', name: 'O', slug: 'o', createdAt: new Date() });
    expect(await repo.setFulfilment('other', row.id, 'packed')).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('toPublic', () => {
  it('★ allowlists — no merchant address, no provider refs, no gateway, no token', async () => {
    const row = await repo.create(input({ customerEmail: 'ada@example.com' }));
    await repo.attachProviderRef(row.id, 'cs_secret_ref');
    const after = (await repo.byId(PROJECT, row.id))!;
    const json = JSON.stringify(repo.toPublic(after));
    for (const leak of ['cs_secret_ref', 'mock', after.publicToken, after.id, 'cat1', 'customerEmail']) {
      expect(json, leak).not.toContain(leak);
    }
    // What it SHOULD carry: enough for the buyer to recognise their own order.
    expect(json).toContain('"status":"created"');
    expect(json).toContain('"totalMinor":2498');
    expect(json).toContain('ada@example.com'); // their own submitted field, echoed back
  });
});

describe('reconciliation and expiry', () => {
  it('★ returns unresolved rows with a provider ref — the safeguard for a webhook that never arrives', async () => {
    const row = await repo.create(input());
    await repo.attachProviderRef(row.id, 'cs_1');
    const now = new Date(Date.now() + 60_000);
    expect((await repo.dueForReconciliation(now, 30_000, 10)).map((r) => r.id)).toEqual([row.id]);
  });

  it('skips a row with no provider ref — there is nothing to ask about', async () => {
    await repo.create(input());
    expect(await repo.dueForReconciliation(new Date(Date.now() + 60_000), 30_000, 10)).toEqual([]);
  });

  it('skips a row that is already resolved', async () => {
    const row = await repo.create(input());
    await repo.attachProviderRef(row.id, 'cs_1');
    await repo.advance(row.id, 'paid', { owesNotification: true });
    expect(await repo.dueForReconciliation(new Date(Date.now() + 60_000), 30_000, 10)).toEqual([]);
  });

  it('skips a row that is not yet stale', async () => {
    const row = await repo.create(input());
    await repo.attachProviderRef(row.id, 'cs_1');
    expect(await repo.dueForReconciliation(new Date(), 30_000, 10)).toEqual([]);
  });

  it('expires past-TTL sessions and leaves paid ones alone', async () => {
    const stale = await repo.create(input());
    const paid = await repo.create(input());
    await repo.advance(paid.id, 'paid', { owesNotification: true });
    const later = new Date(Date.now() + TRANSACTION_TTL_MS + 1000);
    const expired = await repo.expireStale(later);
    expect(expired.map((r) => r.id)).toEqual([stale.id]);
    expect((await repo.byId(PROJECT, paid.id))?.status).toBe('paid');
  });
});

describe('list, countOpen and recordFiltered', () => {
  it('pages newest-first and reports a total', async () => {
    for (let i = 0; i < 3; i += 1) await repo.create(input());
    const page = await repo.list(PROJECT, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  it('filters by status', async () => {
    const a = await repo.create(input());
    await repo.create(input());
    await repo.advance(a.id, 'paid', { owesNotification: true });
    expect((await repo.list(PROJECT, { status: 'paid' })).total).toBe(1);
  });

  it('counts only unresolved sessions — the storage bound for abandoned checkouts', async () => {
    const a = await repo.create(input());
    await repo.create(input());
    expect(await repo.countOpen(PROJECT)).toBe(2);
    await repo.advance(a.id, 'paid', { owesNotification: true });
    expect(await repo.countOpen(PROJECT)).toBe(1);
  });

  it('counts filtered checkouts per reason, and increments on repeat', async () => {
    await repo.recordFiltered(PROJECT, 'pay', 'honeypot');
    await repo.recordFiltered(PROJECT, 'pay', 'honeypot');
    await repo.recordFiltered(PROJECT, 'pay', 'too-fast');
    const rows = await db.select().from((await import('../src/db/schema.js')).shopFiltered);
    expect(rows.find((r) => r.reason === 'honeypot')?.count).toBe(2);
    expect(rows.find((r) => r.reason === 'too-fast')?.count).toBe(1);
  });
});

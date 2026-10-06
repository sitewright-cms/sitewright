import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { projects, shopTransactions } from '../src/db/schema.js';
import { ShopTransactionRepository } from '../src/repo/shop-transactions.js';
import { orderMailContext, renderAdminMail, renderCustomerMail } from '../src/payments/notify.js';
import { runOrderMail } from '../src/payments/notify-runner.js';
import type { SubmissionMail } from '../src/mail/mailer.js';

const PROJECT = 'p_mail';
let db: Database;
let repo: ShopTransactionRepository;
/** Every message the fake transport was asked to send. */
let outbox: Array<{ via: 'global' | 'project'; mail: SubmissionMail }>;
let globalResult: boolean | Error;

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(projects).values({ id: PROJECT, name: 'Shop', slug: 'shop', createdAt: new Date() });
  repo = new ShopTransactionRepository(db);
  outbox = [];
  globalResult = true;
});

const deps = (over: Partial<Parameters<typeof runOrderMail>[0]> = {}) => ({
  transactions: repo,
  globalMailer: {
    send: async (mail: SubmissionMail) => {
      if (globalResult instanceof Error) throw globalResult;
      outbox.push({ via: 'global' as const, mail });
      return globalResult;
    },
  },
  projectMailer: {
    send: async (_p: string, mail: SubmissionMail) => {
      outbox.push({ via: 'project' as const, mail });
      return true;
    },
  },
  resolveChannel: async () => ({ email: 'orders@shop.test', mode: 'globalSmtp' as const, shopName: 'Acme Shop' }),
  ...over,
});

/** A PAID order owing both mails. */
async function paidOrder(over: { customerEmail?: string | null; mode?: 'test' | 'live' } = {}) {
  const row = await repo.create({
    projectId: PROJECT,
    channelKey: 'pay',
    gatewayId: 'mock',
    mode: over.mode ?? 'live',
    currency: 'EUR',
    amounts: { subtotalMinor: 1999, shippingMinor: 499, taxMinor: 0, totalMinor: 2498 },
    lines: [{ sku: 'MUG', name: 'Enamel mug', unitMinor: 1999, qty: 1, lineMinor: 1999 }],
    buyer: { name: 'Ada', email: 'ada@example.com' },
    catalogDigest: 'cat1',
    owesNotification: true,
    ...(over.customerEmail !== null ? { customerEmail: over.customerEmail ?? 'ada@example.com' } : {}),
  });
  await repo.advance(row.id, 'paid', {
    owesNotification: true,
    ...(over.customerEmail !== null ? { customerEmail: over.customerEmail ?? 'ada@example.com' } : {}),
  });
  return row;
}

const raw = async (id: string) => (await db.select().from(shopTransactions).where(eq(shopTransactions.id, id)))[0];

describe('★★ two independent deliveries', () => {
  it('sends BOTH the shop notification and the customer receipt', async () => {
    const row = await paidOrder();
    const result = await runOrderMail(deps());
    expect(result.sent).toBe(2);
    expect(outbox.map((o) => o.mail.recipient).sort()).toEqual(['ada@example.com', 'orders@shop.test']);
    const after = await raw(row.id);
    expect(after?.notifyState).toBe('sent');
    expect(after?.receiptState).toBe('sent');
  });

  it('★ a bouncing MERCHANT address does not block the customer receipt', async () => {
    // The whole reason the two have separate state. One is a missed order; the other is a customer
    // wondering whether their money went anywhere.
    const row = await paidOrder();
    await runOrderMail(
      deps({
        globalMailer: {
          send: async (mail: SubmissionMail) => {
            if (mail.recipient === 'orders@shop.test') throw new Error('550 mailbox unavailable');
            outbox.push({ via: 'global', mail });
            return true;
          },
        },
      }) as never,
    );
    const after = await raw(row.id);
    expect(after?.notifyState).toBe('pending'); // backing off
    expect(after?.receiptState).toBe('sent'); // unaffected
    expect(outbox.map((o) => o.mail.recipient)).toEqual(['ada@example.com']);
  });

  it('★ retrying one does not re-send the other', async () => {
    const row = await paidOrder();
    await runOrderMail(deps()); // both sent
    outbox = [];
    // The operator requeues only the merchant copy.
    expect(await repo.requeueMail(PROJECT, row.id, 'notify')).toBe(true);
    await runOrderMail(deps());
    expect(outbox.map((o) => o.mail.recipient)).toEqual(['orders@shop.test']);
  });

  it('only ARMED orders are picked up — an unpaid one owes nobody anything', async () => {
    await repo.create({
      projectId: PROJECT,
      channelKey: 'pay',
      gatewayId: 'mock',
      mode: 'live',
      currency: 'EUR',
      amounts: { subtotalMinor: 100, shippingMinor: 0, taxMinor: 0, totalMinor: 100 },
      lines: [],
      buyer: {},
      catalogDigest: 'c',
      owesNotification: true,
    });
    expect(await runOrderMail(deps())).toEqual({ sent: 0, failed: 0 });
    expect(outbox).toEqual([]);
  });

  it('★ a second pass sends nothing more — exactly once', async () => {
    await paidOrder();
    await runOrderMail(deps());
    outbox = [];
    expect(await runOrderMail(deps())).toEqual({ sent: 0, failed: 0 });
    expect(outbox).toEqual([]);
  });

  it('★ two concurrent passes do not double-send', async () => {
    await paidOrder();
    await Promise.all([runOrderMail(deps()), runOrderMail(deps())]);
    // A duplicate order confirmation makes a customer believe they were charged twice.
    expect(outbox.filter((o) => o.mail.recipient === 'ada@example.com')).toHaveLength(1);
    expect(outbox.filter((o) => o.mail.recipient === 'orders@shop.test')).toHaveLength(1);
  });
});

describe('failure handling', () => {
  it('backs off on a transport error and keeps the sanitized reason', async () => {
    globalResult = new Error('connect ECONNREFUSED 10.1.2.3:587');
    const row = await paidOrder();
    await runOrderMail(deps());
    const after = await raw(row.id);
    expect(after?.notifyState).toBe('pending');
    expect(after?.notifyAttempts).toBe(1);
    expect(after?.notifyNextAt).not.toBeNull();
    // ★ The resolved IP and the SMTP banner must not reach a stored, operator-visible string.
    expect(after?.notifyError ?? '').not.toContain('10.1.2.3');
  });

  it('gives up after the final attempt rather than retrying for ever', async () => {
    globalResult = new Error('nope');
    const row = await paidOrder();
    for (let i = 0; i < 12; i += 1) {
      await db.update(shopTransactions).set({ notifyNextAt: new Date(0), notifyClaimedAt: null, receiptNextAt: new Date(0), receiptClaimedAt: null });
      await runOrderMail(deps(), new Date());
      if ((await raw(row.id))?.notifyState === 'failed') break;
    }
    expect((await raw(row.id))?.notifyState).toBe('failed');
  });

  it('★ a receipt with NO customer address is recorded as such, not retried for ever', async () => {
    const row = await paidOrder({ customerEmail: null });
    await runOrderMail(deps());
    const after = await raw(row.id);
    // "No customer address" is a fact about the order an operator is owed, not a silent gap.
    expect(after?.receiptState === 'failed' || after?.receiptState === 'na').toBe(true);
    if (after?.receiptState === 'failed') expect(after.receiptError).toContain('no customer address');
    // …and the merchant is still told.
    expect(after?.notifyState).toBe('sent');
  });

  it('abandons when the channel the order came from has been deleted', async () => {
    const row = await paidOrder();
    await runOrderMail(deps({ resolveChannel: async () => null }) as never);
    const after = await raw(row.id);
    expect(after?.notifyState).toBe('failed');
    expect(after?.notifyError).toContain('no longer exists');
  });

  it('uses the project’s own SMTP when the instance only permits that mode', async () => {
    await paidOrder();
    await runOrderMail(deps({ resolveChannel: async () => ({ email: 'o@s.test', mode: 'userSmtp' as const, shopName: 'S' }) }) as never);
    expect(outbox.every((o) => o.via === 'project')).toBe(true);
  });
});

describe('★★ the render context is enumerated, never the settings bundle', () => {
  const txn = {
    id: 't1',
    projectId: PROJECT,
    channelKey: 'pay',
    gatewayId: 'mock',
    mode: 'live' as const,
    status: 'paid' as const,
    fulfilment: 'new' as const,
    preview: false,
    currency: 'EUR',
    amounts: { subtotalMinor: 1999, shippingMinor: 499, taxMinor: 380, totalMinor: 2878 },
    refundedMinor: 0,
    lines: [{ sku: 'MUG', name: 'Enamel mug', unitMinor: 1999, qty: 2, lineMinor: 3998 }],
    buyer: { name: 'Ada', email: 'ada@example.com' },
    catalogDigest: 'cat1',
    providerRef: 'cs_secret_ref',
    publicToken: 'tok_abcdefghijklmnop',
    customerEmail: 'ada@example.com',
    notifyAttempts: 0,
    receiptAttempts: 0,
    createdAt: new Date('2026-10-06T10:00:00Z'),
    paidAt: new Date('2026-10-06T10:05:00Z'),
  };

  it('exposes only order, buyer and shop name', () => {
    const ctx = orderMailContext(txn as never, 'Acme Shop');
    expect(Object.keys(ctx).sort()).toEqual(['buyer', 'order', 'shop']);
    // A mail template that could reach `settings` could reach the SMTP password and every payment
    // credential — and its output leaves the building.
    const json = JSON.stringify(ctx);
    for (const leak of ['cs_secret_ref', 'mock', 'catalogDigest', 'cat1', 'settings', 'gateway']) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it('gives the buyer a reference they can quote, not the internal id', () => {
    const ctx = orderMailContext(txn as never, 'Acme Shop');
    expect(ctx.order.reference).toBe('tok_abcdefgh');
    expect(ctx.order.reference).not.toBe(txn.id);
  });

  it('formats every figure in the settlement currency', () => {
    const ctx = orderMailContext(txn as never, 'Acme Shop');
    expect(ctx.order).toMatchObject({ subtotal: '19.99', shipping: '4.99', tax: '3.80', total: '28.78', currency: 'EUR' });
    expect(ctx.order.lines[0]).toEqual({ name: 'Enamel mug', qty: 2, amount: '39.98' });
  });
});

describe('the rendered mails', () => {
  const ctx = () => orderMailContext({
    publicToken: 'tok_abcdefghijklmnop',
    currency: 'EUR',
    amounts: { subtotalMinor: 1999, shippingMinor: 0, taxMinor: 0, totalMinor: 1999 },
    lines: [{ sku: 'M', name: 'Enamel mug', unitMinor: 1999, qty: 1, lineMinor: 1999 }],
    buyer: { name: 'Ada', email: 'ada@example.com' },
    mode: 'live',
    createdAt: new Date('2026-10-06T10:00:00Z'),
    paidAt: new Date('2026-10-06T10:00:00Z'),
  } as never, 'Acme Shop');

  it('the merchant copy carries the buyer’s details, so it is actionable', () => {
    const m = renderAdminMail(ctx());
    expect(m.subject).toContain('tok_abcdefgh');
    expect(m.html).toContain('Ada');
    expect(m.text).toContain('Ada');
    expect(m.text).toContain('TOTAL: 19.99 EUR');
  });

  it('★ the customer copy carries NO merchant address and no provider reference', () => {
    const m = renderCustomerMail(ctx());
    for (const leak of ['orders@shop.test', 'cs_', 'gateway', 'provider']) {
      expect(`${m.subject} ${m.html} ${m.text}`, leak).not.toContain(leak);
    }
    expect(m.html).toContain('Acme Shop');
  });

  it('★ both are MULTIPART — a text part is what plenty of order filters want', () => {
    for (const m of [renderAdminMail(ctx()), renderCustomerMail(ctx())]) {
      expect(m.html.length).toBeGreaterThan(40);
      expect(m.text.length).toBeGreaterThan(20);
      expect(m.text).not.toContain('<');
    }
  });

  it('★ a TEST order says so in the subject AND the body — never mistakable for a sale', () => {
    const testCtx = orderMailContext({
      publicToken: 'tok_tttttttttttt',
      currency: 'EUR',
      amounts: { subtotalMinor: 100, shippingMinor: 0, taxMinor: 0, totalMinor: 100 },
      lines: [],
      buyer: {},
      mode: 'test',
      createdAt: new Date(),
      paidAt: new Date(),
    } as never, 'Acme');
    for (const m of [renderAdminMail(testCtx), renderCustomerMail(testCtx)]) {
      expect(m.subject).toContain('[TEST]');
      expect(m.text).toContain('TEST ORDER');
    }
  });

  it('★ escapes a product name — a mail body is not a markup sink either', () => {
    const evil = orderMailContext({
      publicToken: 'tok_xxxxxxxxxxxx',
      currency: 'EUR',
      amounts: { subtotalMinor: 1, shippingMinor: 0, taxMinor: 0, totalMinor: 1 },
      lines: [{ sku: 'X', name: '<script>alert(1)</script>', unitMinor: 1, qty: 1, lineMinor: 1 }],
      buyer: { note: '<img src=x onerror=alert(1)>' },
      mode: 'live',
      createdAt: new Date(),
      paidAt: new Date(),
    } as never, 'Acme');
    const m = renderAdminMail(evil);
    // ★ The meaningful check is that no TAG survives — `onerror=` as escaped TEXT is inert, and
    // asserting on the substring would fail a correctly-escaped body.
    expect(m.html).not.toMatch(/<script/i);
    expect(m.html).not.toMatch(/<img/i);
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('&lt;img');
    // And the plain-text part carries the characters literally, which is correct: it is not markup.
    expect(m.text).toContain('<script>');
  });

  it('omits a zero shipping and tax row rather than printing 0.00', () => {
    const m = renderCustomerMail(ctx());
    expect(m.text).not.toContain('Shipping');
    expect(m.text).not.toContain('Tax');
  });
});

describe('undeliveredSummary', () => {
  it('counts each kind separately and surfaces the last error', async () => {
    globalResult = new Error('smtp down');
    await paidOrder();
    await runOrderMail(deps());
    const s = await repo.undeliveredSummary(PROJECT);
    expect(s.notify).toBe(1);
    expect(s.receipt).toBe(1);
    expect(s.lastError).toBeTruthy();
  });

  it('is clean once both have gone', async () => {
    await paidOrder();
    await runOrderMail(deps());
    expect(await repo.undeliveredSummary(PROJECT)).toMatchObject({ notify: 0, receipt: 0 });
  });
});

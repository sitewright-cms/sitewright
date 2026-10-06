import { describe, it, expect } from 'vitest';
import { priceOrder, amountMatches, describeAmounts } from '../src/payments/pricing.js';
import { MAX_CHECKOUT_LINES, ShopPricingSchema } from '@sitewright/schema';
import type { ShopCatalog } from '@sitewright/blocks';

const catalog: ShopCatalog = {
  currency: 'EUR',
  digest: 'cat_abc',
  items: {
    mug: { sku: 'mug', name: 'Enamel mug', priceMinor: 1999 },
    tee: { sku: 'tee', name: 'T-shirt', priceMinor: 2450, stock: 3 },
    free: { sku: 'free', name: 'Sticker', priceMinor: 0 },
  },
};

describe('priceOrder — the browser sends no amount', () => {
  it('prices from the catalog and freezes the catalog NAME, not anything the cart said', () => {
    const r = priceOrder([{ sku: 'mug', qty: 2 }], catalog, undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.currency).toBe('EUR');
    expect(r.catalogDigest).toBe('cat_abc');
    expect(r.lines).toEqual([{ sku: 'mug', name: 'Enamel mug', unitMinor: 1999, qty: 2, lineMinor: 3998 }]);
    expect(r.amounts.totalMinor).toBe(3998);
  });

  it('★★ a tampered cart cannot change the price — there is nowhere to put one', () => {
    // The request type carries sku and qty only. Even if a client invents extra fields, nothing
    // downstream reads them: the unit price comes from the catalog, every time.
    const tampered = [{ sku: 'mug', qty: 1, price: '0.01', priceMinor: 1, unitMinor: 1, total: 1 }] as never;
    const r = priceOrder(tampered, catalog, undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amounts.totalMinor).toBe(1999);
  });

  it('★ the currency comes from the snapshot, not from the request', () => {
    const r = priceOrder([{ sku: 'mug', qty: 1, currency: 'XOF' } as never], catalog, undefined);
    if (r.ok) expect(r.currency).toBe('EUR');
  });

  it('★ REFUSES an unknown sku rather than skipping it', () => {
    // Skipping would charge for a subset of what the buyer thinks they are buying, and send the
    // merchant an order that silently lost a line.
    expect(priceOrder([{ sku: 'mug', qty: 1 }, { sku: 'ghost', qty: 1 }], catalog, undefined)).toEqual({
      ok: false,
      reason: 'unknown-sku',
      sku: 'ghost',
    });
  });

  it('★ refuses a duplicate sku rather than quietly summing it', () => {
    expect(priceOrder([{ sku: 'mug', qty: 1 }, { sku: 'mug', qty: 2 }], catalog, undefined)).toEqual({
      ok: false,
      reason: 'duplicate-sku',
      sku: 'mug',
    });
  });

  it('refuses an empty cart and one past the line cap', () => {
    expect(priceOrder([], catalog, undefined)).toEqual({ ok: false, reason: 'empty' });
    const many = Array.from({ length: MAX_CHECKOUT_LINES + 1 }, (_, i) => ({ sku: `s${i}`, qty: 1 }));
    expect(priceOrder(many, catalog, undefined)).toEqual({ ok: false, reason: 'too-many-lines', limit: MAX_CHECKOUT_LINES });
  });

  it('★ refuses a zero total — every provider rejects one, and it would never resolve', () => {
    expect(priceOrder([{ sku: 'free', qty: 3 }], catalog, undefined)).toEqual({ ok: false, reason: 'zero-total' });
  });

  it('a free item is fine alongside a paid one', () => {
    const r = priceOrder([{ sku: 'mug', qty: 1 }, { sku: 'free', qty: 1 }], catalog, undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amounts.totalMinor).toBe(1999);
  });

  it('applies shop shipping and tax through the single composer', () => {
    const pricing = ShopPricingSchema.parse({ shipping: { flatMinor: 499, freeOverMinor: 5000 }, tax: { rateBp: 1900, mode: 'exclusive' } });
    const r = priceOrder([{ sku: 'mug', qty: 1 }], catalog, pricing);
    if (!r.ok) throw new Error('expected a priced order');
    expect(r.amounts.subtotalMinor).toBe(1999);
    expect(r.amounts.shippingMinor).toBe(499);
    expect(r.amounts.taxMinor).toBe(475); // 19% of 2498
    expect(r.amounts.totalMinor).toBe(2973);
  });

  it('builds a bounded order summary', () => {
    const r = priceOrder([{ sku: 'mug', qty: 2 }, { sku: 'tee', qty: 1 }], catalog, undefined);
    if (!r.ok) throw new Error('expected a priced order');
    expect(r.orderName).toBe('2x Enamel mug, 1x T-shirt');
    const big: ShopCatalog = { ...catalog, items: { long: { sku: 'long', name: 'N'.repeat(400), priceMinor: 100 } } };
    const r2 = priceOrder([{ sku: 'long', qty: 1 }], big, undefined);
    if (!r2.ok) throw new Error('expected a priced order');
    expect(r2.orderName.length).toBeLessThanOrEqual(180);
  });
});

describe('amountMatches — the provider echo is cross-checked, never used', () => {
  const expected = { totalMinor: 2498, currency: 'EUR' };

  it('passes on an exact minor-unit echo', () => {
    expect(amountMatches(expected, { amountMinor: 2498, currency: 'EUR' })).toBe(true);
  });

  it('★ FAILS on a disagreeing amount — in either direction', () => {
    expect(amountMatches(expected, { amountMinor: 1 })).toBe(false);
    expect(amountMatches(expected, { amountMinor: 999_999 })).toBe(false);
  });

  it('★ fails on a disagreeing currency even when the number matches', () => {
    expect(amountMatches(expected, { amountMinor: 2498, currency: 'USD' })).toBe(false);
  });

  it('compares a decimal echo as an amount, not as a string', () => {
    expect(amountMatches(expected, { amountDecimal: '24.98' })).toBe(true);
    expect(amountMatches(expected, { amountDecimal: ' 24.98 ' })).toBe(true);
    expect(amountMatches(expected, { amountDecimal: '24.99' })).toBe(false);
  });

  it('★ a provider that echoes NO amount is not a mismatch — most do not', () => {
    // Demanding an echo would make this check a reason to reject every genuine event from Mollie.
    expect(amountMatches(expected, {})).toBe(true);
  });

  it('is case-insensitive about the currency code', () => {
    expect(amountMatches(expected, { amountMinor: 2498, currency: 'eur' })).toBe(true);
  });
});

describe('describeAmounts', () => {
  it('renders every figure in the settlement currency', () => {
    expect(describeAmounts({ subtotalMinor: 1999, shippingMinor: 499, taxMinor: 0, totalMinor: 2498 }, 'EUR')).toEqual({
      subtotal: '19.99',
      shipping: '4.99',
      tax: '0.00',
      total: '24.98',
    });
  });
  it('respects a zero-decimal currency', () => {
    expect(describeAmounts({ subtotalMinor: 500, shippingMinor: 0, taxMinor: 0, totalMinor: 500 }, 'JPY').total).toBe('500');
  });
});

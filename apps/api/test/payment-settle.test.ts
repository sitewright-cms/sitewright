import { describe, it, expect, vi } from 'vitest';
import { makeSettlement, owesOrderMail } from '../src/payments/settle.js';
import type { ShopStockRepository } from '../src/repo/shop-stock.js';
import type { TransactionRow } from '../src/repo/shop-transactions.js';

/**
 * ★ What a payment's outcome does, in one place for the four paths that end a transaction: a shop order's stock is
 * committed or given back (never for a preview rehearsal), a booking's prepayment settles the booking and never
 * touches stock.
 */

const txn = (over: Partial<TransactionRow>): TransactionRow =>
  ({ projectId: 'p1', preview: false, bookingClaimId: null, lines: [{ sku: 'mug', name: 'Mug', unitMinor: 900, qty: 2, lineMinor: 1800 }], ...over }) as TransactionRow;

const setup = () => {
  const stock = { commit: vi.fn(async () => undefined), release: vi.fn(async () => undefined) };
  const booking = { paid: vi.fn(async () => undefined), unpaid: vi.fn(async () => undefined) };
  return { stock, booking, settle: makeSettlement({ stock: stock as unknown as ShopStockRepository, booking }) };
};

describe('settling a payment', () => {
  it('commits a paid order’s stock and gives an unpaid one’s back', async () => {
    const { stock, booking, settle } = setup();
    await settle.paid(txn({}));
    await settle.unpaid(txn({}));
    expect(stock.commit).toHaveBeenCalledWith('p1', [{ sku: 'mug', qty: 2 }]);
    expect(stock.release).toHaveBeenCalledWith('p1', [{ sku: 'mug', qty: 2 }]);
    expect(booking.paid).not.toHaveBeenCalled();
  });

  it('★ never touches stock for a preview rehearsal', async () => {
    const { stock, settle } = setup();
    await settle.paid(txn({ preview: true }));
    await settle.unpaid(txn({ preview: true }));
    expect(stock.commit).not.toHaveBeenCalled();
    expect(stock.release).not.toHaveBeenCalled();
  });

  it('★ settles a booking’s prepayment with the booking, never with stock, and owes it no order mail', async () => {
    const { stock, booking, settle } = setup();
    const t = txn({ bookingClaimId: 'c1', lines: [{ sku: 'booking:cut', name: 'Haircut', unitMinor: 4500, qty: 1, lineMinor: 4500 }] });
    await settle.paid(t);
    await settle.unpaid(t);
    expect(booking.paid).toHaveBeenCalledWith(t);
    expect(booking.unpaid).toHaveBeenCalledWith(t);
    expect(stock.commit).not.toHaveBeenCalled();
    expect(stock.release).not.toHaveBeenCalled();
    expect(owesOrderMail(t)).toBe(false);
    expect(owesOrderMail(txn({}))).toBe(true);
  });
});

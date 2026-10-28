import { describe, it, expect, vi } from 'vitest';
import { BookingConfigSchema } from '@sitewright/schema';
import { BookingPayments, type BookingPaymentsDeps } from '../src/booking/payments.js';
import type { TransactionRow } from '../src/repo/shop-transactions.js';
import type { BookingEvent } from '../src/booking/notify.js';

// The provider's refund call: it answers, as a working provider does (its own tests are the executor's).
vi.mock('../src/payments/executor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/payments/executor.js')>()),
  refundPayment: vi.fn(async () => ({ ref: 're_1' })),
}));
vi.mock('../src/http/payment-admin-routes.js', () => ({ refundScope: () => ({}) }));

/**
 * ★ SETTLING a booking's payment, branch by branch: what the end-to-end tests cannot easily force. A payment is
 * settled exactly once (confirmed and mailed, or refunded); a busy moment never refunds a booking that still holds;
 * a settlement interrupted after the confirmation is finished, not refunded; a refund the provider will not make
 * is the business's, and both sides are told.
 */

const CONFIG = BookingConfigSchema.parse({
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin' }],
  offerings: [{ id: 'cut', name: 'Haircut', mode: 'duration', durationMin: 60, resourceIds: ['anna'], price: { amountMinor: 4500 } }],
  payment: { gatewayId: 'mock', currency: 'EUR' },
});
const START = Date.UTC(2026, 10, 2, 9);

const txn = (over: Partial<TransactionRow> = {}): TransactionRow =>
  ({
    id: 't1',
    projectId: 'p1',
    gatewayId: 'mock',
    mode: 'test',
    status: 'paid',
    currency: 'EUR',
    amounts: { subtotalMinor: 4500, shippingMinor: 0, taxMinor: 0, totalMinor: 4500 },
    refundedMinor: 0,
    buyer: { name: 'Ada', email: 'ada@example.test' },
    bookingClaimId: 'c1',
    bookingSnapshot: { offeringId: 'cut', resourceId: 'anna', start: START, end: START + 3_600_000, units: 1, locale: 'de' },
    bookingSettledAt: null,
    updatedAt: new Date(),
    ...over,
  }) as TransactionRow;

function setup(
  opts: {
    confirm?: Array<{ ok: true } | { ok: false; reason: string }>;
    claimState?: 'hold' | 'booked' | null;
    refundable?: boolean;
    current?: TransactionRow;
    /** The payment the booking names as the one that booked it. */
    paidBy?: string;
  } = {},
) {
  const current = opts.current;
  const told: BookingEvent[] = [];
  const settled: string[] = [];
  const claimed: number[] = [];
  const confirms = [...(opts.confirm ?? [{ ok: true as const }])];
  const live = opts.claimState
    ? {
        id: 'c1',
        offeringId: 'cut',
        resourceId: 'anna',
        startAt: new Date(START),
        endAt: new Date(START + 3_600_000),
        units: 1,
        customer: { name: 'Ada' },
        state: opts.claimState,
        paidTxnId: opts.paidBy ?? null,
        payBy: null,
      }
    : undefined;
  const deps = {
    bookings: {
      confirm: vi.fn(async () => confirms.shift() ?? { ok: false, reason: 'invalid' }),
      get: vi.fn(async () => live),
      release: vi.fn(async () => ({ ok: true })),
      releaseHold: vi.fn(async () => ({ ok: true })),
    },
    transactions: {
      markBookingSettled: vi.fn(async (id: string) => void settled.push(id)),
      claimRefund: vi.fn(async (_p: string, _id: string, amount: number) => (claimed.push(amount), { ok: true })),
      releaseRefundClaim: vi.fn(async () => undefined),
      settleRefund: vi.fn(async () => undefined),
      unsettledBookingPayments: vi.fn(async () => [] as TransactionRow[]),
      paymentForBooking: vi.fn(async () => undefined),
      // The payment as it stands now: what the test says it is, else the one handed in.
      byId: vi.fn(async () => current),
    },
    gateways: {
      // No refund request on the gateway: the provider cannot refund, so the business must.
      resolveCredentials: vi.fn(async () => ({ ok: true, mode: 'test', cred: {}, gateway: { id: 'mock', ...(opts.refundable === false ? {} : { refund: {} }) } })),
    },
    readConfig: async () => CONFIG,
    notify: async (e: BookingEvent) => void told.push(e),
    reference: (_p: string, id: string) => `ref-${id}`,
    io: {} as never,
    apiBase: () => 'https://sw.test',
    log: { warn: vi.fn(), error: vi.fn() },
  };
  return { payments: new BookingPayments(deps as unknown as BookingPaymentsDeps), deps, told, settled, claimed };
}

describe('★ settling a booking’s payment', () => {
  it('confirms the held booking, sends its confirmation with the link to its page and in the customer’s language, and marks it settled', async () => {
    const { payments, told, settled, claimed } = setup({ claimState: 'booked' });
    await payments.paid(txn());
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'booked', reference: 'ref-c1', locale: 'de' });
    expect(settled).toEqual(['t1']);
    expect(claimed).toEqual([]);
  });

  it('★ never refunds a booking that still holds because the project was busy for a moment: the sweep tries again', async () => {
    const { payments, told, settled, claimed } = setup({ confirm: [{ ok: false, reason: 'busy' }], claimState: 'hold' });
    await payments.paid(txn());
    expect(claimed).toEqual([]);
    expect(told).toEqual([]);
    expect(settled).toEqual([]);
  });

  it('★ finishes a settlement interrupted after its confirmation, rather than refunding a booking that stands', async () => {
    const { payments, told, settled, claimed } = setup({ confirm: [{ ok: false, reason: 'invalid' }], claimState: 'booked' });
    await payments.paid(txn());
    expect(claimed).toEqual([]);
    expect(told.map((e) => e.kind)).toEqual(['booked']);
    expect(settled).toEqual(['t1']);
  });

  it('★ a refund the provider cannot make is the business’s: both sides are told, from what the payment kept of the booking', async () => {
    const { payments, told, settled, claimed } = setup({ confirm: [{ ok: false, reason: 'unknown-claim' }], claimState: null, refundable: false });
    await payments.paid(txn());
    // Nothing claimed: the provider was never going to be asked.
    expect(claimed).toEqual([]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'refunded', refund: 'manual', locale: 'de' });
    expect(told[0]!.claim).toMatchObject({ id: 'c1', resourceId: 'anna', units: 1, customer: { name: 'Ada', email: 'ada@example.test' } });
    expect(told[0]!.claim.startAt.getTime()).toBe(START);
    expect(settled).toEqual(['t1']);
  });

  it('★ reads a refund claimed long ago with no outcome as unconfirmed: never refunded twice, and the business checks', async () => {
    const claimedLongAgo = txn({ refundedMinor: 4500, updatedAt: new Date(Date.now() - 3_600_000) });
    const { payments, told, claimed, settled } = setup({ confirm: [{ ok: false, reason: 'lapsed' }], claimState: 'hold', current: claimedLongAgo });
    await payments.paid(txn());
    expect(claimed).toEqual([]);
    expect(told[0]).toMatchObject({ kind: 'refunded', refund: 'manual' });
    expect(settled).toEqual(['t1']);
  });

  it('★ leaves a refund another pass claimed moments ago to that pass: no second refund, no mail, not settled', async () => {
    const claimedJustNow = txn({ refundedMinor: 4500, updatedAt: new Date() });
    const { payments, told, claimed, settled } = setup({ confirm: [{ ok: false, reason: 'lapsed' }], claimState: 'hold', current: claimedJustNow });
    await payments.paid(txn());
    expect(claimed).toEqual([]);
    expect(told).toEqual([]);
    expect(settled).toEqual([]);
  });

  it('gives back only a hold when a checkout closes unpaid, through the project’s queue', async () => {
    const { payments, deps } = setup();
    await payments.unpaid(txn({ status: 'failed' }));
    expect(deps.bookings.releaseHold).toHaveBeenCalledWith('p1', 'c1');
    expect(deps.bookings.release).not.toHaveBeenCalled();
  });

  it('★ refunds a second payment for a booking another payment already booked, and mails nothing', async () => {
    const { payments, deps, told, settled, claimed } = setup({ confirm: [{ ok: false, reason: 'invalid' }], claimState: 'booked', paidBy: 'the-first' });
    deps.transactions.byId.mockResolvedValueOnce(txn() as never).mockResolvedValueOnce(txn({ status: 'refunded', refundedMinor: 4500 }) as never);
    await payments.paid(txn());
    expect(claimed).toEqual([4500]);
    expect(told).toEqual([]);
    expect(settled).toEqual(['t1']);
  });

  it('★ tells only the business when a second payment cannot be refunded from here', async () => {
    const { payments, told, settled } = setup({ confirm: [{ ok: false, reason: 'invalid' }], claimState: 'booked', paidBy: 'the-first', refundable: false });
    await payments.paid(txn());
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'refunded', refund: 'manual', duplicate: true, only: 'business' });
    expect(settled).toEqual(['t1']);
  });

  it('the sweep settles each one it finds, and one failure does not stop the rest', async () => {
    const { payments, deps, settled } = setup({ confirm: [{ ok: true }, { ok: true }], claimState: 'booked' });
    deps.transactions.unsettledBookingPayments.mockResolvedValue([txn({ id: 'a' }), txn({ id: 'b' })]);
    deps.bookings.confirm.mockRejectedValueOnce(new Error('database gone'));
    expect(await payments.recover(new Date())).toBe(2);
    expect(settled).toEqual(['b']);
    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });

  it('★ keeps the payment of a booking cancelled too late for a refund, and marks it settled so no sweep refunds it later', async () => {
    const { payments, deps, claimed, settled } = setup();
    deps.transactions.paymentForBooking.mockResolvedValue(txn() as never);
    expect(await payments.cancelMoney('p1', 'c1', false)).toBe('none');
    expect(claimed).toEqual([]);
    expect(settled).toEqual(['t1']);
  });

  it('reads a payment refunded before (a cancellation retried) as refunded, and refunds nothing more', async () => {
    const { payments, deps, claimed } = setup();
    deps.transactions.paymentForBooking.mockResolvedValue(txn({ status: 'refunded', refundedMinor: 4500 }) as never);
    expect(await payments.cancelMoney('p1', 'c1', true)).toBe('refunded');
    expect(await payments.cancelMoney('p1', 'c1', false)).toBe('refunded');
    expect(claimed).toEqual([]);
  });

  it('★ refunds in full what was paid for a booking the business cancels, and marks it settled so the sweep never refunds it again', async () => {
    const { payments, deps, claimed, settled } = setup();
    expect(await payments.refundCancelled('p1', 'c1')).toBeUndefined();
    deps.transactions.paymentForBooking.mockResolvedValue(txn({ refundedMinor: 500 }) as never);
    deps.transactions.byId.mockResolvedValueOnce(txn({ refundedMinor: 500 }) as never).mockResolvedValueOnce(txn({ status: 'refunded', refundedMinor: 4500 }) as never);
    expect(await payments.refundCancelled('p1', 'c1')).toBe('refunded');
    expect(claimed).toEqual([4000]);
    expect(settled).toEqual(['t1']);
  });
});

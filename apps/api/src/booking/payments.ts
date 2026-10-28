import { fromMinorUnits, type BookingConfig, type BookingOffering } from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { BookingSnapshot, ShopTransactionRepository, TransactionRow } from '../repo/shop-transactions.js';
import type { GatewayRepository } from '../payments/gateways.js';
import { createCheckoutSession, GatewayError, refundPayment, type ExecutorIo } from '../payments/executor.js';
import type { BookingSettlement } from '../payments/settle.js';
import { refundScope } from '../http/payment-admin-routes.js';
import type { BookingService } from './service.js';
import type { ClaimRow } from './claims.js';
import type { BookingEvent } from './notify.js';
import { DAY_MS } from './zoned.js';

/**
 * BOOKING PREPAYMENT: a booking of a priced offering is paid before it is confirmed, through the project's own
 * payment provider (the shop's machinery: a transaction, the provider's checkout page, its webhook).
 *
 *   booked → the time is HELD for the customer while they pay → the webhook confirms it (and its mails go out),
 *   or the payment fails or runs out and the hold is given back.
 *
 * ★ Money rules (the shop's, kept): the amount is the platform's, never the visitor's; the webhook is the only
 * thing that resolves a payment; a refund is CLAIMED before the provider is asked, and given back only when the
 * provider definitely refused. ★ A payment that arrives after its hold ran out (or after its checkout was closed
 * as failed or expired) does not book over someone else: it is refunded, and both sides are told by mail.
 * ★ Every payment is SETTLED exactly once (confirmed and mailed, or refunded), and marked so: one a crash or a busy
 * moment left unsettled is finished by the maintenance sweep (`recover`).
 */

export const BOOKING_PAY_LIMITS = {
  /** How long a booking's time is held while its customer pays. */
  holdMs: 20 * 60_000,
} as const;

/** The channel a booking's transaction is filed under (it is not one of the shop's). */
export const BOOKING_CHANNEL = 'booking';

/** The most an order line counts (the shop's line schema). */
const MAX_LINE_QTY = 99;

/** A refund claimed this recently with no outcome yet may still be on its way: its own pass settles and mails it. */
const REFUND_IN_FLIGHT_MS = 10 * 60_000;

/**
 * What a refund's outcome means for the people told, from the payment as it now stands: refunded, `manual` (refused,
 * or no answer: the business checks its dashboard and refunds there if need be), or `in-flight` (claimed moments ago
 * by another pass, whose own outcome is the one to tell).
 */
function refundWord(
  outcome: 'refunded' | 'refused' | 'unconfirmed' | 'nothing',
  now: TransactionRow,
  at: number,
): 'refunded' | 'manual' | 'in-flight' {
  if (outcome === 'refunded' || now.status === 'refunded') return 'refunded';
  if (outcome === 'nothing' && now.refundedMinor > 0 && at - now.updatedAt.getTime() < REFUND_IN_FLIGHT_MS) return 'in-flight';
  return 'manual';
}

/** The booking as its payment kept it, shaped as the claim its mails are written from. */
function fromSnapshot(id: string, snap: BookingSnapshot, buyer: Record<string, string>): BookingEvent['claim'] & { offeringId: string } {
  return {
    id,
    offeringId: snap.offeringId,
    resourceId: snap.resourceId,
    startAt: new Date(snap.start),
    endAt: new Date(snap.end),
    units: snap.units,
    customer: buyer,
    state: 'hold',
  };
}

/** What a booking of the offering costs: per booking, per unit booked, or per night or day of a `days` offering. */
export function priceOf(offering: BookingOffering, units: number, start: number, end: number): number | null {
  const price = offering.price;
  if (!price) return null;
  if (price.per === 'unit') return price.amountMinor * Math.max(1, units);
  if (price.per === 'night' && offering.mode === 'days') return price.amountMinor * Math.max(1, Math.round((end - start) / DAY_MS));
  return price.amountMinor;
}

export interface BookingPaymentsDeps {
  bookings: BookingService;
  transactions: ShopTransactionRepository;
  gateways: GatewayRepository;
  readConfig: (projectId: string) => Promise<BookingConfig | null>;
  /** The booking's mails (confirmation, cancellation). Never throws. */
  notify: (event: BookingEvent) => Promise<void>;
  /** The booking's signed reference, for the link to its own page in the confirmation. */
  reference: (projectId: string, claimId: string) => string;
  io: ExecutorIo;
  /** The platform's public API base, for the provider's webhook. */
  apiBase: () => string;
  log?: { warn: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void };
}

const system = (projectId: string): ProjectContext => ({ userId: 'system', projectId, role: 'owner' });

export class BookingPayments implements BookingSettlement {
  constructor(private readonly deps: BookingPaymentsDeps) {}

  /**
   * Opens the payment of a HELD booking: a transaction for its price, and the provider's checkout page. The
   * customer comes back to `returnUrl` (the business's own booking page). On any failure the hold is given back.
   */
  async start(
    projectId: string,
    claim: ClaimRow,
    offering: BookingOffering,
    config: BookingConfig,
    customer: Record<string, string>,
    urls: { return: string; cancel: string },
    /** The language of the page booked on, for the booking's mails. */
    locale?: string,
  ): Promise<{ ok: true; redirectUrl: string } | { ok: false; error: string }> {
    const fail = async (error: string): Promise<{ ok: false; error: string }> => {
      await this.deps.bookings.releaseHold(projectId, claim.id).catch(() => undefined);
      return { ok: false, error };
    };
    const amount = priceOf(offering, claim.units, claim.startAt.getTime(), claim.endAt.getTime());
    if (!config.payment || amount === null) return fail('payment is not set up for this offering');
    const resolved = await this.deps.gateways.resolveCredentials(system(projectId), config.payment.gatewayId);
    if (!resolved.ok) {
      this.deps.log?.warn({ projectId, gatewayId: config.payment.gatewayId, reason: resolved.reason }, 'booking payment refused: the provider is not usable');
      return fail('payment is temporarily unavailable');
    }
    const currency = config.payment.currency;
    if (resolved.gateway.currencies?.length && !resolved.gateway.currencies.includes(currency)) return fail('payment is temporarily unavailable');
    const units = offering.price?.per === 'booking' ? 1 : Math.max(1, Math.round(amount / offering.price!.amountMinor));
    // An order line counts at most 99: a longer stay is one line for the whole of it.
    const line = units <= MAX_LINE_QTY ? { unitMinor: offering.price!.amountMinor, qty: units } : { unitMinor: amount, qty: 1 };
    const snapshot: BookingSnapshot = {
      offeringId: offering.id,
      resourceId: claim.resourceId,
      start: claim.startAt.getTime(),
      end: claim.endAt.getTime(),
      units: claim.units,
      ...(locale ? { locale } : {}),
    };
    const txn = await this.deps.transactions.create({
      projectId,
      channelKey: BOOKING_CHANNEL,
      gatewayId: resolved.gateway.id,
      mode: resolved.mode,
      currency,
      amounts: { subtotalMinor: amount, shippingMinor: 0, taxMinor: 0, totalMinor: amount },
      lines: [{ sku: `booking:${offering.id}`, name: offering.name, ...line, lineMinor: amount }],
      buyer: customer,
      catalogDigest: 'booking',
      // A booking's mails are its own: the shop's order mails are never owed for it.
      owesNotification: false,
      bookingClaimId: claim.id,
      bookingSnapshot: snapshot,
      ...(customer.email ? { customerEmail: customer.email } : {}),
    });
    try {
      const session = await createCheckoutSession(
        resolved.gateway,
        resolved.mode,
        {
          cred: resolved.cred,
          amount: { minor: amount, decimal: fromMinorUnits(amount, currency), currency },
          txn: { id: txn.id, publicToken: txn.publicToken, reference: txn.id },
          url: { return: urls.return, cancel: urls.cancel, webhook: `${this.deps.apiBase()}/pay/${projectId}/webhook/${resolved.gateway.id}` },
          field: customer,
          text: { order_name: offering.name.slice(0, 120) },
        },
        this.deps.io,
      );
      await this.deps.transactions.attachProviderRef(txn.id, session.ref);
      return { ok: true, redirectUrl: session.redirectUrl };
    } catch (err) {
      await this.deps.transactions.advance(txn.id, 'failed').catch(() => undefined);
      this.deps.log?.error({ projectId, kind: err instanceof GatewayError ? err.kind : 'upstream' }, 'could not open a booking payment');
      return fail('the payment provider could not start the payment');
    }
  }

  /**
   * The prepayment arrived. The held booking is confirmed and its mails go out; if its time was lost meanwhile (the
   * hold ran out, or was given back when the checkout closed), the money is refunded and both sides are told.
   * ★ Settled once: a busy moment leaves it unsettled for the sweep rather than refunding a booking that still holds.
   */
  async paid(txn: TransactionRow): Promise<void> {
    const projectId = txn.projectId;
    const claimId = txn.bookingClaimId!;
    const confirmed = await this.deps.bookings.confirm(projectId, claimId);
    if (confirmed.ok) {
      await this.tell(txn, 'booked');
      await this.deps.transactions.markBookingSettled(txn.id);
      return;
    }
    // Confirmed already, its settlement interrupted before it was marked (a crash, a lost reply): finish it. The
    // confirmation may go a second time; a customer never hearing at all is worse.
    if ((await this.deps.bookings.get(projectId, claimId))?.state === 'booked') {
      await this.tell(txn, 'booked');
      await this.deps.transactions.markBookingSettled(txn.id);
      return;
    }
    // The project's queue is full for a moment: nothing is lost yet, and the sweep tries again.
    if (confirmed.reason === 'busy') {
      this.deps.log?.warn({ projectId, txnId: txn.id }, 'a paid booking could not be confirmed yet (busy); the sweep will finish it');
      return;
    }
    // ★ Its time is gone, and may be someone else's now: never book over them. The money goes back.
    this.deps.log?.warn({ projectId, txnId: txn.id, reason: confirmed.reason }, 'a booking was paid after its time could no longer be held; refunding it');
    const word = await this.refundAll(txn);
    // Another pass is refunding it right now: its outcome is the one to tell, and it settles the payment.
    if (word === 'in-flight') return;
    await this.tell(txn, 'refunded', word);
    await this.deps.transactions.markBookingSettled(txn.id);
  }

  /** Refunds what is still outstanding, and says how that stands, read afresh (another pass may have moved it). */
  private async refundAll(txn: TransactionRow): Promise<'refunded' | 'manual' | 'in-flight'> {
    const fresh = (await this.deps.transactions.byId(txn.projectId, txn.id)) ?? txn;
    const outcome = await this.refund(fresh, fresh.amounts.totalMinor - fresh.refundedMinor);
    const after = (await this.deps.transactions.byId(txn.projectId, txn.id)) ?? fresh;
    return refundWord(outcome, after, Date.now());
  }

  /**
   * It will never be paid: the hold is given back. ★ Only while it is a hold, decided in the project's queue: a
   * payment that came after all may have confirmed it in the meantime.
   */
  async unpaid(txn: TransactionRow): Promise<void> {
    await this.deps.bookings.releaseHold(txn.projectId, txn.bookingClaimId!);
  }

  /**
   * The money of a booking being cancelled, decided BEFORE the cancellation (inside its cancel lock): `inFull` refunds
   * what is still outstanding; otherwise the payment is kept (`none`). Undefined when nothing was paid for it;
   * `refunded` when it already was (a cancellation retried after a busy moment); `manual` when the provider would not
   * refund it (or did not answer), so the business checks its dashboard.
   * ★ Settled either way: the sweep must never take it up again and refund what was kept, or refund twice.
   */
  async cancelMoney(projectId: string, claimId: string, inFull: boolean): Promise<'refunded' | 'manual' | 'none' | undefined> {
    const txn = await this.deps.transactions.paymentForBooking(projectId, claimId);
    if (!txn) return undefined;
    let word: 'refunded' | 'manual' | 'none';
    if (txn.status === 'refunded') word = 'refunded';
    else if (!inFull) word = 'none';
    else word = (await this.refundAll(txn)) === 'refunded' ? 'refunded' : 'manual';
    await this.deps.transactions.markBookingSettled(txn.id);
    return word;
  }

  /** The business cancelled a booking: whatever was paid for it goes back in full. */
  async refundCancelled(projectId: string, claimId: string): Promise<'refunded' | 'manual' | undefined> {
    const word = await this.cancelMoney(projectId, claimId, true);
    return word === 'none' ? undefined : word;
  }

  /**
   * The sweep's part: settles paid booking transactions whose settlement never finished. One failure never stops
   * the rest. Returns how many it took up.
   */
  async recover(now: Date): Promise<number> {
    const due = await this.deps.transactions.unsettledBookingPayments(now);
    for (const txn of due) {
      try {
        await this.paid(txn);
      } catch (err) {
        this.deps.log?.error({ err, projectId: txn.projectId, txnId: txn.id }, 'a booking payment could not be settled; trying again next pass');
      }
    }
    return due.length;
  }

  /** The booking's mail for a settled payment: from the claim while it exists, else from what the payment kept. */
  private async tell(txn: TransactionRow, kind: 'booked' | 'refunded', refund?: 'refunded' | 'manual'): Promise<void> {
    const projectId = txn.projectId;
    const snap = txn.bookingSnapshot;
    const live = await this.deps.bookings.get(projectId, txn.bookingClaimId!);
    const config = await this.deps.readConfig(projectId);
    const offering = config?.offerings.find((o) => o.id === (live?.offeringId ?? snap?.offeringId));
    const claim = live ?? (snap ? fromSnapshot(txn.bookingClaimId!, snap, txn.buyer) : undefined);
    if (!config || !offering || !claim) {
      // A refund to make by hand that no mail can carry is an operator's to see: logged as an error.
      const log = refund === 'manual' ? this.deps.log?.error : this.deps.log?.warn;
      log?.call(this.deps.log, { projectId, txnId: txn.id, kind, refund }, 'a booking payment settled without mails: its booking or offering is gone');
      return;
    }
    await this.deps.notify({
      kind,
      projectId,
      claim,
      offering,
      config,
      ...(kind === 'booked' ? { reference: this.deps.reference(projectId, claim.id) } : {}),
      ...(refund ? { refund } : {}),
      ...(snap?.locale ? { locale: snap.locale } : {}),
    });
  }

  /**
   * Gives money back for a booking. ★ CLAIMED before the provider is asked, so a retry cannot refund twice; given
   * back only when the provider definitely refused (a timeout may mean it went through).
   */
  async refund(txn: TransactionRow, amountMinor: number): Promise<'refunded' | 'refused' | 'unconfirmed' | 'nothing'> {
    if (amountMinor <= 0) return 'nothing';
    const resolved = await this.deps.gateways.resolveCredentials(system(txn.projectId), txn.gatewayId);
    if (!resolved.ok || !resolved.gateway.refund || resolved.mode !== txn.mode) {
      this.deps.log?.error({ projectId: txn.projectId, txnId: txn.id }, 'a booking refund could not be issued: refund it in the provider’s dashboard');
      return 'refused';
    }
    const claim = await this.deps.transactions.claimRefund(txn.projectId, txn.id, amountMinor);
    if (!claim.ok) return 'nothing';
    try {
      await refundPayment(resolved.gateway, resolved.mode, refundScope(resolved.cred, txn, amountMinor), this.deps.io);
    } catch (err) {
      const kind = err instanceof GatewayError ? err.kind : 'upstream';
      const status = err instanceof GatewayError ? err.status : undefined;
      const definitelyRefused = kind === 'config' || (kind === 'upstream' && status !== undefined && status >= 400 && status < 500);
      if (definitelyRefused) await this.deps.transactions.releaseRefundClaim(txn.id, amountMinor);
      this.deps.log?.error({ projectId: txn.projectId, txnId: txn.id, kind, status, released: definitelyRefused }, 'a booking refund failed');
      return definitelyRefused ? 'refused' : 'unconfirmed';
    }
    await this.deps.transactions.settleRefund(txn.projectId, txn.id);
    return 'refunded';
  }
}

import type { ShopStockRepository } from '../repo/shop-stock.js';
import type { TransactionRow } from '../repo/shop-transactions.js';

/**
 * WHAT A PAYMENT'S OUTCOME DOES, once its transaction has moved (paid; or failed, expired, cancelled): a shop
 * order's held stock is committed or given back; a BOOKING's prepayment confirms the booking or releases its hold.
 *
 * ★ One place for it. Four paths end a transaction (the webhook, its failure branch, the expiry sweep, the
 * reconciler); each used to commit or release stock itself, which a booking's transaction (its lines name no stock)
 * must never do. Call it only after the transaction's own move succeeded (`advance` said `advanced`), so an outcome
 * is acted on once.
 */
export interface Settlement {
  paid(txn: TransactionRow): Promise<void>;
  unpaid(txn: TransactionRow): Promise<void>;
}

export interface BookingSettlement {
  /** The booking's prepayment arrived: it is confirmed (or, if its time was lost meanwhile, refunded). */
  paid(txn: TransactionRow): Promise<void>;
  /** It will never be paid: the booking's hold is given back. */
  unpaid(txn: TransactionRow): Promise<void>;
}

export function makeSettlement(deps: { stock: ShopStockRepository; booking?: BookingSettlement }): Settlement {
  const lines = (txn: TransactionRow) => txn.lines.map((l) => ({ sku: l.sku, qty: l.qty }));
  return {
    async paid(txn) {
      if (txn.bookingClaimId) return deps.booking?.paid(txn);
      // A preview rehearsal reserved nothing, so committing would increment `sold` against stock it never held.
      if (!txn.preview) await deps.stock.commit(txn.projectId, lines(txn));
    },
    async unpaid(txn) {
      if (txn.bookingClaimId) return deps.booking?.unpaid(txn);
      if (!txn.preview) await deps.stock.release(txn.projectId, lines(txn));
    },
  };
}

/** Whether a paid transaction owes the shop's order mails: a booking's has mails of its own. */
export const owesOrderMail = (txn: Pick<TransactionRow, 'bookingClaimId'>): boolean => !txn.bookingClaimId;

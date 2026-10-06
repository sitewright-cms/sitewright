import { and, eq, lte, or, sql, inArray, desc, isNotNull, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  canTransitionPayment,
  FULFILMENT_TRANSITIONS,
  TRANSACTION_STATUSES,
  type FulfilmentState,
  type PaymentMode,
  type TransactionLine,
  type TransactionAmounts,
  fromMinorUnits,
  type TransactionPublic,
  type TransactionStatus,
} from '@sitewright/schema';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { shopTransactions, shopPaymentEvents, shopFiltered } from '../db/schema.js';

/**
 * TRANSACTIONS.
 *
 * ★ Every status change goes through ONE conditional UPDATE whose WHERE carries the statuses the
 * move is legal from, is judged by `rowsAffected`, and is then RE-READ. A `SELECT` first and an
 * UPDATE second is the shape that produced four duplicate-send defects in the mail work; here the
 * same shape would let a replayed `paid` fire a second receipt and commit stock twice.
 *
 * ★ And the move is only ever made by a VERIFIED webhook or by reconciliation against the provider.
 * The buyer's return navigation is a navigation they can forge, and nothing in this file trusts it.
 */

/** How long an unpaid session stays reconcilable before it may be swept to `expired`. */
export const TRANSACTION_TTL_MS = 36 * 60 * 60 * 1000;

/** A `publicToken` — 32 bytes of url-safe randomness. Separate from `id` so a shared
 *  thank-you URL cannot be walked to reach another order, and so it can be rotated. */
function newPublicToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface CreateTransactionInput {
  projectId: string;
  channelKey: string;
  gatewayId: string;
  mode: PaymentMode;
  currency: string;
  amounts: TransactionAmounts;
  lines: TransactionLine[];
  buyer: Record<string, string>;
  catalogDigest: string;
  /** Whether the shop owes somebody an email once this is paid. */
  owesNotification: boolean;
  /** True for a DRAFT PREVIEW checkout: it holds no stock, so it must not commit any. */
  preview?: boolean;
  customerEmail?: string;
}

export interface TransactionRow {
  id: string;
  projectId: string;
  channelKey: string;
  gatewayId: string;
  mode: PaymentMode;
  /** A draft-preview rehearsal rather than a real order — see the column's note. */
  preview: boolean;
  status: TransactionStatus;
  fulfilment: FulfilmentState;
  currency: string;
  amounts: TransactionAmounts;
  refundedMinor: number;
  lines: TransactionLine[];
  buyer: Record<string, string>;
  catalogDigest: string;
  providerRef: string | null;
  publicToken: string;
  customerEmail: string | null;
  /** Attempts already made for each mail — the runner's back-off input. */
  notifyAttempts: number;
  receiptAttempts: number;
  createdAt: Date;
  paidAt: Date | null;
}

/** Shapes a DB row into the domain object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle row type, narrowed by the table definition
function toRow(r: any): TransactionRow {
  return {
    id: r.id,
    projectId: r.projectId,
    channelKey: r.channelKey,
    gatewayId: r.gatewayId,
    mode: r.mode,
    preview: r.preview === true,
    status: r.status,
    fulfilment: r.fulfilment,
    currency: r.currency,
    amounts: {
      subtotalMinor: r.subtotalMinor,
      shippingMinor: r.shippingMinor,
      taxMinor: r.taxMinor,
      totalMinor: r.totalMinor,
    },
    refundedMinor: r.refundedMinor,
    lines: r.lines ?? [],
    buyer: r.buyer ?? {},
    catalogDigest: r.catalogDigest,
    providerRef: r.providerRef ?? null,
    publicToken: r.publicToken,
    customerEmail: r.customerEmail ?? null,
    notifyAttempts: r.notifyAttempts ?? 0,
    receiptAttempts: r.receiptAttempts ?? 0,
    createdAt: r.createdAt,
    paidAt: r.paidAt ?? null,
  };
}

/** The result of trying to advance a transaction. `stale` means the move was not legal from here. */
export type AdvanceResult =
  | { outcome: 'advanced'; row: TransactionRow }
  | { outcome: 'stale'; row: TransactionRow }
  | { outcome: 'not-found' };

export class ShopTransactionRepository {
  constructor(private readonly db: Database) {}

  /** Opens a transaction in `created`. No provider reference yet — that arrives from the session. */
  async create(input: CreateTransactionInput): Promise<TransactionRow> {
    const now = new Date();
    const id = newId();
    await this.db.insert(shopTransactions).values({
      id,
      projectId: input.projectId,
      channelKey: input.channelKey,
      gatewayId: input.gatewayId,
      mode: input.mode,
      ...(input.preview ? { preview: true } : {}),
      status: 'created',
      fulfilment: 'new',
      currency: input.currency,
      subtotalMinor: input.amounts.subtotalMinor,
      shippingMinor: input.amounts.shippingMinor,
      taxMinor: input.amounts.taxMinor,
      totalMinor: input.amounts.totalMinor,
      lines: input.lines,
      buyer: input.buyer,
      catalogDigest: input.catalogDigest,
      publicToken: newPublicToken(),
      // ★ `na` until the payment is real. `pending` must mean "somebody is owed an email", so an
      // unpaid session is not an outstanding obligation — and a cancelled one never becomes one.
      notifyState: 'na',
      receiptState: 'na',
      ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + TRANSACTION_TTL_MS),
    });
    const row = await this.byId(input.projectId, id);
    if (!row) throw new Error('the transaction vanished immediately after being created');
    return row;
  }

  /** Records the provider's own id for the session, so a webhook can find this row. */
  async attachProviderRef(id: string, providerRef: string): Promise<void> {
    await this.db.update(shopTransactions).set({ providerRef, updatedAt: new Date() }).where(eq(shopTransactions.id, id));
  }

  async byId(projectId: string, id: string): Promise<TransactionRow | undefined> {
    const [r] = await this.db
      .select()
      .from(shopTransactions)
      .where(and(eq(shopTransactions.projectId, projectId), eq(shopTransactions.id, id)));
    return r ? toRow(r) : undefined;
  }

  /** Looks a transaction up by its opaque public token — the thank-you page's only handle. */
  async byPublicToken(projectId: string, token: string): Promise<TransactionRow | undefined> {
    // Bounded before the query: a multi-kilobyte token is not a token.
    if (token.length < 16 || token.length > 128) return undefined;
    const [r] = await this.db
      .select()
      .from(shopTransactions)
      .where(and(eq(shopTransactions.projectId, projectId), eq(shopTransactions.publicToken, token)));
    return r ? toRow(r) : undefined;
  }

  /** The webhook's join: a provider reference is unique WITHIN a gateway, never globally. */
  async byProviderRef(gatewayId: string, providerRef: string): Promise<TransactionRow | undefined> {
    if (!providerRef || providerRef.length > 255) return undefined;
    const [r] = await this.db
      .select()
      .from(shopTransactions)
      .where(and(eq(shopTransactions.gatewayId, gatewayId), eq(shopTransactions.providerRef, providerRef)));
    return r ? toRow(r) : undefined;
  }

  /**
   * Moves a transaction's payment status.
   *
   * ★ THE WHOLE POINT: the legal source statuses go INSIDE the WHERE, so a replayed or re-delivered
   * event matches no row and is reported `stale` rather than re-running everything that follows a
   * payment. The row is then re-read, so the caller acts on what it ACTUALLY became rather than on
   * what it assumed.
   */
  async advance(
    id: string,
    to: TransactionStatus,
    opts: { paidAt?: Date; providerPaymentRef?: string; refundedMinor?: number; owesNotification?: boolean; customerEmail?: string } = {},
  ): Promise<AdvanceResult> {
    // Derived from the canonical list rather than re-typed: a status added to TRANSACTION_STATUSES
    // without updating a hand-written copy here would silently never be a legal `from` state.
    const legalFrom = TRANSACTION_STATUSES.filter((from) => canTransitionPayment(from, to));
    if (legalFrom.length === 0) {
      const existing = await this.anyById(id);
      return existing ? { outcome: 'stale', row: existing } : { outcome: 'not-found' };
    }
    const now = new Date();
    const paid = to === 'paid';
    const res = await this.db
      .update(shopTransactions)
      .set({
        status: to,
        updatedAt: now,
        ...(paid ? { paidAt: opts.paidAt ?? now } : {}),
        ...(opts.providerPaymentRef ? { providerPaymentRef: opts.providerPaymentRef } : {}),
        ...(opts.refundedMinor !== undefined ? { refundedMinor: opts.refundedMinor } : {}),
        ...(opts.customerEmail ? { customerEmail: opts.customerEmail } : {}),
        // ★ Both mail obligations are armed HERE, in the same statement that records the payment, and
        // only when the payment actually happened. Arming them anywhere else risks a receipt for an
        // order that was never paid — and arming them in a second statement risks losing them.
        ...(paid && opts.owesNotification
          ? { notifyState: 'pending' as const, notifyNextAt: now, receiptState: (opts.customerEmail ? 'pending' : 'na') as 'pending' | 'na', receiptNextAt: opts.customerEmail ? now : null }
          : {}),
      })
      .where(and(eq(shopTransactions.id, id), inArray(shopTransactions.status, [...legalFrom])));
    const row = await this.anyById(id);
    if (!row) return { outcome: 'not-found' };
    return (res.rowsAffected ?? 0) > 0 ? { outcome: 'advanced', row } : { outcome: 'stale', row };
  }

  /** Project-agnostic read — the webhook path has no tenant context until it has found the row. */
  private async anyById(id: string): Promise<TransactionRow | undefined> {
    const [r] = await this.db.select().from(shopTransactions).where(eq(shopTransactions.id, id));
    return r ? toRow(r) : undefined;
  }

  /**
   * Claims a provider event id, so the work that follows a payment runs exactly once.
   *
   * ★ Returns false when the id was already seen. Providers retry until they get a 2xx and some
   * retry regardless, so without this a replayed `paid` would re-notify, re-receipt and re-commit
   * stock — and a duplicate ORDER CONFIRMATION makes a customer believe they were charged twice.
   *
   * A unique-constraint violation IS the answer, not an error: two concurrent deliveries of the same
   * event race here, and exactly one must win.
   */
  async claimEvent(gatewayId: string, eventId: string, now: Date = new Date()): Promise<boolean> {
    if (!eventId || eventId.length > 255) return false;
    const res = await this.db
      .insert(shopPaymentEvents)
      .values({ gatewayId, eventId, seenAt: now })
      .onConflictDoNothing();
    return (res.rowsAffected ?? 0) > 0;
  }

  /**
   * Claims transactions whose notification or receipt is due.
   *
   * ★ ONE conditional UPDATE per row: the claim marker goes in the WHERE, so two runners racing the
   * same row cannot both send. Then the row is re-read, so the caller acts on what it ACTUALLY became
   * rather than what it assumed. This is the same discipline the stock ledger uses, and it is here
   * for the same reason: the cost of getting it wrong is a customer receiving two confirmations and
   * concluding they were charged twice.
   */
  async claimDueMail(kind: 'notify' | 'receipt', now: Date, leaseMs: number, limit: number): Promise<TransactionRow[]> {
    const stateCol = kind === 'notify' ? shopTransactions.notifyState : shopTransactions.receiptState;
    const nextCol = kind === 'notify' ? shopTransactions.notifyNextAt : shopTransactions.receiptNextAt;
    const claimedCol = kind === 'notify' ? shopTransactions.notifyClaimedAt : shopTransactions.receiptClaimedAt;
    const stale = new Date(now.getTime() - leaseMs);
    const candidates = await this.db
      .select({ id: shopTransactions.id })
      .from(shopTransactions)
      .where(
        and(
          eq(stateCol, 'pending'),
          lte(nextCol, now),
          // A claim older than the lease belonged to a process that died; it may be taken over.
          or(isNull(claimedCol), lte(claimedCol, stale)),
        ),
      )
      .limit(Math.min(Math.max(limit, 1), 100));

    const claimed: TransactionRow[] = [];
    for (const { id } of candidates) {
      const res = await this.db
        .update(shopTransactions)
        .set({ ...(kind === 'notify' ? { notifyClaimedAt: now } : { receiptClaimedAt: now }), updatedAt: now })
        .where(
          and(
            eq(shopTransactions.id, id),
            eq(stateCol, 'pending'),
            lte(nextCol, now),
            or(isNull(claimedCol), lte(claimedCol, stale)),
          ),
        );
      if ((res.rowsAffected ?? 0) === 0) continue; // somebody else won it
      const row = await this.anyById(id);
      if (row) claimed.push(row);
    }
    return claimed;
  }

  /** Records the outcome of one mail attempt. `sent` and `failed` are terminal; `pending` backs off. */
  async recordMail(
    id: string,
    kind: 'notify' | 'receipt',
    outcome: { state: 'sent' } | { state: 'pending'; attempts: number; nextAt: Date; error: string } | { state: 'failed'; attempts: number; error: string },
  ): Promise<void> {
    const common =
      outcome.state === 'sent'
        ? { state: 'sent' as const, attempts: undefined, nextAt: null, error: null }
        : outcome.state === 'pending'
          ? { state: 'pending' as const, attempts: outcome.attempts, nextAt: outcome.nextAt, error: outcome.error }
          : { state: 'failed' as const, attempts: outcome.attempts, nextAt: null, error: outcome.error };
    const values =
      kind === 'notify'
        ? {
            notifyState: common.state,
            ...(common.attempts !== undefined ? { notifyAttempts: common.attempts } : {}),
            notifyNextAt: common.nextAt,
            notifyError: common.error,
            // Cleared whatever the outcome: the attempt concluded, so nothing holds the row.
            notifyClaimedAt: null,
          }
        : {
            receiptState: common.state,
            ...(common.attempts !== undefined ? { receiptAttempts: common.attempts } : {}),
            receiptNextAt: common.nextAt,
            receiptError: common.error,
            receiptClaimedAt: null,
          };
    await this.db.update(shopTransactions).set({ ...values, updatedAt: new Date() }).where(eq(shopTransactions.id, id));
  }

  /** How many orders are still owed a mail, and why the last attempt failed. For the editor banner. */
  async undeliveredSummary(projectId: string): Promise<{ notify: number; receipt: number; lastError?: string }> {
    const rows = await this.db
      .select()
      .from(shopTransactions)
      .where(and(eq(shopTransactions.projectId, projectId), inArray(shopTransactions.status, ['paid', 'refunded', 'partially_refunded'])));
    let notify = 0;
    let receipt = 0;
    let lastError: string | undefined;
    for (const r of rows) {
      if (r.notifyState === 'pending' || r.notifyState === 'failed') {
        notify += 1;
        lastError = r.notifyError ?? lastError;
      }
      if (r.receiptState === 'pending' || r.receiptState === 'failed') {
        receipt += 1;
        lastError = r.receiptError ?? lastError;
      }
    }
    return { notify, receipt, ...(lastError ? { lastError } : {}) };
  }

  /** Puts a failed mail back in the queue — what an operator clicks after fixing SMTP. */
  async requeueMail(projectId: string, id: string, kind: 'notify' | 'receipt'): Promise<boolean> {
    const row = await this.byId(projectId, id);
    if (!row) return false;
    const now = new Date();
    const values =
      kind === 'notify'
        ? { notifyState: 'pending' as const, notifyAttempts: 0, notifyNextAt: now, notifyError: null, notifyClaimedAt: null }
        : { receiptState: 'pending' as const, receiptAttempts: 0, receiptNextAt: now, receiptError: null, receiptClaimedAt: null };
    const res = await this.db.update(shopTransactions).set({ ...values, updatedAt: now }).where(eq(shopTransactions.id, id));
    return (res.rowsAffected ?? 0) > 0;
  }

  /** Forgets spent event ids older than `olderThan`. Replay protection only needs a window. */
  async reapEvents(olderThan: Date): Promise<number> {
    const res = await this.db.delete(shopPaymentEvents).where(lte(shopPaymentEvents.seenAt, olderThan));
    return res.rowsAffected ?? 0;
  }

  /** Moves an operator's fulfilment state, refusing an illegal or backwards move. */
  async setFulfilment(
    projectId: string,
    id: string,
    to: FulfilmentState,
    note?: string,
  ): Promise<{ ok: true; row: TransactionRow } | { ok: false; reason: 'not-found' | 'illegal' }> {
    const row = await this.byId(projectId, id);
    if (!row) return { ok: false, reason: 'not-found' };
     
    const allowed = FULFILMENT_TRANSITIONS[row.fulfilment] ?? [];
    if (!allowed.includes(to)) return { ok: false, reason: 'illegal' };
    const res = await this.db
      .update(shopTransactions)
      .set({ fulfilment: to, ...(note !== undefined ? { fulfilmentNote: note } : {}), updatedAt: new Date() })
      // The CURRENT state is in the WHERE, so two operators clicking at once cannot both advance it.
      .where(and(eq(shopTransactions.id, id), eq(shopTransactions.fulfilment, row.fulfilment)));
    if ((res.rowsAffected ?? 0) === 0) return { ok: false, reason: 'illegal' };
    const after = await this.byId(projectId, id);
    return after ? { ok: true, row: after } : { ok: false, reason: 'not-found' };
  }

  /** One page of a project's transactions, newest first. */
  async list(projectId: string, opts: { limit?: number; offset?: number; status?: TransactionStatus } = {}): Promise<{ items: TransactionRow[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const where = opts.status
      ? and(eq(shopTransactions.projectId, projectId), eq(shopTransactions.status, opts.status))
      : eq(shopTransactions.projectId, projectId);
    const rows = await this.db.select().from(shopTransactions).where(where).orderBy(desc(shopTransactions.createdAt)).limit(limit).offset(offset);
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)` }).from(shopTransactions).where(where);
    return { items: rows.map(toRow), total: Number(n) };
  }

  /**
   * Transactions that are still unresolved and old enough to be worth asking the provider about.
   *
   * ★ This is the safeguard that makes "the webhook is the only truth" survivable. A webhook that
   * never arrives — a misconfigured endpoint, a firewalled instance, a provider outage — would
   * otherwise leave a PAID order permanently invisible to the merchant.
   */
  async dueForReconciliation(now: Date, staleAfterMs: number, limit: number): Promise<TransactionRow[]> {
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const rows = await this.db
      .select()
      .from(shopTransactions)
      .where(
        and(
          inArray(shopTransactions.status, ['created', 'pending']),
          lte(shopTransactions.updatedAt, cutoff),
          isNotNull(shopTransactions.providerRef),
        ),
      )
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map(toRow);
  }

  /** Sweeps sessions past their TTL to `expired`, so stock they hold can be released. */
  async expireStale(now: Date = new Date(), limit = 100): Promise<TransactionRow[]> {
    const rows = await this.db
      .select()
      .from(shopTransactions)
      .where(and(inArray(shopTransactions.status, ['created', 'pending']), lte(shopTransactions.expiresAt, now)))
      .limit(limit);
    const expired: TransactionRow[] = [];
    for (const r of rows) {
      const res = await this.advance(r.id, 'expired');
      if (res.outcome === 'advanced') expired.push(res.row);
    }
    return expired;
  }

  /**
   * What the thank-you page is allowed to see.
   *
   * ★ Allowlisted field by field. A blocklist would leak the merchant's notification address, the
   * provider references and the gateway id the first time this table grew a column — and the page is
   * reachable by anybody holding the token.
   */
  toPublic(row: TransactionRow): TransactionPublic {
    return {
      status: row.status,
      fulfilment: row.fulfilment,
      currency: row.currency,
      amounts: row.amounts,
      lines: row.lines,
      buyer: row.buyer,
      // ★ Formatted HERE, by the currency's real exponent — never by a display preference, and never
      // by arithmetic in the browser.
      display: {
        subtotal: fromMinorUnits(row.amounts.subtotalMinor, row.currency),
        shipping: fromMinorUnits(row.amounts.shippingMinor, row.currency),
        tax: fromMinorUnits(row.amounts.taxMinor, row.currency),
        total: fromMinorUnits(row.amounts.totalMinor, row.currency),
      },
      lineDisplay: row.lines.map((l) => fromMinorUnits(l.lineMinor, row.currency)),
      createdAt: row.createdAt.toISOString(),
      ...(row.paidAt ? { paidAt: row.paidAt.toISOString() } : {}),
    };
  }

  /**
   * Counts a checkout the bot gates refused.
   *
   * Mirrors `recordFiltered` for forms, and exists for the same reason: a silent drop makes "we
   * blocked 40 bots" and "we lost 40 sales" indistinguishable.
   */
  async recordFiltered(projectId: string, channelKey: string, reason: string, now: Date = new Date()): Promise<void> {
    await this.db
      .insert(shopFiltered)
      .values({ projectId, channelKey, reason: reason.slice(0, 64), count: 1, lastAt: now })
      .onConflictDoUpdate({
        target: [shopFiltered.projectId, shopFiltered.channelKey, shopFiltered.reason],
        set: { count: sql`${shopFiltered.count} + 1`, lastAt: now },
      });
  }

  /** How many `created` rows a project holds — the storage-exhaustion bound for abandoned sessions. */
  async countOpen(projectId: string): Promise<number> {
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(shopTransactions)
      .where(and(eq(shopTransactions.projectId, projectId), inArray(shopTransactions.status, ['created', 'pending'])));
    return Number(n);
  }
}

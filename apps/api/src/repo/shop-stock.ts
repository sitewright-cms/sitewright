import { and, eq, sql, lte, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { shopStock } from '../db/schema.js';
import type { StockReconcileOp } from '../publish/shop-catalog.js';

/**
 * THE STOCK LEDGER.
 *
 * ★★ TWO RULES GOVERN THIS FILE, and both come from defects this codebase has already paid for.
 *
 * 1. **Decide and act in ONE conditional UPDATE.** Every condition goes in the `WHERE`, the result is
 *    judged by `rowsAffected`, and what the row BECAME is then re-read. A `SELECT` is a candidate
 *    list, never a claim. The mail-delivery work took four review rounds to learn this, each round
 *    reproducing a duplicate send; here the equivalent bug sells the same unit twice.
 *
 * 2. **Serialize per (project, sku) in this process.** libsql runs on ONE connection, so a
 *    concurrent `BEGIN IMMEDIATE` is `SQLITE_BUSY` rather than a wait — a transaction is not a
 *    compare-and-swap here. The conditional UPDATE is the real guard; this queue only stops
 *    read-modify-write pairs from interleaving and keeps the common case out of error handling.
 */

/** How long a reservation holds stock while the buyer is away on the provider's page. */
export const RESERVATION_TTL_MS = 30 * 60 * 1000;

/** The ledger's view of one SKU. */
export interface StockState {
  sku: string;
  onStock: number | null;
  sold: number;
  reserved: number;
}

/**
 * Units a buyer could actually take right now. `null` ⇒ untracked, i.e. unlimited.
 *
 * ★ `on_stock` is the quantity the AUTHOR declared — the opening balance — and it is never
 * decremented by a sale. `sold` accumulates instead, which is what lets an unchanged republish leave
 * the ledger alone (see `reconcileStock`). So availability must subtract BOTH `sold` and `reserved`;
 * subtracting only `reserved` would let a SKU with 10 declared and 10 sold take ten more orders.
 *
 * Clamped at zero: when an author writes the quantity DOWN below what has already sold, availability
 * is none — the ledger does not pretend those orders never happened, and it never goes negative.
 */
export function available(row: Pick<StockState, 'onStock' | 'sold' | 'reserved'>): number | null {
  if (row.onStock === null) return null;
  return Math.max(0, row.onStock - row.sold - row.reserved);
}

/** A per-key promise chain. Keeps read-modify-write pairs for one SKU from interleaving. */
class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    // `.then(fn, fn)` deliberately: a REJECTED predecessor must not cancel the next waiter, nor
    // leave the chain permanently rejected.
    const next = prior.then(fn, fn);
    // The stored tail swallows rejections — the CALLER still receives `next` with its real outcome.
    // Without the catch, the tail itself is an unhandled rejection.
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    // Drop the entry once this is the last waiter, so the map does not grow one key per SKU for the
    // lifetime of the process. Compared by identity: a later `run` has already replaced the tail.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

export type ReserveFailure =
  | { ok: false; reason: 'out-of-stock'; sku: string; available: number }
  | { ok: false; reason: 'conflict' };

export class ShopStockRepository {
  private readonly queue = new KeyedQueue();

  constructor(private readonly db: Database) {}

  /** Current state for the given SKUs. Untracked SKUs are simply absent from the result. */
  async states(projectId: string, skus: readonly string[]): Promise<Map<string, StockState>> {
    if (skus.length === 0) return new Map();
    const rows = await this.db.select().from(shopStock).where(eq(shopStock.projectId, projectId));
    const want = new Set(skus);
    return new Map(
      rows
        .filter((r) => want.has(r.sku))
        .map((r) => [r.sku, { sku: r.sku, onStock: r.onStock, sold: r.sold, reserved: r.reserved }]),
    );
  }

  /**
   * Applies what a publish decided (see `reconcileStock`).
   *
   * ★ `setOnStock` is honoured exactly: when false, `on_stock` is NOT in the SET clause at all, so an
   * unchanged republish cannot touch a sold-down quantity even by writing the same value back. The
   * authored marker moves either way, so the next publish can tell a change from a repeat.
   */
  async applyReconciliation(projectId: string, ops: readonly StockReconcileOp[]): Promise<void> {
    const now = new Date();
    for (const op of ops) {
      await this.queue.run(`${projectId}:${op.sku}`, async () => {
        const updated = await this.db
          .update(shopStock)
          .set({
            ...(op.setOnStock ? { onStock: op.onStock } : {}),
            authoredAtPublish: op.authoredAtPublish,
            updatedAt: now,
          })
          .where(and(eq(shopStock.projectId, projectId), eq(shopStock.sku, op.sku)));
        if ((updated.rowsAffected ?? 0) > 0) return;
        // No row yet. `onConflictDoNothing` rather than a bare insert: a racing publish of the same
        // project may have created it between the UPDATE and here, and losing that race must be a
        // no-op, not a crash.
        await this.db
          .insert(shopStock)
          .values({
            projectId,
            sku: op.sku,
            onStock: op.onStock,
            sold: 0,
            reserved: 0,
            authoredAtPublish: op.authoredAtPublish,
            updatedAt: now,
          })
          .onConflictDoNothing();
      });
    }
  }

  /**
   * Holds `qty` of each SKU for the duration of a checkout.
   *
   * All-or-nothing: the first SKU that cannot be satisfied releases everything already held and
   * reports which one, so a buyer is told *what* is unavailable rather than "something went wrong".
   */
  async reserve(
    projectId: string,
    items: readonly { sku: string; qty: number }[],
    now: Date = new Date(),
  ): Promise<{ ok: true } | ReserveFailure> {
    const until = new Date(now.getTime() + RESERVATION_TTL_MS);
    const held: Array<{ sku: string; qty: number }> = [];
    for (const item of items) {
      const result = await this.queue.run(`${projectId}:${item.sku}`, () => this.reserveOne(projectId, item, until));
      if (result.ok) {
        held.push(item);
        continue;
      }
      // Give back what this attempt already took. Best-effort: a failure to release leaves units held
      // until the sweeper expires them, which is a delay, not an oversell.
      for (const h of held) {
        await this.queue.run(`${projectId}:${h.sku}`, () => this.releaseOne(projectId, h)).catch(() => undefined);
      }
      return result;
    }
    return { ok: true };
  }

  /**
   * ★ The guard. ONE conditional UPDATE whose WHERE contains the availability test, so two concurrent
   * reservations for the last unit cannot both pass: whichever UPDATE runs second matches no row.
   *
   * An untracked SKU (`on_stock IS NULL`) has no ceiling, so the test is written to pass for it.
   */
  private async reserveOne(
    projectId: string,
    item: { sku: string; qty: number },
    until: Date,
  ): Promise<{ ok: true } | ReserveFailure> {
    const res = await this.db
      .update(shopStock)
      .set({
        reserved: sql`${shopStock.reserved} + ${item.qty}`,
        reservedUntil: until,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(shopStock.projectId, projectId),
          eq(shopStock.sku, item.sku),
          // The availability test, INSIDE the WHERE. This is the whole point of the method, and it
          // must match `available()` exactly — including `sold`, because `on_stock` is the opening
          // balance and is never decremented by a sale.
          sql`(${shopStock.onStock} IS NULL OR ${shopStock.onStock} - ${shopStock.sold} - ${shopStock.reserved} >= ${item.qty})`,
        ),
      );
    if ((res.rowsAffected ?? 0) > 0) return { ok: true };
    // The UPDATE matched nothing: either the SKU has no ledger row (untracked — never refused), or
    // it genuinely cannot satisfy the quantity. RE-READ to find out which, rather than guessing.
    const [row] = await this.db
      .select()
      .from(shopStock)
      .where(and(eq(shopStock.projectId, projectId), eq(shopStock.sku, item.sku)));
    if (!row) return { ok: true };
    const avail = available(row);
    if (avail === null) return { ok: false, reason: 'conflict' };
    return { ok: false, reason: 'out-of-stock', sku: item.sku, available: avail };
  }

  /** Converts reservations into sales. Called ONLY from a verified `paid` event. */
  async commit(projectId: string, items: readonly { sku: string; qty: number }[]): Promise<void> {
    for (const item of items) {
      await this.queue.run(`${projectId}:${item.sku}`, async () => {
        await this.db
          .update(shopStock)
          .set({
            sold: sql`${shopStock.sold} + ${item.qty}`,
            // `max(0, …)` so a reservation already swept by the TTL cannot drive this negative — the
            // sale is still real, and a negative reservation count would free phantom stock.
            reserved: sql`max(0, ${shopStock.reserved} - ${item.qty})`,
            updatedAt: new Date(),
          })
          .where(and(eq(shopStock.projectId, projectId), eq(shopStock.sku, item.sku)));
      });
    }
  }

  /**
   * Puts sold units back on the shelf — a REFUND whose operator said the goods are sellable again.
   *
   * ★ Never automatic. A refund is a money event and says nothing about whether the thing came back
   * in a state anyone can sell: a returned-unopened order should restock, a damaged one must not,
   * and a goodwill partial refund involves no goods at all. The platform cannot tell those apart, so
   * the operator decides and this runs only when they said yes. Guessing either way is wrong, and
   * guessing "restock" is the expensive direction — it sells inventory that does not exist.
   */
  async uncommit(projectId: string, items: readonly { sku: string; qty: number }[]): Promise<void> {
    for (const item of items) {
      await this.queue.run(`${projectId}:${item.sku}`, async () => {
        await this.db
          .update(shopStock)
          .set({
            // `max(0, …)`: `sold` is a counter the catalog reconciler also writes, so a decrement
            // that would go negative means the two disagree — clamp rather than invent inventory.
            sold: sql`max(0, ${shopStock.sold} - ${item.qty})`,
            updatedAt: new Date(),
          })
          .where(and(eq(shopStock.projectId, projectId), eq(shopStock.sku, item.sku)));
      });
    }
  }

  /** Gives back held units — a failed, expired or cancelled checkout. */
  async release(projectId: string, items: readonly { sku: string; qty: number }[]): Promise<void> {
    for (const item of items) {
      await this.queue.run(`${projectId}:${item.sku}`, () => this.releaseOne(projectId, item));
    }
  }

  private async releaseOne(projectId: string, item: { sku: string; qty: number }): Promise<void> {
    await this.db
      .update(shopStock)
      .set({ reserved: sql`max(0, ${shopStock.reserved} - ${item.qty})`, updatedAt: new Date() })
      .where(and(eq(shopStock.projectId, projectId), eq(shopStock.sku, item.sku)));
  }

  /**
   * Sweeps reservations whose TTL has passed.
   *
   * ★ Deliberately blunt: it zeroes `reserved` for rows whose `reserved_until` is in the past, rather
   * than trying to decrement per abandoned transaction. A per-transaction release is the job of the
   * transaction reaper, which knows which items each one held; this is the backstop for the case
   * where that never ran (a process killed mid-checkout). Zeroing can only ever FREE stock, so the
   * failure mode is a brief oversell window rather than permanently unsellable inventory — and an
   * unsellable SKU is the worse of the two, because nobody ever notices it.
   */
  async sweepExpiredReservations(now: Date = new Date()): Promise<number> {
    const res = await this.db
      .update(shopStock)
      .set({ reserved: 0, reservedUntil: null, updatedAt: now })
      .where(and(isNotNull(shopStock.reservedUntil), lte(shopStock.reservedUntil, now)));
    return res.rowsAffected ?? 0;
  }

  /** Every ledger row for a project — the publish reads this to decide what changed. */
  async all(projectId: string): Promise<Array<{ sku: string; onStock: number | null; sold: number; authoredAtPublish: number | null }>> {
    const rows = await this.db.select().from(shopStock).where(eq(shopStock.projectId, projectId));
    return rows.map((r) => ({ sku: r.sku, onStock: r.onStock, sold: r.sold, authoredAtPublish: r.authoredAtPublish }));
  }
}

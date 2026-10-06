import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { projects, shopStock } from '../src/db/schema.js';
import { ShopStockRepository, available, RESERVATION_TTL_MS } from '../src/repo/shop-stock.js';
import { reconcileStock } from '../src/publish/shop-catalog.js';
import type { ShopCatalog } from '@sitewright/blocks';

const PROJECT = 'p_stock';
let db: Database;
let repo: ShopStockRepository;

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(projects).values({ id: PROJECT, name: 'Stock', slug: 'stock', createdAt: new Date() });
  repo = new ShopStockRepository(db);
});

/** Seeds one ledger row directly, so a test can start from any state. */
async function seed(sku: string, onStock: number | null, sold = 0, reserved = 0): Promise<void> {
  await db.insert(shopStock).values({ projectId: PROJECT, sku, onStock, sold, reserved, authoredAtPublish: onStock, updatedAt: new Date() });
}

async function read(sku: string) {
  const [row] = await db.select().from(shopStock).where(and(eq(shopStock.projectId, PROJECT), eq(shopStock.sku, sku)));
  return row;
}

describe('available()', () => {
  it('★ subtracts BOTH sold and reserved — on_stock is an opening balance, never decremented', () => {
    // The bug this pins: with 10 declared and 10 sold, subtracting only `reserved` would report 10
    // available and happily take ten more orders.
    expect(available({ onStock: 10, sold: 10, reserved: 0 })).toBe(0);
    expect(available({ onStock: 10, sold: 3, reserved: 2 })).toBe(5);
  });
  it('reports untracked as null, not as zero', () => {
    expect(available({ onStock: null, sold: 99, reserved: 5 })).toBeNull();
  });
  it('never goes negative when an author writes the quantity below what has sold', () => {
    expect(available({ onStock: 1, sold: 8, reserved: 0 })).toBe(0);
  });
});

describe('reserve / commit / release', () => {
  it('reserves within availability and reports what is left', async () => {
    await seed('mug', 10);
    expect(await repo.reserve(PROJECT, [{ sku: 'mug', qty: 3 }])).toEqual({ ok: true });
    expect((await read('mug'))?.reserved).toBe(3);
    expect(available({ onStock: 10, sold: 0, reserved: 3 })).toBe(7);
  });

  it('★ refuses an oversell and NAMES the sku and what is actually available', async () => {
    await seed('mug', 2);
    const r = await repo.reserve(PROJECT, [{ sku: 'mug', qty: 5 }]);
    // A buyer told "something went wrong" cannot act; one told which item is short can.
    expect(r).toEqual({ ok: false, reason: 'out-of-stock', sku: 'mug', available: 2 });
    expect((await read('mug'))?.reserved).toBe(0);
  });

  it('counts already-sold units against availability', async () => {
    await seed('mug', 10, 9);
    expect(await repo.reserve(PROJECT, [{ sku: 'mug', qty: 2 }])).toMatchObject({ reason: 'out-of-stock', available: 1 });
    expect(await repo.reserve(PROJECT, [{ sku: 'mug', qty: 1 }])).toEqual({ ok: true });
  });

  it('never refuses an untracked SKU, and creates no row for one', async () => {
    expect(await repo.reserve(PROJECT, [{ sku: 'ghost', qty: 99 }])).toEqual({ ok: true });
    expect(await read('ghost')).toBeUndefined();
  });

  it('treats an explicit null on_stock as unlimited', async () => {
    await seed('svc', null);
    expect(await repo.reserve(PROJECT, [{ sku: 'svc', qty: 99 }])).toEqual({ ok: true });
  });

  it('★ is ALL-OR-NOTHING: a later shortage releases what was already held', async () => {
    await seed('mug', 10);
    await seed('tee', 1);
    const r = await repo.reserve(PROJECT, [{ sku: 'mug', qty: 2 }, { sku: 'tee', qty: 5 }]);
    expect(r).toMatchObject({ reason: 'out-of-stock', sku: 'tee' });
    // A partial hold would quietly make the mug unsellable for the whole TTL.
    expect((await read('mug'))?.reserved).toBe(0);
    expect((await read('tee'))?.reserved).toBe(0);
  });

  it('commit turns a reservation into a sale', async () => {
    await seed('mug', 10);
    await repo.reserve(PROJECT, [{ sku: 'mug', qty: 3 }]);
    await repo.commit(PROJECT, [{ sku: 'mug', qty: 3 }]);
    const row = await read('mug');
    expect(row).toMatchObject({ sold: 3, reserved: 0, onStock: 10 });
    // on_stock is the opening balance and must be untouched by a sale.
    expect(row?.onStock).toBe(10);
  });

  it('★ commit after the reservation was already swept does not drive reserved negative', async () => {
    await seed('mug', 10, 0, 0);
    // The TTL swept the hold, then the webhook arrived. The sale is real either way; a negative
    // reservation count would FREE phantom stock.
    await repo.commit(PROJECT, [{ sku: 'mug', qty: 2 }]);
    const row = await read('mug');
    expect(row?.reserved).toBe(0);
    expect(row?.sold).toBe(2);
  });

  it('release gives units back and never goes below zero', async () => {
    await seed('mug', 10, 0, 1);
    await repo.release(PROJECT, [{ sku: 'mug', qty: 5 }]);
    expect((await read('mug'))?.reserved).toBe(0);
  });

  it('★ two concurrent reservations for the LAST unit: exactly one wins', async () => {
    await seed('mug', 1);
    const [a, b] = await Promise.all([
      repo.reserve(PROJECT, [{ sku: 'mug', qty: 1 }]),
      repo.reserve(PROJECT, [{ sku: 'mug', qty: 1 }]),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    // This is the defect the conditional UPDATE exists to prevent: both buyers paying for one unit.
    expect(wins).toBe(1);
    expect((await read('mug'))?.reserved).toBe(1);
  });

  it('★ ten concurrent reservations against five units: five win, and reserved never exceeds stock', async () => {
    await seed('mug', 5);
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.reserve(PROJECT, [{ sku: 'mug', qty: 1 }])));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await read('mug'))?.reserved).toBe(5);
  });

  it('concurrent reservations across DIFFERENT skus do not block each other', async () => {
    await seed('a', 1);
    await seed('b', 1);
    const results = await Promise.all([
      repo.reserve(PROJECT, [{ sku: 'a', qty: 1 }]),
      repo.reserve(PROJECT, [{ sku: 'b', qty: 1 }]),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('a rejected reservation does not poison the queue for the next caller', async () => {
    await seed('mug', 1);
    expect(await repo.reserve(PROJECT, [{ sku: 'mug', qty: 9 }])).toMatchObject({ ok: false });
    expect(await repo.reserve(PROJECT, [{ sku: 'mug', qty: 1 }])).toEqual({ ok: true });
  });

  it('scopes to the project — another project’s row is untouched', async () => {
    await db.insert(projects).values({ id: 'other', name: 'O', slug: 'other', createdAt: new Date() });
    await seed('mug', 1);
    await db.insert(shopStock).values({ projectId: 'other', sku: 'mug', onStock: 1, sold: 0, reserved: 0, authoredAtPublish: 1, updatedAt: new Date() });
    await repo.reserve(PROJECT, [{ sku: 'mug', qty: 1 }]);
    const rows = await db.select().from(shopStock);
    expect(rows.find((r) => r.projectId === 'other')?.reserved).toBe(0);
  });
});

describe('★ the per-SKU queue survives a THROWING operation', () => {
  it('a thrown op does not poison the chain for the next caller on that sku', async () => {
    // The queue serializes read-modify-write pairs per SKU. Its tail deliberately swallows
    // rejections so the stored promise is not an unhandled rejection — but the CALLER must still see
    // the real failure, and the NEXT caller on that key must still run. A chain left rejected would
    // make one database hiccup permanently unsellable for that SKU in this process.
    let fail = true;
    const flaky = {
      ...db,
      update: (...args: unknown[]) => {
        if (fail) throw new Error('database hiccup');
        return (db as unknown as { update: (...a: unknown[]) => unknown }).update(...args);
      },
    } as unknown as Database;
    const repoFlaky = new ShopStockRepository(flaky);
    await seed('mug', 5);

    // The caller sees the real error…
    await expect(repoFlaky.reserve(PROJECT, [{ sku: 'mug', qty: 1 }])).rejects.toThrow(/database hiccup/);
    // …and the queue is still usable for the same key afterwards.
    fail = false;
    expect(await repoFlaky.reserve(PROJECT, [{ sku: 'mug', qty: 1 }])).toEqual({ ok: true });
    expect((await read('mug'))?.reserved).toBe(1);
  });
});

describe('sweepExpiredReservations', () => {
  it('frees a lapsed hold and leaves a live one alone', async () => {
    const now = new Date('2026-10-06T12:00:00Z');
    await seed('stale', 10, 0, 3);
    await seed('live', 10, 0, 2);
    await db.update(shopStock).set({ reservedUntil: new Date(now.getTime() - 1000) });
    await db
      .update(shopStock)
      .set({ reservedUntil: new Date(now.getTime() + RESERVATION_TTL_MS) })
      .where(eq(shopStock.sku, 'live'));
    const freed = await repo.sweepExpiredReservations(now);
    expect(freed).toBe(1);
    expect((await read('stale'))?.reserved).toBe(0);
    expect((await read('live'))?.reserved).toBe(2);
  });

  it('is a no-op when nothing has lapsed', async () => {
    await seed('mug', 10);
    expect(await repo.sweepExpiredReservations(new Date())).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
// ★★ The ownership split, end to end through the repository.
// ------------------------------------------------------------------------------------------------

function catalog(stocks: Record<string, number | undefined>): ShopCatalog {
  const items = Object.fromEntries(
    Object.entries(stocks).map(([sku, stock]) => [sku, { sku, name: sku, priceMinor: 1000, ...(stock !== undefined ? { stock } : {}) }]),
  );
  return { currency: 'EUR', items, digest: 'd' };
}

describe('★★ applyReconciliation — the author owns the restock, the platform owns `sold`', () => {
  it('an UNCHANGED republish leaves a sold-down quantity exactly where it was', async () => {
    await seed('mug', 10);
    await repo.commit(PROJECT, [{ sku: 'mug', qty: 8 }]);
    expect((await read('mug'))?.sold).toBe(8);

    // The author republishes for an unrelated reason. `stock=10` is still what the markup says.
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: 10 }), await repo.all(PROJECT)));

    const row = await read('mug');
    expect(row?.onStock).toBe(10);
    expect(row?.sold).toBe(8); // ★ not reset — this is the whole rule
    expect(available({ onStock: row!.onStock, sold: row!.sold, reserved: row!.reserved })).toBe(2);
  });

  it('a CHANGED authored number restocks, and keeps the sold history', async () => {
    await seed('mug', 10);
    await repo.commit(PROJECT, [{ sku: 'mug', qty: 8 }]);
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: 40 }), await repo.all(PROJECT)));
    const row = await read('mug');
    expect(row?.onStock).toBe(40);
    expect(row?.sold).toBe(8);
    expect(row?.authoredAtPublish).toBe(40);
    expect(available({ onStock: 40, sold: 8, reserved: 0 })).toBe(32);
  });

  it('★ two consecutive republishes after a restock: the second must not restock again', async () => {
    await seed('mug', 10);
    await repo.commit(PROJECT, [{ sku: 'mug', qty: 8 }]);
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: 40 }), await repo.all(PROJECT)));
    await repo.commit(PROJECT, [{ sku: 'mug', qty: 5 }]);
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: 40 }), await repo.all(PROJECT)));
    const row = await read('mug');
    expect(row?.onStock).toBe(40);
    expect(row?.sold).toBe(13);
  });

  it('creates a row for a SKU it has never seen', async () => {
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ fresh: 5 }), []));
    expect(await read('fresh')).toMatchObject({ onStock: 5, sold: 0, authoredAtPublish: 5 });
  });

  it('moving a SKU from tracked to untracked clears the ceiling', async () => {
    await seed('mug', 10);
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: undefined }), await repo.all(PROJECT)));
    expect((await read('mug'))?.onStock).toBeNull();
    expect(await repo.reserve(PROJECT, [{ sku: 'mug', qty: 99 }])).toEqual({ ok: true });
  });

  it('a SKU dropped from the catalog keeps its row and its sold count', async () => {
    await seed('retired', 10);
    await repo.commit(PROJECT, [{ sku: 'retired', qty: 4 }]);
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: 1 }), await repo.all(PROJECT)));
    expect((await read('retired'))?.sold).toBe(4);
  });

  it('a stock of 0 survives an unchanged republish as 0, not as unlimited', async () => {
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: 0 }), []));
    await repo.applyReconciliation(PROJECT, reconcileStock(catalog({ mug: 0 }), await repo.all(PROJECT)));
    const row = await read('mug');
    expect(row?.onStock).toBe(0);
    expect(await repo.reserve(PROJECT, [{ sku: 'mug', qty: 1 }])).toMatchObject({ reason: 'out-of-stock', available: 0 });
  });

  it('two concurrent reconciliations for one project do not duplicate a row', async () => {
    const ops = reconcileStock(catalog({ mug: 5 }), []);
    await Promise.all([repo.applyReconciliation(PROJECT, ops), repo.applyReconciliation(PROJECT, ops)]);
    expect((await db.select().from(shopStock)).filter((r) => r.sku === 'mug')).toHaveLength(1);
  });
});

describe('states()', () => {
  it('returns only the requested skus, and omits untracked ones', async () => {
    await seed('a', 1);
    await seed('b', 2);
    const m = await repo.states(PROJECT, ['a', 'ghost']);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')).toEqual({ sku: 'a', onStock: 1, sold: 0, reserved: 0 });
  });
  it('is empty for no skus', async () => {
    expect((await repo.states(PROJECT, [])).size).toBe(0);
  });
});

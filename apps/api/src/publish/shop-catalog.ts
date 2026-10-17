// Publish-side wiring for the shop catalog snapshot: what gets STORED, and what a publish is allowed
// to write back to the stock ledger.
//
// The HARVEST itself lives in @sitewright/blocks (cart-catalog.ts), next to the helper that emits the
// markers it reads. This module owns the parts that touch the database.
import type { ShopCatalog } from '@sitewright/blocks';

// ---------------------------------------------------------------------------------------------
// Stock reconciliation — the ownership split
// ---------------------------------------------------------------------------------------------

/** What the ledger already knows about one SKU. */
export interface StockLedgerRow {
  sku: string;
  onStock: number | null;
  sold: number;
  /** The authored `stock=` value recorded at the LAST publish. The hinge of the whole rule. */
  authoredAtPublish: number | null;
}

/** A write the publish should apply to the stock ledger. */
export interface StockReconcileOp {
  sku: string;
  /** Null leaves `on_stock` untouched (an unchanged republish). */
  onStock: number | null;
  authoredAtPublish: number | null;
  /** True when `onStock` must be written; false when only the authored marker moves. */
  setOnStock: boolean;
}

/**
 * Decides what a publish may write to the stock ledger.
 *
 * ★★ THE OWNERSHIP SPLIT, and the single most important rule in this file. The AUTHOR owns the
 * restock number; the PLATFORM owns `sold`. So `on_stock` is written ONLY when the authored value
 * differs from what was authored at the previous publish — i.e. the author actually changed it,
 * which is an explicit restock. An unchanged republish must never reset a sold-down quantity.
 *
 * Without this, the first price refresh on a catalogue-driven shop silently restocks everything that
 * had sold out. That is exactly the defect the Forever-Elvi sync had to be designed around, and the
 * reason its `SOURCE_FIELDS` list exists.
 *
 * `authoredAtPublish` is recorded either way, so the NEXT publish can tell a change from a repeat.
 */
export function reconcileStock(catalog: ShopCatalog, ledger: readonly StockLedgerRow[]): StockReconcileOp[] {
  const known = new Map(ledger.map((r) => [r.sku, r]));
  const ops: StockReconcileOp[] = [];
  for (const item of Object.values(catalog.items)) {
    const authored = item.stock ?? null;
    const row = known.get(item.sku);
    if (!row) {
      // First sight of this SKU: whatever the author declared IS the opening quantity.
      ops.push({ sku: item.sku, onStock: authored, authoredAtPublish: authored, setOnStock: true });
      continue;
    }
    const changed = row.authoredAtPublish !== authored;
    ops.push({
      sku: item.sku,
      onStock: changed ? authored : null,
      authoredAtPublish: authored,
      // ★ `changed` is the whole gate. Not "authored !== null", not "authored > row.onStock".
      setOnStock: changed,
    });
  }
  // A SKU that has left the catalog keeps its row: its `sold` count is order history, and the
  // transactions that produced it are still in the inbox.
  return ops;
}

/**
 * Every SKU any of a shop's price lists sells, once — for {@link reconcileStock}. Stock is a fact about
 * the SKU, not about a market: a product sold in two markets draws on one shelf. The first DECLARED
 * stock wins, as it does across the pages of one list.
 */
export function mergeCatalogStock(catalogs: readonly ShopCatalog[]): ShopCatalog {
  const items: ShopCatalog['items'] = {};
  for (const catalog of catalogs) {
    for (const [sku, item] of Object.entries(catalog.items)) {
      // eslint-disable-next-line security/detect-object-injection -- own keys of sealed price lists into a fresh object
      const prior = items[sku];
      // eslint-disable-next-line security/detect-object-injection -- as above
      if (!prior) items[sku] = item;
      // eslint-disable-next-line security/detect-object-injection -- as above
      else if (prior.stock === undefined && item.stock !== undefined) items[sku] = { ...prior, stock: item.stock };
    }
  }
  return { currency: catalogs[0]?.currency ?? '', items, digest: '' };
}

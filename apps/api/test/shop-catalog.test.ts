import { describe, it, expect } from 'vitest';
import { reconcileStock, type StockLedgerRow } from '../src/publish/shop-catalog.js';
import type { ShopCatalog } from '@sitewright/blocks';

/** A catalog holding the given sku → authored stock (undefined = untracked). */
function catalog(stocks: Record<string, number | undefined>): ShopCatalog {
  const items = Object.fromEntries(
    Object.entries(stocks).map(([sku, stock]) => [sku, { sku, name: sku, priceMinor: 1000, ...(stock !== undefined ? { stock } : {}) }]),
  );
  return { currency: 'EUR', items, digest: 'd' };
}

const row = (sku: string, onStock: number | null, sold: number, authoredAtPublish: number | null): StockLedgerRow => ({
  sku,
  onStock,
  sold,
  authoredAtPublish,
});

describe('reconcileStock — the ownership split', () => {
  it('a SKU seen for the first time opens at whatever the author declared', () => {
    expect(reconcileStock(catalog({ mug: 10 }), [])).toEqual([{ sku: 'mug', onStock: 10, authoredAtPublish: 10, setOnStock: true }]);
  });

  it('a first-sight SKU with no declared stock opens untracked', () => {
    expect(reconcileStock(catalog({ mug: undefined }), [])).toEqual([{ sku: 'mug', onStock: null, authoredAtPublish: null, setOnStock: true }]);
  });

  it('★★ an UNCHANGED republish must NOT touch a sold-down quantity', () => {
    // The defect this rule exists to prevent: the author republishes for an unrelated reason, the
    // authored number is still 10, and 8 have sold. Writing on_stock here would silently restock.
    const ops = reconcileStock(catalog({ mug: 10 }), [row('mug', 2, 8, 10)]);
    expect(ops).toEqual([{ sku: 'mug', onStock: null, authoredAtPublish: 10, setOnStock: false }]);
  });

  it('★ a CHANGED authored number is an explicit restock, and is written', () => {
    const ops = reconcileStock(catalog({ mug: 40 }), [row('mug', 2, 8, 10)]);
    expect(ops).toEqual([{ sku: 'mug', onStock: 40, authoredAtPublish: 40, setOnStock: true }]);
  });

  it('★ the gate is "the author changed it", NOT "the new number is bigger"', () => {
    // Reducing the authored quantity is just as explicit an act as raising it — a merchant writing
    // down to 3 means three, even though 3 < the 10 on the shelf.
    const ops = reconcileStock(catalog({ mug: 3 }), [row('mug', 10, 0, 10)]);
    expect(ops[0]).toMatchObject({ onStock: 3, setOnStock: true });
    // …and reducing it to a number BELOW what has already sold is still honoured: the ledger clamps
    // availability at zero, it does not pretend the orders did not happen.
    const ops2 = reconcileStock(catalog({ mug: 1 }), [row('mug', 2, 8, 10)]);
    expect(ops2[0]).toMatchObject({ onStock: 1, setOnStock: true });
  });

  it('★ the gate is not "authored is non-null" — going from tracked to UNTRACKED is a real change', () => {
    const ops = reconcileStock(catalog({ mug: undefined }), [row('mug', 2, 8, 10)]);
    expect(ops).toEqual([{ sku: 'mug', onStock: null, authoredAtPublish: null, setOnStock: true }]);
  });

  it('★ going from untracked to tracked is a real change too', () => {
    const ops = reconcileStock(catalog({ mug: 5 }), [row('mug', null, 3, null)]);
    expect(ops).toEqual([{ sku: 'mug', onStock: 5, authoredAtPublish: 5, setOnStock: true }]);
  });

  it('records the authored marker on every pass, so the NEXT publish can tell a change from a repeat', () => {
    // Without this, an unchanged republish after a restock would look like another change forever.
    const afterRestock = reconcileStock(catalog({ mug: 40 }), [row('mug', 2, 8, 10)])[0]!;
    expect(afterRestock.authoredAtPublish).toBe(40);
    const second = reconcileStock(catalog({ mug: 40 }), [row('mug', 40, 0, afterRestock.authoredAtPublish)])[0]!;
    expect(second.setOnStock).toBe(false);
  });

  it('a stock of 0 is a real declaration, not an absent one', () => {
    // `stock=0` is "sold out"; absent is "untracked". Treating 0 as falsy would make a sold-out SKU
    // unlimited, which is the worst possible direction for this bug.
    expect(reconcileStock(catalog({ mug: 0 }), [])).toEqual([{ sku: 'mug', onStock: 0, authoredAtPublish: 0, setOnStock: true }]);
    const unchanged = reconcileStock(catalog({ mug: 0 }), [row('mug', 0, 5, 0)]);
    expect(unchanged[0]).toMatchObject({ setOnStock: false });
  });

  it('★ a SKU that has LEFT the catalog keeps its row — its sold count is order history', () => {
    const ops = reconcileStock(catalog({ mug: 10 }), [row('mug', 10, 0, 10), row('retired', 0, 42, 5)]);
    expect(ops.map((o) => o.sku)).toEqual(['mug']);
  });

  it('handles a many-SKU catalog without cross-contamination', () => {
    const ops = reconcileStock(catalog({ a: 1, b: 2, c: undefined }), [row('a', 1, 0, 1), row('b', 0, 2, 5)]);
    expect(ops.find((o) => o.sku === 'a')).toMatchObject({ setOnStock: false });
    expect(ops.find((o) => o.sku === 'b')).toMatchObject({ setOnStock: true, onStock: 2 });
    expect(ops.find((o) => o.sku === 'c')).toMatchObject({ setOnStock: true, onStock: null });
  });
});

// ------------------------------------------------------------------------------------------------
// ★ The style escape hatch — a fully-forked drawer can ship with none of the platform's CSS.
// ------------------------------------------------------------------------------------------------
describe('bodyEffectStyles — platform cart styles', () => {
  it('ships the cart sheet by default', async () => {
    const { bodyEffectStyles } = await import('../src/publish/effect-runtimes.js');
    const withCart = bodyEffectStyles('<div data-sw-cart></div>');
    expect(withCart.some((css) => css.includes('data-sw-cart'))).toBe(true);
  });

  it('★ drops it entirely when the shop asks — not a pile of overrides, but none of it', async () => {
    const { bodyEffectStyles } = await import('../src/publish/effect-runtimes.js');
    const none = bodyEffectStyles('<div data-sw-cart></div>', { platformCartStyles: false });
    expect(none.some((css) => css.includes('data-sw-cart'))).toBe(false);
  });

  it('leaves every OTHER runtime’s CSS alone', async () => {
    const { bodyEffectStyles } = await import('../src/publish/effect-runtimes.js');
    const html = '<div data-sw-cart></div><div data-sw-animate="fade-up"></div>';
    const all = bodyEffectStyles(html);
    const noCart = bodyEffectStyles(html, { platformCartStyles: false });
    // Exactly one sheet fewer — the switch is about the cart, not about effects in general.
    expect(noCart).toHaveLength(all.length - 1);
  });

  it('ships nothing for a page with no cart, either way', async () => {
    const { bodyEffectStyles } = await import('../src/publish/effect-runtimes.js');
    expect(bodyEffectStyles('<main>no shop</main>').some((c) => c.includes('data-sw-cart'))).toBe(false);
  });
});

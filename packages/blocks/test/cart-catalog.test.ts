import { describe, it, expect } from 'vitest';
import {
  createCatalogAccumulator,
  harvestCatalogPage,
  finishCatalog,
  describeCatalogProblems,
} from '../src/cart-catalog.js';
import { renderTemplate } from '../src/template.js';

/** Harvests one HTML surface and seals it, for the common single-page case. */
function harvest(html: string, currency = 'EUR', route = '/shop/') {
  const acc = createCatalogAccumulator(currency);
  harvestCatalogPage(acc, html, route);
  return finishCatalog(acc);
}

const btn = (attrs: string) => `<button type="button" data-sw-cart-add ${attrs}></button>`;

describe('harvestCatalogPage', () => {
  it('harvests sku, name, price in minor units, image and stock', () => {
    const { catalog, problems } = harvest(
      btn('data-sku="mug" data-name="Enamel mug" data-price="19.99" data-image="/m/mug.webp" data-stock="7"'),
    );
    expect(problems).toEqual([]);
    expect(catalog.currency).toBe('EUR');
    expect(catalog.items.mug).toEqual({ sku: 'mug', name: 'Enamel mug', priceMinor: 1999, image: '/m/mug.webp', stock: 7 });
  });

  it('is a no-op on a page with no cart markers', () => {
    const { catalog, problems } = harvest('<main><h1>About us</h1><p>No shop here.</p></main>');
    expect(catalog.items).toEqual({});
    expect(problems).toEqual([]);
  });

  it('falls back to the sku as the name, and omits absent optional attributes', () => {
    const { catalog } = harvest(btn('data-sku="mug" data-price="5.00"'));
    expect(catalog.items.mug).toEqual({ sku: 'mug', name: 'mug', priceMinor: 500 });
  });

  it('uses the currency exponent, not two decimals', () => {
    expect(harvest(btn('data-sku="a" data-price="500"'), 'JPY').catalog.items.a?.priceMinor).toBe(500);
    expect(harvest(btn('data-sku="a" data-price="1.234"'), 'BHD').catalog.items.a?.priceMinor).toBe(1234);
  });

  it('harvests from chrome as well as a body — a footer tile is a real place to buy something', () => {
    const acc = createCatalogAccumulator('EUR');
    harvestCatalogPage(acc, [`<main>${btn('data-sku="a" data-price="1.00"')}</main>`, `<footer>${btn('data-sku="b" data-price="2.00"')}</footer>`].join('\n'), '/');
    expect(Object.keys(finishCatalog(acc).catalog.items)).toEqual(['a', 'b']);
  });

  it('decodes HTML entities in attribute values', () => {
    const { catalog } = harvest(btn('data-sku="mug" data-name="Tea &amp; Coffee" data-price="1.00"'));
    expect(catalog.items.mug?.name).toBe('Tea & Coffee');
  });

  // ------------------------------------------------------------------------------------------
  // ★ The failures that must block a publish
  // ------------------------------------------------------------------------------------------

  it('★ reports a price it cannot represent exactly, rather than rounding it', () => {
    const { problems, catalog } = harvest(btn('data-sku="mug" data-price="19.999"'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ sku: 'mug', route: '/shop/' });
    expect(problems[0]!.message).toContain('cannot be charged exactly');
    expect(problems[0]!.message).toContain('3 decimal places');
    // And the SKU is NOT in the catalog — an unpriceable item must not become a chargeable one.
    expect(catalog.items.mug).toBeUndefined();
  });

  it('★ reports the SAME SKU at two different prices and names both pages', () => {
    const acc = createCatalogAccumulator('EUR');
    harvestCatalogPage(acc, btn('data-sku="mug" data-price="19.99"'), '/shop/');
    harvestCatalogPage(acc, btn('data-sku="mug" data-price="24.99"'), '/sale/');
    const { problems } = finishCatalog(acc);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.sku).toBe('mug');
    expect(problems[0]!.message).toContain('one SKU cannot have two prices');
    expect(problems[0]!.message).toContain('/shop/'); // the FIRST page
    expect(problems[0]!.route).toBe('/sale/'); // and the one that disagreed
  });

  it('the same SKU at the SAME price on many pages is not a conflict', () => {
    const acc = createCatalogAccumulator('EUR');
    for (const route of ['/', '/shop/', '/sale/']) harvestCatalogPage(acc, btn('data-sku="mug" data-price="19.99"'), route);
    const { problems, catalog } = finishCatalog(acc);
    expect(problems).toEqual([]);
    expect(catalog.items.mug?.priceMinor).toBe(1999);
  });

  it('reports a negative and a malformed price distinctly', () => {
    expect(harvest(btn('data-sku="a" data-price="-1.00"')).problems[0]!.message).toContain('negative');
    expect(harvest(btn('data-sku="a" data-price="free"')).problems[0]!.message).toContain('not a plain decimal');
    expect(harvest(btn('data-sku="a"')).problems[0]!.message).toContain('not a plain decimal');
  });

  it('★ reports a hand-authored button with no sku instead of dropping it silently', () => {
    const { problems } = harvest(btn('data-price="1.00"'));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('no data-sku');
  });

  it('truncates a long value in the message rather than echoing it back whole', () => {
    const { problems } = harvest(btn(`data-sku="a" data-price="${'9'.repeat(200)}"`));
    expect(problems[0]!.message.length).toBeLessThan(120);
  });

  it('refuses an absurd number of markers on one page instead of truncating silently', () => {
    const many = Array.from({ length: 2100 }, (_, i) => btn(`data-sku="s${i}" data-price="1.00"`)).join('');
    const { problems, catalog } = harvest(many);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('more than 2000');
    // Nothing from that page is priced — a partial catalog would price some SKUs and refuse others.
    expect(Object.keys(catalog.items)).toEqual([]);
  });

  it('rejects an over-long sku', () => {
    const { problems } = harvest(btn(`data-sku="${'s'.repeat(201)}" data-price="1.00"`));
    expect(problems[0]!.message).toContain('longer than 200');
  });
});

describe('stock harvesting', () => {
  it('ignores a non-integral or negative stock value rather than coercing it', () => {
    for (const v of ['many', '-1', '1.5', '', ' ']) {
      expect(harvest(btn(`data-sku="a" data-price="1.00" data-stock="${v}"`)).catalog.items.a?.stock, v).toBeUndefined();
    }
  });
  it('takes the first DECLARED stock when one tile shows availability and another does not', () => {
    const acc = createCatalogAccumulator('EUR');
    harvestCatalogPage(acc, btn('data-sku="a" data-price="1.00"'), '/');
    harvestCatalogPage(acc, btn('data-sku="a" data-price="1.00" data-stock="4"'), '/shop/');
    expect(finishCatalog(acc).catalog.items.a?.stock).toBe(4);
  });
});

describe('the digest', () => {
  it('is a function of CONTENT, not of page iteration order', () => {
    const a = createCatalogAccumulator('EUR');
    harvestCatalogPage(a, btn('data-sku="x" data-price="1.00"'), '/a/');
    harvestCatalogPage(a, btn('data-sku="y" data-price="2.00"'), '/b/');
    const b = createCatalogAccumulator('EUR');
    harvestCatalogPage(b, btn('data-sku="y" data-price="2.00"'), '/b/');
    harvestCatalogPage(b, btn('data-sku="x" data-price="1.00"'), '/a/');
    // Otherwise an unchanged site would mint a new digest on every publish.
    expect(finishCatalog(a).catalog.digest).toBe(finishCatalog(b).catalog.digest);
  });

  it('changes when a price changes, and when the currency changes', () => {
    const base = harvest(btn('data-sku="x" data-price="1.00"')).catalog.digest;
    expect(harvest(btn('data-sku="x" data-price="1.01"')).catalog.digest).not.toBe(base);
    expect(harvest(btn('data-sku="x" data-price="1.00"'), 'USD').catalog.digest).not.toBe(base);
  });
});

describe('describeCatalogProblems', () => {
  it('names every offender, and caps the list', () => {
    const problems = Array.from({ length: 25 }, (_, i) => ({ sku: `s${i}`, route: '/p/', message: 'bad' }));
    const text = describeCatalogProblems(problems);
    expect(text).toContain('s0');
    expect(text).toContain('and 5 more');
  });
});

// ------------------------------------------------------------------------------------------
// ★★ The round trip that matters: render the real helper, then harvest what it emitted.
// ------------------------------------------------------------------------------------------

describe('★ render-then-harvest round trip', () => {
  const ctx = {
    website: { shop: { enabled: true, currency: { code: 'EUR', decimals: 2 } } },
    dataset: {
      products: [
        { sku: 'mug', title: 'Enamel mug', price: '19.99', stock: 7 },
        { sku: 'tee', title: 'T-shirt', price: '24.50', stock: 0 },
      ],
    },
  };

  it('harvests exactly what {{sw-add-to-cart}} rendered', () => {
    const html = renderTemplate(
      '{{#each dataset.products}}{{sw-add-to-cart sku=sku name=title price=price stock=stock}}{{/each}}',
      ctx as never,
    );
    // Prove the precondition before asserting what it implies: a helper that rendered nothing would
    // make every expectation below vacuously true.
    expect(html).toContain('data-sw-cart-add');
    const { catalog, problems } = harvest(html);
    expect(problems).toEqual([]);
    expect(catalog.items.mug).toMatchObject({ name: 'Enamel mug', priceMinor: 1999, stock: 7 });
    expect(catalog.items.tee).toMatchObject({ name: 'T-shirt', priceMinor: 2450, stock: 0 });
  });

  it('★ a zero stock is harvested as 0, not dropped as falsy', () => {
    // `stock=0` means sold out, which is the opposite of `stock` absent (untracked). A falsy check
    // anywhere in this chain would turn "sold out" into "unlimited".
    const html = renderTemplate('{{sw-add-to-cart sku="tee" price="1.00" stock=0}}', ctx as never);
    expect(harvest(html).catalog.items.tee?.stock).toBe(0);
  });

  it('harvests nothing when the shop is OFF, because the helper renders nothing', () => {
    const off = { website: { shop: { enabled: false } }, dataset: ctx.dataset };
    const html = renderTemplate('{{sw-add-to-cart sku="mug" price="19.99"}}', off as never);
    expect(html.trim()).toBe('');
    expect(harvest(html).catalog.items).toEqual({});
  });

  it('★ a tampered-looking price in the SOURCE is still only what the author wrote', () => {
    // The author is the merchant: they set prices by definition. What matters is that the BUYER
    // cannot influence this — the browser never sends a price at all.
    const html = renderTemplate('{{sw-add-to-cart sku="mug" price="0.01"}}', ctx as never);
    expect(harvest(html).catalog.items.mug?.priceMinor).toBe(1);
  });

  it('coerces an unknown or negative helper price to 0 and harvests it as free, not as a problem', () => {
    // The helper already floors a bad price to "0"; that is a visible 0.00 button, which an author
    // will notice. The harvest must agree with what the page actually shows.
    const html = renderTemplate('{{sw-add-to-cart sku="mug" price="-5"}}', ctx as never);
    expect(html).toContain('data-price="0"');
    expect(harvest(html).catalog.items.mug?.priceMinor).toBe(0);
  });
});

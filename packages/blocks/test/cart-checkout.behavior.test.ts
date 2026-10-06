// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CART_JS } from '../src/cart.js';

/**
 * ★★ THE CHECKOUT FLOW, driven through the REAL runtime in a DOM.
 *
 * What these pin, in order of how expensive they would be to get wrong:
 *  - the browser posts `{sku, qty}` and NOTHING resembling a price;
 *  - the review step renders the SERVER's figures, not the cart's own;
 *  - the cart is NOT cleared on redirect, so an abandoned payment keeps the basket;
 *  - a refusal says WHAT is wrong, because "something went wrong" is why buyers leave.
 */

const CHANNELS = [{ kind: 'checkout', key: 'pay', gatewayId: 'mock' }];

let posted: Array<{ url: string; body: Record<string, unknown> }>;
let assigned: string;
let response: { status: number; body: unknown };

/** Mounts a cart with a checkout channel and adds one product through the real add path. */
function mount(): HTMLElement {
  document.body.innerHTML = '<div data-sw-cart data-cart-key="co"></div>';
  const root = document.querySelector('[data-sw-cart]') as HTMLElement;
  root.setAttribute('data-currency-symbol', '$');
  root.setAttribute('data-channels', JSON.stringify(CHANNELS));
  root.setAttribute('data-pay-label', 'Pay now');
  root.setAttribute('data-review-label', 'Confirm your order');
  const add = document.createElement('button');
  add.setAttribute('data-sw-cart-add', '');
  add.setAttribute('data-sku', 'MUG');
  add.setAttribute('data-name', 'Enamel mug');
  add.setAttribute('data-price', '19.99');
  document.body.appendChild(add);
  (0, eval)(CART_JS);
  // A trusted-looking interaction, so the runtime's own evidence collector has something to report.
  document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return root;
}

const clickCheckout = (root: HTMLElement) =>
  (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();

beforeEach(() => {
  posted = [];
  assigned = '';
  response = {
    status: 200,
    body: {
      token: 'tok_abc',
      redirectUrl: 'https://pay.example.test/s/1',
      currency: 'EUR',
      amounts: { subtotalMinor: 1999, shippingMinor: 499, taxMinor: 0, totalMinor: 2498 },
      display: { subtotal: '19.99', shipping: '4.99', tax: '0.00', total: '24.98' },
      lines: [{ name: 'Enamel mug', qty: 1, amount: '19.99' }],
    },
  };
  window.localStorage.clear();
  (window as unknown as { __swp: (k: string) => string }).__swp = (k) => `/pay/p1/${k}`;
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return { ok: response.status === 200, status: response.status, json: async () => response.body };
  });
  // jsdom refuses a real navigation; capture the intent instead.
  delete (window as unknown as Record<string, unknown>).location;
  (window as unknown as { location: { assign: (u: string) => void } }).location = {
    assign: (u: string) => void (assigned = u),
  } as never;
});

describe('★★ the browser sends sku and qty, and nothing that looks like a price', () => {
  it('posts only {sku, qty} plus the bot evidence', async () => {
    const root = mount();
    clickCheckout(root);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0]!.body;
    expect(body.items).toEqual([{ sku: 'MUG', qty: 1 }]);
    // ★ Nothing price-shaped anywhere in the request. This is the whole security model: the server
    // re-prices from its own catalog snapshot, and there is nowhere for a tampered cart to put a number.
    const json = JSON.stringify(body);
    for (const forbidden of ['price', 'amount', 'total', 'currency', '19.99', '1999']) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(body._hpt).toBe('');
    expect(String(body._ix)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('posts to the assembled endpoint, which is never in the markup', async () => {
    const root = mount();
    clickCheckout(root);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toBe('/pay/p1/pay');
    expect(document.body.innerHTML).not.toContain('/pay/p1/');
  });
});

describe('★★ the review step shows the SERVER’s numbers', () => {
  it('renders the returned breakdown, not the cart’s own arithmetic', async () => {
    const root = mount();
    clickCheckout(root);
    const panel = await vi.waitFor(() => {
      const p = root.querySelector('[data-sw-part="review"]');
      expect(p).toBeTruthy();
      return p as HTMLElement;
    });
    const text = panel.textContent ?? '';
    // The cart's own total is 19.99; the SERVER says 24.98 because it added shipping. The panel must
    // show the server's figure — a drawer showing one total while the provider charges another is the
    // worst defect this feature can have.
    expect(text).toContain('24.98');
    expect(text).toContain('4.99');
    expect(text).toContain('Enamel mug');
    expect(text).toContain('Confirm your order');
  });

  it('does not redirect until the buyer confirms', async () => {
    const root = mount();
    clickCheckout(root);
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="review"]')).toBeTruthy());
    expect(assigned).toBe('');
    (root.querySelector('[data-sw-part="review-pay"]') as HTMLElement).click();
    expect(assigned).toBe('https://pay.example.test/s/1');
  });

  it('lets the buyer go back without paying', async () => {
    const root = mount();
    clickCheckout(root);
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="review"]')).toBeTruthy());
    (root.querySelector('[data-sw-part="review-cancel"]') as HTMLElement).click();
    expect(root.querySelector('[data-sw-part="review"]')).toBeNull();
    expect(assigned).toBe('');
  });
});

describe('★★ the cart survives the trip to the provider', () => {
  it('is NOT cleared on redirect, and the token is kept for the thank-you page', async () => {
    const root = mount();
    clickCheckout(root);
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="review"]')).toBeTruthy());
    (root.querySelector('[data-sw-part="review-pay"]') as HTMLElement).click();
    // A buyer who abandons on the provider's page comes back to their basket, not an empty one.
    const stored = JSON.parse(window.localStorage.getItem('sw-cart:co') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(window.localStorage.getItem('sw-cart:co:txn')).toBe('tok_abc');
  });

  it('★ refuses a redirect that is not https — the last place the URL is ours to refuse', async () => {
    response.body = { ...(response.body as object), redirectUrl: 'http://pay.example.test/s/1' };
    const root = mount();
    clickCheckout(root);
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="review"]')).toBeTruthy());
    (root.querySelector('[data-sw-part="review-pay"]') as HTMLElement).click();
    expect(assigned).toBe('');
    expect(root.querySelector('[data-sw-part="checkout-status"]')?.textContent).toContain('unavailable');
  });
});

describe('★ a refusal says WHAT is wrong', () => {
  it('names an out-of-stock item', async () => {
    response = { status: 409, body: { error: 'out_of_stock', sku: 'MUG', available: 0 } };
    const root = mount();
    root.setAttribute('data-oos-label', 'Sorry, that is out of stock.');
    clickCheckout(root);
    const status = await vi.waitFor(() => {
      const s = root.querySelector('[data-sw-part="checkout-status"]');
      // ★ Wait for the SETTLED state, not merely a non-empty one: the first thing written here is
      // "Checking availability…", which a truthiness check accepts while proving nothing.
      expect(s?.textContent).not.toMatch(/Checking/);
      expect(s?.textContent).toBeTruthy();
      return s as HTMLElement;
    });
    // "Something went wrong" is what most shops give a buyer, and it is why they leave.
    expect(status.textContent).toContain('out of stock');
    expect(status.textContent).toContain('MUG');
    expect(root.querySelector('[data-sw-part="review"]')).toBeNull();
  });

  it('says an item is no longer sold', async () => {
    response = { status: 409, body: { error: 'unknown-sku', sku: 'MUG' } };
    const root = mount();
    clickCheckout(root);
    await vi.waitFor(() =>
      expect(root.querySelector('[data-sw-part="checkout-status"]')?.textContent).toContain('no longer available'),
    );
  });

  it('falls back to a generic message for anything else, and re-enables the button', async () => {
    response = { status: 503, body: { error: 'checkout_unavailable' } };
    const root = mount();
    clickCheckout(root);
    const btn = root.querySelector('[data-sw-part="channel"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="checkout-status"]')?.textContent).toContain('unavailable'));
    // A buyer must be able to try again — a permanently disabled button is an abandoned sale.
    expect(btn.disabled).toBe(false);
  });
});

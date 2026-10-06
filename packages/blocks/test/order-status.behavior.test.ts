// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ORDER_STATUS_JS, usesOrderStatus } from '../src/order-status.js';
import { renderTemplate } from '../src/template.js';

/**
 * ★★ THE THANK-YOU PANEL, driven through the real runtime.
 *
 * The load-bearing claims, in the order they would hurt:
 *  - the page is COMPLETE before the script runs, so a flaky connection still thanks the buyer;
 *  - arriving here is never evidence of payment — the platform is asked;
 *  - the cart is cleared HERE, only on a confirmed `paid`.
 */

const PANEL = `
  <div data-sw-order-status data-currency-symbol="$" data-currency-decimals="2" data-cart-key="sw-cart:shop">
    <p data-sw-part="status-pending">Checking…</p>
    <p data-sw-part="status-paid" style="display:none">Payment confirmed</p>
    <p data-sw-part="status-failed" style="display:none">That did not go through</p>
    <p data-sw-part="status-unknown" style="display:none">No confirmation yet</p>
    <ul data-sw-part="status-summary"></ul>
    <template data-sw-part="status-line-template"><li><i data-sw-field="qty"></i> <b data-sw-field="name"></b></li></template>
    <strong data-sw-part="status-total"></strong>
  </div>`;

const PAID = {
  transaction: {
    status: 'paid',
    fulfilment: 'new',
    currency: 'EUR',
    amounts: { subtotalMinor: 1999, shippingMinor: 499, taxMinor: 0, totalMinor: 2498 },
    lines: [{ sku: 'MUG', name: 'Enamel mug', unitMinor: 1999, qty: 2, lineMinor: 3998 }],
    buyer: { email: 'ada@example.com' },
    createdAt: '2026-10-06T10:00:00.000Z',
  },
};

let fetched: string[];
let reply: { ok: boolean; body: unknown };

function run(url = 'https://shop.test/thank-you/?t=tok_abc', panel = PANEL): HTMLElement {
  window.history.replaceState({}, '', url.replace('https://shop.test', ''));
  document.body.innerHTML = panel;
  (0, eval)(ORDER_STATUS_JS);
  return document.querySelector('[data-sw-order-status]') as HTMLElement;
}

const vis = (root: HTMLElement, part: string) =>
  (root.querySelector(`[data-sw-part="${part}"]`) as HTMLElement | null)?.style.display !== 'none';

beforeEach(() => {
  fetched = [];
  reply = { ok: true, body: PAID };
  window.localStorage.clear();
  window.localStorage.setItem('sw-cart:shop', JSON.stringify([{ sku: 'MUG', name: 'Enamel mug', price: 19.99, qty: 2 }]));
  window.localStorage.setItem('sw-cart:shop:txn', 'tok_abc');
  (window as unknown as { __swt: (t: string) => string }).__swt = (t) => `/pay/p1/txn/${t}`;
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return { ok: reply.ok, json: async () => reply.body };
  });
});

describe('★★ the page is complete before the script runs', () => {
  it('the author’s own copy is in the markup, not fetched', () => {
    const rendered = renderTemplate(
      '{{#sw-order-status}}<h1>Thank you for your order</h1>{{/sw-order-status}}',
      { website: { shop: { enabled: true, currency: { code: 'EUR', decimals: 2 } } } } as never,
    );
    // A buyer who never runs the script still reads this.
    expect(rendered).toContain('Thank you for your order');
    expect(rendered).toContain('data-sw-order-status');
  });

  it('a bare {{sw-order-status}} still emits a usable default panel', () => {
    const rendered = renderTemplate('{{sw-order-status}}', {
      website: { shop: { enabled: true, currency: { decimals: 2 } } },
    } as never);
    expect(rendered).toContain('data-sw-part="status-paid"');
    expect(rendered).toContain('data-sw-part="status-line-template"');
    expect(rendered).toContain('Thank you');
  });

  it('renders nothing when the shop is OFF', () => {
    expect(renderTemplate('{{sw-order-status}}', { website: { shop: { enabled: false } } } as never).trim()).toBe('');
  });
});

describe('★★ the platform is asked — arriving is not evidence of payment', () => {
  it('reads the token from the return URL and asks about THAT', async () => {
    run();
    await vi.waitFor(() => expect(fetched).toHaveLength(1));
    expect(fetched[0]).toBe('/pay/p1/txn/tok_abc');
  });

  it('prefers the URL token over the stored one — a buyer may open the link in another tab', async () => {
    window.localStorage.setItem('sw-cart:shop:txn', 'tok_stale');
    run('https://shop.test/thank-you/?t=tok_from_link');
    await vi.waitFor(() => expect(fetched[0]).toBe('/pay/p1/txn/tok_from_link'));
  });

  it('falls back to the persisted token when the URL carries none', async () => {
    run('https://shop.test/thank-you/');
    await vi.waitFor(() => expect(fetched[0]).toBe('/pay/p1/txn/tok_abc'));
  });

  it('★ shows the paid state ONLY when the platform says paid', async () => {
    const root = run();
    await vi.waitFor(() => expect(vis(root, 'status-paid')).toBe(true));
    expect(vis(root, 'status-pending')).toBe(false);
    expect(vis(root, 'status-failed')).toBe(false);
    expect(vis(root, 'status-unknown')).toBe(false);
  });

  it('★ an UNPAID transaction never shows the paid message, however the buyer got here', async () => {
    reply = { ok: true, body: { transaction: { ...PAID.transaction, status: 'created' } } };
    const root = run();
    await vi.waitFor(() => expect(vis(root, 'status-unknown')).toBe(true));
    expect(vis(root, 'status-paid')).toBe(false);
  });

  it('shows the failed state for failed, cancelled and expired', async () => {
    for (const status of ['failed', 'cancelled', 'expired']) {
      reply = { ok: true, body: { transaction: { ...PAID.transaction, status } } };
      const root = run();
      await vi.waitFor(() => expect(vis(root, 'status-failed'), status).toBe(true));
      expect(vis(root, 'status-paid'), status).toBe(false);
    }
  });

  it('degrades to the unknown state when the lookup fails, and clears the pending line', async () => {
    reply = { ok: false, body: null };
    const root = run();
    await vi.waitFor(() => expect(vis(root, 'status-unknown')).toBe(true));
    expect(vis(root, 'status-pending')).toBe(false);
  });

  it('with no token at all it says so, rather than leaving a spinner forever', async () => {
    window.localStorage.clear();
    const root = run('https://shop.test/thank-you/');
    await vi.waitFor(() => expect(vis(root, 'status-pending')).toBe(false));
    expect(vis(root, 'status-unknown')).toBe(true);
    expect(fetched).toHaveLength(0);
  });
});

describe('the summary', () => {
  it('fills the author’s own line template and the total', async () => {
    const root = run();
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="status-summary"] li')).toBeTruthy());
    const li = root.querySelector('[data-sw-part="status-summary"] li') as HTMLElement;
    expect(li.querySelector('i')?.textContent).toBe('2');
    expect(li.querySelector('b')?.textContent).toBe('Enamel mug');
    expect(root.querySelector('[data-sw-part="status-total"]')?.textContent).toBe('$24.98');
  });

  it('★ fills by textContent — an order line is not a markup sink', async () => {
    reply = { ok: true, body: { transaction: { ...PAID.transaction, lines: [{ ...PAID.transaction.lines[0], name: '<img src=x onerror=alert(1)>' }] } } };
    const root = run();
    await vi.waitFor(() => expect(root.querySelector('[data-sw-field="name"]')).toBeTruthy());
    const nameEl = root.querySelector('[data-sw-field="name"]') as HTMLElement;
    expect(nameEl.textContent).toContain('<img');
    expect(nameEl.querySelector('img')).toBeNull();
  });

  it('respects a zero-decimal currency', async () => {
    document.body.innerHTML = '';
    const root = run('https://shop.test/thank-you/?t=tok_abc', PANEL.replace('data-currency-decimals="2"', 'data-currency-decimals="0"').replace('data-currency-symbol="$"', 'data-currency-symbol="¥"'));
    reply = { ok: true, body: { transaction: { ...PAID.transaction, currency: 'JPY', amounts: { ...PAID.transaction.amounts, totalMinor: 2498 } } } };
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="status-total"]')?.textContent).toBe('¥2498'));
  });
});

describe('★★ the cart is cleared HERE, and only on a confirmed payment', () => {
  it('clears on paid', async () => {
    const root = run();
    await vi.waitFor(() => expect(vis(root, 'status-paid')).toBe(true));
    expect(window.localStorage.getItem('sw-cart:shop')).toBeNull();
    expect(window.localStorage.getItem('sw-cart:shop:txn')).toBeNull();
  });

  it('★ does NOT clear when the payment failed — the buyer may want to try again', async () => {
    reply = { ok: true, body: { transaction: { ...PAID.transaction, status: 'failed' } } };
    const root = run();
    await vi.waitFor(() => expect(vis(root, 'status-failed')).toBe(true));
    expect(window.localStorage.getItem('sw-cart:shop')).not.toBeNull();
  });

  it('does not clear while the status is still unknown', async () => {
    reply = { ok: true, body: { transaction: { ...PAID.transaction, status: 'pending' } } };
    const root = run();
    await vi.waitFor(() => expect(vis(root, 'status-unknown')).toBe(true));
    expect(window.localStorage.getItem('sw-cart:shop')).not.toBeNull();
  });
});

describe('usesOrderStatus', () => {
  it('detects both the helper call and the rendered marker', () => {
    expect(usesOrderStatus('{{sw-order-status}}')).toBe(true);
    expect(usesOrderStatus('<div data-sw-order-status></div>')).toBe(true);
    expect(usesOrderStatus('<main>nothing</main>')).toBe(false);
    expect(usesOrderStatus(null)).toBe(false);
  });
});

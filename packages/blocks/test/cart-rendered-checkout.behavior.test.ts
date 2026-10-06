// @vitest-environment jsdom
/// <reference lib="dom" />
/**
 * ★★ THE TEST THAT WAS MISSING, AND THE BUG IT WOULD HAVE CAUGHT.
 *
 * Every other cart behaviour test builds `data-channels` BY HAND:
 *
 *     root.setAttribute('data-channels', JSON.stringify(CHANNELS))
 *
 * which is a fine way to test the runtime and a useless way to test the SITE. It meant the whole
 * payments epic could ship with the server, the executor, the webhook, the notifications, the
 * reconciler and the orders inbox all built and green — while `template.ts` quietly dropped the
 * `checkout` channel on the floor, so a real published page rendered a cart drawer with no pay
 * button at all. Nobody could have paid, and 40+ passing tests said otherwise.
 *
 * So this file renders the mount with the REAL helper and then runs the REAL runtime against that
 * rendered markup. The seam between them is the thing under test; neither half is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderTemplate } from '../src/template.js';
import { CART_JS } from '../src/cart.js';

type Shop = Record<string, unknown>;

/** The render context: a shop with a catalog item and whichever channels the case needs. */
function ctx(channels: unknown[], extra: Shop = {}) {
  return {
    website: {
      shop: {
        enabled: true,
        currency: { code: 'EUR', decimals: 2, position: 'before' },
        channels,
        ...extra,
      },
      t: { 'cart.currency_symbol': '€', 'cart.currency_code': 'EUR', 'shop.pay': 'Pay now', 'shop.wa': 'WhatsApp' },
    },
  } as never;
}

/** Renders `{{sw-cart}}` + an add button, mounts both, and starts the runtime. */
function mount(channels: unknown[], extra: Shop = {}): HTMLElement {
  const html = renderTemplate('{{sw-cart}}', ctx(channels, extra));
  document.body.innerHTML = html;
  const add = document.createElement('button');
  add.setAttribute('data-sw-cart-add', '');
  add.setAttribute('data-sku', 'mug');
  add.setAttribute('data-name', 'Mug');
  add.setAttribute('data-price', '1999');
  document.body.appendChild(add);
  (0, eval)(CART_JS);
  add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return document.querySelector('[data-sw-cart]') as HTMLElement;
}

let posted: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  posted = [];
  // `window.__swp(key)` is how the runtime learns the pay endpoint — supplied by the page's blob.
  (window as unknown as { __swp: (k: string) => string }).__swp = (k) => `https://sw.test/pay/p1/${k}`;
  vi.stubGlobal('fetch', (url: string, init: { body: string }) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve({
      status: 200,
      json: () =>
        Promise.resolve({
          redirectUrl: 'https://provider.test/s/1',
          token: 'tok_1',
          currency: 'EUR',
          amounts: { subtotalMinor: 1999, shippingMinor: 0, taxMinor: 0, totalMinor: 1999 },
          display: { subtotal: '19.99', shipping: '0.00', tax: '0.00', total: '19.99' },
          lines: [{ sku: 'mug', name: 'Mug', qty: 1, amount: '19.99' }],
        }),
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { __swp?: unknown }).__swp;
});

const CHECKOUT = { kind: 'checkout', key: 'pay', gatewayId: 'mock', email: 'o@shop.test', returnPath: '/thank-you/' };

describe('★★ a rendered checkout channel reaches the runtime', () => {
  it('the mount carries the checkout channel, WITH its key', () => {
    const html = renderTemplate('{{sw-cart}}', ctx([CHECKOUT]));
    expect(html).toContain('data-channels=');
    // The key is what the endpoint is built from and what an authored button is matched against.
    expect(html).toContain('&quot;kind&quot;:&quot;checkout&quot;');
    expect(html).toContain('&quot;key&quot;:&quot;pay&quot;');
    // Nothing about the gateway or the merchant belongs in a page attribute.
    expect(html).not.toContain('mock');
    expect(html).not.toContain('o@shop.test');
  });

  it('★ the default drawer renders a pay button for it', () => {
    const root = mount([CHECKOUT]);
    const btns = Array.from(root.querySelectorAll('[data-sw-part="channel"]')) as HTMLElement[];
    expect(btns).toHaveLength(1);
    expect(btns[0]!.textContent).toBe('Pay now');
  });

  it('★★ clicking it POSTs to the channel\'s own pay endpoint and shows the review panel', async () => {
    const root = mount([CHECKOUT]);
    (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.url).toBe('https://sw.test/pay/p1/pay');
    expect(posted[0]!.body).toMatchObject({ items: [{ sku: 'mug', qty: 1 }] });
    // The server's authoritative breakdown is what the buyer confirms against.
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="review"]')).toBeTruthy());
    expect(root.querySelector('[data-sw-part="review"]')!.textContent).toContain('19.99');
  });

  it('a checkout channel alongside a deep-link one renders both, each with its own key', () => {
    const html = renderTemplate('{{sw-cart}}', ctx([{ kind: 'whatsapp', key: 'wa', number: '+14155550123' }, CHECKOUT]));
    expect(html).toContain('&quot;key&quot;:&quot;wa&quot;');
    expect(html).toContain('&quot;key&quot;:&quot;pay&quot;');
    const root = mount([{ kind: 'whatsapp', key: 'wa', number: '+14155550123' }, CHECKOUT]);
    expect(root.querySelectorAll('[data-sw-part="channel"]')).toHaveLength(2);
  });
});

describe('★★ declared buyer fields are rendered AND collected', () => {
  const WITH_FIELD = { ...CHECKOUT, fields: [{ key: 'email', type: 'email', required: true }] };

  it('renders a control for a declared field', () => {
    const root = mount([WITH_FIELD]);
    expect(root.querySelector('[data-sw-part="order-field"]')).toBeTruthy();
    expect(root.querySelector('[data-sw-part="order-field"] input')).toBeTruthy();
  });

  it('★★ the control carries the field KEY as its name, so the value actually arrives', async () => {
    const root = mount([WITH_FIELD]);
    const input = root.querySelector('[data-sw-part="order-field"] input') as HTMLInputElement;
    // ★ Without a name the value is collected under no key at all: the server then sees an empty
    // `fields` object, rejects the required field, and the buyer meets a button that always fails.
    expect(input.name).toBe('email');
    input.value = 'ada@example.com';
    (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0]!.body as { fields: Record<string, string> }).fields).toEqual({ email: 'ada@example.com' });
  });

  it('★ a REQUIRED field left empty blocks the POST instead of failing server-side', async () => {
    const root = mount([WITH_FIELD]);
    const form = root.querySelector('[data-sw-part="channel-form"]') as HTMLFormElement;
    expect(form).toBeTruthy();
    // jsdom implements checkValidity; reportValidity is stubbed to follow it.
    form.reportValidity = () => form.checkValidity();
    (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    // Nothing was sent, and the button is usable again.
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toHaveLength(0);
    expect((root.querySelector('[data-sw-part="channel"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('★ the runtime hands back its prior attempt so stock is not stacked', () => {
  it('sends no supersede on a first attempt, and the prior token on a retry', async () => {
    const root = mount([CHECKOUT]);
    const btn = root.querySelector('[data-sw-part="channel"]') as HTMLElement;
    btn.click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0]!.body as Record<string, unknown>).supersede).toBeUndefined();
    // The token is remembered at REVIEW time — a buyer who goes back has already cost a hold.
    // (The cart key is derived from the page address, so find it rather than hard-coding it.)
    const pendingKey = () =>
      Object.keys(window.localStorage).find((k) => k.endsWith(':pending')) ?? '';
    await vi.waitFor(() => expect(pendingKey()).not.toBe(''));
    expect(window.localStorage.getItem(pendingKey())).toBe('tok_1');

    // Back, then Checkout again.
    await vi.waitFor(() => expect(root.querySelector('[data-sw-part="review-cancel"]')).toBeTruthy());
    (root.querySelector('[data-sw-part="review-cancel"]') as HTMLElement).click();
    btn.click();
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect((posted[1]!.body as Record<string, unknown>).supersede).toBe('tok_1');
  });
});

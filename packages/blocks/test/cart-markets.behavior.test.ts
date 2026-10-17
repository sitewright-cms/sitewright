// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CART_JS } from '../src/cart.js';

/**
 * ★★ SHOP MARKETS in the browser, through the REAL runtime. A published site is static, so the
 * visitor's market is chosen here — from their own earlier choice, the page language, then the
 * browser's region — and everything follows it: which buttons can be bought, the prices and their
 * currency, which cart is filled, which checkout channels are offered, and the ship-to question the
 * server re-checks.
 */

const MARKETS = [
  { id: 'eu', name: 'Europe', currency: 'EUR', locale: 'de', channels: ['card'], ship: ['DE', 'AT'] },
  { id: 'ch', name: 'Switzerland', currency: 'CHF', locale: 'de', channels: ['card', 'twint'], ship: ['CH'] },
  { id: 'us', name: 'United States', currency: 'USD', locale: 'en', ship: ['US', 'CA'] },
];
const CHANNELS = [
  { kind: 'checkout', key: 'card', gatewayId: 'stripe' },
  { kind: 'checkout', key: 'twint', gatewayId: 'twint' },
];

let posted: Array<{ url: string; body: Record<string, unknown> }>;
let reloaded: number;

function setLanguages(lang: string, browser: string[]): void {
  document.documentElement.setAttribute('lang', lang);
  Object.defineProperty(window.navigator, 'languages', { value: browser, configurable: true });
}

/** A page with a cart mount, two buy buttons and two prices, then the runtime. */
function boot(): HTMLElement {
  document.body.innerHTML =
    '<div data-sw-cart data-cart-key="mk"></div>' +
    '<button data-sw-cart-add data-sku="mug" data-name="Mug" data-price="19.9" data-prices=\'{"eu":"19.9","ch":"21.5","us":"23"}\'>Add</button>' +
    '<button data-sw-cart-add data-sku="cap" data-name="Cap" data-price="9" data-prices=\'{"eu":"9"}\'>Add</button>' +
    '<span id="pmug" data-sw-price data-price="19.9" data-prices=\'{"eu":"19.9","ch":"21.5","us":"23"}\'>€19.90</span>' +
    '<span id="pcap" data-sw-price data-price="9" data-prices=\'{"eu":"9"}\'>€9.00</span>' +
    '<select id="switch" data-sw-market-switcher></select>';
  const root = document.querySelector('[data-sw-cart]') as HTMLElement;
  root.setAttribute('data-channels', JSON.stringify(CHANNELS));
  root.setAttribute('data-markets', JSON.stringify(MARKETS));
  root.setAttribute('data-ship-to-label', 'Ship to');
  root.setAttribute('data-unavailable-label', 'Not available in {market}');
  (0, eval)(CART_JS);
  document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  return root;
}

const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-sw-cart-add]'));
const channelsShown = (root: HTMLElement) => Array.from(root.querySelectorAll('[data-sw-part="channel"]')).map((b) => b.textContent);

beforeEach(() => {
  posted = [];
  reloaded = 0;
  window.localStorage.clear();
  (window as unknown as { __swp: (k: string) => string }).__swp = (k) => `/pay/p1/${k}`;
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ token: 't', redirectUrl: 'https://pay.example.test/s/1', currency: 'CHF', amounts: { totalMinor: 3050 }, display: { total: '30.50' }, lines: [] }),
    };
  });
  delete (window as unknown as Record<string, unknown>).location;
  (window as unknown as { location: unknown }).location = { assign: () => undefined, reload: () => void (reloaded += 1), host: 'x', pathname: '/' } as never;
});

describe('which market a visitor is in', () => {
  it('★ the page language decides — and the browser’s region decides between markets sharing it', () => {
    setLanguages('de', ['de-CH', 'de']);
    boot();
    expect((document.getElementById('switch') as HTMLSelectElement).value).toBe('ch');
  });

  it('a page language no market claims falls to the browser’s region, then to the first market', () => {
    setLanguages('fr', ['en-US']);
    boot();
    expect((document.getElementById('switch') as HTMLSelectElement).value).toBe('us');
    window.localStorage.clear();
    setLanguages('fr', ['fr-FR']);
    boot();
    expect((document.getElementById('switch') as HTMLSelectElement).value).toBe('eu');
  });

  it('★ the visitor’s own choice is remembered, and switching reloads into the new market', () => {
    setLanguages('de', ['de-DE']);
    boot();
    const sel = document.getElementById('switch') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['eu', 'ch', 'us']);
    sel.value = 'us';
    sel.dispatchEvent(new Event('change'));
    expect(reloaded).toBe(1);
    boot();
    expect((document.getElementById('switch') as HTMLSelectElement).value).toBe('us');
  });
});

describe('★★ prices, buttons and the cart follow the market', () => {
  it('shows the market’s prices in its currency, and a product it does not sell as unavailable', () => {
    setLanguages('de', ['de-CH']);
    boot();
    expect(document.getElementById('pmug')!.textContent).toMatch(/21[.,]50\s?CHF|CHF\s?21[.,]50/); // formatted for the page language
    expect(document.getElementById('pcap')!.textContent).toBe('Not available in Switzerland');
    const [mug, cap] = buttons();
    expect(mug!.disabled).toBe(false);
    expect(cap!.disabled).toBe(true);
    expect(cap!.title).toBe('Not available in Switzerland');
  });

  it('★ keeps one cart per market, so a basket never mixes currencies', () => {
    setLanguages('de', ['de-CH']);
    boot();
    buttons()[0]!.click();
    const stored = Object.keys(window.localStorage).filter((k) => k.startsWith('sw-cart:'));
    expect(stored.length).toBe(1);
    expect(stored[0]!.endsWith(':ch')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(stored[0]!)!)[0]).toMatchObject({ sku: 'mug', price: 21.5 });
  });

  it('offers only the checkout channels — the providers — the market lists', () => {
    setLanguages('de', ['de-DE']);
    const eu = boot();
    expect(channelsShown(eu).length).toBe(1);
    window.localStorage.clear();
    setLanguages('de', ['de-CH']);
    const ch = boot();
    expect(channelsShown(ch).length).toBe(2);
  });
});

describe('★★ checkout sends the market and the ship-to country — and asks for one first', () => {
  it('asks where it ships, offering only the market’s countries', async () => {
    setLanguages('en', ['en-US']);
    const root = boot();
    buttons()[0]!.click();
    const shipTo = root.querySelector<HTMLSelectElement>('[data-sw-ship-to]')!;
    expect(Array.from(shipTo.options).map((o) => o.value).filter(Boolean).sort()).toEqual(['CA', 'US']);
    // Not chosen: nothing is posted.
    (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toEqual([]);
    shipTo.value = 'CA';
    (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toMatchObject({ market: 'us', shipTo: 'CA', items: [{ sku: 'mug', qty: 1 }] });
    // Still nothing price-shaped: the server charges from its own list.
    expect(JSON.stringify(posted[0]!.body)).not.toMatch(/23|price/i);
  });

  it('a market shipping to one country has it chosen already', async () => {
    setLanguages('de', ['de-CH']);
    const root = boot();
    buttons()[0]!.click();
    expect(root.querySelector<HTMLSelectElement>('[data-sw-ship-to]')!.value).toBe('CH');
    (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toMatchObject({ market: 'ch', shipTo: 'CH' });
  });
});

describe('a shop without markets is exactly as before', () => {
  it('no ship-to question, no market in the request, one cart key', async () => {
    document.body.innerHTML =
      '<div data-sw-cart data-cart-key="plain"></div><button data-sw-cart-add data-sku="mug" data-name="Mug" data-price="19.9">Add</button>';
    const root = document.querySelector('[data-sw-cart]') as HTMLElement;
    root.setAttribute('data-channels', JSON.stringify([CHANNELS[0]]));
    (0, eval)(CART_JS);
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    buttons()[0]!.click();
    expect(root.querySelector('[data-sw-ship-to]')).toBeNull();
    (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).not.toHaveProperty('market');
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith('sw-cart:')).every((k) => !k.includes(':eu'))).toBe(true);
  });
});

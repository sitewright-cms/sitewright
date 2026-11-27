// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormSchema, composeAmounts, fromMinorUnits, toPublicForm, type ShopPricing } from '@sitewright/schema';
import { demoRuntimeJs, type DemoRuntimeData } from '../src/demo-runtime.js';
import { componentAssets } from '../src/components.js';
import { CART_JS, resolveShopChannels } from '../src/cart.js';
import { ORDER_STATUS_JS } from '../src/order-status.js';
import { BOOKING_JS } from '../src/booking-runtime.js';
import { bookingRenderContext } from '../src/booking.js';
import { renderTemplate } from '../src/template.js';
import { renderFormMarkup, resolveFormEmbeds, resolveFormEndpoints } from '../src/form-embed.js';

/**
 * ★★ A DEMO COPY, driven through the REAL runtimes.
 *
 * The demo runtime answers the platform's routes in the page, and the runtimes read those answers field by field.
 * So each runtime here runs unchanged against the demo runtime and must reach its SUCCESS state: a form sent, an
 * order sent from the cart, a checkout reviewed and its thank-you page paid, a booking made in each of the four
 * modes, and a booking's own page cancelling it. A runtime that starts reading a field the demo does not answer
 * fails here, rather than leaving every demo copy quietly broken.
 *
 * And nothing may leave the page: the real `fetch` underneath is a spy that must never be called.
 */

const FORM_JS = componentAssets(['Form']).js;
// Monday 2 March 2026, 09:00 in Berlin (UTC+1 until the end of March).
const NOW = Date.UTC(2026, 2, 2, 8, 0);

const base = { confirmation: 'instant', maxQuantity: 1, minNoticeMin: 0, maxAdvanceDays: 90, timeZone: 'Europe/Berlin' };
const OFFERINGS: Record<string, Record<string, unknown>> = {
  massage: { ...base, id: 'massage', name: 'Massage', mode: 'duration', durationMin: 60 },
  class: { ...base, id: 'class', name: 'Yoga class', mode: 'slots', maxQuantity: 4 },
  room: { ...base, id: 'room', name: 'Meeting room', mode: 'range', minMin: 60, maxMin: 180, stepMin: 30 },
  cabin: { ...base, id: 'cabin', name: 'Cabin', mode: 'days', unit: 'night', minUnits: 1, maxUnits: 7, checkIn: '15:00', checkOut: '11:00' },
  consult: { ...base, id: 'consult', name: 'Consultation', mode: 'duration', durationMin: 30, confirmation: 'request' },
  paid: { ...base, id: 'paid', name: 'Paid session', mode: 'duration', durationMin: 60, price: { amountMinor: 4500, per: 'booking', currency: 'EUR', digits: 2 } },
};
const DATA: DemoRuntimeData = {
  offerings: OFFERINGS,
  returnPaths: { card: '/thank-you/' },
  catalog: { c: 'EUR', d: 2, items: { mug: { n: 'Enamel mug', p: 1999 } } },
};
const BOOKING = bookingRenderContext({
  offerings: Object.values(OFFERINGS).map((o) => ({ id: o.id, name: o.name })),
  pow: false,
  statusPath: '/my-booking/',
} as never);

let network: ReturnType<typeof vi.fn>;

const part = (root: Element, name: string) => root.querySelector(`[data-sw-part="${name}"]`) as HTMLElement;
const parts = (root: Element, name: string) => Array.from(root.querySelectorAll(`[data-sw-part="${name}"]`)) as HTMLButtonElement[];
const shown = (el: Element | null) => !!el && !el.hasAttribute('hidden');
const until = (check: () => void) => vi.waitFor(check, { timeout: 3000, interval: 10 });
function fill(root: Element, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const el = root.querySelector(`[name="${name}"]`) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
/** Starts the demo runtime over a spy standing in for the network, exactly as the page loads it. */
function startDemo(data: DemoRuntimeData = DATA): void {
  (0, eval)(demoRuntimeJs(data));
}
/** One answer of the demo runtime, as a runtime would read it. */
async function ask(url: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  document.documentElement.lang = 'en-GB';
  document.documentElement.removeAttribute('data-sw-demo');
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  network = vi.fn(async () => {
    throw new TypeError('the network was reached');
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of ['__swf', '__swp', '__swt', '__swb']) delete (window as unknown as Record<string, unknown>)[k];
});

describe('the demo runtime itself', () => {
  it('marks the page, and builds every address under sw-demo: in the shapes the runtimes append to', () => {
    startDemo();
    const w = window as unknown as Record<string, ((...a: unknown[]) => string) & { preview?: boolean }>;
    expect(document.documentElement.hasAttribute('data-sw-demo')).toBe(true);
    expect(w.__swf!('contact')).toBe('sw-demo:/f/contact');
    expect(w.__swp!('card')).toBe('sw-demo:/pay/card');
    expect(w.__swt!('a b')).toBe('sw-demo:/txn/a%20b');
    expect(w.__swb!('massage/availability')).toBe('sw-demo:/b/massage/availability');
    expect(w.__swb!.preview).toBe(false);
  });

  it('answers sw-demo: in the page and passes every other request to the real fetch', async () => {
    startDemo();
    const res = await fetch('sw-demo:/f/contact/challenge');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ algorithm: 'SHA-256', salt: 'sw-demo', maxnumber: 0 });
    expect((await fetch('sw-demo:/nothing/here')).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
    await expect(fetch('https://elsewhere.test/data.json')).rejects.toThrow('the network was reached');
    expect(network).toHaveBeenCalledWith('https://elsewhere.test/data.json');
  });

  it('refuses a SKU it has no price for, as the platform does', async () => {
    startDemo();
    const res = await fetch('sw-demo:/pay/card', { method: 'POST', body: JSON.stringify({ items: [{ sku: 'toString', qty: 1 }] }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'unknown-sku', sku: 'toString' });
  });
});

describe('a contact form', () => {
  it('is sent, says so, and nothing leaves the page', async () => {
    const form = toPublicForm(
      FormSchema.parse({
        id: 'contact',
        name: 'Contact',
        recipient: 'owner@site.test',
        fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
        successMessage: 'Thanks — we will be in touch.',
      }),
    );
    const forms = resolveFormEndpoints({ contact: form }, (id) => `/f/p1/${id}`);
    document.body.innerHTML = resolveFormEmbeds(renderFormMarkup('contact', forms.contact!), { forms });
    startDemo();
    (0, eval)(FORM_JS);
    const el = document.querySelector('form') as HTMLFormElement;
    expect(el.getAttribute('data-sw-routed')).toBe('contact');
    fill(el, { email: 'ada@example.com' });
    el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => expect(shown(part(el, 'success')) && part(el, 'success').style.display !== 'none').toBe(true));
    expect(part(el, 'success').textContent).toContain('Thanks — we will be in touch.');
    expect(network).not.toHaveBeenCalled();
  });
});

describe('the cart', () => {
  function cart(channels: unknown[]): HTMLElement {
    const shop = resolveShopChannels({ enabled: true, currency: { code: 'EUR', decimals: 2 }, channels }, (id) => `/f/p1/${id}`);
    document.body.innerHTML = renderTemplate('{{sw-cart}}', { website: { shop } } as never);
    const add = document.createElement('button');
    add.setAttribute('data-sw-cart-add', '');
    add.setAttribute('data-sku', 'mug');
    add.setAttribute('data-name', 'Enamel mug');
    add.setAttribute('data-price', '19.99');
    document.body.appendChild(add);
    startDemo();
    (0, eval)(CART_JS);
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return document.querySelector('[data-sw-cart]') as HTMLElement;
  }

  it('sends an order from its order form', async () => {
    const root = cart([{ kind: 'form', key: 'order', email: 'orders@shop.test' }]);
    const form = root.querySelector('[data-sw-part="order"]') as HTMLFormElement;
    for (const input of Array.from(form.querySelectorAll('input[required]')) as HTMLInputElement[]) {
      input.value = input.type === 'email' ? 'ada@example.com' : 'Ada';
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => expect(form.querySelector('[data-sw-part="order-status"]')!.textContent).toBe(''));
    await until(() => expect(root.querySelector<HTMLElement>('[data-sw-part="sent-msg"]')!.style.display).toBe('block'));
    expect(network).not.toHaveBeenCalled();
  });

  describe('a checkout', () => {
    let assigned: string;
    const original = window.location;
    beforeEach(() => {
      assigned = '';
      // jsdom refuses a real navigation, and its page is http: a demo site's thank-you page is https.
      delete (window as unknown as Record<string, unknown>).location;
      (window as unknown as { location: unknown }).location = {
        origin: 'https://shop.test',
        href: 'https://shop.test/shop/',
        host: 'shop.test',
        pathname: '/shop/',
        assign: (u: string) => void (assigned = u),
      };
    });
    afterEach(() => {
      (window as unknown as { location: unknown }).location = original;
    });

    it('reviews the order priced from the published price list, then the thank-you page reads it as paid', async () => {
      const root = cart([{ kind: 'checkout', key: 'card', gatewayId: 'mock', email: 'o@shop.test' }]);
      // A second mug, so the line and the total are a sum.
      (document.querySelector('[data-sw-cart-add]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      (root.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
      await until(() => expect(root.querySelector('[data-sw-part="review"]')).not.toBeNull());
      const review = root.querySelector('[data-sw-part="review"]') as HTMLElement;
      expect(review.textContent).toContain('2 x Enamel mug');
      expect(review.textContent).toContain('39.98');
      (review.querySelector('[data-sw-part="review-pay"]') as HTMLElement).click();
      expect(assigned).toMatch(/^https:\/\/shop\.test\/thank-you\/\?t=demo-[a-z0-9]{12}$/);
      expect(network).not.toHaveBeenCalled();

      // The thank-you page, in the same tab: the order it just placed, paid.
      (window as unknown as { location: unknown }).location = original;
      window.history.replaceState({}, '', `/thank-you/?t=${new URL(assigned).searchParams.get('t')}`);
      for (const k of ['__swf', '__swp', '__swt', '__swb']) delete (window as unknown as Record<string, unknown>)[k];
      document.body.innerHTML =
        '<div data-sw-order-status data-currency-symbol="€" data-cart-key="sw-cart:shop">' +
        '<p data-sw-part="status-pending">Checking…</p><p data-sw-part="status-paid" style="display:none">Paid</p>' +
        '<p data-sw-part="status-failed" style="display:none">Failed</p><p data-sw-part="status-unknown" style="display:none">Unknown</p>' +
        '<ul data-sw-part="status-summary"></ul>' +
        '<template data-sw-part="status-line-template"><li><i data-sw-field="qty"></i> <b data-sw-field="name"></b></li></template>' +
        '<strong data-sw-part="status-total"></strong></div>';
      startDemo();
      (0, eval)(ORDER_STATUS_JS);
      const status = document.querySelector('[data-sw-order-status]') as HTMLElement;
      await until(() => expect(part(status, 'status-paid').style.display).not.toBe('none'));
      expect(part(status, 'status-summary').textContent).toContain('Enamel mug');
      expect(part(status, 'status-total').textContent).toBe('€39.98');
      expect(network).not.toHaveBeenCalled();
    });
  });
});

describe('booking', () => {
  function widget(id: string): HTMLElement {
    document.body.innerHTML = renderTemplate(`{{sw-booking "${id}"}}`, { booking: BOOKING });
    startDemo();
    (0, eval)(BOOKING_JS);
    return document.querySelector('[data-sw-booking]') as HTMLElement;
  }
  function send(root: HTMLElement): void {
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    part(root, 'details').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  const reference = (root: HTMLElement) => decodeURIComponent((part(root, 'manage').getAttribute('href') ?? '').split('#t=')[1] ?? '');

  it('books an appointment from the sample week, on the business clock', async () => {
    const root = widget('massage');
    await until(() => expect(parts(root, 'time').length).toBeGreaterThan(0));
    // 09:00 to 17:00 in hours, from now (09:00 in Berlin).
    expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
    parts(root, 'time')[2]!.click();
    expect(part(root, 'summary').textContent).toContain('11:00 – 12:00');
    send(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(part(root, 'done-message').textContent).toBe('You are booked. A confirmation is on its way to your email.');
    expect(part(root, 'manage').getAttribute('href')).toMatch(/^\/my-booking\/#t=DEMO-[A-Z0-9]{6}$/);
    expect(network).not.toHaveBeenCalled();
  });

  it('books places in a class at its set times', async () => {
    const root = widget('class');
    await until(() => expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['10:00', '14:00']));
    parts(root, 'time')[1]!.click();
    choose(root.querySelector('[name="quantity"]') as HTMLSelectElement, '3');
    send(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(part(root, 'summary').textContent).toContain('14:00');
    expect(network).not.toHaveBeenCalled();
  });

  it('books a start and a length within the day’s window', async () => {
    const root = widget('room');
    await until(() => expect(root.querySelector('select[name="start"]')).not.toBeNull());
    const start = root.querySelector('select[name="start"]') as HTMLSelectElement;
    expect(start.options[0]!.textContent).toBe('9:00');
    choose(start, '2');
    const len = root.querySelector('select[name="length"]') as HTMLSelectElement;
    choose(len, '90');
    part(root, 'continue').click();
    expect(part(root, 'summary').textContent).toContain('10:00 – 11:30');
    send(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(network).not.toHaveBeenCalled();
  });

  it('books nights on the calendar', async () => {
    const root = widget('cabin');
    await until(() => expect(part(root, 'range-label')?.textContent).toBe('March 2026'));
    const day = (date: string) =>
      root.querySelector(
        `[data-sw-part="day"][aria-label="${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(Date.parse(date))}"]`,
      ) as HTMLButtonElement;
    day('2026-03-05').click();
    day('2026-03-07').click();
    expect(part(root, 'summary').textContent).toContain('Nights: 2');
    part(root, 'continue').click();
    send(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(network).not.toHaveBeenCalled();
  });

  it('says a request is waiting when the offering is confirmed by hand', async () => {
    const root = widget('consult');
    await until(() => expect(parts(root, 'time').length).toBeGreaterThan(0));
    parts(root, 'time')[0]!.click();
    send(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(part(root, 'done-message').textContent).not.toBe('You are booked. A confirmation is on its way to your email.');
  });

  it('shows the booking on its own page and cancels it', async () => {
    const booked = widget('massage');
    await until(() => expect(parts(booked, 'time').length).toBeGreaterThan(0));
    parts(booked, 'time')[0]!.click();
    send(booked);
    await until(() => expect(shown(part(booked, 'done'))).toBe(true));
    const ref = reference(booked);

    for (const k of ['__swf', '__swp', '__swt', '__swb']) delete (window as unknown as Record<string, unknown>)[k];
    window.history.replaceState({}, '', `/my-booking/#t=${encodeURIComponent(ref)}`);
    document.body.innerHTML = renderTemplate('{{sw-booking-status}}', { booking: BOOKING });
    startDemo();
    (0, eval)(BOOKING_JS);
    const root = document.querySelector('[data-sw-booking-status]') as HTMLElement;
    await until(() => expect(shown(part(root, 'status-booked'))).toBe(true));
    expect(root.querySelector('[data-sw-field="offering"]')!.textContent).toBe('Massage');
    expect(root.querySelector('[data-sw-field="when"]')!.textContent).toBe('Mon, 2 Mar 2026, 9:00 – 10:00');
    part(root, 'cancel').click();
    part(root, 'cancel-yes').click();
    await until(() => expect(shown(part(root, 'status-cancelled'))).toBe(true));
    expect(network).not.toHaveBeenCalled();
  });

  it('knows no booking it did not make', async () => {
    window.history.replaceState({}, '', '/my-booking/#t=DEMO-NOPE00');
    document.body.innerHTML = renderTemplate('{{sw-booking-status}}', { booking: BOOKING });
    startDemo();
    (0, eval)(BOOKING_JS);
    const root = document.querySelector('[data-sw-booking-status]') as HTMLElement;
    await until(() => expect(shown(part(root, 'status-unknown'))).toBe(true));
  });
});

describe('★★ a demo checkout charges what the live checkout would', () => {
  const EXCLUSIVE: ShopPricing = { shipping: { flatMinor: 495, freeOverMinor: 5000 }, tax: { rateBp: 1900, mode: 'exclusive' } };
  const INCLUSIVE: ShopPricing = { tax: { rateBp: 1900, mode: 'inclusive' } };
  const HALF: ShopPricing = { shipping: { flatMinor: 495 }, tax: { rateBp: 1000, mode: 'exclusive' } };
  const PRICED: DemoRuntimeData = {
    catalogs: {
      eu: { c: 'EUR', d: 2, items: { mug: { n: 'Mug', p: 1999 }, tee: { n: 'Tee', p: 2500 } }, pricing: EXCLUSIVE },
      de: { c: 'EUR', d: 2, items: { mug: { n: 'Mug', p: 1999 } }, pricing: INCLUSIVE },
      half: { c: 'EUR', d: 2, items: { big: { n: 'Big', p: 2000 } }, pricing: HALF },
      jp: { c: 'JPY', d: 0, items: { cup: { n: 'Cup', p: 1200 } }, pricing: { tax: { rateBp: 1000, mode: 'exclusive' } } },
      kw: { c: 'KWD', d: 3, items: { pen: { n: 'Pen', p: 1250 } } },
      bh: { c: 'BHD', d: 3, items: { pin: { n: 'Pin', p: 5 }, free: { n: 'Free', p: 0 } } },
    },
    returnPaths: { card: '/thanks/#done' },
  };
  const ITEMS: Record<string, Record<string, number>> = {
    eu: { mug: 1999, tee: 2500 }, de: { mug: 1999 }, half: { big: 2000 }, jp: { cup: 1200 }, kw: { pen: 1250 }, bh: { pin: 5 },
  };
  const CURRENCY: Record<string, string> = { eu: 'EUR', de: 'EUR', half: 'EUR', jp: 'JPY', kw: 'KWD', bh: 'BHD' };
  const PRICING: Record<string, ShopPricing | undefined> = { eu: EXCLUSIVE, de: INCLUSIVE, half: HALF, jp: { tax: { rateBp: 1000, mode: 'exclusive' } }, kw: undefined, bh: undefined };

  /** What the platform's checkout computes for this cart (priceOrder → composeAmounts → fromMinorUnits). */
  function platform(market: string, cart: Record<string, number>) {
    const lines = Object.entries(cart).map(([sku, qty]) => ({ sku, name: sku, unitMinor: ITEMS[market]![sku]!, qty, lineMinor: ITEMS[market]![sku]! * qty }));
    const amounts = composeAmounts(lines, PRICING[market]);
    const c = CURRENCY[market]!;
    return {
      amounts,
      display: { subtotal: fromMinorUnits(amounts.subtotalMinor, c), shipping: fromMinorUnits(amounts.shippingMinor, c), tax: fromMinorUnits(amounts.taxMinor, c), total: fromMinorUnits(amounts.totalMinor, c) },
    };
  }

  it.each([
    ['flat shipping, threshold not reached, tax on top', 'eu', { mug: 1 }],
    ['the free-shipping threshold crossed', 'eu', { mug: 1, tee: 2 }],
    ['exactly at the threshold: free', 'eu', { tee: 2 }],
    ['tax included in the price', 'de', { mug: 3 }],
    ['a half minor unit of tax rounds up', 'half', { big: 1 }],
    ['a currency without decimals (JPY)', 'jp', { cup: 2 }],
    ['three decimals (KWD)', 'kw', { pen: 3 }],
    ['three decimals, padded (BHD)', 'bh', { pin: 1 }],
  ])('%s', async (_label, market, cart) => {
    startDemo(PRICED);
    const items = Object.entries(cart).map(([sku, qty]) => ({ sku, qty }));
    const r = await ask('sw-demo:/pay/card', { items, market });
    expect(r.status).toBe(200);
    const live = platform(market, cart);
    expect(r.body.amounts).toEqual(live.amounts);
    expect(r.body.display).toEqual(live.display);
    expect(r.body.currency).toBe(CURRENCY[market]);
  });

  it('formats as the server does, by the currency’s own decimals', async () => {
    startDemo(PRICED);
    expect((await ask('sw-demo:/pay/card', { items: [{ sku: 'cup', qty: 1 }], market: 'jp' })).body.display).toMatchObject({ subtotal: '1200', total: '1320' });
    expect((await ask('sw-demo:/pay/card', { items: [{ sku: 'pen', qty: 1 }], market: 'kw' })).body.display).toMatchObject({ total: '1.250' });
    expect((await ask('sw-demo:/pay/card', { items: [{ sku: 'pin', qty: 1 }], market: 'bh' })).body.display).toMatchObject({ total: '0.005' });
  });

  it('refuses what the platform refuses', async () => {
    startDemo(PRICED);
    expect(await ask('sw-demo:/pay/card', { items: [], market: 'eu' })).toEqual({ status: 400, body: { error: 'empty' } });
    expect(await ask('sw-demo:/pay/card', { items: [{ sku: 'mug', qty: 1 }, { sku: 'mug', qty: 1 }], market: 'eu' })).toEqual({ status: 400, body: { error: 'duplicate-sku', sku: 'mug' } });
    expect(await ask('sw-demo:/pay/card', { items: [{ sku: 'free', qty: 1 }], market: 'bh' })).toEqual({ status: 400, body: { error: 'zero-total' } });
  });

  it('keeps the token in the query of a thank-you page with a #fragment', async () => {
    startDemo(PRICED);
    const r = await ask('sw-demo:/pay/card', { items: [{ sku: 'mug', qty: 1 }], market: 'eu' });
    const back = new URL(String(r.body.redirectUrl));
    expect(back.pathname).toBe('/thanks/');
    expect(back.searchParams.get('t')).toBe(r.body.token);
    expect(back.hash).toBe('#done');
  });

  describe('where the browser refuses storage', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    beforeEach(() => {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new DOMException('denied', 'SecurityError'); } });
    });
    afterEach(() => {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    });

    it('still reads back the order it just placed on the same page', async () => {
      startDemo(PRICED);
      const r = await ask('sw-demo:/pay/card', { items: [{ sku: 'mug', qty: 2 }], market: 'eu' });
      expect(r.status).toBe(200);
      const status = await ask(`sw-demo:/txn/${String(r.body.token)}`);
      expect(status.status).toBe(200);
      expect(status.body.transaction).toMatchObject({ status: 'paid', lines: [{ name: 'Mug', qty: 2 }] });
    });
  });
});

describe('★ sample booking times, as the platform would list them', () => {
  const H = 3_600_000;
  const DAY = 24 * H;
  const DUR = { ...base, id: 'd', name: 'D', mode: 'duration', durationMin: 60 };
  const list = async (o: Record<string, unknown>, from: number, to: number, resource?: string) => {
    startDemo({ offerings: { [String(o.id)]: o } });
    return ask(`sw-demo:/b/${String(o.id)}/availability?from=${from}&to=${to}${resource ? `&resource=${resource}` : ''}`);
  };
  const starts = (r: { body: Record<string, unknown> }) => ((r.body.times ?? r.body.windows) as Array<{ start: number }>).map((t) => t.start);

  it('keeps the offering’s clock across the spring change: 09:00 is 08:00Z before it and 07:00Z after', async () => {
    const r = await list(DUR, Date.UTC(2026, 2, 27), Date.UTC(2026, 2, 31));
    const s = starts(r);
    expect(s[0]).toBe(Date.UTC(2026, 2, 27, 8)); // Friday 27 March, CET
    expect(s).toContain(Date.UTC(2026, 2, 30, 7)); // Monday 30 March, CEST
    expect(s).not.toContain(Date.UTC(2026, 2, 28, 8)); // the weekend has none
  });

  it('lists every day across the autumn change, none twice and none lost', async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 20, 8));
    const days = { ...base, id: 'c', name: 'C', mode: 'days', unit: 'day', minUnits: 1, maxUnits: 7 };
    const r = await list(days, Date.UTC(2026, 9, 23), Date.UTC(2026, 9, 28));
    // A day is listed when it STARTS inside the window, as the server's listDays: the 23rd began at 22:00Z the day
    // before, and the 28th begins at 23:00Z on the 27th.
    expect((r.body.days as Array<{ date: string }>).map((d) => d.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
  });

  it('★ books nights from check-in to check-out, and whole days midnight to midnight, across the autumn change', async () => {
    const nights = { ...base, id: 'n', name: 'Cabin', mode: 'days', unit: 'night', minUnits: 1, maxUnits: 7, checkIn: '15:00', checkOut: '11:00' };
    const days = { ...nights, id: 'w', unit: 'day' };
    startDemo({ offerings: { n: nights, w: days } });
    // Two nights from Saturday 24 October: in at 15:00 summer time, out at 11:00 winter time on the 26th.
    expect((await ask('sw-demo:/b/n', { date: '2026-10-24', units: '2' })).body).toMatchObject({ start: Date.UTC(2026, 9, 24, 13), end: Date.UTC(2026, 9, 26, 10) });
    // Two whole days: midnight to midnight, the second day 25 hours long.
    expect((await ask('sw-demo:/b/w', { date: '2026-10-24', units: '2' })).body).toMatchObject({ start: Date.UTC(2026, 9, 23, 22), end: Date.UTC(2026, 9, 25, 23) });
  });

  it('lists nothing sooner than the notice the offering asks for', async () => {
    const r = await list({ ...DUR, minNoticeMin: 120 }, NOW, NOW + 2 * DAY);
    expect(starts(r)[0]).toBe(NOW + 2 * H); // 11:00, two hours after now
  });

  it('lists nothing further ahead than the offering books', async () => {
    const r = await list({ ...DUR, maxAdvanceDays: 2 }, NOW, NOW + 7 * DAY);
    const s = starts(r);
    // As the server's timing rule: a start more than maxAdvanceDays x 24 h from now is too far. From Monday 09:00
    // that is Monday and Tuesday (eight a day) and Wednesday 09:00 itself.
    expect(s).toHaveLength(17);
    expect(Math.max(...s)).toBe(NOW + 2 * DAY);
  });

  it('clips the asked window to now, and to the platform’s 62 days of times', async () => {
    const r = await list({ ...DUR, maxAdvanceDays: 365 }, NOW - 5 * DAY, NOW + 100 * DAY);
    const s = starts(r);
    expect(Math.min(...s)).toBe(NOW);
    expect(Math.max(...s)).toBeLessThan(NOW + 62 * DAY);
    expect((await list(DUR, NOW + 10 * DAY, NOW + 5 * DAY)).body.times).toEqual([]);
  });

  it('names the resources a visitor chooses between, and only the one asked for', async () => {
    const pick = { ...DUR, resources: [{ id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }] };
    const all = await list(pick, NOW, NOW + DAY);
    expect((all.body.times as Array<{ resources: string[] }>)[0]!.resources).toEqual(['anna', 'ben']);
    const ben = await list(pick, NOW, NOW + DAY, 'ben');
    expect((ben.body.times as Array<{ resources: string[] }>).every((t) => t.resources.join() === 'ben')).toBe(true);
    expect((await list(pick, NOW, NOW + DAY, 'zed')).body).toEqual({ error: 'unknown-resource' });
    const room = { ...pick, id: 'room', mode: 'range', minMin: 60, maxMin: 180, stepMin: 30 };
    expect((await list(room, NOW, NOW + DAY)).body.windows).toEqual([
      { start: NOW, end: NOW + 8 * H, resource: 'anna' },
      { start: NOW, end: NOW + 8 * H, resource: 'ben' },
    ]);
  });

  it('books a priced offering without a payment hand-off', async () => {
    document.body.innerHTML = renderTemplate('{{sw-booking "paid"}}', { booking: BOOKING });
    startDemo();
    (0, eval)(BOOKING_JS);
    const root = document.querySelector('[data-sw-booking]') as HTMLElement;
    await until(() => expect(parts(root, 'time').length).toBeGreaterThan(0));
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    part(root, 'details').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(part(root, 'done-message').textContent).toBe('You are booked. A confirmation is on its way to your email.');
    expect(network).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
/// <reference lib="dom" />
/**
 * ★★ A CHECKOUT THAT ASKS FOR A CAPTCHA OR PROOF OF WORK IS ONE A BUYER CAN PASS.
 *
 * The shop settings offered both on a checkout channel and the server enforced both, but neither reached the page:
 * the helper dropped the flags and stamped no captcha key for a checkout, and the runtime sent neither. Every buyer
 * of such a shop was refused. The order-form channel's captcha worked only on a page that also had a captcha
 * contact form loading the vendor's script, and never with reCAPTCHA v3.
 *
 * Rendered with the REAL helper (and the render surfaces' own `resolveShopChannels`), run with the REAL runtime:
 * the seam between them is what broke.
 */
import { createHash, webcrypto } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderTemplate } from '../src/template.js';
import { CART_JS, resolveShopChannels } from '../src/cart.js';

const CAPTCHA = { provider: 'hcaptcha', siteKey: '10000000-ffff-ffff-ffff-000000000001' };
const CHECKOUT = { kind: 'checkout', key: 'pay', gatewayId: 'mock', email: 'o@shop.test' };
const SALT = 'salt-1';
const CHALLENGE = createHash('sha256').update(`${SALT}3`).digest('hex');

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
let challengeStatus: number;

/** Renders `{{sw-cart}}` for these channels as a published page would, mounts it, and starts the runtime. */
function mount(channels: unknown[], opts: { captcha?: typeof CAPTCHA | { provider: string; siteKey: string }; add?: boolean } = {}): HTMLElement {
  const shop = resolveShopChannels({ enabled: true, currency: { code: 'EUR', decimals: 2 }, channels }, (id) => `/f/p1/${id}`, opts.captcha);
  document.body.innerHTML = renderTemplate('{{sw-cart}}', { website: { shop, t: { 'cart.captcha': 'Bitte lösen Sie das Captcha.' } } } as never);
  const add = document.createElement('button');
  add.setAttribute('data-sw-cart-add', '');
  add.setAttribute('data-sku', 'mug');
  add.setAttribute('data-name', 'Mug');
  add.setAttribute('data-price', '19.99');
  document.body.appendChild(add);
  (0, eval)(CART_JS);
  document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  // The first item opens the drawer (and with it the captcha); a case about the closed drawer adds nothing.
  if (opts.add !== false) add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return document.querySelector('[data-sw-cart]') as HTMLElement;
}

const payButton = (root: HTMLElement, i = 0) => root.querySelectorAll('[data-sw-part="channel"]')[i] as HTMLButtonElement;
const status = (root: HTMLElement) => root.querySelector('[data-sw-part="checkout-status"]')?.textContent ?? '';
const checkouts = () => calls.filter((c) => c.method === 'POST' && !c.url.includes('/f/'));

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('script[data-sw-captcha-src]').forEach((s) => s.remove());
  window.localStorage.clear();
  calls = [];
  challengeStatus = 200;
  vi.stubGlobal('crypto', webcrypto);
  (window as unknown as { __swp: (k: string) => string }).__swp = (k) => `https://sw.test/pay/p1/${k}`;
  (window as unknown as { __swf: (id: string) => string }).__swf = (id) => `https://sw.test/f/p1/${id}`;
  vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    const reply = (status: number, body: unknown) => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
    if (url.includes('/challenge')) {
      return reply(challengeStatus, { algorithm: 'SHA-256', challenge: CHALLENGE, salt: SALT, maxnumber: 10, signature: 'sig' });
    }
    if (url.includes('/f/')) return reply(200, { ok: true });
    return reply(200, {
      redirectUrl: 'https://provider.test/s/1',
      token: 'tok_1',
      display: { subtotal: '19.99', shipping: '0.00', tax: '0.00', total: '19.99' },
      lines: [{ name: 'Mug', qty: 1, amount: '19.99' }],
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['__swp', '__swf', 'hcaptcha', 'grecaptcha']) delete (window as unknown as Record<string, unknown>)[k];
});

describe('★★ a checkout that asks for proof of work', () => {
  it('the rendered channel says so, and the order carries the solved challenge for THIS channel', async () => {
    const root = mount([{ ...CHECKOUT, pow: true }]);
    expect(root.getAttribute('data-channels')).toContain('"pow":true');
    payButton(root).click();
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(calls[0]!.url).toBe('https://sw.test/pay/p1/pay/challenge');
    const pow = JSON.parse(atob(String(checkouts()[0]!.body!._pow))) as Record<string, unknown>;
    expect(pow).toEqual({ algorithm: 'SHA-256', challenge: CHALLENGE, salt: SALT, number: 3, signature: 'sig' });
  });

  it('in the preview, asks the challenge at the preview’s address', async () => {
    (window as unknown as { __swp: (k: string) => string }).__swp = (k) => `/pay/p1/${k}?preview=1`;
    const root = mount([{ ...CHECKOUT, pow: true }]);
    payButton(root).click();
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(calls[0]!.url).toBe('/pay/p1/pay/challenge?preview=1');
    expect(checkouts()[0]!.url).toBe('/pay/p1/pay?preview=1');
  });

  it('★ sends no order without the work, and says checkout is unavailable', async () => {
    challengeStatus = 429;
    const root = mount([{ ...CHECKOUT, pow: true }]);
    payButton(root).click();
    await vi.waitFor(() => expect(status(root)).toBe('Checkout is unavailable right now. Please try again.'));
    expect(checkouts()).toHaveLength(0);
    expect(payButton(root).disabled).toBe(false);
  });

  it('a checkout that does not ask fetches no challenge', async () => {
    const root = mount([CHECKOUT]);
    payButton(root).click();
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(calls.some((c) => c.url.includes('/challenge'))).toBe(false);
    expect(checkouts()[0]!.body!._pow).toBeUndefined();
  });
});

describe('★★ a checkout that asks for a captcha', () => {
  let vendor: { render: ReturnType<typeof vi.fn>; getResponse: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vendor = { render: vi.fn(() => 7), getResponse: vi.fn((id: number) => (id === 7 ? 'answer-7' : 'someone-else')), reset: vi.fn() };
  });

  it('the rendered mount carries the project’s captcha and the translated prompt', () => {
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    expect(root.getAttribute('data-captcha-provider')).toBe('hcaptcha');
    expect(root.getAttribute('data-captcha-sitekey')).toBe(CAPTCHA.siteKey);
    expect(root.getAttribute('data-captcha-label')).toBe('Bitte lösen Sie das Captcha.');
    expect(root.getAttribute('data-channels')).toContain('"captcha":true');
  });

  it('★ loads the vendor’s script itself, and only once the drawer opens', async () => {
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    expect(document.querySelector('script[data-sw-captcha-src]')).toBeNull();
    (root.querySelector('[data-sw-part="toggle"]') as HTMLElement).click();
    expect(document.querySelector('script[data-sw-captcha-src="hcaptcha"]')?.getAttribute('src')).toBe('https://js.hcaptcha.com/1/api.js');
    // The script arrives: the widget is drawn into the cart's own box, just before the pay button.
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const box = root.querySelector('[data-sw-part="captcha"]') as HTMLElement;
    await vi.waitFor(() => expect(vendor.render).toHaveBeenCalledWith(box, { sitekey: CAPTCHA.siteKey }));
    expect(box.nextElementSibling).toBe(payButton(root));
    // No vendor class: a contact form's auto-render never touches this box.
    expect(box.className).toBe('');
  });

  it('★★ says so when it is not answered, and sends the answer of ITS widget when it is', async () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    vendor.getResponse.mockReturnValue('');
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA });
    payButton(root).click();
    await vi.waitFor(() => expect(status(root)).toBe('Bitte lösen Sie das Captcha.'));
    expect(checkouts()).toHaveLength(0);
    expect(payButton(root).disabled).toBe(false);

    vendor.getResponse.mockImplementation((id: number) => (id === 7 ? 'answer-7' : 'someone-else'));
    payButton(root).click();
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(checkouts()[0]!.body!['h-captcha-response']).toBe('answer-7');
    // The server's check spent the answer: the widget is reset for a next try (Back, then Checkout again).
    await vi.waitFor(() => expect(vendor.reset).toHaveBeenCalledWith(7));
  });

  it('the captcha first, then the work: both arrive on one order', async () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const root = mount([{ ...CHECKOUT, captcha: true, pow: true }], { captcha: CAPTCHA });
    payButton(root).click();
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(checkouts()[0]!.body).toMatchObject({ 'h-captcha-response': 'answer-7' });
    expect(checkouts()[0]!.body!._pow).toBeTruthy();
  });

  it('one widget for a cart, however many checkouts ask', async () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const root = mount(
      [
        { ...CHECKOUT, captcha: true },
        { ...CHECKOUT, key: 'twint', captcha: true },
      ],
      { captcha: CAPTCHA },
    );
    expect(root.querySelectorAll('[data-sw-part="captcha"]')).toHaveLength(1);
    payButton(root, 1).click();
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(checkouts()[0]!.url).toBe('https://sw.test/pay/p1/twint');
    expect(checkouts()[0]!.body!['h-captcha-response']).toBe('answer-7');
  });

  it('reCAPTCHA v3: no widget on the page, a fresh token per order', async () => {
    const grecaptcha = { ready: (cb: () => void) => cb(), execute: vi.fn(() => Promise.resolve('v3-token')) };
    (window as unknown as { grecaptcha: unknown }).grecaptcha = grecaptcha;
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: { provider: 'recaptcha-v3', siteKey: 'v3-key' } });
    expect(root.querySelector('[data-sw-part="captcha"]')).toBeNull();
    payButton(root).click();
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(grecaptcha.execute).toHaveBeenCalledWith('v3-key', { action: 'submit' });
    expect(checkouts()[0]!.body!['g-recaptcha-response']).toBe('v3-token');
  });

  it('a checkout that does not ask draws none, even when an order form does', () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const root = mount([CHECKOUT, { kind: 'form', key: 'order', email: 'o@shop.test', captcha: true }], { captcha: CAPTCHA });
    const boxes = Array.from(root.querySelectorAll('[data-sw-part="captcha"]'));
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.closest('form')).toBeTruthy();
  });
});

describe('★ the order-form channel’s captcha works without a contact form on the page', () => {
  it('draws its own widget, loads the script, and posts that widget’s answer', async () => {
    const vendor = { render: vi.fn(() => 3), getResponse: vi.fn((id: number) => (id === 3 ? 'answer-3' : '')), reset: vi.fn() };
    const root = mount([{ kind: 'form', key: 'order', email: 'o@shop.test', captcha: true }], { captcha: CAPTCHA });
    expect(document.querySelector('script[data-sw-captcha-src="hcaptcha"]')).toBeTruthy();
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const form = root.querySelector('[data-sw-part="order"]') as HTMLFormElement;
    const box = form.querySelector('[data-sw-part="captcha"]') as HTMLElement;
    await vi.waitFor(() => expect(vendor.render).toHaveBeenCalledWith(box, { sitekey: CAPTCHA.siteKey }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(calls.filter((c) => c.url.includes('/f/'))).toHaveLength(1));
    expect(calls.find((c) => c.url.includes('/f/'))!.body!['h-captcha-response']).toBe('answer-3');
    await vi.waitFor(() => expect(vendor.reset).toHaveBeenCalledWith(3));
  });

  it('says so, translated, and sends nothing when the captcha is not answered', async () => {
    const vendor = { render: vi.fn(() => 3), getResponse: vi.fn(() => ''), reset: vi.fn() };
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const root = mount([{ kind: 'form', key: 'order', email: 'o@shop.test', captcha: true }], { captcha: CAPTCHA });
    const form = root.querySelector('[data-sw-part="order"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(form.querySelector('[data-sw-part="order-status"]')!.textContent).toBe('Bitte lösen Sie das Captcha.'));
    expect(calls.filter((c) => c.url.includes('/f/'))).toHaveLength(0);
    expect((form.querySelector('[data-sw-part="order-submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('an authored cart', () => {
  const AUTHORED = (inner: string) =>
    `<div data-sw-cart data-cart-key="a" data-channels='${JSON.stringify([{ ...CHECKOUT, captcha: true }])}' data-captcha-provider="hcaptcha" data-captcha-sitekey="${CAPTCHA.siteKey}">` +
    `<button data-sw-action="open">Basket</button>` +
    `<dialog data-sw-part="drawer"><ul data-sw-part="items"></ul><template data-sw-part="line-template"><li><span data-sw-field="name"></span></li></template>` +
    `<div data-sw-part="foot">${inner}<button data-sw-action="channel:pay">Pay</button></div></dialog></div>`;

  function bind(html: string): HTMLElement {
    document.body.innerHTML = html;
    (0, eval)(CART_JS);
    const root = document.querySelector('[data-sw-cart]') as HTMLElement;
    (root.querySelector('[data-sw-action="open"]') as HTMLElement).click();
    return root;
  }

  it('draws the captcha into the author’s own captcha part', async () => {
    const vendor = { render: vi.fn(() => 1), getResponse: vi.fn(() => 'a'), reset: vi.fn() };
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const root = bind(AUTHORED('<div data-sw-part="captcha" id="mine"></div>'));
    expect(vendor.render).toHaveBeenCalledWith(root.querySelector('#mine'), { sitekey: CAPTCHA.siteKey });
    expect(root.querySelectorAll('[data-sw-part="captcha"]')).toHaveLength(1);
  });

  it('without one, puts the box just before the checkout button, as it does the ship-to question', () => {
    const vendor = { render: vi.fn(() => 1), getResponse: vi.fn(() => 'a'), reset: vi.fn() };
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
    const root = bind(AUTHORED(''));
    const box = root.querySelector('[data-sw-part="captcha"]') as HTMLElement;
    expect(box.nextElementSibling).toBe(root.querySelector('[data-sw-action="channel:pay"]'));
    expect(vendor.render).toHaveBeenCalledWith(box, { sitekey: CAPTCHA.siteKey });
  });
});

describe('★★ a puzzle the captcha vendor shows can be answered', () => {
  // jsdom has no <dialog> methods: the browser's are stood in for, and the modal one is watched. Whether the
  // puzzle can really be reached is measured in a real browser; here, which way the drawer opens.
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  let modal: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    modal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    proto.showModal = modal;
    proto.show = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    Object.defineProperty(proto, 'open', { configurable: true, get(this: HTMLDialogElement) { return this.hasAttribute('open'); } });
    // An earlier case may have left a drawer open, and the page's scroll locked with it.
    document.documentElement.style.overflow = '';
  });
  afterEach(() => {
    for (const k of ['showModal', 'show', 'close', 'open']) delete proto[k];
  });
  const vendor = () => ({ render: vi.fn(() => 7), getResponse: vi.fn((id: number) => (id === 7 ? 'answer-7' : '')), reset: vi.fn() });
  const open = (root: HTMLElement) => (root.querySelector('[data-sw-part="toggle"]') as HTMLElement).click();
  const drawer = (root: HTMLElement) => root.querySelector('dialog') as HTMLDialogElement;
  const scrim = (root: HTMLElement) => root.querySelector('[data-sw-part="scrim"]') as HTMLElement | null;

  it('★★ a cart with a visible captcha opens its drawer WITHOUT the modal layer, over a scrim of its own', () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor();
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    open(root);
    // A modal drawer makes the vendor's puzzle (added at the end of the page) inert and paints over it.
    expect(modal).not.toHaveBeenCalled();
    expect(drawer(root).open).toBe(true);
    expect(drawer(root).hasAttribute('data-sw-loose')).toBe(true);
    expect(scrim(root)!.hidden).toBe(false);
    expect(scrim(root)!.nextElementSibling).toBe(drawer(root));
  });

  it('Esc and the scrim close it, as a modal’s Esc and backdrop would', () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor();
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    open(root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(drawer(root).open).toBe(false);
    expect(scrim(root)!.hidden).toBe(true);
    expect(drawer(root).hasAttribute('data-sw-loose')).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
    open(root);
    scrim(root)!.click();
    expect(drawer(root).open).toBe(false);
  });

  it('★ the default cart moves to the end of the page first, out of any ancestor that would confine its drawer', () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor();
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    // Where a site puts {{sw-cart}}: inside a header that slides with a transform.
    const header = document.createElement('header');
    header.style.transform = 'translateY(0)';
    document.body.prepend(header);
    header.appendChild(root);
    const render = (window as unknown as { hcaptcha: { render: ReturnType<typeof vi.fn> } }).hcaptcha.render;
    open(root);
    expect(root.parentNode).toBe(document.body);
    expect(drawer(root).hasAttribute('data-sw-loose')).toBe(true);
    // Moved BEFORE the widget was drawn: moving an iframe reloads it.
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('says it is modal while it is open loose, and stops saying so when it closes', () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor();
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    open(root);
    expect(drawer(root).getAttribute('aria-modal')).toBe('true');
    scrim(root)!.click();
    expect(drawer(root).hasAttribute('aria-modal')).toBe(false);
  });

  it('Esc pressed in ANOTHER dialog is that dialog’s, not the cart’s', () => {
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor();
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    const other = document.createElement('dialog');
    const inside = document.createElement('button');
    other.appendChild(inside);
    document.body.appendChild(other);
    open(root);
    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawer(root).open).toBe(true);
  });

  it('a cart with no captcha to show keeps the modal drawer (no captcha, or reCAPTCHA v3)', () => {
    const plain = mount([CHECKOUT], { add: false });
    open(plain);
    expect(modal).toHaveBeenCalledTimes(1);
    expect(scrim(plain)).toBeNull();
    (window as unknown as { grecaptcha: unknown }).grecaptcha = { ready: (cb: () => void) => cb(), execute: () => Promise.resolve('t') };
    const v3 = mount([{ ...CHECKOUT, captcha: true }], { captcha: { provider: 'recaptcha-v3', siteKey: 'v3-key' }, add: false });
    open(v3);
    expect(modal).toHaveBeenCalledTimes(2);
    expect(scrim(v3)).toBeNull();
  });

  it('refused after the captcha was answered: the widget is reset and the button works again', async () => {
    const v = vendor();
    (window as unknown as { hcaptcha: unknown }).hcaptcha = v;
    vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'checkout_unavailable' }) });
    });
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA });
    payButton(root).click();
    await vi.waitFor(() => expect(status(root)).toBe('Checkout is unavailable right now. Please try again.'));
    expect(checkouts()[0]!.body!['h-captcha-response']).toBe('answer-7');
    expect(v.reset).toHaveBeenCalledWith(7);
    expect(payButton(root).disabled).toBe(false);
  });

  it('a captcha script that came too late is asked for again on the next try', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const root = mount([{ ...CHECKOUT, captcha: true }], { captcha: CAPTCHA, add: false });
    open(root);
    // Twenty seconds and no script: the widget gives up for now.
    vi.advanceTimersByTime(20_500);
    vi.useRealTimers();
    const v = vendor();
    (window as unknown as { hcaptcha: unknown }).hcaptcha = v;
    expect(v.render).not.toHaveBeenCalled();
    // The cart now has an item; the buyer tries to pay, and the widget is drawn after all.
    (document.querySelector('[data-sw-cart-add]') as HTMLElement).click();
    payButton(root).click();
    expect(v.render).toHaveBeenCalledWith(root.querySelector('[data-sw-part="captcha"]'), { sitekey: CAPTCHA.siteKey });
    await vi.waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(checkouts()[0]!.body!['h-captcha-response']).toBe('answer-7');
  });
});

describe('★ an authored drawer is not moved: where its layout would confine it, it opens as a modal', () => {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  let modal: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    modal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    proto.showModal = modal;
    proto.show = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    Object.defineProperty(proto, 'open', { configurable: true, get(this: HTMLDialogElement) { return this.hasAttribute('open'); } });
    (window as unknown as { hcaptcha: unknown }).hcaptcha = { render: vi.fn(() => 1), getResponse: vi.fn(() => 'a'), reset: vi.fn() };
  });
  afterEach(() => {
    for (const k of ['showModal', 'show', 'open']) delete proto[k];
  });
  const authored = (wrapperStyle: string) =>
    `<header style="${wrapperStyle}"><div data-sw-cart data-cart-key="a" data-channels='${JSON.stringify([{ ...CHECKOUT, captcha: true }])}' data-captcha-provider="hcaptcha" data-captcha-sitekey="${CAPTCHA.siteKey}">` +
    `<button data-sw-action="open">Basket</button><dialog data-sw-part="drawer"><ul data-sw-part="items"></ul><template data-sw-part="line-template"><li></li></template>` +
    `<button data-sw-action="channel:pay">Pay</button></dialog></div></header>`;
  function openIt(html: string): HTMLElement {
    document.body.innerHTML = html;
    (0, eval)(CART_JS);
    const root = document.querySelector('[data-sw-cart]') as HTMLElement;
    (root.querySelector('[data-sw-action="open"]') as HTMLElement).click();
    return root;
  }

  it('in a plain layout it opens loose, where it is', () => {
    const root = openIt(authored(''));
    expect(modal).not.toHaveBeenCalled();
    expect(root.querySelector('dialog')!.hasAttribute('data-sw-loose')).toBe(true);
    expect(root.parentElement!.tagName).toBe('HEADER');
  });

  it('inside a transformed header it opens as a modal, in place', () => {
    const root = openIt(authored('transform:translateY(0)'));
    expect(modal).toHaveBeenCalledTimes(1);
    expect(root.querySelector('dialog')!.hasAttribute('data-sw-loose')).toBe(false);
    expect(root.parentElement!.tagName).toBe('HEADER');
  });
});

describe('the authored helper carries the captcha too', () => {
  it('{{#sw-cart}}…{{/sw-cart}} stamps the provider, the site key and the prompt on the mount', () => {
    const shop = resolveShopChannels({ enabled: true, currency: { code: 'EUR', decimals: 2 }, channels: [{ ...CHECKOUT, captcha: true }] }, (id) => `/f/p1/${id}`, CAPTCHA);
    const html = renderTemplate('{{#sw-cart}}<dialog data-sw-part="drawer"><ul data-sw-part="items"></ul><template data-sw-part="line-template"><li></li></template></dialog>{{/sw-cart}}', {
      website: { shop, t: {} },
    } as never);
    expect(html).toContain('data-captcha-provider="hcaptcha"');
    expect(html).toContain(`data-captcha-sitekey="${CAPTCHA.siteKey}"`);
    expect(html).toContain('data-captcha-label="Please complete the captcha."');
  });
});

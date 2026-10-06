// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { CART_JS, CART_PARTS, CART_FIELDS, CART_ACTIONS, CART_REQUIRED_PARTS } from '../src/cart.js';

/**
 * ★★ AUTHORED CART MARKUP, driven through the REAL shipped runtime in a DOM.
 *
 * The point of these tests is that the markup below is nothing like the platform's own drawer — a
 * `<section>` instead of the default wrapper, different classes, a differently-ordered line, a
 * missing clear button. If the runtime still drives it, authoring genuinely works; if it only drives
 * markup that happens to look like the default, it does not.
 *
 * Asserting BEHAVIOUR (what the DOM does when clicked) rather than the runtime's source text: a
 * source test would pass while the drawer rendered and did nothing.
 */

/** Deliberately idiosyncratic markup — proof the binder reads the CONTRACT, not a shape. */
function authoredMarkup(opts: { omitClear?: boolean; omitTemplate?: boolean; channelKey?: string } = {}): string {
  return `
    <button data-sw-part="${CART_PARTS.toggle}" class="my-own-tab">
      Basket <em data-sw-part="${CART_PARTS.count}" hidden>0</em>
    </button>
    <dialog data-sw-part="${CART_PARTS.drawer}" class="totally-custom">
      <header><h2>Your basket</h2><a href="#" data-sw-action="${CART_ACTIONS.close}">dismiss</a></header>
      <p data-sw-part="${CART_PARTS.empty}">Nothing here yet.</p>
      <ol data-sw-part="${CART_PARTS.items}"></ol>
      ${
        opts.omitTemplate
          ? ''
          : `<template data-sw-part="${CART_PARTS.lineTemplate}">
               <li class="my-line">
                 <img data-sw-field="${CART_FIELDS.image}" alt="">
                 <b data-sw-field="${CART_FIELDS.subtotal}"></b>
                 <span data-sw-field="${CART_FIELDS.name}"></span>
                 <i data-sw-field="${CART_FIELDS.price}"></i>
                 <button data-sw-action="${CART_ACTIONS.decrement}">less</button>
                 <output data-sw-field="${CART_FIELDS.qty}"></output>
                 <button data-sw-action="${CART_ACTIONS.increment}">more</button>
                 <button data-sw-action="${CART_ACTIONS.remove}">bin</button>
               </li>
             </template>`
      }
      <footer data-sw-part="${CART_PARTS.foot}">
        <strong data-sw-part="${CART_PARTS.total}"></strong>
        <button data-sw-action="channel:${opts.channelKey ?? 'wa'}">Order on WhatsApp</button>
        ${opts.omitClear ? '' : `<button data-sw-action="${CART_ACTIONS.clear}">empty it</button>`}
      </footer>
      <p data-sw-part="${CART_PARTS.sentMsg}">Thanks!</p>
    </dialog>`;
}

const CHANNELS = [{ kind: 'whatsapp', key: 'wa', label: 'WhatsApp', number: '+14155550123' }];

/** Mounts the given inner markup, runs the real runtime, and adds one product. */
function mount(inner: string, addTwice = false): HTMLElement {
  document.body.innerHTML = `<div data-sw-cart data-cart-key="authored">${inner}</div>`;
  const root = document.querySelector('[data-sw-cart]') as HTMLElement;
  root.setAttribute('data-currency-symbol', '$');
  root.setAttribute('data-channels', JSON.stringify(CHANNELS));
  const add = document.createElement('button');
  add.setAttribute('data-sw-cart-add', '');
  add.setAttribute('data-sku', 'MUG');
  add.setAttribute('data-name', 'Enamel mug');
  add.setAttribute('data-price', '19.99');
  add.setAttribute('data-image', '/m/mug.webp');
  document.body.appendChild(add);
  (0, eval)(CART_JS);
  add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  if (addTwice) add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return root;
}

let warnings: string[];
beforeEach(() => {
  warnings = [];
  // eslint-disable-next-line no-console -- capturing the runtime's own authoring diagnostics
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
  window.localStorage.clear();
});

describe('★★ the runtime BINDS authored markup instead of building its own', () => {
  it('fills the author’s own line template, in the author’s own order', () => {
    const root = mount(authoredMarkup());
    const line = root.querySelector('[data-sw-part="items"] .my-line') as HTMLElement;
    expect(line, 'a line was cloned from the author template').toBeTruthy();
    // The author's tags, not the platform's: `<b>` for the subtotal, `<i>` for the unit price.
    expect(line.querySelector('b')?.textContent).toBe('$19.99');
    expect(line.querySelector('span')?.textContent).toBe('Enamel mug');
    expect(line.querySelector('i')?.textContent).toBe('$19.99');
    expect(line.querySelector('output')?.textContent).toBe('1');
    expect(line.querySelector('img')?.getAttribute('src')).toBe('/m/mug.webp');
  });

  it('★ builds NOTHING of its own — no platform parts appear beside the author’s', () => {
    const root = mount(authoredMarkup());
    // The default drawer's own structural parts must be absent: an author who wrote their own markup
    // must not find the platform's bolted on next to it.
    for (const absent of ['head', 'title', 'note', 'line-body', 'line-controls', 'qty', 'thumb']) {
      expect(root.querySelector(`[data-sw-part="${absent}"]`), absent).toBeNull();
    }
    expect(root.querySelectorAll('[data-sw-part="drawer"]')).toHaveLength(1);
  });

  it('★ a part the author OMITTED stays omitted — nothing is put back', () => {
    const root = mount(authoredMarkup({ omitClear: true }));
    expect(root.querySelector('[data-sw-action="clear"]')).toBeNull();
    expect(root.querySelector('[data-sw-part="clear"]')).toBeNull();
  });

  it('drives the author’s qty and remove controls', () => {
    const root = mount(authoredMarkup());
    const line = () => root.querySelector('.my-line') as HTMLElement;
    (line().querySelector('[data-sw-action="inc"]') as HTMLElement).click();
    expect(line().querySelector('output')?.textContent).toBe('2');
    expect(line().querySelector('b')?.textContent).toBe('$39.98');
    (line().querySelector('[data-sw-action="dec"]') as HTMLElement).click();
    expect(line().querySelector('output')?.textContent).toBe('1');
    (line().querySelector('[data-sw-action="remove"]') as HTMLElement).click();
    expect(root.querySelector('.my-line')).toBeNull();
  });

  it('keeps the author’s total and count in step', () => {
    const root = mount(authoredMarkup(), true);
    expect(root.querySelector('[data-sw-part="total"]')?.textContent).toBe('$39.98');
    const count = root.querySelector('[data-sw-part="count"]') as HTMLElement;
    expect(count.textContent).toBe('2');
    expect(count.hasAttribute('hidden')).toBe(false);
  });

  it('shows the author’s empty notice when the cart empties, and hides the foot', () => {
    const root = mount(authoredMarkup());
    (root.querySelector('[data-sw-action="clear"]') as HTMLElement).click();
    expect((root.querySelector('[data-sw-part="empty"]') as HTMLElement).style.display).not.toBe('none');
    expect((root.querySelector('[data-sw-part="foot"]') as HTMLElement).style.display).toBe('none');
  });

  it('opens on the author’s toggle and closes on their own close control', () => {
    const root = mount(authoredMarkup());
    const drawer = root.querySelector('[data-sw-part="drawer"]') as HTMLDialogElement;
    expect(drawer.hasAttribute('open')).toBe(false);
    (root.querySelector('[data-sw-part="toggle"]') as HTMLElement).click();
    expect(drawer.hasAttribute('open')).toBe(true);
    // An <a>, not a button — the contract is the ACTION, not the element.
    (root.querySelector('[data-sw-action="close"]') as HTMLElement).click();
    expect(drawer.hasAttribute('open')).toBe(false);
  });

  it('wires an authored channel button to the configured channel', () => {
    let opened = '';
    window.open = ((url: string) => {
      opened = decodeURIComponent(url ?? '');
      return null;
    }) as typeof window.open;
    const root = mount(authoredMarkup());
    (root.querySelector('[data-sw-action="channel:wa"]') as HTMLElement).click();
    expect(opened).toContain('wa.me/14155550123');
    // The real order-text format, not a guess at it.
    expect(opened).toContain('1 x Enamel mug ($19.99)');
    expect(opened).toContain('Total: $19.99');
  });

  it('★ REFUSES a channel button naming a channel that is not configured', () => {
    // A dead checkout button is worse than a missing one, because it looks fine.
    const root = mount(authoredMarkup({ channelKey: 'nope' }));
    const btn = root.querySelector('[data-sw-action="channel:nope"]') as HTMLElement;
    expect(btn.hasAttribute('data-sw-unconfigured')).toBe(true);
    expect(warnings.join(' ')).toContain('no channel named "nope"');
  });

  it('★ warns loudly when a REQUIRED part is missing, instead of rendering a dead drawer', () => {
    mount(authoredMarkup({ omitTemplate: true }));
    expect(warnings.join(' ')).toContain('missing a required part');
    expect(CART_REQUIRED_PARTS).toContain('line-template');
  });

  it('★ a line is filled with textContent only — authored markup is not a sink', () => {
    document.body.innerHTML = `<div data-sw-cart data-cart-key="xss">${authoredMarkup()}</div>`;
    const root = document.querySelector('[data-sw-cart]') as HTMLElement;
    root.setAttribute('data-currency-symbol', '$');
    root.setAttribute('data-channels', JSON.stringify(CHANNELS));
    const add = document.createElement('button');
    add.setAttribute('data-sw-cart-add', '');
    add.setAttribute('data-sku', 'X');
    add.setAttribute('data-name', '<img src=x onerror=alert(1)>');
    add.setAttribute('data-price', '1.00');
    document.body.appendChild(add);
    (0, eval)(CART_JS);
    add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const nameEl = root.querySelector('[data-sw-field="name"]') as HTMLElement;
    expect(nameEl.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(nameEl.querySelector('img')).toBeNull();
  });
});

describe('★ an EMPTY mount still gets the platform default — no migration for existing sites', () => {
  it('builds the default drawer exactly as before', () => {
    const root = mount('');
    // The default's own parts are present…
    expect(root.querySelector('[data-sw-part="head"]')).toBeTruthy();
    expect(root.querySelector('[data-sw-part="title"]')).toBeTruthy();
    expect(root.querySelector('[data-sw-part="line-name"]')?.textContent).toBe('Enamel mug');
    // …and no warning was emitted: an empty mount is the normal case, not a misconfiguration.
    expect(warnings).toEqual([]);
  });
});

describe('the contract is a single source of truth', () => {
  it('every required part is a declared part', () => {
    const declared = Object.values(CART_PARTS) as string[];
    for (const req of CART_REQUIRED_PARTS) expect(declared, req).toContain(req);
  });
  it('names are stable strings the markup can be written against', () => {
    expect(CART_PARTS.lineTemplate).toBe('line-template');
    expect(CART_FIELDS.subtotal).toBe('subtotal');
    expect(CART_ACTIONS.increment).toBe('inc');
  });
});

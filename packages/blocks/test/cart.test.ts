import { describe, it, expect } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import { CART_CSS, CART_JS, usesCart, treeUsesCart, resolveShopChannels } from '../src/cart.js';

describe('cart stylesheet', () => {
  it('hides the cart until the runtime marks it enhanced (PE: no inert UI pre-JS)', () => {
    expect(CART_CSS).toContain('[data-sw-cart]{display:none}');
    expect(CART_CSS).toContain('[data-sw-cart][data-sw-enhanced="true"]{display:block}');
  });

  it('brand-themes the toggle + channel buttons via --sw-color-primary', () => {
    expect(CART_CSS).toContain('var(--sw-color-primary,#0a7a5a)');
  });

  it('cannot break out of a <style> block', () => {
    expect(CART_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('cart runtime', () => {
  it('is a syntactically valid IIFE', () => {
    expect(CART_JS.trim().startsWith('(function(){')).toBe(true);
    // Compiles without throwing (does not execute it).
    expect(() => new Function(CART_JS)).not.toThrow();
  });

  it('wires the {{sw-cart}} mount and {{sw-add-to-cart}} buttons', () => {
    expect(CART_JS).toContain('[data-sw-cart]');
    expect(CART_JS).toContain('[data-sw-cart-add]');
    expect(CART_JS).toContain("data-sw-enhanced");
  });

  it('builds UI via createElement + textContent — never innerHTML of cart data', () => {
    expect(CART_JS).toContain('createElement');
    expect(CART_JS).not.toContain('innerHTML');
  });

  it('guards localStorage access (sandboxed preview / disabled storage)', () => {
    expect(CART_JS).toContain('localStorage');
    expect(CART_JS).toContain('try{');
  });

  it('namespaces the storage key per site (derived from the script URL)', () => {
    expect(CART_JS).toContain("'sw-cart:'");
    expect(CART_JS).toContain('document.currentScript');
  });

  it('bounds distinct lines and per-line quantity', () => {
    expect(CART_JS).toContain('MAX_LINES=50');
    expect(CART_JS).toContain('MAX_QTY=99');
  });

  it('builds a WhatsApp deep link with an encoded order text', () => {
    expect(CART_JS).toContain('https://wa.me/');
    expect(CART_JS).toContain('encodeURIComponent');
    // wa.me wants digits only — the leading + (and any separators) are stripped.
    expect(CART_JS).toContain("replace(/[^0-9]/g,'')");
  });

  it('builds a mailto link with an encoded subject + body', () => {
    expect(CART_JS).toContain("'mailto:'");
    expect(CART_JS).toContain('encodeURIComponent(text)');
  });

  it('substitutes {total}/{currency}/{items} and re-checks https before opening a payment link', () => {
    expect(CART_JS).toContain('{total}');
    expect(CART_JS).toContain('{currency}');
    expect(CART_JS).toContain('{items}');
    // Defence-in-depth: the substituted URL must still be https before window.open.
    expect(CART_JS).toContain('https:');
    expect(CART_JS).toContain("'noopener'");
  });

  it('opens the native <dialog> drawer (focus trap + Esc for free)', () => {
    expect(CART_JS).toContain('showModal');
  });

  it('cannot break out of a <script> block', () => {
    expect(CART_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('cart detection', () => {
  it('detects the rendered mount/button markers AND the source-level helper calls', () => {
    // rendered markers (raw Html embed / future Shop block)
    expect(usesCart('<div data-sw-cart data-currency-symbol="€"></div>')).toBe(true);
    expect(usesCart('<button data-sw-cart-add data-sku="x" data-price="9.9">Add</button>')).toBe(true);
    // code-first SOURCE: the helper name (the marker attribute appears only AFTER render)
    expect(usesCart('<footer>{{sw-cart}}</footer>')).toBe(true);
    expect(usesCart('{{#each data.products}}{{sw-add-to-cart sku=id name=title price=price}}{{/each}}')).toBe(true);
    expect(usesCart('<div class="card">plain</div>')).toBe(false);
    expect(usesCart(undefined)).toBe(false);
    expect(usesCart(null)).toBe(false);
  });

  it('detects the marker in a block tree string prop (raw Html embed)', () => {
    const tree: PageNode = {
      id: 'r',
      type: 'Section',
      children: [{ id: 'e', type: 'Html', props: { html: '<div data-sw-cart></div>' } }],
    };
    expect(treeUsesCart(tree)).toBe(true);
  });

  it('ignores trees without the marker', () => {
    const plain: PageNode = { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }] };
    expect(treeUsesCart(plain)).toBe(false);
  });
});

describe('cart form channel', () => {
  it('CART_JS submits the order form to the endpoint with cart + spam-guard fields', () => {
    expect(CART_JS).toContain("'order-submit'");
    expect(CART_JS).toContain('cart_json');
    expect(CART_JS).toContain('cart_text');
    expect(CART_JS).toContain('_elapsed'); // time-trap
    expect(CART_JS).toContain('_hpt'); // honeypot (sent empty)
    expect(CART_JS).toContain("method:'POST'");
    expect(CART_JS).toContain('ch.endpoint');
    // contact values flow through input .value (and JSON) — never innerHTML.
    expect(CART_JS).not.toContain('innerHTML');
  });

  it('CART_JS shows a confirmation panel on success (kept out of the foot so it survives the empty render)', () => {
    expect(CART_JS).toContain("'sent-msg'");
    expect(CART_JS).toContain('sent=true');
    expect(CART_CSS).toContain('[data-sw-part="sent-msg"]');
  });
});

describe('resolveShopChannels', () => {
  const ep = (id: string): string => `/f/p1/${id}`;
  it('fills the endpoint for a form channel and leaves others untouched', () => {
    const shop = { currency: { code: 'USD' }, channels: [{ kind: 'form', formId: 'order' }, { kind: 'mailto', email: 'a@b.test' }] };
    const out = resolveShopChannels(shop, ep) as { channels: Array<Record<string, unknown>> };
    expect(out.channels[0]).toMatchObject({ kind: 'form', formId: 'order', endpoint: '/f/p1/order' });
    expect(out.channels[1]).toEqual({ kind: 'mailto', email: 'a@b.test' });
  });
  it('is a no-op for an absent shop or one without channels', () => {
    expect(resolveShopChannels(undefined, ep)).toBeUndefined();
    expect(resolveShopChannels({ currency: { code: 'USD' } }, ep)).toEqual({ currency: { code: 'USD' } });
  });
});

import { describe, it, expect } from 'vitest';
import { validateAuthoredCart, cartMountContents } from '../src/cart-validate.js';
import { renderTemplate } from '../src/template.js';

const ctx = { channelKeys: ['wa', 'pay'] };

/** A minimally-correct authored drawer; each test breaks exactly one thing. */
const GOOD = `
  <button data-sw-part="toggle"></button>
  <dialog data-sw-part="drawer">
    <button data-sw-action="close"></button>
    <ul data-sw-part="items"></ul>
    <template data-sw-part="line-template">
      <li>
        <span data-sw-field="name"></span>
        <span data-sw-field="subtotal"></span>
        <button data-sw-action="remove"></button>
      </li>
    </template>
    <div data-sw-part="foot"><button data-sw-action="channel:wa"></button></div>
  </dialog>`;

const messages = (html: string, c = ctx) => validateAuthoredCart(html, c).map((p) => p.message).join(' | ');
const errors = (html: string, c = ctx) => validateAuthoredCart(html, c).filter((p) => p.severity === 'error');

describe('validateAuthoredCart', () => {
  it('says nothing about a correct drawer', () => {
    expect(validateAuthoredCart(GOOD, ctx)).toEqual([]);
  });

  it('★ says nothing about an EMPTY mount — not forking is not a mistake', () => {
    // The overwhelmingly common case: `{{sw-cart}}` with no children, where the runtime builds the
    // default. Warning here would nag every site that never asked to author anything.
    expect(validateAuthoredCart('', ctx)).toEqual([]);
    expect(validateAuthoredCart('   \n  ', ctx)).toEqual([]);
    expect(validateAuthoredCart('<p>just some text</p>', ctx)).toEqual([]);
  });

  it('★ ERRORS on a missing required part, naming it', () => {
    for (const part of ['drawer', 'items', 'line-template']) {
      const broken = GOOD.replace(`data-sw-part="${part}"`, 'data-sw-part="something-else"');
      const errs = errors(broken);
      expect(errs.length, part).toBeGreaterThan(0);
      expect(errs.map((e) => e.message).join(' '), part).toContain(part);
    }
  });

  it('★ ERRORS when the line template is not a <template>', () => {
    // A <div> renders a visible empty row before any item exists, and has no `.content` to clone —
    // so the list stays empty for ever while looking like it is working.
    const broken = GOOD.replace('<template data-sw-part="line-template">', '<div data-sw-part="line-template">').replace('</template>', '</div>');
    expect(messages(broken)).toContain('must be a <template>');
  });

  it('★★ ERRORS on a button naming a channel the shop does not configure', () => {
    // The one authors hit most: rename a channel in settings, and the drawer keeps a button that now
    // points at nothing. A dead checkout button looks exactly like a working one.
    const broken = GOOD.replace('channel:wa', 'channel:whatsapp');
    const errs = errors(broken);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('"whatsapp"');
    expect(errs[0]!.message).toContain('do');
  });

  it('accepts every configured channel key', () => {
    const both = GOOD.replace('<button data-sw-action="channel:wa"></button>', '<button data-sw-action="channel:wa"></button><button data-sw-action="channel:pay"></button>');
    expect(errors(both)).toEqual([]);
  });

  it('warns when a line shows no name, and no price or total', () => {
    const noName = GOOD.replace('<span data-sw-field="name"></span>', '');
    expect(messages(noName)).toContain('no product name');
    const noMoney = GOOD.replace('<span data-sw-field="subtotal"></span>', '');
    expect(messages(noMoney)).toContain('neither a price nor a line total');
  });

  it('warns when a line offers no way to change or remove an item', () => {
    const noControls = GOOD.replace('<button data-sw-action="remove"></button>', '');
    expect(messages(noControls)).toContain('cannot correct a mistake');
  });

  it('accepts +/- in place of a remove button', () => {
    const stepper = GOOD.replace(
      '<button data-sw-action="remove"></button>',
      '<button data-sw-action="dec"></button><button data-sw-action="inc"></button>',
    );
    expect(validateAuthoredCart(stepper, ctx)).toEqual([]);
  });

  it('warns about a drawer nobody can open or close', () => {
    const noClose = GOOD.replace('<button data-sw-action="close"></button>', '');
    expect(messages(noClose)).toContain('no close control');
    const noToggle = GOOD.replace('<button data-sw-part="toggle"></button>', '');
    expect(messages(noToggle)).toContain('nothing on the page opens the cart');
  });

  it('★ warns about a part name that is not in the contract — almost always a typo', () => {
    const typo = GOOD.replace('data-sw-part="foot"', 'data-sw-part="footer"');
    expect(messages(typo)).toContain('"footer" is not a part');
  });

  it('★ every problem is actionable prose, not a code', () => {
    const broken = GOOD.replace('data-sw-part="items"', 'data-sw-part="x"').replace('channel:wa', 'channel:gone');
    for (const p of validateAuthoredCart(broken, ctx)) {
      expect(p.message.length).toBeGreaterThan(25);
      expect(p.message).toMatch(/[a-z]/);
    }
  });
});

describe('cartMountContents', () => {
  it('returns the inner markup of each cart mount, and ignores add-to-cart buttons', () => {
    const html = `<div data-sw-cart data-channels="[]"><dialog data-sw-part="drawer"></dialog></div><button data-sw-cart-add data-sku="a"></button>`;
    const inner = cartMountContents(html);
    expect(inner).toHaveLength(1);
    expect(inner[0]).toContain('data-sw-part="drawer"');
  });

  it('is empty for a page with no cart at all', () => {
    expect(cartMountContents('<main><h1>About</h1></main>')).toEqual([]);
  });

  it('★ round-trips the REAL helper output — the validator sees what publish emits', () => {
    const rendered = renderTemplate(
      '{{#sw-cart}}<dialog data-sw-part="drawer"><ul data-sw-part="items"></ul></dialog>{{/sw-cart}}',
      { website: { shop: { enabled: true, currency: { code: 'EUR' }, channels: [{ kind: 'whatsapp', key: 'wa', number: '+14155550123' }] } } } as never,
    );
    const [inner] = cartMountContents(rendered);
    expect(inner).toBeTruthy();
    // It is missing the line template, and the validator says so against the genuine output.
    expect(errors(inner!).map((e) => e.message).join(' ')).toContain('line-template');
  });
});

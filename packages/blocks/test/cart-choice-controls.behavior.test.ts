// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeAll } from 'vitest';
import { baseStyles } from '../src/base-css.js';
import { CART_CSS, CART_JS, CART_PARTS } from '../src/cart.js';

// CHECKBOXES, RADIOS AND TOGGLES INSIDE THE CART'S ORDER FORM KEEP THEIR OWN BOX.
//
// The same defect the form sheet had (form-choice-controls.behavior.test.ts), in the cart sheet. An AUTHORED cart
// carries its own buyer-input controls inside `order-toggle` / `order-choice` > `order-option` / `order-field`
// wrappers (the runtime reads every control inside one), and an agent writing daisyUI there — `toggle`,
// `checkbox`, `radio` — watched them collapse to 2px bars: a firm `width:auto;padding:0` on every order-option /
// order-toggle input is ZERO content width on an `appearance:none` control, and daisyUI ships its components in
// `@layer daisyui.*`, so ANY unlayered platform declaration wins whatever its weight. A checkbox placed in an
// `order-field` fared worse: the text-field look (width:100%, padding, border, radius) landed on it.
//
// The invariant measured here, through the real cascade (jsdom 30 sorts by specificity + source order): a control
// inside the cart resolves EXACTLY the box it gets anywhere else on the page — and the platform's own drawer,
// whose controls the runtime builds bare, renders exactly as before.

/** The controls agents write, given a per-copy id prefix — each in the wrapper the cart contract names. */
const controls = (p: string, wrap: (part: string, inner: string, tag?: string) => string): string =>
  wrap(CART_PARTS.orderToggle, `<input id="${p}-daisy-toggle" type="checkbox" name="${p}a" class="toggle toggle-primary" /><span>Gift wrap</span>`) +
  wrap(CART_PARTS.orderToggle, `<input id="${p}-daisy-checkbox" type="checkbox" name="${p}b" class="checkbox" /><span>Terms</span>`) +
  wrap(CART_PARTS.orderToggle, `<input id="${p}-sized-checkbox" type="checkbox" name="${p}c" class="h-5 w-5 rounded accent-primary" /><span>Sized</span>`) +
  wrap(CART_PARTS.orderToggle, `<input id="${p}-bare-checkbox" type="checkbox" name="${p}d" /><span>Bare</span>`) +
  wrap(
    CART_PARTS.orderChoice,
    `<legend>Delivery</legend>` +
      `<label data-sw-part="order-option"><input id="${p}-daisy-radio" type="radio" name="${p}e" value="x" class="radio radio-primary" /><span>Collect</span></label>` +
      `<label data-sw-part="order-option"><input id="${p}-sized-radio" type="radio" name="${p}e" value="y" class="h-5 w-5 rounded-full" /><span>Courier</span></label>`,
    'fieldset',
  ) +
  wrap(CART_PARTS.orderField, `<span>Newsletter</span><input id="${p}-field-checkbox" type="checkbox" name="${p}f" class="checkbox checkbox-sm" />`);

const inCart = (part: string, inner: string, tag = 'label'): string => `<${tag} data-sw-part="${part}">${inner}</${tag}>`;
const outside = (_part: string, inner: string, tag = 'label'): string => `<${tag}>${inner}</${tag}>`;

// Both copies inherit the SAME text colour (a border's default colour is currentColor, and the drawer sets its
// own), so any difference left in the comparison is one the cart sheet put on the control itself.
const INK = 'style="color:rgb(20, 30, 40)"';
const AUTHORED =
  `<div data-sw-cart data-sw-enhanced="true"><dialog data-sw-part="${CART_PARTS.drawer}" open>` +
  `<form data-sw-part="${CART_PARTS.channelForm}" ${INK}>${controls('in', inCart)}` +
  `<label data-sw-part="${CART_PARTS.orderField}"><span>Name</span><input id="in-text" type="text" name="name" /></label>` +
  `</form></dialog></div>` +
  `<div id="outside" ${INK}>${controls('out', outside)}</div>`;

// Stand-in for daisyUI's control rules. jsdom skips `@layer` blocks, so the real (layered) daisyUI sheet would
// simply vanish here. What a layer MEANS against unlayered CSS is "loses to every rule, whatever its weight" —
// which is exactly the WEAKEST possible unlayered rule: zero specificity (`:where`) and FIRST in source order.
const DAISY_LAYERED =
  ':where(.checkbox,.radio,.toggle){width:1.5rem;height:1.5rem;padding:.25rem;border-radius:.5rem}:where(.toggle){width:2.5rem}' +
  ':where(.checkbox-sm){width:1.25rem;height:1.25rem;padding:.1875rem}';

// Stand-in for the compiled utility sheet: unlayered single-class rules loading AFTER the runtime sheets.
const UTILITIES = '.w-5{width:1.25rem}.h-5{height:1.25rem}.rounded{border-radius:.25rem}.rounded-full{border-radius:9999px}';

const BOX = [
  'width', 'height', 'flex-basis',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-top-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
] as const;

const box = (el: Element): Record<string, string> => {
  const cs = getComputedStyle(el);
  return Object.fromEntries(BOX.map((p) => [p, cs.getPropertyValue(p)]));
};
const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} was not rendered`);
  return el;
};
const styles = (): string =>
  `<style>${DAISY_LAYERED}</style><style>${baseStyles()}</style><style>${CART_CSS}</style><style>${UTILITIES}</style>`;

describe('Cart sheet — order-form checkbox / radio / toggle keep their intrinsic or daisyUI box (jsdom cascade)', () => {
  beforeAll(() => {
    document.head.innerHTML = styles();
    document.body.innerHTML = AUTHORED;
  });

  it('PRESENCE: the authored order form IS styled by the cart sheet (text field look applied)', () => {
    // Guards every "unchanged" assertion below: without the sheet they would pass vacuously.
    const cs = getComputedStyle(byId('in-text'));
    expect(cs.width).toBe('100%');
    expect(cs.getPropertyValue('padding-left')).toBe('8px'); // .5rem
    expect(cs.getPropertyValue('border-radius')).toBe('0.375rem'); // jsdom keeps the shorthand as written
  });

  it.each([
    'daisy-toggle',
    'daisy-checkbox',
    'sized-checkbox',
    'bare-checkbox',
    'daisy-radio',
    'sized-radio',
    'field-checkbox',
  ])('%s resolves the same box inside the cart as outside it', (name) => {
    expect(box(byId(`in-${name}`))).toEqual(box(byId(`out-${name}`)));
  });

  it('a daisyUI toggle / checkbox / radio keeps daisyUI’s size — never the 2px bar', () => {
    expect(getComputedStyle(byId('in-daisy-toggle')).width).toBe('40px'); // 2.5rem; before the fix: `auto`
    for (const name of ['daisy-checkbox', 'daisy-radio']) {
      const cs = getComputedStyle(byId(`in-${name}`));
      expect(cs.width).toBe('24px'); // 1.5rem
      expect(cs.height).toBe('24px');
      expect(cs.getPropertyValue('padding-left')).toBe('4px'); // .25rem, not the old forced 0
    }
    // …and one placed in an order-FIELD is not given the text-field look (width:100% + padding + border).
    const field = getComputedStyle(byId('in-field-checkbox'));
    expect(field.width).toBe('20px'); // checkbox-sm 1.25rem
    expect(field.getPropertyValue('padding-left')).toBe('3px'); // .1875rem
  });

  it('a native control keeps the author size utilities (w-5 h-5)', () => {
    for (const name of ['sized-checkbox', 'sized-radio']) {
      const cs = getComputedStyle(byId(`in-${name}`));
      expect(cs.width).toBe('20px');
      expect(cs.height).toBe('20px');
    }
  });

  it('the controls still sit flush in their flex row (no UA margin, never shrinking)', () => {
    for (const name of ['daisy-toggle', 'bare-checkbox', 'daisy-radio']) {
      const cs = getComputedStyle(byId(`in-${name}`));
      expect(cs.getPropertyValue('margin-left')).toBe('0px');
      expect(cs.getPropertyValue('flex-shrink')).toBe('0');
    }
  });
});

describe('Cart sheet — the platform drawer’s runtime-built order controls are unchanged', () => {
  beforeAll(() => {
    document.head.innerHTML = styles();
    document.body.innerHTML = '<div data-sw-cart></div><div id="outside"><input id="ref-checkbox" type="checkbox" /></div>';
    const root = document.querySelector('[data-sw-cart]') as HTMLElement;
    root.setAttribute('data-currency-symbol', '$');
    root.setAttribute(
      'data-channels',
      JSON.stringify([
        {
          kind: 'whatsapp',
          label: 'WhatsApp',
          number: '+14155550123',
          fields: [
            { label: 'Gift wrap', type: 'checkbox' },
            { label: 'Delivery', type: 'radio', options: ['Collect', 'Courier'] },
          ],
        },
      ]),
    );
    (0, eval)(CART_JS);
    (document.querySelector('[data-sw-part="channel"]') as HTMLElement | null)?.click(); // reveal the field form
  });

  it('PRESENCE: the runtime built a bare checkbox in an order-toggle and radios in order-options', () => {
    expect(document.querySelector('[data-sw-part="order-toggle"] input[type="checkbox"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-sw-part="order-option"] input[type="radio"]')).toHaveLength(2);
  });

  // The old firm `width:auto;padding:0` was a no-op on these: a native checkbox/radio is auto-wide with zero UA
  // padding in every engine. What the platform actually wants from its rule — flush, never shrinking — stays.
  it('their box is the plain native one, flush and non-shrinking in the row', () => {
    const checkbox = document.querySelector('[data-sw-part="order-toggle"] input')!;
    const radio = document.querySelector('[data-sw-part="order-option"] input')!;
    // Same inherited text colour as the drawer (a border's default colour is currentColor) — context, not box.
    byId('outside').style.color = getComputedStyle(checkbox.parentElement!).color;
    const ref = box(byId('ref-checkbox'));
    for (const el of [checkbox, radio]) {
      expect(box(el)).toEqual(ref);
      const cs = getComputedStyle(el);
      expect(cs.getPropertyValue('margin-top')).toBe('0px');
      expect(cs.getPropertyValue('flex-shrink')).toBe('0');
      expect(cs.getPropertyValue('flex-grow')).toBe('0');
    }
  });
});

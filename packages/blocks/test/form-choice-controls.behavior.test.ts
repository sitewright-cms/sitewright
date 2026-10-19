// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeAll } from 'vitest';
import { baseStyles } from '../src/base-css.js';
import { componentAssets, componentTypesInSource } from '../src/components.js';
import { resolveFormEndpoints } from '../src/form-embed.js';
import { renderTemplate } from '../src/template.js';

// CHECKBOXES AND RADIOS INSIDE A PLATFORM FORM KEEP THEIR OWN BOX.
//
// Two agents hand-writing forms (`<form data-sw-form>`) watched daisyUI `checkbox` / `radio` controls — and
// brand-coloured native ones sized with `w-5 h-5` — collapse to 2px bars. The form sheet gave EVERY input the
// field look (width:100%, padding, border, radius) and then "undid" it for checkbox/radio with a firm
// `width:auto;padding:0;border-radius:0` at (0,2,1). On an `appearance:none` control (every daisyUI one)
// `width:auto` is zero content width, so all that was left was the 1px border on each side.
//
// Specificity was never going to fix it: daisyUI 5.7 ships its components inside `@layer daisyui.*`, and ANY
// unlayered declaration beats a layered one whatever its weight — so the only safe amount of platform box
// styling on these controls is NONE. That is the invariant measured here: through the real cascade (jsdom 30
// sorts by specificity + source order), a control inside a platform form must resolve EXACTLY the box it gets
// anywhere else on the page.

const forms = resolveFormEndpoints(
  {
    contact: {
      id: 'contact',
      fields: [
        { name: 'agree', label: 'I agree', type: 'checkbox', required: false },
        { name: 'plan', label: 'Plan', type: 'radio', required: false, options: ['Basic', 'Pro'] },
        { name: 'name', label: 'Name', type: 'text', required: false },
      ],
      submitLabel: 'Send',
      successMessage: 'Thanks',
      errorMessage: 'Sorry',
      captcha: false,
      pow: false,
      mode: 'globalSmtp',
    },
  },
  (id) => `/f/p/${id}`,
);

/** The controls agents actually wrote, given a per-copy id prefix. */
const controls = (p: string): string =>
  `<label class="flex items-center gap-2"><input id="${p}-daisy-checkbox" type="checkbox" name="${p}a" class="checkbox checkbox-primary" /> I agree</label>` +
  `<label class="flex items-center gap-2"><input id="${p}-daisy-radio" type="radio" name="${p}b" value="x" class="radio radio-primary" /> Basic</label>` +
  `<label class="flex items-center gap-2"><input id="${p}-daisy-toggle" type="checkbox" name="${p}c" class="toggle" /> News</label>` +
  `<label class="flex items-center gap-2"><input id="${p}-sized-checkbox" type="checkbox" name="${p}d" class="h-5 w-5 rounded accent-primary" /> Sized</label>` +
  `<label class="flex items-center gap-2"><input id="${p}-sized-radio" type="radio" name="${p}e" value="x" class="h-5 w-5 rounded-full accent-primary" /> Sized</label>` +
  `<label class="flex items-center gap-2"><input id="${p}-bare-checkbox" type="checkbox" name="${p}f" /> Bare</label>`;

const SOURCE =
  `<form data-sw-form="contact" class="space-y-4">${controls('in')}<input id="in-text" type="text" name="name" />` +
  `<button type="submit" class="btn btn-primary">Send</button></form>` +
  `<div id="outside">${controls('out')}</div>` +
  `<div id="generated">{{sw-form "contact"}}</div>`;

// Stand-in for daisyUI's control rules. jsdom skips `@layer` blocks, so the real (layered) daisyUI sheet would
// simply vanish here. What a layer MEANS against unlayered CSS is "loses to every rule, whatever its weight" —
// which is exactly the WEAKEST possible unlayered rule: zero specificity (`:where`) and FIRST in source order.
// Any platform declaration that reaches the control therefore overrides it, as it does in a browser.
const DAISY_LAYERED = ':where(.checkbox,.radio,.toggle){width:1.5rem;height:1.5rem;padding:.25rem;border-radius:.5rem}:where(.toggle){width:2.5rem}';

// Stand-in for the compiled utility sheet: Tailwind utilities are UNLAYERED single-class rules that load
// AFTER the component sheets (renderDocument), so these carry exactly their real cascade weight.
const UTILITIES = '.w-5{width:1.25rem}.h-5{height:1.25rem}.rounded{border-radius:.25rem}.rounded-full{border-radius:9999px}';

// Every property the old rules touched, plus the rest of the box.
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

describe('Form sheet — checkbox / radio keep their intrinsic or daisyUI box (jsdom cascade)', () => {
  beforeAll(() => {
    const html = renderTemplate(SOURCE, { forms, preview: true });
    const { css } = componentAssets(componentTypesInSource(SOURCE));
    document.head.innerHTML =
      `<style>${DAISY_LAYERED}</style><style>${baseStyles()}</style><style>${css}</style><style>${UTILITIES}</style>`;
    document.body.innerHTML = html;
  });

  it('PRESENCE: the hand-written form IS a styled platform form (marker stamped, field look applied)', () => {
    // Guards every "unchanged" assertion below: without the marker or the sheet they would pass vacuously.
    const form = document.querySelector('form')!;
    expect(form.getAttribute('data-sw-block')).toBe('Form');
    expect(getComputedStyle(byId('in-text')).width).toBe('100%');
    expect(getComputedStyle(byId('in-text')).getPropertyValue('padding-left')).toBe('10px'); // .625rem
  });

  it.each([
    'daisy-checkbox',
    'daisy-radio',
    'daisy-toggle',
    'sized-checkbox',
    'sized-radio',
    'bare-checkbox',
  ])('%s resolves the same box inside the form as outside it', (name) => {
    expect(box(byId(`in-${name}`))).toEqual(box(byId(`out-${name}`)));
  });

  it('a daisyUI checkbox / radio / toggle keeps daisyUI\'s size — never the 2px bar', () => {
    for (const name of ['daisy-checkbox', 'daisy-radio']) {
      const cs = getComputedStyle(byId(`in-${name}`));
      // jsdom resolves rem against the 16px root: 1.5rem → 24px. Before the fix: `auto` (0 wide + border).
      expect(cs.width).toBe('24px');
      expect(cs.height).toBe('24px');
      expect(cs.getPropertyValue('padding-left')).toBe('4px'); // .25rem, not the old forced 0
    }
    expect(getComputedStyle(byId('in-daisy-toggle')).width).toBe('40px'); // 2.5rem
  });

  it('a brand-coloured native control keeps the author size utilities (w-5 h-5)', () => {
    for (const name of ['sized-checkbox', 'sized-radio']) {
      const cs = getComputedStyle(byId(`in-${name}`));
      expect(cs.width).toBe('20px'); // w-5 = 1.25rem; before the fix the form's (0,2,1) width:auto beat it
      expect(cs.height).toBe('20px');
    }
  });

  it('the {{sw-form}} markup is unchanged: its native boxes stay native, its text field keeps the look', () => {
    const gen = byId('generated');
    const checkbox = gen.querySelector('input[type="checkbox"]')!;
    const radio = gen.querySelector('input[type="radio"]')!;
    expect(box(checkbox)).toEqual(box(byId('out-bare-checkbox')));
    expect(getComputedStyle(radio).width).toBe(getComputedStyle(byId('out-bare-checkbox')).width);
    // …and they still never shrink in their flex option row.
    expect(getComputedStyle(checkbox).getPropertyValue('flex-shrink')).toBe('0');
    expect(getComputedStyle(radio).getPropertyValue('flex-shrink')).toBe('0');
    expect(getComputedStyle(gen.querySelector('input[type="text"]')!).width).toBe('100%');
  });
});

// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { CART_JS } from '../src/cart.js';

// Behavioral coverage for the buyer-input ORDER FIELDS a whatsapp/mailto channel collects: run the REAL
// shipped cart runtime in a DOM, drive each control type, and assert the deep link it opens. Asserting the
// built URL (not the JS source text) is the point — a source-string test would still pass if the control
// rendered but its value never reached the message.

const MOUNT = '[data-sw-cart]';

/** Mount the cart with one whatsapp channel carrying `fields`, and open its collapsible form. */
function run(fields: unknown[]): { root: HTMLElement; form: HTMLFormElement } {
  document.body.innerHTML = '<div data-sw-cart></div>';
  const root = document.querySelector(MOUNT) as HTMLElement;
  root.setAttribute('data-currency-symbol', '$');
  root.setAttribute('data-yes-label', 'Ja'); // localized, to prove the checkbox uses cart.yes and not a literal
  root.setAttribute('data-channels', JSON.stringify([{ kind: 'whatsapp', label: 'WhatsApp', number: '+14155550123', fields }]));
  // A cart with no items refuses to submit, so seed one through the runtime's own add-to-cart path. The
  // button must exist BEFORE the runtime evaluates: it binds the add handlers once over the elements
  // present at init, so one appended afterwards is never wired.
  const add = document.createElement('button');
  add.setAttribute('data-sw-cart-add', '');
  add.setAttribute('data-sku', 'X1');
  add.setAttribute('data-name', 'Aloe Gel');
  add.setAttribute('data-price', '480');
  document.body.appendChild(add);
  (0, eval)(CART_JS);
  add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  (document.querySelector('[data-sw-part="channel"]') as HTMLElement).click(); // reveal the field form
  return { root, form: document.querySelector('[data-sw-part="channel-form"]') as HTMLFormElement };
}

/** The wa.me URL the runtime hands to window.open, decoded. */
let opened: string;
beforeEach(() => {
  opened = '';
  window.open = ((url: string) => {
    opened = decodeURIComponent(url ?? '');
    return null;
  }) as typeof window.open;
});

describe('cart order fields — the control types a channel can collect', () => {
  it('renders a select from its options and carries the choice into the order', () => {
    const { form } = run([{ label: 'Size', type: 'select', options: ['Small', 'Large'] }]);
    const sel = form.querySelector('select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['Small', 'Large']); // no blank rung when optional
    sel.value = 'Large';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(opened).toContain('Size: Large');
  });

  it('gives a REQUIRED select an empty first option, so the browser can block an unmade choice', () => {
    const { form } = run([{ label: 'Size', type: 'select', required: true, options: ['Small', 'Large'] }]);
    const sel = form.querySelector('select') as HTMLSelectElement;
    expect(sel.required).toBe(true);
    expect(sel.options[0]!.value).toBe(''); // the rung that makes `required` meaningful
    expect(sel.checkValidity()).toBe(false); // nothing chosen yet → the form cannot submit
    sel.value = 'Small';
    expect(sel.checkValidity()).toBe(true);
  });

  it('renders a radio group as a fieldset and carries the checked option', () => {
    const { form } = run([{ label: 'Delivery', type: 'radio', required: true, options: ['Collect', 'Courier'] }]);
    const fs = form.querySelector('[data-sw-part="order-choice"]') as HTMLFieldSetElement;
    expect(fs.tagName).toBe('FIELDSET');
    expect(fs.querySelector('legend')!.textContent).toBe('Delivery *');
    const radios = [...form.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1); // one group, so only one can be chosen
    expect(radios.every((r) => r.required)).toBe(true);
    expect(radios[0]!.checkValidity()).toBe(false); // nothing picked → blocked
    radios[1]!.checked = true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(opened).toContain('Delivery: Courier');
  });

  it('gives each radio group its OWN name, so two groups do not fight', () => {
    const { form } = run([
      { label: 'Delivery', type: 'radio', options: ['Collect', 'Courier'] },
      { label: 'Wrap', type: 'radio', options: ['Plain', 'Gift'] },
    ]);
    const names = new Set([...form.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.name));
    expect(names.size).toBe(2);
  });

  it('a ticked checkbox contributes the localized yes value; an unticked one contributes NO line', () => {
    const { form } = run([
      { label: 'Gift wrap', type: 'checkbox' },
      { label: 'Note', type: 'text' },
    ]);
    const cb = form.querySelector('input[type="checkbox"]') as HTMLInputElement;
    (form.querySelector('input[type="text"]') as HTMLInputElement).value = 'leave at gate';

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(opened).not.toContain('Gift wrap'); // unticked → absent entirely, not "Gift wrap: No"
    expect(opened).toContain('Note: leave at gate');

    cb.checked = true;
    (document.querySelector('[data-sw-part="channel"]') as HTMLElement).click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(opened).toContain('Gift wrap: Ja'); // the data-yes-label value, not a hardcoded "Yes"
  });

  it('honours the typed text inputs and falls back to text for an unknown type', () => {
    const { form } = run([
      { label: 'Qty', type: 'number' },
      { label: 'When', type: 'date' },
      { label: 'Site', type: 'url' },
      { label: 'Odd', type: 'colour-picker-from-the-future' },
    ]);
    const types = [...form.querySelectorAll<HTMLInputElement>('input')].map((i) => i.type);
    expect(types).toEqual(['number', 'date', 'url', 'text']);
  });

  // A choice type whose `shop.<key>.options` row is still blank ships no `options` at all. Rendering an
  // empty <select> would be a dead control the buyer cannot satisfy — especially when it is required.
  it('degrades a choice field with no options to a text input rather than an empty select', () => {
    const { form } = run([{ label: 'Size', type: 'select', required: true }]);
    expect(form.querySelector('select')).toBeNull();
    const inp = form.querySelector('input') as HTMLInputElement;
    expect(inp.type).toBe('text');
    expect(inp.required).toBe(true);
  });

  it('keeps every field in the authored ORDER in the message', () => {
    const { form } = run([
      { label: 'First', type: 'text' },
      { label: 'Second', type: 'select', options: ['B'] },
      { label: 'Third', type: 'text' },
    ]);
    const [a, b] = [...form.querySelectorAll<HTMLInputElement>('input[type="text"]')];
    a!.value = 'one';
    b!.value = 'three';
    (form.querySelector('select') as HTMLSelectElement).value = 'B';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(opened.indexOf('First: one')).toBeLessThan(opened.indexOf('Second: B'));
    expect(opened.indexOf('Second: B')).toBeLessThan(opened.indexOf('Third: three'));
  });

  // Option text reaches the DOM through textContent/.value and the deep link through encodeURIComponent —
  // never innerHTML. A choice label carrying markup must stay inert text.
  it('never lets an option label become markup', () => {
    const { form } = run([{ label: 'Size', type: 'select', options: ['<img src=x onerror=alert(1)>'] }]);
    const sel = form.querySelector('select') as HTMLSelectElement;
    expect(sel.querySelector('img')).toBeNull();
    expect(sel.options[0]!.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

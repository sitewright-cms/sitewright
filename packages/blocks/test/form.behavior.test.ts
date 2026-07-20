// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { componentAssets } from '../src/components.js';

// The real shipped Form runtime string, run in a DOM exactly as a published page's <script> would.
const FORM_JS = componentAssets(['Form']).js;

function mountAndRun(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  // Indirect eval executes our own trusted build-output constant in the global scope. The IIFE binds on
  // document.readyState, which is 'complete' under jsdom, so it enhances synchronously.
  (0, eval)(FORM_JS);
  return document.querySelector('form') as HTMLFormElement;
}

describe('Form runtime — native validation (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a required, empty field makes the form NATIVELY invalid (the form is not novalidate)', () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-endpoint="/f/x/y">' +
        '<label><span>Name</span><input type="text" name="name" required /></label>' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '</form>',
    );
    // An empty required field → the browser would block submit + prompt on the field.
    expect(form.checkValidity()).toBe(false);
    const input = form.querySelector<HTMLInputElement>('input[name="name"]')!;
    input.value = 'Ada';
    expect(form.checkValidity()).toBe(true);
  });

  it('enforces a required checkbox GROUP via custom validity (blocks until one is checked)', () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-endpoint="/f/x/y">' +
        '<fieldset data-sw-part="field" data-sw-required><legend>Features</legend>' +
        '<label><input type="checkbox" name="features" value="SEO" /></label>' +
        '<label><input type="checkbox" name="features" value="Analytics" /></label>' +
        '</fieldset>' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '</form>',
    );
    const boxes = form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const first = boxes[0]!;
    const second = boxes[1]!;
    // Empty group → the first box carries a custom-validity message, so the form is invalid.
    expect(first.validationMessage).toBe('Please select at least one option.');
    expect(form.checkValidity()).toBe(false);

    // Checking ANY box in the group clears the custom validity → the form is valid.
    second.checked = true;
    second.dispatchEvent(new Event('change'));
    expect(first.validationMessage).toBe('');
    expect(form.checkValidity()).toBe(true);
  });

  it('re-enforces a required checkbox group after form.reset() (the no-redirect success path)', async () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-endpoint="/f/x/y">' +
        '<fieldset data-sw-part="field" data-sw-required><legend>Features</legend>' +
        '<label><input type="checkbox" name="features" value="SEO" /></label>' +
        '<label><input type="checkbox" name="features" value="Analytics" /></label>' +
        '</fieldset>' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '</form>',
    );
    const first = form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!;
    first.checked = true;
    first.dispatchEvent(new Event('change'));
    expect(form.checkValidity()).toBe(true); // valid with one checked

    form.reset(); // the success handler resets the form in place (unchecks boxes, no 'change' fires)
    await new Promise((r) => setTimeout(r, 0)); // let the deferred re-sync run
    // The required group must be enforced AGAIN, not silently valid-with-nothing-checked.
    expect(first.validationMessage).toBe('Please select at least one option.');
    expect(form.checkValidity()).toBe(false);
  });

  it('leaves an OPTIONAL (unmarked) checkbox group unconstrained', () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-endpoint="/f/x/y">' +
        '<fieldset data-sw-part="field"><legend>Features</legend>' +
        '<label><input type="checkbox" name="features" value="SEO" /></label>' +
        '</fieldset>' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '</form>',
    );
    expect(form.checkValidity()).toBe(true); // nothing required → valid with nothing checked
  });
});

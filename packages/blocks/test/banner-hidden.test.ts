import { describe, it, expect } from 'vitest';
import { addComponentBlockMarkers } from '../src/components.js';
import { renderTemplate } from '../src/template.js';
import { BANNER_CSS } from '../src/banner.js';

/**
 * ★ THE TRAP THIS REMOVES. A banner is documented as requiring `hidden` in the authored markup — the
 * server ships it hidden and the runtime reveals it. Forget the attribute and it fails in a
 * CONFUSING direction: the banner renders immediately, at the default `bottom-right` position, as a
 * card that floats over the page and cannot be dismissed until JS loads. That reads as "the banner
 * component is broken", not "you missed an attribute".
 *
 * Nothing is lost by injecting it. The banner's own stylesheet hides `[hidden]` and its runtime calls
 * removeAttribute('hidden') to reveal — so a banner that renders visible server-side is never what
 * anyone wanted, and with no JS there is nothing to dismiss it with anyway.
 */
describe('a banner always ships hidden', () => {
  it('adds the attribute when the author omitted it', () => {
    expect(addComponentBlockMarkers('<div data-sw-component="banner">hi</div>')).toBe(
      '<div data-sw-component="banner" hidden>hi</div>',
    );
  });

  it('leaves an author who wrote it alone — no duplicate attribute', () => {
    const already = '<div data-sw-component="banner" hidden>hi</div>';
    expect(addComponentBlockMarkers(already)).toBe(already);
    expect(addComponentBlockMarkers(addComponentBlockMarkers(already))).toBe(already);
  });

  it('recognises hidden written in its other legal spellings', () => {
    for (const form of ['hidden=""', 'hidden="hidden"', 'HIDDEN']) {
      const tag = `<div data-sw-component="banner" ${form}>hi</div>`;
      expect(addComponentBlockMarkers(tag)).toBe(tag);
    }
  });

  it('does not confuse another attribute that merely contains the word', () => {
    const tag = '<div data-sw-component="banner" data-hidden-until="scroll">hi</div>';
    expect(addComponentBlockMarkers(tag)).toBe('<div data-sw-component="banner" hidden data-hidden-until="scroll">hi</div>');
  });

  it('touches no other component', () => {
    for (const name of ['modal', 'tabs', 'carousel', 'lightbox', 'form', 'shader-bg']) {
      expect(addComponentBlockMarkers(`<div data-sw-component="${name}"></div>`)).not.toContain(' hidden');
    }
  });

  it('composes with the block marker on the same tag', () => {
    // Form is block-keyed; banner is not — but both passes share one traversal, so check they agree.
    const out = addComponentBlockMarkers('<div data-sw-component="banner"></div><form data-sw-component="form"></form>');
    expect(out).toContain('<div data-sw-component="banner" hidden>');
    expect(out).toContain('data-sw-component="form" data-sw-block="Form"');
  });

  it('runs through renderTemplate, so both render surfaces get it', () => {
    const out = renderTemplate('<div data-sw-component="banner" data-position="inline"><p>Promo</p></div>', {});
    expect(out).toContain('data-sw-component="banner"');
    expect(out).toContain(' hidden');
  });

  it('the injected attribute is the one the stylesheet actually hides', () => {
    // Guards the pairing: injecting `hidden` is only correct while the sheet keys on [hidden].
    expect(BANNER_CSS).toContain('[data-sw-component="banner"][hidden]{display:none}');
  });
});

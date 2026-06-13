import { describe, it, expect } from 'vitest';
import { COMPONENT_TYPES, componentTypesInSource, componentAssets } from '../src/components.js';

describe('componentTypesInSource (code-first detection)', () => {
  it('detects interactive components by their data-sw-component marker in rendered source', () => {
    const html =
      '<div data-sw-component="modal"><button data-sw-part="open">Open</button></div>' +
      '<div data-sw-component="tabs"></div>' +
      '<form data-sw-component="form"></form>';
    expect(componentTypesInSource(html).sort()).toEqual(['Form', 'Modal', 'Tabs']);
  });

  it('maps every emitted component name to a registered type (so its JS/CSS actually bundles)', () => {
    for (const name of ['carousel', 'lightbox', 'modal', 'cookie-consent', 'tabs', 'form']) {
      const [type] = componentTypesInSource(`<div data-sw-component="${name}"></div>`);
      expect(type, name).toBeDefined();
      expect(COMPONENT_TYPES.has(type!), name).toBe(true);
      expect(componentAssets([type!]).js.length + componentAssets([type!]).css.length).toBeGreaterThan(0);
    }
  });

  it('dedupes repeats and ignores unknown / empty markers', () => {
    expect(componentTypesInSource('<a data-sw-component="modal"></a><b data-sw-component="modal"></b>')).toEqual(['Modal']);
    expect(componentTypesInSource('<div data-sw-component="bogus"></div>')).toEqual([]);
    expect(componentTypesInSource('')).toEqual([]);
    expect(componentTypesInSource(undefined)).toEqual([]);
    expect(componentTypesInSource(null)).toEqual([]);
  });

  it('ships nothing for a native-details accordion (DaisyUI collapse pattern, not a component)', () => {
    expect(componentTypesInSource('<details class="collapse collapse-plus"><summary class="collapse-title">Q</summary></details>')).toEqual([]);
    // legacy Accordion styling hooks no longer trigger a (removed) registry entry
    expect(componentTypesInSource('<div data-sw-block="Accordion"></div>')).toEqual([]);
  });

  it('detects a form embedded by REFERENCE — {{sw-form}} or data-sw-form (marker only exists post-render)', () => {
    expect(componentTypesInSource('<section>{{sw-form "contact"}}</section>')).toEqual(['Form']);
    expect(componentTypesInSource('<section>{{ sw-form "contact" }}</section>')).toEqual(['Form']);
    expect(componentTypesInSource('<form data-sw-form="contact"><input name="n" /></form>')).toEqual(['Form']);
    // anchored scan: prose mentions and would-be `sw-format` helpers do NOT over-ship Form assets
    expect(componentTypesInSource('<p>about sw-form</p>')).toEqual([]);
    expect(componentTypesInSource('{{sw-formation "x"}}')).toEqual([]);
  });
});

describe('component registry', () => {
  it('registers interactive components (container types; child blocks are plain)', () => {
    expect(COMPONENT_TYPES.has('Carousel')).toBe(true);
    expect(COMPONENT_TYPES.has('Lightbox')).toBe(true);
    expect(COMPONENT_TYPES.has('Modal')).toBe(true);
    expect(COMPONENT_TYPES.has('CookieConsent')).toBe(true);
    expect(COMPONENT_TYPES.has('Tabs')).toBe(true);
    expect(COMPONENT_TYPES.has('Tab')).toBe(false); // a Tab is a plain child panel
    // child / plain blocks have no registry entry of their own
    expect(COMPONENT_TYPES.has('Slide')).toBe(false);
    expect(COMPONENT_TYPES.has('Accordion')).toBe(false); // removed — DaisyUI collapse covers it
    expect(COMPONENT_TYPES.has('LightboxItem')).toBe(false);
    expect(COMPONENT_TYPES.has('Section')).toBe(false);
  });

  it('Lightbox ships the vendored SmartPhoto runtime + grid CSS', () => {
    const used = componentAssets(['Lightbox']);
    expect(used.css).toContain('[data-sw-part="grid"]'); // authored thumbnail grid
    expect(used.css).toContain('.smartphoto'); // vendored viewer stylesheet
    expect(used.css).toContain('.smartphoto{z-index:999999'); // fullscreen viewer sits above site chrome (cookie banner z 9998)
    // CSP default-src 'self': the only url() refs are inline data: URIs (SmartPhoto's icons) —
    // never an external http(s):// or protocol-relative asset.
    expect(used.css).not.toMatch(/url\(\s*['"]?(?!data:)/i);
    expect(used.js).toContain('smartphoto@'); // license banner names the bundled MIT package
    expect(used.js).toContain('data-sw-component="lightbox"');
    expect(used.js).toContain('data-thumbnails'); // the thumbnail-strip switch is read from data-*
    expect(used.js).toContain('focus'); // a11y shim: focus restored to the trigger on close
    // The IE-only polyfills SmartPhoto ships are aliased away at bundle time (modern target).
    expect(used.js).not.toContain('es6-promise-polyfill');
    expect(used.js).not.toContain('custom-event-polyfill');
    expect(used.js).not.toMatch(/\beval\(/); // CSP: no eval in shipped runtime
  });

  it('ignores unknown/removed types when bundling', () => {
    expect(componentAssets(['Accordion']).css).toBe('');
    expect(componentAssets(['Accordion']).js).toBe('');
    expect(componentAssets(['Accordion', 'Lightbox']).js).toContain('lightbox');
  });

  it('bundles CSS + JS for used components, empty when none', () => {
    const used = componentAssets(['Carousel']);
    expect(used.css).toContain('[data-sw-block="Carousel"]');
    expect(used.css).toContain('scroll-snap-type'); // no-JS fallback stays a swipeable row
    expect(used.css).toContain('--sw-items'); // multi-item / peek layout knob
    expect(used.js).toContain('embla-carousel@'); // license banner names the bundled MIT packages
    expect(used.js).toContain('data-sw-component="carousel"');
    expect(used.js).toContain('data-sw-enhanced'); // progressive enhancement marker
    expect(used.js).toContain('removeAttribute'); // un-hides the dots for screen readers
    expect(used.js).not.toMatch(/\beval\(/); // CSP: no eval in shipped runtime

    const none = componentAssets([]);
    expect(none.css).toBe('');
    expect(none.js).toBe('');
  });

  it('Modal uses the native <dialog> API; CookieConsent guards localStorage', () => {
    const modal = componentAssets(['Modal']);
    expect(modal.css).toContain('::backdrop');
    expect(modal.js).toContain('showModal');
    const cc = componentAssets(['CookieConsent']);
    expect(cc.js).toContain('localStorage');
    expect(cc.js).toContain('try{'); // storage access is guarded (sandbox/disabled)
  });

  it('Tabs builds an ARIA tablist with keyboard nav', () => {
    const tabs = componentAssets(['Tabs']);
    expect(tabs.css).toContain('[data-sw-part="tab"]');
    expect(tabs.js).toContain("role','tab'");
    expect(tabs.js).toContain('ArrowRight'); // keyboard navigation
    expect(tabs.js).toContain('Home'); // + Home/End (APG)
    expect(tabs.js).toContain('aria-controls');
    expect(tabs.js).not.toContain('innerHTML'); // tab labels via textContent, not innerHTML
  });

  it('ignores unknown component types', () => {
    expect(componentAssets(['Nope', 'AlsoNope'])).toEqual({ css: '', js: '' });
  });
});

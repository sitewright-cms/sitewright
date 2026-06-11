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
});

describe('component registry', () => {
  it('registers interactive components (container types; child blocks are plain)', () => {
    expect(COMPONENT_TYPES.has('Carousel')).toBe(true);
    expect(COMPONENT_TYPES.has('Accordion')).toBe(true);
    expect(COMPONENT_TYPES.has('Lightbox')).toBe(true);
    expect(COMPONENT_TYPES.has('Modal')).toBe(true);
    expect(COMPONENT_TYPES.has('CookieConsent')).toBe(true);
    expect(COMPONENT_TYPES.has('Tabs')).toBe(true);
    expect(COMPONENT_TYPES.has('Tab')).toBe(false); // a Tab is a plain child panel
    // child / plain blocks have no registry entry of their own
    expect(COMPONENT_TYPES.has('Slide')).toBe(false);
    expect(COMPONENT_TYPES.has('AccordionItem')).toBe(false);
    expect(COMPONENT_TYPES.has('LightboxItem')).toBe(false);
    expect(COMPONENT_TYPES.has('Section')).toBe(false);
  });

  it('Accordion contributes CSS but no JS (native <details>, zero-JS)', () => {
    const used = componentAssets(['Accordion']);
    expect(used.css).toContain('[data-sw-block="AccordionItem"]');
    expect(used.js).toBe(''); // no behavior bundle
  });

  it('Lightbox contributes CSS + JS (DOM-built overlay, no innerHTML injection)', () => {
    const used = componentAssets(['Lightbox']);
    expect(used.css).toContain('[data-sw-part="overlay"]');
    expect(used.js).toContain('data-sw-component="lightbox"');
    expect(used.js).toContain('createElement'); // overlay built via DOM, not innerHTML of user data
    expect(used.js).not.toMatch(/innerHTML\s*=\s*[^']/); // only the one-time `innerHTML=''` clear
    expect(used.js).toContain('Image viewer'); // dialog has an accessible name (WCAG 4.1.2)
    expect(used.js).toContain("'Tab'"); // focus trap honors the aria-modal contract
  });

  it('bundles only the JS of used components (Accordion alone → no JS)', () => {
    expect(componentAssets(['Accordion']).js).toBe('');
    expect(componentAssets(['Accordion', 'Lightbox']).js).toContain('lightbox');
  });

  it('bundles CSS + JS for used components, empty when none', () => {
    const used = componentAssets(['Carousel']);
    expect(used.css).toContain('[data-sw-block="Carousel"]');
    expect(used.css).toContain('scroll-snap-type');
    expect(used.js).toContain('data-sw-component="carousel"');
    expect(used.js).toContain('data-sw-enhanced'); // progressive enhancement marker
    expect(used.js).toContain('removeAttribute'); // un-hides the dots for screen readers
    expect(used.js).toContain('relatedTarget'); // focus pause doesn't oscillate within the carousel

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

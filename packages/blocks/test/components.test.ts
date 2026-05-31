import { describe, it, expect } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import { COMPONENT_TYPES, usedComponentTypes, componentAssets } from '../src/components.js';

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

  it('collects distinct component types used in a tree (deduped, ignores non-components)', () => {
    const tree: PageNode = {
      id: 'r',
      type: 'Section',
      children: [
        { id: 'c1', type: 'Carousel', children: [{ id: 's', type: 'Slide' }] },
        { id: 'c2', type: 'Carousel' },
        { id: 'h', type: 'Heading' },
      ],
    };
    expect(usedComponentTypes(tree)).toEqual(['Carousel']); // deduped
    expect(usedComponentTypes({ id: 'x', type: 'Section' })).toEqual([]);
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
    expect(tabs.js).toContain('aria-controls');
  });

  it('ignores unknown component types', () => {
    expect(componentAssets(['Nope', 'AlsoNope'])).toEqual({ css: '', js: '' });
  });
});

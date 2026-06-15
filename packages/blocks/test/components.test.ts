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

  it('Lightbox ships the vendored runtime + grid CSS under vendor-neutral class names', () => {
    const used = componentAssets(['Lightbox']);
    expect(used.css).toContain('[data-sw-part="grid"]'); // authored thumbnail grid
    expect(used.css).toContain('.sw-lightbox-nav'); // vendored viewer stylesheet, renamed to sw-lightbox-*
    expect(used.css).toContain('.sw-lightbox{z-index:999999'); // fullscreen viewer sits above site chrome (cookie banner z 9998)
    expect(used.css).not.toContain('.smartphoto'); // no third-party class name leaks into shipped CSS
    // CSP default-src 'self': the only url() refs are inline data: URIs (icons) — never an external
    // http(s):// or protocol-relative asset.
    expect(used.css).not.toMatch(/url\(\s*['"]?(?!data:)/i);
    expect(used.js).toContain('smartphoto@'); // license banner MUST keep attributing the bundled MIT package
    expect(used.js).toContain('data-sw-component="lightbox"');
    expect(used.js).toContain('data-thumbnails'); // the thumbnail-strip switch is read from data-*
    expect(used.js).toContain('data-full'); // minimal form: bare <img> wrapped with href = data-full || src
    expect(used.js).toContain('data-gallery'); // shared data-gallery merges roots into one combined gallery
    expect(used.js).toContain('sw-lightbox'); // runtime builds the viewer with the neutral class names
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

  it('Modal fades in from the top / out to the top across the <dialog> display toggle', () => {
    const css = componentAssets(['Modal']).css;
    // The enter/exit transition needs a real duration on opacity+transform (not the default
    // 0s = instant), a translateY(-24px) offset (from the top), and the native-<dialog>
    // machinery that lets it animate across the display toggle (@starting-style +
    // allow-discrete). Dropping any of these collapses the animation to an instant show/hide.
    expect(css).toContain('transition:opacity .22s ease,transform .22s ease');
    expect(css).toContain('translateY(-24px)');
    expect(css).toContain('allow-discrete');
    expect(css).toContain('@starting-style');
    // Reduced-motion drops straight to a plain show/hide.
    expect(css).toContain('prefers-reduced-motion:reduce');
  });

  it('Modal auto-injects a styled close button and honours data-closebutton / data-backdrop-close', () => {
    const { css, js } = componentAssets(['Modal']);
    // The runtime builds a top-right close button (brand-primary square, white icon) and reads the
    // two opt-out switches off the root.
    expect(js).toContain("setAttribute('data-sw-part','autoclose')");
    expect(js).toContain("getAttribute('data-closebutton')!=='false'");
    expect(js).toContain("getAttribute('data-backdrop-close')!=='false'");
    // Authored close buttons (any number) are wired too.
    expect(js).toContain("querySelectorAll('[data-sw-part=\"close\"]')");
    // The close button's appearance: primary background, white icon, hover zoom + 180° spin.
    expect(css).toContain('[data-sw-part="autoclose"]');
    expect(css).toContain('var(--sw-color-primary');
    expect(css).toContain('rotate(180deg)');
    expect(css).toContain('scale(1.1)');
  });

  it('Modal dialog defaults are zero-specificity so dialog classes win, and the backdrop blurs', () => {
    const css = componentAssets(['Modal']).css;
    // Appearance defaults wrapped in :where() (specificity 0) → utility classes on the dialog
    // override them without !important; bg/text come from the global theme vars; 1.5rem padding.
    expect(css).toContain(':where([data-sw-block="Modal"] dialog)');
    expect(css).toContain('var(--sw-color-base-100');
    expect(css).toContain('var(--sw-color-base-content');
    expect(css).toContain('padding:1.5rem');
    // Backdrop dims AND blurs.
    expect(css).toContain('backdrop-filter:blur(5px)');
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

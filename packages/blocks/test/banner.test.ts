import { describe, it, expect } from 'vitest';
import { componentAssets, componentTypesInSource, COMPONENT_TYPES } from '../src/components.js';
import { BANNER_CSS, BANNER_JS } from '../src/banner.js';

// The Banner component is a generic, free-content dismissible banner (NOT the consent banner — that's
// the auto-injected Consent Manager): the author writes the body + the action buttons, and the runtime
// only reveals it and remembers the dismissal. These tests
// pin the runtime contract (the data-* switches the catalog documents) and the PE / storage guards.
describe('Banner component', () => {
  it('is registered and detected by the source scanner', () => {
    expect(COMPONENT_TYPES.has('Banner')).toBe(true);
    expect(componentTypesInSource('<div data-sw-component="banner"></div>')).toEqual(['Banner']);
    const { css, js } = componentAssets(['Banner']);
    expect(css.length + js.length).toBeGreaterThan(0);
  });

  it('CSS keys on the component marker, ships placement variants, and uses theme tokens (dark-ready)', () => {
    expect(BANNER_CSS).toContain('[data-sw-component="banner"]');
    expect(BANNER_CSS).not.toContain('data-sw-block');
    // PE: hidden until revealed; a transition-driven reveal class.
    expect(BANNER_CSS).toContain('[data-sw-component="banner"][hidden]{display:none}');
    expect(BANNER_CSS).toContain('[data-sw-banner-shown]');
    // Every documented placement variant exists.
    for (const pos of ['bottom', 'top', 'bottom-left', 'bottom-right', 'top-left', 'top-right', 'center', 'inline']) {
      expect(BANNER_CSS, pos).toContain(`[data-position="${pos}"]`);
    }
    // The surface reads a --sw-color-* token so it flips in dark mode (no raw light background).
    expect(BANNER_CSS).toContain('var(--sw-color-base-100');
    expect(BANNER_CSS).toContain('prefers-reduced-motion:reduce');
  });

  it('runtime guards Web Storage and consumes every documented data-* switch', () => {
    expect(BANNER_JS).toContain('localStorage');
    expect(BANNER_JS).toContain('try{'); // storage access is guarded (sandbox / disabled storage)
    // Per-banner key namespace so multiple banners are remembered independently.
    expect(BANNER_JS).toContain("'sw-banner:'");
    expect(BANNER_JS).toContain("getAttribute('data-sw-banner-id')");
    // The catalog-documented config attributes must actually be read by the runtime.
    expect(BANNER_JS).toContain("getAttribute('data-frequency')");
    expect(BANNER_JS).toContain("getAttribute('data-delay')");
    expect(BANNER_JS).toContain("getAttribute('data-remind-days')");
    // The three dismissal parts.
    expect(BANNER_JS).toContain('[data-sw-part="dismiss"]');
    expect(BANNER_JS).toContain('[data-sw-part="dismiss-forever"]');
    expect(BANNER_JS).toContain('[data-sw-part="remind"]');
    // Frequency vocabulary.
    expect(BANNER_JS).toContain("'always'");
    expect(BANNER_JS).toContain('session');
    expect(BANNER_JS).toContain("'days:'");
    // Scans for all banners (multiple-instance support).
    expect(BANNER_JS).toContain('querySelectorAll(\'[data-sw-component="banner"]\')');
    // CSP: no eval-equivalents in the shipped runtime.
    expect(BANNER_JS).not.toMatch(/\beval\(/);
    expect(BANNER_JS).not.toMatch(/\bnew\s+Function\s*\(/);
  });

  it('reveals progressively (removes [hidden]) and idempotently enhances each root once', () => {
    expect(BANNER_JS).toContain("removeAttribute('hidden')");
    expect(BANNER_JS).toContain("setAttribute('data-sw-banner-shown','')");
    // PE idempotency guard so a re-init never double-wires the buttons.
    expect(BANNER_JS).toContain("getAttribute('data-sw-enhanced')==='true'");
    // Boots on DOM ready like the other component runtimes.
    expect(BANNER_JS).toContain("addEventListener('DOMContentLoaded',init)");
  });
});

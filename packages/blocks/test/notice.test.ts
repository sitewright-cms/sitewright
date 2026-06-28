import { describe, it, expect } from 'vitest';
import { componentAssets, componentTypesInSource, COMPONENT_TYPES } from '../src/components.js';
import { NOTICE_CSS, NOTICE_JS } from '../src/notice.js';

// The Notice component is the generic, free-content sibling of CookieConsent: the author writes the
// body + the action buttons, and the runtime only reveals it and remembers the dismissal. These tests
// pin the runtime contract (the data-* switches the catalog documents) and the PE / storage guards.
describe('Notice component', () => {
  it('is registered and detected by the source scanner', () => {
    expect(COMPONENT_TYPES.has('Notice')).toBe(true);
    expect(componentTypesInSource('<div data-sw-component="notice"></div>')).toEqual(['Notice']);
    const { css, js } = componentAssets(['Notice']);
    expect(css.length + js.length).toBeGreaterThan(0);
  });

  it('CSS keys on the component marker, ships placement variants, and uses theme tokens (dark-ready)', () => {
    expect(NOTICE_CSS).toContain('[data-sw-component="notice"]');
    expect(NOTICE_CSS).not.toContain('data-sw-block');
    // PE: hidden until revealed; a transition-driven reveal class.
    expect(NOTICE_CSS).toContain('[data-sw-component="notice"][hidden]{display:none}');
    expect(NOTICE_CSS).toContain('[data-sw-notice-shown]');
    // Every documented placement variant exists.
    for (const pos of ['bottom', 'top', 'bottom-left', 'bottom-right', 'top-left', 'top-right', 'center', 'inline']) {
      expect(NOTICE_CSS, pos).toContain(`[data-position="${pos}"]`);
    }
    // The surface reads a --sw-color-* token so it flips in dark mode (no raw light background).
    expect(NOTICE_CSS).toContain('var(--sw-color-base-100');
    expect(NOTICE_CSS).toContain('prefers-reduced-motion:reduce');
  });

  it('runtime guards Web Storage and consumes every documented data-* switch', () => {
    expect(NOTICE_JS).toContain('localStorage');
    expect(NOTICE_JS).toContain('try{'); // storage access is guarded (sandbox / disabled storage)
    // Per-notice key namespace so multiple notices are remembered independently.
    expect(NOTICE_JS).toContain("'sw-notice:'");
    expect(NOTICE_JS).toContain("getAttribute('data-sw-notice-id')");
    // The catalog-documented config attributes must actually be read by the runtime.
    expect(NOTICE_JS).toContain("getAttribute('data-frequency')");
    expect(NOTICE_JS).toContain("getAttribute('data-delay')");
    expect(NOTICE_JS).toContain("getAttribute('data-remind-days')");
    // The three dismissal parts.
    expect(NOTICE_JS).toContain('[data-sw-part="dismiss"]');
    expect(NOTICE_JS).toContain('[data-sw-part="dismiss-forever"]');
    expect(NOTICE_JS).toContain('[data-sw-part="remind"]');
    // Frequency vocabulary.
    expect(NOTICE_JS).toContain("'always'");
    expect(NOTICE_JS).toContain('session');
    expect(NOTICE_JS).toContain("'days:'");
    // Scans for all notices (multiple-instance support).
    expect(NOTICE_JS).toContain('querySelectorAll(\'[data-sw-component="notice"]\')');
    // CSP: no eval-equivalents in the shipped runtime.
    expect(NOTICE_JS).not.toMatch(/\beval\(/);
    expect(NOTICE_JS).not.toMatch(/\bnew\s+Function\s*\(/);
  });

  it('reveals progressively (removes [hidden]) and idempotently enhances each root once', () => {
    expect(NOTICE_JS).toContain("removeAttribute('hidden')");
    expect(NOTICE_JS).toContain("setAttribute('data-sw-notice-shown','')");
    // PE idempotency guard so a re-init never double-wires the buttons.
    expect(NOTICE_JS).toContain("getAttribute('data-sw-enhanced')==='true'");
    // Boots on DOM ready like the other component runtimes.
    expect(NOTICE_JS).toContain("addEventListener('DOMContentLoaded',init)");
  });
});

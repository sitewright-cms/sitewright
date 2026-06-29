import { describe, it, expect } from 'vitest';
import { CONSENT_CSS, CONSENT_JS, usesConsent, CONSENT_CATEGORIES } from '../src/consent.js';

describe('consent stylesheet', () => {
  it('hides the banner until the runtime marks it enhanced (PE: no inert UI pre-JS)', () => {
    expect(CONSENT_CSS).toContain('[data-sw-consent]{display:none}');
    expect(CONSENT_CSS).toContain('[data-sw-consent][data-sw-enhanced="true"]{display:block');
  });

  it('reads --sw-color-* tokens (dark-ready surface), offers a box layout, and styles toggles', () => {
    expect(CONSENT_CSS).toContain('var(--sw-color-base-100');
    expect(CONSENT_CSS).toContain('var(--sw-color-base-content');
    expect(CONSENT_CSS).toContain('[data-layout="box"]');
    // The category checkboxes render as toggles (green = on via the success token).
    expect(CONSENT_CSS).toContain('.sw-consent-cat input:checked{background:var(--sw-color-success');
    expect(CONSENT_CSS.toLowerCase()).not.toContain('</style');
  });

  it('drives visibility via data-open with a slide transition (not the overridable [hidden] attr)', () => {
    expect(CONSENT_CSS).toContain('[data-sw-consent][data-sw-enhanced="true"][data-open]');
    expect(CONSENT_CSS).toContain('transition:transform');
    expect(CONSENT_CSS).toContain('prefers-reduced-motion');
  });

  it('only reveals the preferences panel when data-prefs is open', () => {
    expect(CONSENT_CSS).toContain('.sw-consent-prefs{display:none');
    expect(CONSENT_CSS).toContain('[data-prefs="open"] .sw-consent-prefs{display:block}');
  });
});

describe('consent runtime (CONSENT_JS)', () => {
  it('guards Web Storage and is versioned', () => {
    expect(CONSENT_JS).toContain('localStorage');
    expect(CONSENT_JS).toContain('try{');
    expect(CONSENT_JS).toContain("'sw-consent'"); // storage namespace
    expect(CONSENT_JS).toContain('rec.v'); // versioned re-prompt
  });

  it('reads its config from the escaped data-sw-consent-config attribute (CSP-safe; no inline script)', () => {
    expect(CONSENT_JS).toContain("getAttribute('data-sw-consent-config')");
    expect(CONSENT_JS).toContain('JSON.parse');
  });

  it('broadcasts decisions on a sw:consentchange event + exposes window.swConsent', () => {
    expect(CONSENT_JS).toContain("'sw:consentchange'");
    expect(CONSENT_JS).toContain('CustomEvent');
    expect(CONSENT_JS).toContain('window.swConsent');
    expect(CONSENT_JS).toContain('necessary'); // necessary is always granted
  });

  it('wires the first-layer actions + the re-open trigger', () => {
    expect(CONSENT_JS).toContain('data-sw-consent-open'); // {{sw-consent-settings}} re-open
    expect(CONSENT_JS).toContain('querySelectorAll(\'[data-sw-consent]\')');
  });

  it('builds the UI with createElement/textContent only — no innerHTML/eval (XSS + CSP safe)', () => {
    expect(CONSENT_JS).toContain('createElement');
    expect(CONSENT_JS).not.toContain('innerHTML');
    expect(CONSENT_JS).not.toMatch(/\beval\(/);
    expect(CONSENT_JS).not.toMatch(/\bnew\s+Function\s*\(/);
  });
});

describe('usesConsent gate (only-used-ships)', () => {
  it('matches every authoring form of the helper + the rendered marker', () => {
    expect(usesConsent('<x>{{sw-consent}}</x>')).toBe(true);
    expect(usesConsent('{{sw-consent-settings}}')).toBe(true);
    expect(usesConsent('<div data-sw-consent></div>')).toBe(true);
    expect(usesConsent('<a data-sw-consent-open>x</a>')).toBe(true);
    expect(usesConsent('<p>plain</p>')).toBe(false);
    expect(usesConsent(undefined)).toBe(false);
    expect(usesConsent(null)).toBe(false);
  });

  it('exports the canonical optional category list', () => {
    expect([...CONSENT_CATEGORIES]).toEqual(['functional', 'analytics', 'marketing']);
  });
});

describe('consent integration injection (CONSENT_JS)', () => {
  it('injects consented integrations once, de-duped, gated by the granted category', () => {
    expect(CONSENT_JS).toContain('cfg.ints');
    expect(CONSENT_JS).toContain('loadConsented');
    expect(CONSENT_JS).toContain("createElement('script')");
    expect(CONSENT_JS).toContain('data-sw-consent-loaded'); // de-dupe marker on the injected <script>
    expect(CONSENT_JS).toContain('loaded[it.id]'); // de-dupe
    expect(CONSENT_JS).toContain('current[it.cat]'); // gated by the consented category
    // CSP-safe: injects EXTERNAL src scripts only — no eval/new Function.
    expect(CONSENT_JS).not.toMatch(/\beval\(/);
    expect(CONSENT_JS).not.toMatch(/\bnew\s+Function\s*\(/);
  });
  it('runs the gtag/gtm bootstrap in self-origin (no external inline script needed)', () => {
    expect(CONSENT_JS).toContain('window.dataLayer');
    expect(CONSENT_JS).toContain('gtag');
    expect(CONSENT_JS).toContain('gtm.start');
  });
  it('registers a securitypolicyviolation listener that loudly names a blocked origin', () => {
    expect(CONSENT_JS).toContain("'securitypolicyviolation'");
    expect(CONSENT_JS).toContain('console.error');
    expect(CONSENT_JS).toContain('blockedURI');
  });
});

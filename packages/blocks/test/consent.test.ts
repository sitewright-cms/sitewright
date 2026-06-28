import { describe, it, expect } from 'vitest';
import { CONSENT_CSS, CONSENT_JS, usesConsent, CONSENT_CATEGORIES } from '../src/consent.js';

describe('consent stylesheet', () => {
  it('hides the banner until the runtime marks it enhanced (PE: no inert UI pre-JS)', () => {
    expect(CONSENT_CSS).toContain('[data-sw-consent]{display:none}');
    expect(CONSENT_CSS).toContain('[data-sw-consent][data-sw-enhanced="true"]{display:block');
  });

  it('reads --sw-color-* tokens (dark-ready surface) and offers a box layout', () => {
    expect(CONSENT_CSS).toContain('var(--sw-color-base-100');
    expect(CONSENT_CSS).toContain('var(--sw-color-base-content');
    expect(CONSENT_CSS).toContain('[data-layout="box"]');
    expect(CONSENT_CSS).toContain('accent-color:var(--sw-color-primary');
    expect(CONSENT_CSS.toLowerCase()).not.toContain('</style');
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

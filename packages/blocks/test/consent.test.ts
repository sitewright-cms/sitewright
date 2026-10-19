import { describe, it, expect } from 'vitest';
import { CONSENT_CSS, CONSENT_JS, usesConsent, CONSENT_CATEGORIES, consentMountMarkup } from '../src/consent.js';
import type { Consent } from '@sitewright/schema';

// Identity translator (returns the reserved key itself, so we can assert which key fed each slot) unless a
// specific map is supplied. The real build feeds page-locale translations → English defaults.
const idTr = (k: string): string => k;
const enTr = (map: Record<string, string>) => (k: string): string => map[k] ?? k;

describe('consentMountMarkup — the auto-injected mount (config builder, no {{sw-consent}})', () => {
  const on = (extra: Partial<Consent> = {}): Consent => ({ enabled: true, ...extra } as Consent);

  it('returns "" when consent is off / undefined', () => {
    expect(consentMountMarkup(undefined, idTr)).toBe('');
    expect(consentMountMarkup({ enabled: false } as Consent, idTr)).toBe('');
  });

  it('emits the mount with id + data-sw-consent + escaped config when enabled', () => {
    const out = consentMountMarkup(on(), idTr);
    expect(out).toContain('id="sw-consent"');
    expect(out).toContain('data-sw-consent ');
    expect(out).toContain('data-sw-consent-config="');
    expect(out).toContain('consent.accept_all'); // the t.acceptAll slot fed by idTr
  });

  it('honors layout + denyButton + version + a category subset', () => {
    const out = consentMountMarkup(on({ layout: 'box', denyButton: false, version: 3, categories: ['analytics'] }), idTr);
    expect(out).toContain('data-layout="box"');
    expect(out).toMatch(/&quot;v&quot;:3/); // escaped JSON in the attribute
    expect(out).toContain('consent.analytics');
    expect(out).not.toContain('consent.marketing'); // only the requested category is offered
  });

  it('localizes copy via the tr function', () => {
    expect(consentMountMarkup(on(), enTr({ 'consent.accept_all': 'Alle akzeptieren' }))).toContain('Alle akzeptieren');
  });

  it('sanitizes the privacy link (javascript: dropped; internal path kept)', () => {
    expect(consentMountMarkup(on({ privacyHref: 'javascript:alert(1)' } as Partial<Consent>), idTr)).not.toContain('javascript:');
    expect(consentMountMarkup(on({ privacyHref: '/privacy' } as Partial<Consent>), idTr)).toContain('/privacy');
  });

  it('bakes the integration registry as runtime descriptors', () => {
    const out = consentMountMarkup(on({ integrations: [{ id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' }] } as Partial<Consent>), idTr);
    expect(out).toContain('ga4');
    expect(out).toContain('googletagmanager.com');
    expect(out).toContain('G-X');
  });

  it('sets grantAll only when the preview flag is passed', () => {
    expect(consentMountMarkup(on(), idTr, { grantAll: true })).toContain('grantAll');
    expect(consentMountMarkup(on(), idTr)).not.toContain('grantAll');
  });
});

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

describe('★ consentMountMarkup — integrations that load WITHOUT consent', () => {
  const PL = { id: 'pl', name: 'Plausible', category: 'analytics', preset: 'plausible', siteId: 'pa-AbC123', requireConsent: false };
  const GA = { id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' };
  const cfgOf = (html: string): Record<string, unknown> => {
    const m = /data-sw-consent-config="([^"]*)"/.exec(html);
    return JSON.parse(m![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  };

  it('emits a banner-less mount carrying only the cookieless integrations when the manager is OFF', () => {
    const out = consentMountMarkup({ enabled: false, integrations: [PL, GA] } as unknown as Consent, idTr);
    expect(out).toContain('data-sw-consent');
    expect(out).not.toContain('id="sw-consent"'); // no banner to open: #sw-consent links stay plain anchors
    const cfg = cfgOf(out);
    expect(cfg.nobanner).toBe(1);
    expect((cfg.ints as Array<{ id: string }>).map((i) => i.id)).toEqual(['pl']);
    expect(cfg).not.toHaveProperty('t'); // no banner copy shipped
  });

  it('still emits nothing when the manager is off and every integration waits for consent', () => {
    expect(consentMountMarkup({ enabled: false, integrations: [GA] } as unknown as Consent, idTr)).toBe('');
  });

  it('carries grantAll on the banner-less mount too, so the preview can hold analytics', () => {
    expect(cfgOf(consentMountMarkup({ enabled: false, integrations: [PL] } as unknown as Consent, idTr, { grantAll: true })).grantAll).toBe(true);
  });

  it('escapes a hostile value in the banner-less config (a schema-bypassing write)', () => {
    const evil = { id: 'pl', name: 'P', category: 'analytics', preset: 'plausible', siteId: '"><script>alert(1)</script>&', requireConsent: false };
    const out = consentMountMarkup({ enabled: false, integrations: [evil] } as unknown as Consent, idTr);
    expect(out).not.toContain('<script>');
    expect(out.match(/"/g)).toHaveLength(2); // the attribute's own quotes only: the value cannot break out
    expect(/data-sw-consent-config="([^"]*)"/.exec(out)![1]).not.toMatch(/[<>]/);
    expect(cfgOf(out).ints).toEqual([expect.objectContaining({ attrs: { 'data-domain': '"><script>alert(1)</script>&' } })]); // intact as DATA
  });
});


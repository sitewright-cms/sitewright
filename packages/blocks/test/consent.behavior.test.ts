// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { CONSENT_JS } from '../src/consent.js';

// Behavioral coverage: run the REAL shipped consent runtime in a DOM and assert the banner / accept /
// reject / customize / persist / re-prompt / re-open state machine end-to-end.
const CONFIG = {
  v: 1,
  layout: 'bar',
  deny: true,
  cats: [
    { id: 'functional', label: 'Functional', desc: 'fd' },
    { id: 'analytics', label: 'Analytics', desc: 'ad' },
    { id: 'marketing', label: 'Marketing', desc: 'md' },
  ],
  t: {
    title: 'Privacy',
    intro: 'we use cookies',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    customize: 'Customize',
    save: 'Save preferences',
    prefsTitle: 'Prefs',
    necessary: 'Necessary',
    necessaryDesc: 'req',
  },
};

// In jsdom `document.currentScript` is always null, so the runtime's cached SITE_KEY falls back to
// location.pathname — matching this KEY. The currentScript-vs-pathname persistence bug therefore can't be
// reproduced here; the cross-reload key stability is verified live in a real browser (Playwright on :2003).
const KEY = `sw-consent:${location.pathname || '/'}`;
let lastDetail: Record<string, boolean> | null = null;

function run(cfg: object = CONFIG): HTMLElement {
  document.body.innerHTML = '<div data-sw-consent></div>';
  const root = document.querySelector('[data-sw-consent]') as HTMLElement;
  root.setAttribute('data-sw-consent-config', JSON.stringify(cfg));
  (0, eval)(CONSENT_JS);
  return root;
}
const root = (): HTMLElement => document.querySelector('[data-sw-consent]') as HTMLElement;
const btn = (text: string): HTMLButtonElement =>
  Array.from(root().querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;
const boxes = (): HTMLInputElement[] => Array.from(root().querySelectorAll('.sw-consent-cat input')) as HTMLInputElement[];
const stored = (): { v: number; cats: Record<string, boolean> } | null => {
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
};

describe('Consent runtime behavior (jsdom)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    lastDetail = null;
    window.addEventListener('sw:consentchange', (e: Event) => {
      lastDetail = (e as CustomEvent).detail;
    });
  });

  it('shows the banner on a first visit, with the necessary toggle locked on', () => {
    run();
    expect(root().hasAttribute('data-open')).toBe(true);
    expect(root().getAttribute('data-sw-enhanced')).toBe('true');
    expect(boxes()[0]!.disabled).toBe(true); // necessary is always-on
    expect(boxes()[0]!.checked).toBe(true);
  });

  it('Accept all → stores all categories, hides the banner, and broadcasts (necessary always true)', () => {
    run();
    btn('Accept all').click();
    expect(root().hasAttribute('data-open')).toBe(false);
    expect(stored()).toMatchObject({ v: 1, cats: { functional: true, analytics: true, marketing: true } });
    expect(lastDetail).toEqual({ necessary: true, functional: true, analytics: true, marketing: true });
  });

  it('Reject all → stores all-false but the broadcast still grants necessary', () => {
    run();
    btn('Reject all').click();
    expect(stored()).toMatchObject({ cats: { functional: false, analytics: false, marketing: false } });
    expect(lastDetail).toEqual({ necessary: true, functional: false, analytics: false, marketing: false });
  });

  it('Customize → opens preferences; Save persists exactly the picked categories', () => {
    run();
    btn('Customize').click();
    expect(root().getAttribute('data-prefs')).toBe('open');
    boxes()[2]!.checked = true; // analytics on, others left off
    btn('Save preferences').click();
    expect(stored()).toMatchObject({ cats: { functional: false, analytics: true, marketing: false } });
    expect(lastDetail).toMatchObject({ necessary: true, analytics: true, functional: false });
  });

  it('a returning visitor (same version) sees no banner but the stored consent is re-broadcast on load', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: true, analytics: false, marketing: false } }));
    run();
    expect(root().hasAttribute('data-open')).toBe(false);
    expect(lastDetail).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
  });

  it('bumping the consent version re-prompts a previously-consented visitor', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: true, analytics: true, marketing: true } }));
    run({ ...CONFIG, v: 2 });
    expect(root().hasAttribute('data-open')).toBe(true); // stored v1 < config v2 → ask again
  });

  it('re-opens preferences via window.swConsent.open() and a [data-sw-consent-open] trigger', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: false, analytics: false, marketing: false } }));
    run();
    expect(root().hasAttribute('data-open')).toBe(false);
    (window as unknown as { swConsent: { open: () => void } }).swConsent.open();
    expect(root().hasAttribute('data-open')).toBe(true);
    expect(root().getAttribute('data-prefs')).toBe('open');
    // and via the delegated click trigger
    btn('Accept all').click(); // hide again
    expect(root().hasAttribute('data-open')).toBe(false);
    const link = document.createElement('a');
    link.setAttribute('data-sw-consent-open', '');
    document.body.appendChild(link);
    link.click();
    expect(root().hasAttribute('data-open')).toBe(true);
  });

  it('window.swConsent.get() reflects the live decision', () => {
    run();
    btn('Accept all').click();
    const api = (window as unknown as { swConsent: { get: () => Record<string, boolean> } }).swConsent;
    expect(api.get()).toEqual({ necessary: true, functional: true, analytics: true, marketing: true });
  });

  it('omits the Reject button when denyButton is false, yet still customizes + saves', () => {
    run({ ...CONFIG, deny: false });
    const hasBtn = (text: string): boolean => Array.from(root().querySelectorAll('button')).some((b) => b.textContent === text);
    expect(hasBtn('Reject all')).toBe(false);
    expect(hasBtn('Accept all')).toBe(true);
    btn('Customize').click();
    boxes()[1]!.checked = true; // functional on
    btn('Save preferences').click();
    expect(stored()).toMatchObject({ cats: { functional: true, analytics: false, marketing: false } });
  });

  it('window.swConsent.set() applies categories programmatically, persists, hides, and broadcasts', () => {
    run();
    const api = (window as unknown as { swConsent: { set: (c: Record<string, boolean>) => void } }).swConsent;
    api.set({ functional: true, analytics: false, marketing: true });
    expect(root().hasAttribute('data-open')).toBe(false);
    expect(stored()).toMatchObject({ cats: { functional: true, analytics: false, marketing: true } });
    expect(lastDetail).toEqual({ necessary: true, functional: true, analytics: false, marketing: true });
  });

  it('renders the title as a NON-heading element (no h1-h6, for SEO)', () => {
    run();
    const title = root().querySelector('.sw-consent-title') as HTMLElement;
    expect(/^H[1-6]$/.test(title.tagName)).toBe(false);
  });

  it('hides the Customize button once the preferences panel opens, and shows Save', () => {
    run();
    const customize = btn('Customize');
    expect(customize.style.display).not.toBe('none');
    customize.click();
    expect(customize.style.display).toBe('none');
    expect(btn('Save preferences').style.display).not.toBe('none');
  });

  it('Accept all / Reject all immediately sync the preference toggles', () => {
    run();
    const optional = (): HTMLInputElement[] => boxes().filter((b) => !b.disabled);
    btn('Customize').click();
    btn('Reject all').click();
    expect(optional().every((b) => !b.checked)).toBe(true);
    btn('Accept all').click();
    expect(optional().every((b) => b.checked)).toBe(true);
  });

  it('re-opens via an <a href="#sw-consent"> anchor', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: false, analytics: false, marketing: false } }));
    run();
    expect(root().hasAttribute('data-open')).toBe(false);
    const a = document.createElement('a');
    a.setAttribute('href', '#sw-consent');
    document.body.appendChild(a);
    a.click();
    expect(root().hasAttribute('data-open')).toBe(true);
    expect(root().getAttribute('data-prefs')).toBe('open');
  });
});

describe('Consent integration injection (jsdom)', () => {
  const INTS = [
    { id: 'ga', cat: 'analytics', kind: 'ga4', mid: 'G-X', src: 'https://www.googletagmanager.com/gtag/js?id=G-X', async: true },
    { id: 'chat', cat: 'functional', kind: 'script', src: 'https://w.example/c.js', async: true },
  ];
  const cfgInts = { ...CONFIG, ints: INTS };
  const injected = (id: string): Element | null => document.querySelector(`script[data-sw-consent-loaded="${id}"]`);

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    Array.from(document.querySelectorAll('[data-sw-consent-loaded]')).forEach((s) => s.remove());
    delete (window as unknown as { dataLayer?: unknown }).dataLayer;
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it('injects NOTHING before the visitor consents (first visit)', () => {
    run(cfgInts);
    expect(injected('ga')).toBeNull();
    expect(injected('chat')).toBeNull();
  });

  it('Accept all → injects every integration and bootstraps gtag (self-origin)', () => {
    run(cfgInts);
    btn('Accept all').click();
    expect(injected('ga')).not.toBeNull();
    expect(injected('chat')).not.toBeNull();
    expect((window as unknown as { dataLayer?: unknown[] }).dataLayer).toBeDefined();
    expect(typeof (window as unknown as { gtag?: unknown }).gtag).toBe('function');
  });

  it('Reject all → injects nothing', () => {
    run(cfgInts);
    btn('Reject all').click();
    expect(injected('ga')).toBeNull();
    expect(injected('chat')).toBeNull();
  });

  it('injects ONLY the integrations whose category was granted (Customize → analytics only)', () => {
    run(cfgInts);
    btn('Customize').click();
    (Array.from(root().querySelectorAll('.sw-consent-cat input')) as HTMLInputElement[])[2]!.checked = true; // analytics
    btn('Save preferences').click();
    expect(injected('ga')).not.toBeNull(); // analytics granted
    expect(injected('chat')).toBeNull(); // functional NOT granted
  });

  it('a returning visitor with stored consent re-injects on load', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: false, analytics: true, marketing: false } }));
    run(cfgInts);
    expect(root().hasAttribute('data-open')).toBe(false);
    expect(injected('ga')).not.toBeNull();
  });

  it('de-dupes — never double-injects when consent is re-applied', () => {
    run(cfgInts);
    btn('Accept all').click();
    (window as unknown as { swConsent: { set: (c: Record<string, boolean>) => void } }).swConsent.set({ functional: true, analytics: true, marketing: true });
    expect(document.querySelectorAll('script[data-sw-consent-loaded="ga"]').length).toBe(1);
  });

  it('a GTM integration injects gtm.js and pushes gtm.start to the dataLayer', () => {
    run({ ...CONFIG, ints: [{ id: 'gtm', cat: 'analytics', kind: 'gtm', mid: 'GTM-XY', src: 'https://www.googletagmanager.com/gtm.js?id=GTM-XY', async: true }] });
    btn('Accept all').click();
    expect(injected('gtm')).not.toBeNull();
    const dl = (window as unknown as { dataLayer?: Array<Record<string, unknown>> }).dataLayer!;
    expect(dl.some((e) => e && e['gtm.start'])).toBe(true);
  });

  it('multiple GA4 ids load gtag.js ONCE but config each id (no double-load)', () => {
    run({
      ...CONFIG,
      ints: [
        { id: 'ga1', cat: 'analytics', kind: 'ga4', mid: 'G-AAA', src: 'https://www.googletagmanager.com/gtag/js?id=G-AAA', async: true },
        { id: 'ga2', cat: 'analytics', kind: 'ga4', mid: 'G-BBB', src: 'https://www.googletagmanager.com/gtag/js?id=G-BBB', async: true },
      ],
    });
    btn('Accept all').click();
    expect(document.querySelectorAll('script[data-sw-consent-loaded]').length).toBe(1); // gtag.js loaded once
    const dl = (window as unknown as { dataLayer?: Array<Record<number, unknown>> }).dataLayer!;
    const configs = dl.filter((a) => a && a[0] === 'config').map((a) => a[1]);
    expect(configs).toEqual(expect.arrayContaining(['G-AAA', 'G-BBB'])); // both ids configured
  });

  it('a custom integration with async=false injects a non-async script', () => {
    run({ ...CONFIG, ints: [{ id: 'sync', cat: 'functional', kind: 'script', src: 'https://w.example/s.js', async: false }] });
    btn('Accept all').click();
    expect((injected('sync') as HTMLScriptElement).async).toBe(false);
  });
});

describe('Consent author-content gating (jsdom)', () => {
  // Mount a consent banner + held author content together, then run the real runtime over it.
  function runWith(bodyHtml: string, cfg: object = CONFIG): void {
    document.body.innerHTML = `<div data-sw-consent></div>${bodyHtml}`;
    document.querySelector('[data-sw-consent]')!.setAttribute('data-sw-consent-config', JSON.stringify(cfg));
    (0, eval)(CONSENT_JS);
  }
  const heldIframe = (): HTMLIFrameElement => document.querySelector('iframe') as HTMLIFrameElement;
  const gateBtn = (text: string): HTMLButtonElement =>
    Array.from(document.querySelectorAll('.sw-gate-ph button')).find((b) => b.textContent === text) as HTMLButtonElement;
  const HELD_MARKETING = '<iframe data-sw-consent-src="https://x.example/v" data-sw-consent-cat="marketing"></iframe>';

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('holds a cross-origin iframe behind an Allow once / Always allow placeholder until consent', () => {
    runWith(HELD_MARKETING);
    const fr = heldIframe();
    expect(fr.getAttribute('src')).toBeNull(); // not loaded
    // The iframe is wrapped + the placeholder OVERLAYS it (at the iframe's exact dimensions), with a skeleton.
    expect(fr.parentElement?.classList.contains('sw-gate-wrap')).toBe(true);
    const ph = document.querySelector('.sw-gate-ph') as HTMLElement;
    expect(ph).not.toBeNull();
    expect(ph.classList.contains('skeleton')).toBe(true);
    expect(fr.parentElement?.contains(ph)).toBe(true); // overlay is a sibling of the iframe inside the wrapper
    expect(document.querySelector('.sw-gate-url')?.textContent).toBe('https://x.example/v'); // URL eyebrow
    expect(gateBtn('Allow once')).toBeTruthy();
    expect(gateBtn('Always allow')).toBeTruthy();
  });

  it('does NOT wrap an already-positioned (responsive) iframe — overlays in the author box instead', () => {
    // The padding-top responsive pattern: the iframe is position:absolute inside the author's own box. A
    // wrapper would collapse, so the placeholder is dropped in as a sibling that fills the same box.
    runWith('<div style="position:relative"><iframe style="position:absolute" data-sw-consent-src="https://x.example/v" data-sw-consent-cat="marketing"></iframe></div>');
    const fr = heldIframe();
    expect(fr.parentElement?.classList.contains('sw-gate-wrap')).toBe(false); // NOT wrapped
    expect(fr.parentElement?.querySelector('.sw-gate-ph')).not.toBeNull(); // overlay is a sibling in the author box
    gateBtn('Allow once').click();
    expect(fr.getAttribute('src')).toBe('https://x.example/v');
    expect(document.querySelector('.sw-gate-ph')).toBeNull(); // overlay removed on load
  });

  it('Allow once loads ONLY this iframe — no category grant, nothing persisted', () => {
    runWith(HELD_MARKETING);
    gateBtn('Allow once').click();
    expect(heldIframe().getAttribute('src')).toBe('https://x.example/v');
    expect(document.querySelector('.sw-gate-ph')).toBeNull();
    expect(stored()).toBeNull();
    expect((window as unknown as { swConsent: { get: () => Record<string, boolean> } }).swConsent.get().marketing).toBe(false);
  });

  it('Always allow grants the category (persists) and loads the iframe', () => {
    runWith(HELD_MARKETING);
    gateBtn('Always allow').click();
    expect(heldIframe().getAttribute('src')).toBe('https://x.example/v');
    expect(stored()).toMatchObject({ cats: { marketing: true } });
  });

  it('loads a held iframe when its category is granted via the banner (consentchange)', () => {
    runWith('<iframe data-sw-consent-src="https://x.example/v" data-sw-consent-cat="analytics"></iframe>');
    expect(heldIframe().getAttribute('src')).toBeNull();
    btn('Accept all').click();
    expect(heldIframe().getAttribute('src')).toBe('https://x.example/v');
  });

  it('loads a held iframe immediately when its category was already consented (returning visitor)', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: false, analytics: false, marketing: true } }));
    runWith(HELD_MARKETING);
    expect(heldIframe().getAttribute('src')).toBe('https://x.example/v');
    expect(document.querySelector('.sw-gate-ph')).toBeNull();
  });

  it('grantAll (preview) loads gated content immediately on init, no placeholder', () => {
    runWith(HELD_MARKETING, { ...CONFIG, grantAll: true });
    expect(heldIframe().getAttribute('src')).toBe('https://x.example/v');
    expect(document.querySelector('.sw-gate-ph')).toBeNull();
  });

  it('activates a gated <script type=text/plain data-sw-consent> only once its category is granted', () => {
    runWith('<script type="text/plain" data-sw-consent="analytics" src="https://cdn.example/a.js"></script>');
    expect(document.querySelector('script[type="text/plain"][data-sw-consent]')).not.toBeNull(); // inert
    btn('Accept all').click(); // grants analytics
    expect(document.querySelector('script[type="text/plain"][data-sw-consent]')).toBeNull(); // replaced
    const active = Array.from(document.querySelectorAll('script')).find((s) => s.getAttribute('src') === 'https://cdn.example/a.js');
    expect(active).toBeTruthy();
    expect(active!.getAttribute('type')).not.toBe('text/plain');
  });

  it('does NOT activate a gated script whose category is rejected', () => {
    runWith('<script type="text/plain" data-sw-consent="analytics" src="https://cdn.example/a.js"></script>');
    btn('Reject all').click();
    expect(document.querySelector('script[type="text/plain"][data-sw-consent]')).not.toBeNull(); // still inert
  });

  it('activates an already-consented gated script on load (returning visitor)', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: false, analytics: true, marketing: false } }));
    runWith('<script type="text/plain" data-sw-consent="analytics" src="https://cdn.example/a.js"></script>');
    expect(document.querySelector('script[type="text/plain"][data-sw-consent]')).toBeNull(); // activated on load
    expect(Array.from(document.querySelectorAll('script')).some((s) => s.getAttribute('src') === 'https://cdn.example/a.js')).toBe(true);
  });

  it('shows ONLY "Allow once" (no "Always allow") when there is no consent banner to grant against', () => {
    // A held iframe but NO [data-sw-consent] mount → "Always allow" would silently degrade, so it is hidden.
    document.body.innerHTML = HELD_MARKETING;
    (0, eval)(CONSENT_JS);
    expect(document.querySelector('.sw-gate-ph')).not.toBeNull();
    expect(gateBtn('Allow once')).toBeTruthy();
    expect(Array.from(document.querySelectorAll('.sw-gate-ph button')).find((b) => b.textContent === 'Always allow')).toBeUndefined();
    gateBtn('Allow once').click();
    expect(heldIframe().getAttribute('src')).toBe('https://x.example/v'); // load-once still works
  });
});

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

  it('UNWRAPS the iframe on load so it regains its authored (fluid) sizing', () => {
    // jsdom's getBoundingClientRect returns 0, so the PIN path (wrap.style.width/height) is not hit here — the
    // Playwright render matrix covers the pin. This test covers only the wrap creation + unwrap-on-load.
    runWith(HELD_MARKETING);
    const fr = heldIframe();
    const wrap = fr.parentElement!;
    expect(wrap.classList.contains('sw-gate-wrap')).toBe(true);
    const originalParent = wrap.parentElement!; // where the iframe lived before wrapping
    gateBtn('Allow once').click();
    expect(fr.getAttribute('src')).toBe('https://x.example/v'); // loaded
    expect(document.querySelector('.sw-gate-wrap')).toBeNull(); // the sizing wrapper is gone
    expect(document.querySelector('.sw-gate-ph')).toBeNull(); // overlay removed
    expect(fr.parentElement).toBe(originalParent); // iframe restored to its original spot (fluid sizing intact)
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
    expect(document.querySelector('.sw-gate-wrap')).toBeNull(); // unwrapped on this load path too
  });

  it('loads a held iframe when its category is granted via the banner (consentchange)', () => {
    runWith('<iframe data-sw-consent-src="https://x.example/v" data-sw-consent-cat="analytics"></iframe>');
    expect(heldIframe().getAttribute('src')).toBeNull();
    btn('Accept all').click();
    expect(heldIframe().getAttribute('src')).toBe('https://x.example/v');
    expect(document.querySelector('.sw-gate-wrap')).toBeNull(); // unwrapped on the consentchange load path too
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

describe('Consent runtime — analytics hygiene (jsdom)', () => {
  type Win = { dataLayer?: unknown[]; gtag?: unknown; swConsent: { set: (c: Record<string, boolean>) => void } };
  const win = (): Win => window as unknown as Win;
  const GA = { id: 'ga', cat: 'analytics', kind: 'ga4', mid: 'G-X', src: 'https://www.googletagmanager.com/gtag/js?id=G-X', async: true };
  const injected = (id: string): Element | null => document.querySelector(`script[data-sw-consent-loaded="${id}"]`);
  function runWith(bodyHtml: string, cfg: object): void {
    document.body.innerHTML = `<div data-sw-consent></div>${bodyHtml}`;
    document.querySelector('[data-sw-consent]')!.setAttribute('data-sw-consent-config', JSON.stringify(cfg));
    (0, eval)(CONSENT_JS);
  }
  /** The gtag consent commands pushed so far, as [command, params] pairs. */
  const consentCalls = (): Array<[string, Record<string, string>]> =>
    (win().dataLayer ?? [])
      .map((a) => a as unknown as ArrayLike<unknown>)
      .filter((a) => a && a[0] === 'consent')
      .map((a) => [a[1] as string, a[2] as Record<string, string>]);
  const clearCookies = (): void => {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0]!.trim();
      if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  };
  type Revoked = { cats: string[]; reload: boolean; storedAtEvent: unknown };
  let revoked: Revoked[] = [];
  const onRevoked = (e: Event): void => {
    const d = (e as CustomEvent).detail as { cats: string[]; reload: boolean };
    revoked.push({ ...d, storedAtEvent: stored()?.cats });
    e.preventDefault(); // jsdom cannot navigate; detail.reload says whether the runtime would have reloaded
  };

  beforeEach(() => {
    localStorage.clear();
    clearCookies();
    document.body.innerHTML = '';
    Array.from(document.querySelectorAll('[data-sw-consent-loaded]')).forEach((s) => s.remove());
    delete win().dataLayer;
    delete win().gtag;
    revoked = [];
    window.removeEventListener('sw:consentrevoked', onRevoked);
    window.addEventListener('sw:consentrevoked', onRevoked);
  });

  it('★ a gated script keeps the attributes its vendor reads (data-domain, data-website-id…), but not the gate', () => {
    runWith(
      '<script type="text/plain" data-sw-consent="analytics" defer async data-domain="example.com" data-website-id="abc" data-sw-note="x" integrity="sha384-x" referrerpolicy="no-referrer" src="https://plausible.io/js/script.js"></script>',
      CONFIG,
    );
    btn('Accept all').click();
    const live = Array.from(document.querySelectorAll('script')).find((s) => s.getAttribute('src') === 'https://plausible.io/js/script.js')!;
    expect(live).toBeTruthy();
    expect(live.getAttribute('data-domain')).toBe('example.com');
    expect(live.getAttribute('data-website-id')).toBe('abc');
    expect(live.getAttribute('integrity')).toBe('sha384-x');
    expect(live.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(live.hasAttribute('defer')).toBe(true);
    expect(live.hasAttribute('async')).toBe(true);
    // The gate's own markers and the inert type must not survive, or the script would never run.
    expect(live.getAttribute('type')).toBeNull();
    expect(live.getAttribute('data-sw-consent')).toBeNull();
    expect(live.getAttribute('data-sw-note')).toBeNull();
  });

  it('★ GA4 gets Google Consent Mode v2: everything denied by default, then the visitor’s choice, before the tag runs', () => {
    run({ ...CONFIG, ints: [GA] });
    btn('Customize').click();
    boxes()[2]!.checked = true; // analytics only
    btn('Save preferences').click();
    expect(injected('ga')).not.toBeNull();

    const dl = (win().dataLayer ?? []) as unknown as Array<ArrayLike<unknown>>;
    const idx = (cmd: string): number => dl.findIndex((a) => a && a[0] === cmd);
    expect(idx('consent')).toBeGreaterThanOrEqual(0);
    expect(idx('consent')).toBeLessThan(idx('js')); // consent state precedes gtag('js') and config
    expect(idx('consent')).toBeLessThan(idx('config'));
    const [[cmd0, def], [cmd1, upd]] = consentCalls() as [[string, Record<string, string>], [string, Record<string, string>]];
    expect(cmd0).toBe('default');
    for (const k of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage', 'functionality_storage', 'personalization_storage'])
      expect(def[k], k).toBe('denied');
    expect(cmd1).toBe('update');
    expect(upd).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', functionality_storage: 'denied' });
  });

  it('Tag Manager gets the consent default BEFORE the container starts', () => {
    run({ ...CONFIG, ints: [{ id: 'gtm', cat: 'analytics', kind: 'gtm', mid: 'GTM-XY', src: 'https://www.googletagmanager.com/gtm.js?id=GTM-XY', async: true }] });
    btn('Accept all').click();
    const dl = (win().dataLayer ?? []) as unknown as Array<Record<string, unknown> & ArrayLike<unknown>>;
    const consentAt = dl.findIndex((a) => a && a[0] === 'consent');
    const startAt = dl.findIndex((a) => a && a['gtm.start']);
    expect(consentAt).toBeGreaterThanOrEqual(0);
    expect(consentAt).toBeLessThan(startAt);
    expect(consentCalls().at(-1)).toEqual(['update', expect.objectContaining({ analytics_storage: 'granted', ad_storage: 'granted' })]);
  });

  it('★ withdrawing analytics tells Google at once, deletes its cookies, and reloads the page', () => {
    run({ ...CONFIG, ints: [GA] });
    btn('Accept all').click();
    document.cookie = '_ga=GA1.1.1; path=/';
    document.cookie = '_ga_ABC123=GS1.1; path=/';
    document.cookie = '_gid=GA1.1.2; path=/';
    document.cookie = 'site_pref=dark; path=/';

    win().swConsent.set({ functional: true, analytics: false, marketing: true });

    expect(consentCalls().at(-1)).toEqual(['update', expect.objectContaining({ analytics_storage: 'denied', ad_storage: 'granted' })]);
    expect(document.cookie).not.toMatch(/(^|; )_ga=/);
    expect(document.cookie).not.toMatch(/_ga_ABC123=/);
    expect(document.cookie).not.toMatch(/_gid=/);
    expect(document.cookie).toMatch(/site_pref=dark/); // only the tracker's own cookies go
    // The tag already ran on this page and cannot be unloaded, so the runtime reloads (cancelable for authors),
    // and the withdrawal is already stored when it does: the reloaded page must not run the tag again.
    expect(revoked).toEqual([{ cats: ['analytics'], reload: true, storedAtEvent: { functional: true, analytics: false, marketing: true } }]);
  });

  it('withdrawing a category that loaded nothing on this page does not reload', () => {
    run({ ...CONFIG, ints: [GA] });
    btn('Customize').click();
    boxes()[1]!.checked = true; // functional only — nothing of ours runs
    btn('Save preferences').click();
    win().swConsent.set({ functional: false, analytics: false, marketing: false });
    expect(revoked).toEqual([expect.objectContaining({ cats: ['functional'], reload: false })]);
  });

  it('★ deletes a withdrawn category’s tracker cookies even when nothing ran on this page, and only those', () => {
    run(CONFIG);
    btn('Accept all').click();
    for (const c of ['_ga=1', '_ga_ABC=1', '_gat_UA-1=1', '__utma=1', '_gcl_au=1', '_gather_session=keep', '_gate=keep', '_gallery=keep'])
      document.cookie = `${c}; path=/`;
    win().swConsent.set({ functional: true, analytics: false, marketing: true });
    // Cookies from an earlier page of the visit are as much the tracker's as this page's.
    for (const gone of ['_ga=', '_ga_ABC=', '_gat_UA-1=', '__utma=']) expect(document.cookie).not.toContain(gone);
    for (const kept of ['_gather_session=keep', '_gate=keep', '_gallery=keep', '_gcl_au=1']) expect(document.cookie).toContain(kept);
    win().swConsent.set({ functional: true, analytics: false, marketing: false });
    expect(document.cookie).not.toContain('_gcl_au=');
  });

  it('★ does not reload while a form on the page holds unsaved input', () => {
    runWith('<form><input name="email" value=""></form>', { ...CONFIG, ints: [GA] });
    btn('Accept all').click();
    (document.querySelector('input[name="email"]') as HTMLInputElement).value = 'half typed';
    win().swConsent.set({ functional: true, analytics: false, marketing: true });
    expect(revoked).toEqual([expect.objectContaining({ cats: ['analytics'], reload: false })]);
    // The banner's own toggles changing is not "unsaved input".
  });

  it('★ only allow-listed attributes are copied, and an attribute setAttribute rejects does not cost the script', () => {
    runWith(
      [
        '<script type="text/plain" data-sw-consent="analytics" TYPE="module" onload="x()" ONERROR="y()" DATA-SW-X="1" @click="z" :class="w" data-ok="1" src="https://a.example/a.js"></script>',
        '<script type="text/plain" data-sw-consent="analytics" src="https://b.example/b.js"></script>',
      ].join(''),
      CONFIG,
    );
    btn('Accept all').click();
    const a = Array.from(document.querySelectorAll('script')).find((s) => s.getAttribute('src') === 'https://a.example/a.js')!;
    const b = Array.from(document.querySelectorAll('script')).find((s) => s.getAttribute('src') === 'https://b.example/b.js')!;
    expect(a && b).toBeTruthy(); // both released — the odd names did not abort anything
    expect(a.getAttribute('data-ok')).toBe('1');
    for (const n of ['type', 'onload', 'onerror', 'data-sw-x', '@click', ':class']) expect(a.hasAttribute(n), n).toBe(false);
  });

  it('GA4 and Tag Manager together get ONE consent default, and gtag(js) runs once', () => {
    run({
      ...CONFIG,
      ints: [
        GA,
        { id: 'ga2', cat: 'analytics', kind: 'ga4', mid: 'G-Z', src: 'https://www.googletagmanager.com/gtag/js?id=G-Z', async: true },
        { id: 'gtm', cat: 'marketing', kind: 'gtm', mid: 'GTM-XY', src: 'https://www.googletagmanager.com/gtm.js?id=GTM-XY', async: true },
      ],
    });
    btn('Accept all').click();
    expect(consentCalls().filter(([c]) => c === 'default')).toHaveLength(1);
    const dl = (win().dataLayer ?? []) as unknown as Array<ArrayLike<unknown>>;
    expect(dl.filter((a) => a && a[0] === 'js')).toHaveLength(1);
  });
});

describe('★ consent runtime — cookieless integrations alongside the banner (jsdom)', () => {
  const injected = (id: string): Element | null => document.querySelector(`script[data-sw-consent-loaded="${id}"]`);
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    Array.from(document.querySelectorAll('[data-sw-consent-loaded]')).forEach((s) => s.remove());
  });

  it('loads a cookieless integration before any choice, while a gated one waits for consent', () => {
    run({
      ...CONFIG,
      ints: [
        { id: 'fa', cat: 'analytics', kind: 'script', src: 'https://cdn.usefathom.com/script.js', async: true, attrs: { 'data-site': 'ABCD' }, free: true, ana: true },
        { id: 'chat', cat: 'functional', kind: 'script', src: 'https://w.example/c.js', async: true },
      ],
    });
    expect(root().hasAttribute('data-open')).toBe(true); // the banner still asks
    expect(injected('fa')!.getAttribute('data-site')).toBe('ABCD');
    expect(injected('chat')).toBeNull();
    btn('Reject all').click();
    expect(injected('chat')).toBeNull();
    expect(injected('fa')).not.toBeNull(); // rejecting does not unload a script that needs no consent
  });

  it('a Matomo that waits for consent keeps its cookies (no disableCookies)', () => {
    delete (window as unknown as { _paq?: unknown })._paq;
    run({ ...CONFIG, ints: [{ id: 'mt', cat: 'analytics', kind: 'matomo', mid: '7', src: 'https://s.example.com/matomo.js', track: 'https://s.example.com/matomo.php', async: true, ana: true }] });
    expect(injected('mt')).toBeNull(); // waits
    btn('Accept all').click();
    const q = (window as unknown as { _paq: unknown[][] })._paq;
    expect(q.map((c) => c[0])).toEqual(['trackPageView', 'enableLinkTracking', 'setTrackerUrl', 'setSiteId']);
  });
});


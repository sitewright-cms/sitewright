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
    expect(root().hasAttribute('hidden')).toBe(false);
    expect(root().getAttribute('data-sw-enhanced')).toBe('true');
    expect(boxes()[0]!.disabled).toBe(true); // necessary is always-on
    expect(boxes()[0]!.checked).toBe(true);
  });

  it('Accept all → stores all categories, hides the banner, and broadcasts (necessary always true)', () => {
    run();
    btn('Accept all').click();
    expect(root().hasAttribute('hidden')).toBe(true);
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
    expect(root().hasAttribute('hidden')).toBe(true);
    expect(lastDetail).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
  });

  it('bumping the consent version re-prompts a previously-consented visitor', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: true, analytics: true, marketing: true } }));
    run({ ...CONFIG, v: 2 });
    expect(root().hasAttribute('hidden')).toBe(false); // stored v1 < config v2 → ask again
  });

  it('re-opens preferences via window.swConsent.open() and a [data-sw-consent-open] trigger', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, cats: { functional: false, analytics: false, marketing: false } }));
    run();
    expect(root().hasAttribute('hidden')).toBe(true);
    (window as unknown as { swConsent: { open: () => void } }).swConsent.open();
    expect(root().hasAttribute('hidden')).toBe(false);
    expect(root().getAttribute('data-prefs')).toBe('open');
    // and via the delegated click trigger
    btn('Accept all').click(); // hide again
    expect(root().hasAttribute('hidden')).toBe(true);
    const link = document.createElement('a');
    link.setAttribute('data-sw-consent-open', '');
    document.body.appendChild(link);
    link.click();
    expect(root().hasAttribute('hidden')).toBe(false);
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
    expect(root().hasAttribute('hidden')).toBe(true);
    expect(stored()).toMatchObject({ cats: { functional: true, analytics: false, marketing: true } });
    expect(lastDetail).toEqual({ necessary: true, functional: true, analytics: false, marketing: true });
  });
});

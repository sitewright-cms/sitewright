// @vitest-environment jsdom
/// <reference lib="dom" />
import { it, expect } from 'vitest';
import { CONSENT_JS } from '../src/consent.js';

// ONE test in its own file on purpose: every evaluation of the runtime leaves a window 'sw:consentchange'
// listener behind, and in a shared file an earlier run's listener releases this page's gated script first, so
// this run never sees its own code run. A real page evaluates the runtime once.
it('a released gated script counts as code that ran, so withdrawing a STORED grant reloads', () => {
  const key = `sw-consent:${location.pathname || '/'}`;
  // A returning visitor: the grant is stored, so the script is released at start-up, and they withdraw it.
  localStorage.setItem(key, JSON.stringify({ v: 1, cats: { functional: true, analytics: true, marketing: true } }));
  const fired: Array<{ cats: string[]; reload: boolean }> = [];
  window.addEventListener('sw:consentrevoked', (e) => {
    fired.push((e as CustomEvent).detail as { cats: string[]; reload: boolean });
    e.preventDefault(); // jsdom cannot navigate; detail.reload says whether the runtime would have
  });
  document.body.innerHTML = '<div data-sw-consent></div><script type="text/plain" data-sw-consent="marketing" src="https://px.example/p.js"></script>';
  document.querySelector('[data-sw-consent]')!.setAttribute(
    'data-sw-consent-config',
    JSON.stringify({ v: 1, cats: [{ id: 'functional' }, { id: 'analytics' }, { id: 'marketing' }], t: {} }),
  );
  (0, eval)(CONSENT_JS);
  expect(document.querySelector('script[type="text/plain"]')).toBeNull(); // released on load

  (window as unknown as { swConsent: { set: (c: Record<string, boolean>) => void } }).swConsent.set({ functional: true, analytics: true, marketing: false });

  expect(fired).toEqual([{ cats: ['marketing'], reload: true }]);
  // The withdrawal is stored before the reload, so the reloaded page does not release the script again.
  expect(JSON.parse(localStorage.getItem(key)!).cats.marketing).toBe(false);
});

// @vitest-environment jsdom
/// <reference lib="dom" />
import { it, expect } from 'vitest';
import { CONSENT_JS } from '../src/consent.js';

// One runtime per file (see consent.withdraw.test.ts for why).
it('withdrawing analytics does not reload for a cookieless tool that needs no consent', () => {
  const fired: Array<{ cats: string[]; reload: boolean }> = [];
  window.addEventListener('sw:consentrevoked', (e) => {
    fired.push((e as CustomEvent).detail as { cats: string[]; reload: boolean });
    e.preventDefault();
  });
  document.body.innerHTML = '<div data-sw-consent></div>';
  document.querySelector('[data-sw-consent]')!.setAttribute(
    'data-sw-consent-config',
    JSON.stringify({
      v: 1,
      cats: [{ id: 'functional' }, { id: 'analytics' }, { id: 'marketing' }],
      t: {},
      ints: [{ id: 'fa', cat: 'analytics', kind: 'script', src: 'https://cdn.usefathom.com/script.js', async: true, attrs: { 'data-site': 'ABCD' }, free: true, ana: true }],
    }),
  );
  (0, eval)(CONSENT_JS);
  const sw = (window as unknown as { swConsent: { set: (c: Record<string, boolean>) => void } }).swConsent;
  sw.set({ functional: true, analytics: true, marketing: true });
  sw.set({ functional: true, analytics: false, marketing: true });
  // The tool is still allowed after the withdrawal, so a reload would only load it again.
  expect(fired).toEqual([{ cats: ['analytics'], reload: false }]);
});

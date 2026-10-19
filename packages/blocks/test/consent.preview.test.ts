// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect } from 'vitest';
import { CONSENT_JS } from '../src/consent.js';

// Its own file on purpose: every evaluation of the runtime leaves a window 'sw:consentchange' listener behind,
// and in a shared file the listeners of earlier (non-preview) runs would activate this page's held scripts.
// A real page evaluates the runtime once.
const CONFIG = {
  v: 1,
  cats: [
    { id: 'functional', label: 'Functional' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'marketing', label: 'Marketing' },
  ],
  t: {},
};
const GA = { id: 'ga', cat: 'analytics', kind: 'ga4', mid: 'G-X', src: 'https://www.googletagmanager.com/gtag/js?id=G-X', async: true };
const injected = (id: string): Element | null => document.querySelector(`script[data-sw-consent-loaded="${id}"]`);
function runWith(bodyHtml: string, cfg: object): void {
  document.body.innerHTML = `<div data-sw-consent></div>${bodyHtml}`;
  document.querySelector('[data-sw-consent]')!.setAttribute('data-sw-consent-config', JSON.stringify(cfg));
  (0, eval)(CONSENT_JS);
}

describe('Consent runtime in the editor preview (jsdom)', () => {
  it('★ the preview (grantAll) loads embeds and functional widgets, but never analytics or marketing code', () => {
    runWith(
      [
        '<iframe data-sw-consent-src="https://x.example/v" data-sw-consent-cat="marketing"></iframe>',
        '<script type="text/plain" data-sw-consent="analytics" src="https://cdn.example/a.js"></script>',
        '<script type="text/plain" data-sw-consent="functional" src="https://cdn.example/f.js"></script>',
      ].join(''),
      {
        ...CONFIG,
        grantAll: true,
        ints: [
          GA,
          { id: 'ga-func', cat: 'functional', kind: 'ga4', mid: 'G-Y', src: 'https://www.googletagmanager.com/gtag/js?id=G-Y', async: true },
          { id: 'pixel', cat: 'marketing', kind: 'script', src: 'https://px.example/p.js', async: true },
          { id: 'chat', cat: 'functional', kind: 'script', src: 'https://w.example/c.js', async: true },
        ],
      },
    );
    // The owner's own previews must not count as visits: no analytics, no marketing, no Google tag in any category.
    expect(injected('ga')).toBeNull();
    expect(injected('ga-func')).toBeNull();
    expect(injected('pixel')).toBeNull();
    expect(document.querySelector('script[type="text/plain"][data-sw-consent="analytics"]')).not.toBeNull();
    // What the page LOOKS like still renders.
    expect(injected('chat')).not.toBeNull();
    expect(document.querySelector('script[type="text/plain"][data-sw-consent="functional"]')).toBeNull();
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toBe('https://x.example/v');
  });


  it('changing the choice in the preview sends no consent signal and never reloads', () => {
    const fired: unknown[] = [];
    window.addEventListener('sw:consentrevoked', (e) => fired.push((e as CustomEvent).detail));
    runWith('', { ...CONFIG, grantAll: true, ints: [GA] });
    (window as unknown as { swConsent: { set: (c: Record<string, boolean>) => void } }).swConsent.set({ functional: false, analytics: false, marketing: false });
    expect((window as unknown as { dataLayer?: unknown[] }).dataLayer).toBeUndefined();
    expect(fired).toEqual([]);
  });
});

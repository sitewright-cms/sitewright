// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CONSENT_JS } from '../src/consent.js';

// Its own file: these assert that no window.swConsent exists, and every evaluation of the runtime in a shared
// file leaves globals and window listeners behind.
const injected = (id: string): HTMLScriptElement | null => document.querySelector(`script[data-sw-consent-loaded="${id}"]`);
function mount(cfg: object, bodyHtml = ''): void {
  document.body.innerHTML = `<div data-sw-consent></div>${bodyHtml}`;
  document.querySelector('[data-sw-consent]')!.setAttribute('data-sw-consent-config', JSON.stringify(cfg));
  (0, eval)(CONSENT_JS);
}
type W = { plausible?: { o?: unknown; init?: unknown }; _paq?: unknown[][]; swConsent?: unknown };
const w = (): W => window as unknown as W;

describe('★ the consent runtime with NO banner: cookieless integrations only', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.querySelectorAll('[data-sw-consent-loaded]').forEach((s) => s.remove());
    delete w().plausible;
    delete w()._paq;
  });

  it('loads a cookieless integration at once, shows no banner, and offers no consent API', () => {
    mount({
      nobanner: 1,
      ints: [
        { id: 'pl', cat: 'analytics', kind: 'plausible', src: 'https://plausible.io/js/pa-AbC123.js', async: true, free: true, ana: true },
        { id: 'um', cat: 'analytics', kind: 'script', src: 'https://cloud.umami.is/script.js', async: true, attrs: { 'data-website-id': 'abc' }, free: true, ana: true },
      ],
    });
    expect(injected('pl')).not.toBeNull();
    // Plausible's per-site script starts only once plausible.init() has run: the runtime runs its stub first.
    expect(w().plausible?.o).toEqual({});
    expect(injected('um')!.getAttribute('data-website-id')).toBe('abc');
    expect(document.querySelectorAll('[data-sw-consent] button')).toHaveLength(0);
    expect(w().swConsent).toBeUndefined();
    expect(document.querySelector('[data-sw-consent]')!.getAttribute('data-sw-enhanced')).toBe('nobanner'); // never 'true': stays display:none
  });

  it('a cookieless Matomo queues its commands with cookies switched off', () => {
    mount({
      nobanner: 1,
      ints: [{ id: 'mt', cat: 'analytics', kind: 'matomo', mid: '7', src: 'https://s.example.com/matomo.js', track: 'https://s.example.com/matomo.php', async: true, free: true, nocookie: true, ana: true }],
    });
    expect(injected('mt')!.getAttribute('src')).toBe('https://s.example.com/matomo.js');
    expect(w()._paq).toEqual([['disableCookies'], ['trackPageView'], ['enableLinkTracking'], ['setTrackerUrl', 'https://s.example.com/matomo.php'], ['setSiteId', '7']]);
  });

  it('never loads an analytics preset in the preview, even a cookieless one filed under "functional"', () => {
    mount({
      nobanner: 1,
      grantAll: true,
      ints: [{ id: 'fa', cat: 'functional', kind: 'script', src: 'https://cdn.usefathom.com/script.js', async: true, attrs: { 'data-site': 'ABCD' }, free: true, ana: true }],
    });
    expect(injected('fa')).toBeNull();
  });

  it('runs Plausible’s plausible.init() BEFORE its script is added, the order its tracker requires', () => {
    let initDoneAtInsert: unknown = 'not inserted';
    const spy = vi.spyOn(document.head, 'appendChild').mockImplementation(function (this: HTMLElement, node: Node) {
      if ((node as Element).getAttribute?.('data-sw-consent-loaded') === 'pl') initDoneAtInsert = w().plausible?.o;
      return HTMLElement.prototype.appendChild.call(this, node);
    } as never);
    try {
      mount({ nobanner: 1, ints: [{ id: 'pl', cat: 'analytics', kind: 'plausible', src: 'https://plausible.io/js/pa-AbC123.js', async: true, free: true, ana: true }] });
    } finally {
      spy.mockRestore();
    }
    expect(initDoneAtInsert).toEqual({});
  });
});


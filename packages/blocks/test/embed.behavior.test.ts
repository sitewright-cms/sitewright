// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { EMBED_JS } from '../src/embed.js';

// Behavioral coverage: run the real shipped runtime in a DOM and assert the click-to-load / consent gating.
function mount(attrs: string): void {
  document.body.innerHTML = `<div data-sw-component="embed" ${attrs}></div>`;
  (0, eval)(EMBED_JS);
}
const root = (): HTMLElement => document.querySelector('[data-sw-component="embed"]') as HTMLElement;
const iframe = (): HTMLIFrameElement | null => root().querySelector('iframe');
const ph = (): Element | null => root().querySelector('.sw-embed-ph');
const clickBtn = (re: RegExp): void => (Array.from(root().querySelectorAll('button')).find((b) => re.test(b.textContent || ''))! as HTMLButtonElement).click();

const YT = 'data-embed-src="https://www.youtube-nocookie.com/embed/x" data-embed-category="marketing" data-embed-provider="YouTube"';

describe('Embed runtime (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as { swConsent?: unknown }).swConsent;
  });

  it('shows a placeholder (not the iframe) and no "Always allow" when there is no consent manager', () => {
    mount(YT);
    expect(iframe()).toBeNull();
    expect(ph()).not.toBeNull();
    expect(root().textContent).not.toContain('Always allow');
  });

  it('clicking Load injects the iframe with the held src and removes the placeholder', () => {
    mount(YT);
    clickBtn(/Load/);
    expect(iframe()).not.toBeNull();
    expect(iframe()!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/x');
    expect(ph()).toBeNull();
  });

  it('auto-loads when the category is already consented', () => {
    (window as unknown as { swConsent: unknown }).swConsent = { get: () => ({ necessary: true, marketing: true }), set: () => {} };
    mount(YT);
    expect(iframe()).not.toBeNull();
  });

  it('loads on sw:consentchange once its category is granted', () => {
    (window as unknown as { swConsent: unknown }).swConsent = { get: () => ({ necessary: true, marketing: false }), set: () => {} };
    mount(YT);
    expect(iframe()).toBeNull();
    window.dispatchEvent(new CustomEvent('sw:consentchange', { detail: { marketing: true } }));
    expect(iframe()).not.toBeNull();
  });

  it('"Always allow" (shown when a consent manager mount is present) grants the category AND loads', () => {
    let setArg: Record<string, boolean> | null = null;
    (window as unknown as { swConsent: unknown }).swConsent = {
      get: () => ({ necessary: true, marketing: false }),
      set: (c: Record<string, boolean>) => {
        setArg = c;
        window.dispatchEvent(new CustomEvent('sw:consentchange', { detail: c }));
      },
    };
    // The consent banner mount is present (it's on every page when consent is enabled) even though consent.js
    // hasn't set window.swConsent yet at enhance time — the button must still render.
    document.body.innerHTML = `<div data-sw-consent></div><div data-sw-component="embed" ${YT}></div>`;
    (0, eval)(EMBED_JS);
    expect(root().textContent).toContain('Always allow');
    clickBtn(/Always allow/);
    expect(setArg).toMatchObject({ marketing: true });
    expect(iframe()).not.toBeNull(); // set → sw:consentchange → the embed loads
  });

  it('a Google Maps embed (functional) shows a placeholder and loads its src on click', () => {
    document.body.innerHTML = '<div data-sw-component="embed" data-embed-src="https://www.google.com/maps?q=x&output=embed" data-embed-category="functional" data-embed-provider="Google Maps"></div>';
    (0, eval)(EMBED_JS);
    expect(ph()).not.toBeNull();
    clickBtn(/Load/);
    expect(iframe()!.getAttribute('src')).toBe('https://www.google.com/maps?q=x&output=embed');
  });

  it('sets the poster as a CSS background-image on the placeholder', () => {
    mount(`${YT} data-embed-poster="https://i.ytimg.com/vi/x/hqdefault.jpg"`);
    expect((ph() as HTMLElement).style.backgroundImage).toContain('i.ytimg.com');
  });
});

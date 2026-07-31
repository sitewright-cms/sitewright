// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { STICKY_HEADER_JS } from '../src/sticky-header.js';

// Behavioral coverage for the runtime's GENERIC anchor-rest sync (string-contains assertions can't
// prove the forced-measure ordering): run the REAL shipped runtime in a DOM with a stubbed #main-nav
// whose measured height depends on the html.sw-scrolled state — 76px full, 52px condensed. That
// collapse is now AUTHOR CSS rather than a built-in mode, which is exactly what the sync has to
// measure: it forces the class and reads whatever the author's own rules produce.
const FULL = 76;
const SHRUNK = 52;

function mount(bodyClass: string, opts: { preScrolled?: boolean } = {}): HTMLElement {
  document.body.className = bodyClass;
  document.body.innerHTML = '<nav id="main-nav"><div class="navbar"></div></nav><main></main>';
  document.documentElement.className = opts.preScrolled ? 'sw-scrolled' : '';
  document.documentElement.style.scrollPaddingTop = '';
  document.body.style.scrollPaddingTop = '';
  const nav = document.getElementById('main-nav') as HTMLElement;
  // jsdom has no layout — the stub returns the height the CSS would produce for the current state.
  nav.getBoundingClientRect = () =>
    ({ height: document.documentElement.classList.contains('sw-scrolled') ? SHRUNK : FULL, top: 0, left: 0, right: 0, bottom: 0, width: 1200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return nav;
}

const run = (): void => {
  (0, eval)(STICKY_HEADER_JS);
};

describe('Sticky-header runtime behavior (jsdom) — generic anchor-rest sync', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.className = '';
    document.documentElement.style.scrollPaddingTop = '';
    document.body.style.scrollPaddingTop = '';
  });

  it('pins scroll-padding-top (root AND body) to the SHRUNK bar height at init, leaving no state classes behind', () => {
    mount('sw-header-pinned');
    run();
    expect(document.documentElement.style.scrollPaddingTop).toBe(`${SHRUNK}px`);
    expect(document.body.style.scrollPaddingTop).toBe(`${SHRUNK}px`);
    // the forced-measure toggle must fully unwind (no leaked sw-measure/sw-scrolled at rest)
    expect(document.documentElement.classList.contains('sw-measure')).toBe(false);
    expect(document.documentElement.classList.contains('sw-scrolled')).toBe(false);
  });

  it('measures directly (no forced toggle) when the page initializes ALREADY scrolled', () => {
    mount('sw-header-pinned', { preScrolled: true });
    const addSpy = vi.spyOn(document.documentElement.classList, 'add');
    run();
    expect(document.documentElement.style.scrollPaddingTop).toBe(`${SHRUNK}px`);
    expect(addSpy.mock.calls.flat()).not.toContain('sw-measure');
    // NOTE: update() then re-derives sw-scrolled from the (jsdom, y=0) scroll position and clears it —
    // the sync itself must still have used the direct-measure path above.
  });

  it('re-syncs on resize (rAF-throttled path runs measure + sync + update)', () => {
    const nav = mount('sw-header-pinned');
    run();
    expect(document.documentElement.style.scrollPaddingTop).toBe(`${SHRUNK}px`);
    // the bar grows (breakpoint change) — the stub now reports new heights
    nav.getBoundingClientRect = () =>
      ({ height: document.documentElement.classList.contains('sw-scrolled') ? 60 : 90, top: 0, left: 0, right: 0, bottom: 0, width: 1200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.scrollPaddingTop).toBe('60px');
    expect(document.documentElement.classList.contains('sw-measure')).toBe(false);
  });

  it('pins for EVERY positional mode; skips a static header and a missing #main-nav', () => {
    // hide-on-scroll pins too now — the sync is generic. Harmless where the bar keeps its height (it
    // measures the same value twice) and strictly better than the hardcoded token, since it uses the
    // bar's REAL measured height.
    mount('sw-header-hide-on-scroll');
    run();
    expect(document.documentElement.style.scrollPaddingTop).toBe('52px');
    // A STATIC header emits no sw-header-* class: nothing overlays content, so nothing to offset.
    mount('');
    run();
    expect(document.documentElement.style.scrollPaddingTop).toBe('');
    // …and with no #main-nav there is nothing to measure.
    document.body.className = 'sw-header-pinned';
    document.body.innerHTML = '<main></main>';
    run();
    expect(document.documentElement.style.scrollPaddingTop).toBe('');
  });
});

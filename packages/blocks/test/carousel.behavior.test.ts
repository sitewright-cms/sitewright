// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CAROUSEL_RUNTIME_JS } from '../src/vendor/carousel-runtime.js';

// Behavioral coverage for the CLS guard: run the REAL shipped runtime string in a DOM and assert the
// track is hidden across enhancement and reliably revealed. String-contains checks can't prove the
// reveal actually fires. The IIFE binds on document.readyState ('complete' under jsdom) → enhances
// synchronously on eval. Embla reads layout (all zero in jsdom) but enhances structurally regardless.
function mountAndRun(html: string): void {
  document.body.innerHTML = `<div data-sw-block="Carousel" data-sw-component="carousel" aria-label="Test">${html}</div>`;
  // Indirect eval of our own trusted build-output constant (not user input), exactly as the page's
  // <script> would run it.
  (0, eval)(CAROUSEL_RUNTIME_JS);
}

const twoSlides =
  '<div data-sw-part="track">' +
  '<div data-sw-part="slide">A</div>' +
  '<div data-sw-part="slide">B</div>' +
  '</div>';

const root = (): HTMLElement => document.querySelector('[data-sw-block="Carousel"]') as HTMLElement;
const track = (): HTMLElement => root().querySelector('[data-sw-part="track"]') as HTMLElement;

describe('Carousel runtime CLS guard (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom lacks the browser APIs Embla touches at init (layout is all-zero here anyway — we assert
    // the runtime's structural behaviour, not geometry). Inert ResizeObserver + matchMedia + a real
    // rAF (fake timers below drive it) so enhancement runs end-to-end.
    const g = globalThis as unknown as Record<string, unknown>;
    class InertObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    }
    g.ResizeObserver = InertObserver;
    g.IntersectionObserver = InertObserver;
    if (!g.requestAnimationFrame) g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    if (!g.cancelAnimationFrame) g.cancelAnimationFrame = (id: number) => clearTimeout(id);
    if (!g.DOMMatrix) g.DOMMatrix = class { m41 = 0; m42 = 0; constructor(_?: string) {} };
    if (!window.matchMedia) window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hides the carousel across enhancement, then reveals it', () => {
    vi.useFakeTimers();
    mountAndRun(twoSlides);
    // Enhanced synchronously; the carousel is hidden while the engine settles.
    expect(root().getAttribute('data-sw-enhanced')).toBe('true');
    expect(root().style.visibility).toBe('hidden');
    // The rAF chain + the timeout fallback both reveal it — advancing timers past both flushes it.
    vi.advanceTimersByTime(400);
    expect(root().style.visibility).toBe('');
  });

  it('the timeout fallback reveals the carousel even if rAF never fires', () => {
    // Fake ONLY timers (leave rAF unfaked so it does not run) — proves the setTimeout backstop alone
    // clears the hidden state, so a starved rAF can never leave a carousel permanently invisible.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0 as unknown as number);
    vi.useFakeTimers();
    mountAndRun(twoSlides);
    expect(root().style.visibility).toBe('hidden');
    vi.advanceTimersByTime(300);
    expect(root().style.visibility).toBe('');
    raf.mockRestore();
  });

  it('leaves a single-slide carousel untouched (no enhancement, never hidden)', () => {
    mountAndRun('<div data-sw-part="track"><div data-sw-part="slide">only</div></div>');
    expect(root().getAttribute('data-sw-enhanced')).toBeNull();
    expect(root().style.visibility).toBe('');
  });

  it('stamps data-sw-multi when --sw-items > 1 (peek/multi) so the CSS shows compact circle arrows', () => {
    document.body.innerHTML = `<div data-sw-block="Carousel" data-sw-component="carousel" aria-label="Test" style="--sw-items:2">${twoSlides}</div>`;
    (0, eval)(CAROUSEL_RUNTIME_JS);
    expect(root().getAttribute('data-sw-enhanced')).toBe('true');
    expect(root().getAttribute('data-sw-multi')).toBe('true');
  });

  it('leaves data-sw-multi UNSET for a single full-width slider (edge/gradient arrows by default)', () => {
    mountAndRun(twoSlides); // no --sw-items → effective 1
    expect(root().getAttribute('data-sw-enhanced')).toBe('true');
    expect(root().getAttribute('data-sw-multi')).toBeNull();
  });

  const mount = (attrs: string): void => {
    document.body.innerHTML = `<div data-sw-block="Carousel" data-sw-component="carousel" aria-label="Test" ${attrs}>${twoSlides}</div>`;
    (0, eval)(CAROUSEL_RUNTIME_JS);
  };

  it('click-to-slide is DEFAULT ON for the edge/full-screen style (single-item, no data-arrows)', () => {
    mount(''); // single full-width → edge → click-next default on
    expect(root().getAttribute('data-click-next')).toBe('true'); // stamped so the CSS hooks match
    expect(root().getAttribute('tabindex')).toBe('0'); // focusable for arrow keys
  });

  it('click-to-slide opts OUT with data-click-next="false" on a single-item slider', () => {
    mount('data-click-next="false"');
    expect(root().getAttribute('data-click-next')).toBe('false'); // left as authored, not stamped true
    expect(root().getAttribute('tabindex')).toBeNull(); // no click-next wiring
  });

  it('a data-arrows="circle" CONTENT slider keeps click-to-slide OPT-IN (off by default)', () => {
    mount('data-arrows="circle"'); // single-item but forced circle → NOT the full-screen style
    expect(root().getAttribute('data-click-next')).toBeNull();
    expect(root().getAttribute('tabindex')).toBeNull();
  });

  it('a MULTI-item slider keeps click-to-slide OPT-IN; data-click-next="true" turns it on', () => {
    mount('style="--sw-items:2"'); // multi → off by default
    expect(root().getAttribute('data-click-next')).toBeNull();
    document.body.innerHTML = '';
    mount('style="--sw-items:2" data-click-next="true"'); // explicit opt-in
    expect(root().getAttribute('data-click-next')).toBe('true');
    expect(root().getAttribute('tabindex')).toBe('0');
  });
});

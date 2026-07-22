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
});

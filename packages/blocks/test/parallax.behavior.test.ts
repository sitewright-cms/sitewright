// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PARALLAX_JS } from '../src/parallax.js';

/**
 * ★ THE BUG. The runtime renders on SCROLL, and an IntersectionObserver marks off-screen elements
 * inactive so they neither compute nor hold a GPU layer. But the observer's callback only flipped the
 * flag — it never asked for a render. So an element that had just come into view kept the transform
 * it was frozen at until the NEXT scroll event arrived.
 *
 * Continuous human scrolling hides this completely (the next event is milliseconds away). An ANCHOR
 * JUMP does not: `location.hash = '#aloe'` is a single scroll, so the layer paints one frame stale at
 * the position it held before it woke.
 *
 * Found while measuring parallax travel in a real browser — a probe that scrolled once per sample
 * reported a layer travelling 0px, which looked like a broken element and was actually this.
 */
type IoCb = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;

let fire: IoCb = () => {};
let el: HTMLElement;
let rect = { top: 2000, height: 100 };

const realRaf = globalThis.requestAnimationFrame;

function mount(): void {
  document.body.innerHTML = '<div id="layer" data-sw-parallax-translate="100,0"></div>';
  el = document.getElementById('layer') as HTMLElement;
  el.getBoundingClientRect = () =>
    ({ top: rect.top, height: rect.height, left: 0, right: 0, bottom: 0, width: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  class IO {
    constructor(cb: IoCb) { fire = cb; }
    observe(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  // Run frame callbacks synchronously so "did it render?" is a deterministic question rather than a
  // timing one. STUB it — do not delete it: removing rAF from the global breaks vitest's own forks
  // pool, which hangs the worker and reports the whole FILE as unstartable rather than as a failure.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0; }) as typeof requestAnimationFrame;
}

const run = (): void => { (0, eval)(PARALLAX_JS); };
const y = (): string => /translate3d\(0,\s*([-\d.]+)px/.exec(el.style.transform)?.[1] ?? '';

describe('parallax runtime — an element that wakes up renders immediately', () => {
  beforeEach(() => { rect = { top: 2000, height: 100 }; mount(); });
  afterEach(() => { globalThis.requestAnimationFrame = realRaf; });

  it('renders once at setup, at the element\'s current position', () => {
    run();
    // Far below the fold → cover-progress clamps to 0 → the channel sits at its `from` value.
    expect(y()).toBe('100.00');
  });

  it('re-renders when the observer reports the element has come INTO view', () => {
    run();
    fire([{ target: el, isIntersecting: false }]); // parked off-screen
    rect = { top: 100, height: 100 }; // …the page moves it into view…
    fire([{ target: el, isIntersecting: true }]); // …and the observer says so

    // No scroll event was dispatched. Before the fix the transform stayed at 100.00.
    expect(y()).not.toBe('100.00');
    expect(Number(y())).toBeCloseTo(23.04, 1);
  });

  it('does not re-render when an element merely LEAVES view', () => {
    run();
    fire([{ target: el, isIntersecting: true }]);
    const before = el.style.transform;
    rect = { top: 5000, height: 100 };
    fire([{ target: el, isIntersecting: false }]);
    // Nothing to paint for something off-screen — and re-rendering it would be wasted work.
    expect(el.style.transform).toBe(before);
  });

  it('still drops will-change when the element leaves, and restores it when it returns', () => {
    run();
    fire([{ target: el, isIntersecting: true }]);
    expect(el.style.willChange).toBe('transform');
    fire([{ target: el, isIntersecting: false }]);
    expect(el.style.willChange).toBe('');
  });
});

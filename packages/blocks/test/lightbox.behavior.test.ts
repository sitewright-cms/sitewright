// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LIGHTBOX_SMARTPHOTO_RUNTIME_JS } from '../src/vendor/lightbox-smartphoto-runtime.js';

// Behavioural coverage for the lightbox's "items added after init" watcher, running the REAL shipped
// runtime string. The watcher sees every node added under a gallery root — and a carousel inside the
// lightbox adds one on every slide (it rewrites its "Slide n of N" live region). Rebuilding on that
// destroyed the OPEN viewer on the next autoplay tick and left the page at `overflow: hidden`
// (kayec.org.na's donor slider). The real-browser half of this lives in
// apps/api/test/lightbox-in-carousel.browser.test.ts.

const item = (n: number): string => `<a data-sw-part="item" href="full-${n}.jpg" data-caption="Item ${n}"><img src="thumb-${n}.jpg" alt="Item ${n}"></a>`;

function mountAndRun(): void {
  document.body.innerHTML =
    '<div data-sw-component="lightbox" data-animation="false" data-thumbnails="false">' +
    `<div id="row">${item(1)}${item(2)}${item(3)}</div>` +
    '<div id="live" class="sw-sr-only" aria-live="off">Slide 1 of 3</div>' +
    '</div>';
  // Indirect eval of our own trusted build-output constant, as the page's <script> would run it.
  (0, eval)(LIGHTBOX_SMARTPHOTO_RUNTIME_JS);
}

const viewer = (): HTMLElement | null => document.querySelector('.sw-lightbox');
const isOpen = (): boolean => viewer()?.getAttribute('aria-hidden') === 'false';
const wrappers = (): number => document.querySelectorAll('body > div[data-id]').length;
const anchors = (): HTMLAnchorElement[] => Array.from(document.querySelectorAll<HTMLAnchorElement>('#row a'));
// IDENTITY, not toEqual: a rebuild swaps every anchor for a clone, which toEqual would call equal.
const sameNodes = (a: Element[], b: Element[]): boolean => a.length === b.length && a.every((el, i) => el === b[i]);

// What a carousel does inside the root on each slide: rewrite the live region (a text node is added)
// and append a press ripple.
function carouselTick(n: number): void {
  document.getElementById('live')!.textContent = `Slide ${n} of 3`;
  const ripple = document.createElement('span');
  ripple.className = 'sw-ripple';
  document.getElementById('row')!.appendChild(ripple);
}

async function open(a: HTMLAnchorElement | undefined): Promise<void> {
  if (!a) throw new Error('no such gallery item');
  a.click();
  await vi.advanceTimersByTimeAsync(50); // the image "load" + SmartPhoto's render
  expect(isOpen()).toBe(true);
}

async function close(): Promise<void> {
  (document.querySelector('.sw-lightbox-dismiss') as HTMLElement).click();
  // jsdom runs no CSS transitions; SmartPhoto finishes its close on the overlay's transitionend.
  viewer()!.dispatchEvent(new Event('transitionend'));
  await vi.advanceTimersByTimeAsync(20);
}

describe('Lightbox runtime: items added after init (jsdom)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    const g = globalThis as unknown as Record<string, unknown>;
    // jsdom never loads images; SmartPhoto opens a photo once `new Image()` reports a size.
    g.Image = class {
      width = 800;
      height = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 1);
      }
    };
    if (!window.matchMedia) window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a carousel ticking inside the gallery neither closes the open viewer nor rebuilds it', async () => {
    mountAndRun();
    const before = anchors();
    await open(before[0]);
    for (let n = 2; n <= 4; n++) {
      carouselTick(n);
      await vi.advanceTimersByTimeAsync(500); // well past the watcher's coalescing window
    }
    expect(isOpen()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(wrappers()).toBe(1);
    expect(sameNodes(anchors(), before)).toBe(true); // nothing was rebuilt
  });

  it('closing still unlocks the page after the carousel has ticked', async () => {
    mountAndRun();
    const before = anchors();
    await open(before[1]);
    carouselTick(2);
    await vi.advanceTimersByTimeAsync(500);
    await close();
    expect(isOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('');
    // …and with the viewer closed, ticks still rebuild nothing.
    carouselTick(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(sameNodes(anchors(), before)).toBe(true);
    expect(wrappers()).toBe(1);
  });

  it('a new item is still picked up, and the old viewer is retired rather than left behind', async () => {
    mountAndRun();
    const row = document.getElementById('row')!;
    row.insertAdjacentHTML('beforeend', item(4));
    await vi.advanceTimersByTimeAsync(200);
    expect(wrappers()).toBe(1);
    const fresh = anchors();
    expect(fresh).toHaveLength(4);
    await open(fresh[3]);
    expect(document.querySelector('.sw-lightbox-count')?.textContent?.replace(/\s/g, '')).toBe('4/4');
  });

  it('a gallery of bare images (the minimal form) ignores carousel noise but picks up a new image', async () => {
    document.body.innerHTML =
      '<div data-sw-component="lightbox" data-animation="false" data-thumbnails="false">' +
      '<div id="row"><img src="one.jpg" alt="One"><a href="two-full.jpg"><img src="two.jpg" alt="Two"></a></div>' +
      // A NESTED lightbox is its own gallery: its image is never one of the outer gallery's items.
      '<div data-sw-component="lightbox" data-animation="false"><img src="nested.jpg" alt="Nested"></div>' +
      '<div id="live" class="sw-sr-only">Slide 1 of 3</div>' +
      '</div>';
    (0, eval)(LIGHTBOX_SMARTPHOTO_RUNTIME_JS);
    const before = anchors();
    expect(before).toHaveLength(2); // the bare image was wrapped
    carouselTick(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(sameNodes(anchors(), before)).toBe(true);
    expect(wrappers()).toBe(2); // one viewer per gallery: outer + nested

    document.getElementById('row')!.insertAdjacentHTML('beforeend', '<img src="three.jpg" alt="Three">');
    await vi.advanceTimersByTimeAsync(200);
    expect(anchors()).toHaveLength(3);
    expect(wrappers()).toBe(2);
  });

  it('a re-open during the exit transition keeps the gallery open when that close completes', async () => {
    mountAndRun();
    const before = anchors();
    await open(before[0]);
    (document.querySelector('.sw-lightbox-dismiss') as HTMLElement).click(); // exit transition starts
    await open(before[1]); // …and the visitor re-opens before it has ended
    viewer()!.dispatchEvent(new Event('transitionend')); // the FIRST close completes
    await vi.advanceTimersByTimeAsync(20);
    document.getElementById('row')!.insertAdjacentHTML('beforeend', item(4));
    await vi.advanceTimersByTimeAsync(1000);
    expect(isOpen()).toBe(true);
    expect(sameNodes(anchors().slice(0, 3), before)).toBe(true); // still deferred: the viewer is showing
  });

  it('a close whose event is lost still lets a waiting new item be bound', async () => {
    mountAndRun();
    const before = anchors();
    await open(before[0]);
    // Closing without a transitionend: SmartPhoto never fires 'close'.
    (document.querySelector('.sw-lightbox-dismiss') as HTMLElement).click();
    document.getElementById('row')!.insertAdjacentHTML('beforeend', item(4));
    await vi.advanceTimersByTimeAsync(2000);
    expect(anchors()).toHaveLength(4);
    expect(anchors()[0]).not.toBe(before[0]);
    expect(wrappers()).toBe(1);
  });

  it('a new item that arrives while the viewer is open waits until it has closed', async () => {
    mountAndRun();
    const before = anchors();
    await open(before[0]);
    document.getElementById('row')!.insertAdjacentHTML('beforeend', item(4));
    await vi.advanceTimersByTimeAsync(1000);
    expect(isOpen()).toBe(true);
    expect(sameNodes(anchors().slice(0, 3), before)).toBe(true); // not rebuilt yet
    await close();
    expect(document.body.style.overflow).toBe('');
    await vi.advanceTimersByTimeAsync(300);
    expect(anchors()[0]).not.toBe(before[0]); // rebuilt now
    expect(wrappers()).toBe(1);
    await open(anchors()[3]);
    expect(document.querySelector('.sw-lightbox-count')?.textContent?.replace(/\s/g, '')).toBe('4/4');
  });
});

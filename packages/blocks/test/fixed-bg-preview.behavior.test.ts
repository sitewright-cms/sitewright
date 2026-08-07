// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FIXED_BG_PREVIEW_JS } from '../src/fixed-bg-preview.js';

// Run the REAL shipped runtime string in a DOM, the way the page's inline <script> would. jsdom
// resolves `background-attachment`/`background-image` from inline styles, which is all this runtime
// reads, so its adoption logic is genuinely exercised here (geometry/clipping is not — jsdom reports
// every box as 0x0, and that part is verified in a browser instead).
function run(): void {
  (0, eval)(FIXED_BG_PREVIEW_JS);
}

const LAYER = '[data-sw-fixed-bg]';
const fixedSection = (id: string): string =>
  `<section id="${id}" style="background-image:url('/t.png');background-attachment:fixed">x</section>`;

// jsdom reports every box as 0x0, which makes the whole clipping path untestable — so give it a
// viewport and let each host declare where it sits. That is enough to exercise the real geometry code
// (the arithmetic is plain subtraction); the browser-level truth is measured separately.
function stubViewport(width = 1000, height = 800): void {
  Object.defineProperty(document.documentElement, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
}
function placeAt(el: HTMLElement, top: number, height: number, width = 1000): void {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: width,
      width,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('fixed-background emulation (jsdom)', () => {
  // jsdom has no rAF. Shim it on the real timer queue rather than a fake one: the runtime's rescan is
  // driven by a MutationObserver microtask, and a faked clock torn down mid-flight leaves that
  // callback to fire against a removed global (an unhandled ReferenceError, not a test failure).
  const g = globalThis as unknown as Record<string, unknown>;
  let previousRaf: unknown;
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

  beforeEach(() => {
    document.body.innerHTML = '';
    previousRaf = g.requestAnimationFrame;
    g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
  });
  afterEach(async () => {
    await settle(); // let any queued rescan run BEFORE the shim goes away
    g.requestAnimationFrame = previousRaf;
    document.body.innerHTML = '';
  });

  it('adopts an element that declares a fixed background, and hands the image to the layer', () => {
    document.body.innerHTML = fixedSection('hero');
    run();
    const host = document.getElementById('hero')!;
    const layer = host.querySelector(LAYER) as HTMLElement | null;
    expect(layer, 'no emulation layer was created').not.toBeNull();
    // The host gives up the image (the layer paints it) but keeps a stacking context so the
    // z-index:-1 layer cannot slide behind the host itself.
    expect(host.style.backgroundImage).toBe('none');
    expect(host.style.isolation).toBe('isolate');
    expect(layer!.style.backgroundImage).toContain('/t.png');
    expect(layer!.getAttribute('aria-hidden')).toBe('true');
    // It is the FIRST child, so it paints under the host's content.
    expect(host.firstElementChild).toBe(layer);
  });

  it('leaves an ordinary background completely alone', () => {
    document.body.innerHTML = `<section id="plain" style="background-image:url('/t.png')">x</section>`;
    run();
    const host = document.getElementById('plain')!;
    expect(host.querySelector(LAYER)).toBeNull();
    expect(host.style.backgroundImage).toContain('/t.png'); // untouched
    expect(host.style.isolation).toBe('');
  });

  it('ignores a fixed attachment with no image to paint', () => {
    document.body.innerHTML = `<section id="noimg" style="background-attachment:fixed">x</section>`;
    run();
    expect(document.querySelector(LAYER)).toBeNull();
  });

  it('★ adopts content inserted AFTER init — the case a one-time scan missed', async () => {
    document.body.innerHTML = fixedSection('first');
    run();
    expect(document.querySelectorAll(LAYER)).toHaveLength(1);

    // A carousel cloning slides, a modal injecting content, any runtime enhancing markup into place.
    document.body.insertAdjacentHTML('beforeend', fixedSection('later'));
    await settle();

    expect(document.getElementById('later')!.querySelector(LAYER), 'late content never got a layer').not.toBeNull();
    expect(document.querySelectorAll(LAYER)).toHaveLength(2);
  });

  it('★ TERMINATES — inserting its own layers does not loop the observer forever', async () => {
    document.body.innerHTML = fixedSection('a') + fixedSection('b');
    run();
    await settle();
    // Exactly one layer per host: the pass that follows its own insertions finds them already there
    // and inserts nothing, so the observer settles instead of re-adopting on every cycle.
    expect(document.querySelectorAll(LAYER)).toHaveLength(2);
    expect(document.getElementById('a')!.querySelectorAll(LAYER)).toHaveLength(1);
    expect(document.getElementById('b')!.querySelectorAll(LAYER)).toHaveLength(1);

    // …and it stays settled after further unrelated mutations.
    document.body.insertAdjacentHTML('beforeend', '<p>unrelated</p>');
    await settle();
    expect(document.querySelectorAll(LAYER)).toHaveLength(2);
  });

  it('★ keeps re-clipping after a rescan — the frozen clip-path regression', async () => {
    // Measured in the live editor before the fix: the clip-path froze at its very first value and never
    // moved again, because collect() identified an adopted host by its background-image — which adoption
    // itself had set to `none`. One rescan (and any live page mutates within milliseconds) emptied the
    // tracked pairs, so every later scroll re-clipped nothing at all.
    stubViewport();
    document.body.innerHTML = fixedSection('hero');
    const host = document.getElementById('hero')!;
    placeAt(host, 100, 400);
    run();
    const layer = host.querySelector(LAYER) as HTMLElement;
    expect(layer.style.clipPath).toBe('inset(100px 0px 300px 0px)');

    // Something else on the page mutates — a runtime enhancing markup, the editor's own overlay.
    document.body.insertAdjacentHTML('beforeend', '<span>tick</span>');
    await settle();

    // …and then the author scrolls.
    placeAt(host, -50, 400);
    window.dispatchEvent(new Event('scroll'));
    await settle();
    expect(layer.style.clipPath, 'the clip froze: the host was dropped from the tracked pairs').toBe(
      'inset(0px 0px 450px 0px)',
    );
  });

  it('★ RELEASES the host when a media query hands the background back to `scroll`', async () => {
    // "No fixed backgrounds on mobile" is the single most common responsive rule there is, and the
    // device modes walk straight into it. Without a release the host keeps the desktop treatment at
    // mobile width AND loses its own background, because adoption had blanked it.
    stubViewport();
    document.body.innerHTML = fixedSection('hero');
    const host = document.getElementById('hero')!;
    placeAt(host, 0, 400);
    run();
    expect(host.querySelector(LAYER)).not.toBeNull();

    // The width changes and the media query wins. No DOM mutation happens, so only a re-clip runs.
    host.style.backgroundAttachment = 'scroll';
    window.dispatchEvent(new Event('resize'));
    await settle();

    expect(host.querySelector(LAYER), 'the emulation layer outlived the fixed attachment').toBeNull();
    expect(host.style.backgroundImage, 'the host never got its own background back').toContain('/t.png');
    expect(host.style.isolation).toBe('');
  });

  it('★ re-adopts when the host asks for a fixed background again', async () => {
    stubViewport();
    document.body.innerHTML = fixedSection('hero');
    const host = document.getElementById('hero')!;
    placeAt(host, 0, 400);
    run();
    host.style.backgroundAttachment = 'scroll';
    window.dispatchEvent(new Event('resize'));
    await settle();
    expect(host.querySelector(LAYER)).toBeNull();

    // Back to a desktop width: the rule that flipped it off no longer applies.
    host.style.backgroundAttachment = 'fixed';
    document.body.insertAdjacentHTML('beforeend', '<span>tick</span>'); // any rescan trigger
    await settle();
    expect(host.querySelector(LAYER), 'the host was never re-adopted').not.toBeNull();
    expect(host.style.backgroundImage).toBe('none');
  });

  it('restores an INLINE background exactly as authored when released', async () => {
    stubViewport();
    document.body.innerHTML = `<section id="hero" style="background-image:url('/inline.png');background-attachment:fixed;isolation:auto">x</section>`;
    const host = document.getElementById('hero')!;
    placeAt(host, 0, 400);
    run();
    host.style.backgroundAttachment = 'scroll';
    window.dispatchEvent(new Event('resize'));
    await settle();
    expect(host.style.backgroundImage).toContain('/inline.png');
    expect(host.style.isolation).toBe('auto');
  });

  it('carries the host border-radius into the clip', async () => {
    stubViewport();
    // The four LONGHANDS, not the `border-radius` shorthand: jsdom does not expand the shorthand, and
    // the runtime reads the longhands (which is what a browser resolves them to anyway).
    document.body.innerHTML =
      `<section id="hero" style="background-image:url('/t.png');background-attachment:fixed;` +
      `border-top-left-radius:24px;border-top-right-radius:24px;border-bottom-right-radius:24px;border-bottom-left-radius:24px">x</section>`;
    const host = document.getElementById('hero')!;
    placeAt(host, 100, 400);
    run();
    const layer = host.querySelector(LAYER) as HTMLElement;
    // Without this a rounded section paints square background corners.
    expect(layer.style.clipPath).toBe('inset(100px 0px 300px 0px round 24px 24px 24px 24px)');
  });

  it('hides the layer while its host is off-screen', async () => {
    stubViewport();
    document.body.innerHTML = fixedSection('hero');
    const host = document.getElementById('hero')!;
    placeAt(host, 900, 400); // below a 800px-tall viewport
    run();
    const layer = host.querySelector(LAYER) as HTMLElement;
    expect(layer.style.display).toBe('none');
  });

  it('does not adopt the same element twice across repeated scans', async () => {
    document.body.innerHTML = fixedSection('once');
    run();
    await settle();
    document.body.insertAdjacentHTML('beforeend', '<span>tick</span>');
    await settle();
    expect(document.getElementById('once')!.querySelectorAll(LAYER)).toHaveLength(1);
  });
});

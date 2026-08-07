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

  it('does not adopt the same element twice across repeated scans', async () => {
    document.body.innerHTML = fixedSection('once');
    run();
    await settle();
    document.body.insertAdjacentHTML('beforeend', '<span>tick</span>');
    await settle();
    expect(document.getElementById('once')!.querySelectorAll(LAYER)).toHaveLength(1);
  });
});

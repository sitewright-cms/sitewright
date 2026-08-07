import { describe, it, expect } from 'vitest';
import { FIXED_BG_PREVIEW_CSS, FIXED_BG_PREVIEW_JS, usesFixedBackground } from '../src/fixed-bg-preview.js';

describe('usesFixedBackground', () => {
  it('detects both the Tailwind utility and the CSS longhand', () => {
    expect(usesFixedBackground('<section class="bg-fixed bg-cover">')).toBe(true);
    expect(usesFixedBackground('<div style="background-attachment:fixed">')).toBe(true);
    expect(usesFixedBackground('<style>.hero{background-attachment: fixed}</style>')).toBe(true);
  });

  it('is false for a page with no fixed background, so the runtime never ships', () => {
    expect(usesFixedBackground('<section class="bg-cover bg-center">')).toBe(false);
    expect(usesFixedBackground('')).toBe(false);
    expect(usesFixedBackground(null)).toBe(false);
    expect(usesFixedBackground(undefined)).toBe(false);
  });
});

describe('fixed-background preview emulation', () => {
  it('paints through a viewport-FIXED layer — the one thing that survives a scaled iframe', () => {
    // Measured (Chromium 1223): with the page-editor's responsive modes scaling the preview iframe,
    // `background-attachment: fixed` paints as `scroll` — for a wrapper transform, an iframe
    // transform AND CSS zoom alike. `position: fixed` inside the same scaled iframe still resolves
    // against the iframe's own viewport, which is why the emulation is built on it.
    expect(FIXED_BG_PREVIEW_CSS).toContain('position:fixed');
    expect(FIXED_BG_PREVIEW_CSS).toContain('inset:0');
    // The layer IS the viewport box, so `scroll` on it reproduces fixed-attachment exactly — the
    // browser resolves cover/contain/percentages against the same area it would have used.
    expect(FIXED_BG_PREVIEW_CSS).toContain('background-attachment:scroll');
    // Behind the host's content but in front of the host's own background.
    expect(FIXED_BG_PREVIEW_CSS).toContain('z-index:-1');
    expect(FIXED_BG_PREVIEW_JS).toContain("isolation='isolate'");
  });

  it('only touches elements that actually declare a fixed background AND have an image', () => {
    expect(FIXED_BG_PREVIEW_JS).toContain("cs.backgroundAttachment.indexOf('fixed')>=0");
    expect(FIXED_BG_PREVIEW_JS).toContain("cs.backgroundImage==='none'");
  });

  it('★ recognises an adopted host by its LAYER, never by its background-image', () => {
    // The image test cannot come first: adoption sets the host's background-image to `none`, so it
    // would reject every host it had already adopted, empty the tracked pairs on the next rescan and
    // freeze the clip. Pinned as an ordering invariant here; proved behaviourally in the jsdom suite.
    const layerLookup = FIXED_BG_PREVIEW_JS.indexOf("var layer=el.querySelector(':scope>['+LAYER+']')");
    const imageGuard = FIXED_BG_PREVIEW_JS.indexOf("cs.backgroundImage==='none'");
    expect(layerLookup).toBeGreaterThan(-1);
    expect(imageGuard).toBeGreaterThan(layerLookup);
  });

  it('clips the layer to the host rect, and hides it when the host is off-screen', () => {
    expect(FIXED_BG_PREVIEW_JS).toContain('clipPath');
    expect(FIXED_BG_PREVIEW_JS).toContain("layer.style.display='none'");
  });

  it('follows the BODY-SCROLLER contract: capture-phase, rAF-throttled', () => {
    // The whole-site preview scrolls <body>; a non-root scroller's scroll event does not bubble to a
    // plain window listener, so capture:true is what makes this fire there at all.
    expect(FIXED_BG_PREVIEW_JS).toContain('{passive:true,capture:true}');
    expect(FIXED_BG_PREVIEW_JS).toContain('requestAnimationFrame');
  });

  it('is idempotent — a second pass reuses the layer it already made', () => {
    expect(FIXED_BG_PREVIEW_JS).toContain('el.hasAttribute(LAYER)');
    expect(FIXED_BG_PREVIEW_JS).toContain(':scope>[');
  });

  it('is marker-gated at the SHIP level, not by bailing at runtime', () => {
    // The runtime deliberately keeps its listeners + observer armed even with nothing to adopt yet,
    // because a fixed background can arrive later (see the behaviour suite). "Ships nothing" is
    // enforced upstream by usesFixedBackground, which is what gates the whole script.
    expect(usesFixedBackground('<div class="bg-cover">')).toBe(false);
  });
});


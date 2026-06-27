import { describe, it, expect } from 'vitest';
import { PARALLAX_CSS, PARALLAX_JS, PARALLAX_LIMITS, parallaxPreviewDoc, usesParallax } from '../src/parallax.js';

describe('parallax — scroll-linked property engine', () => {
  describe('PARALLAX_CSS (structural only)', () => {
    it('clips the bg section + positions the drifting layer + lifts content', () => {
      expect(PARALLAX_CSS).toContain('[data-sw-parallax-bg]{position:relative;overflow:hidden}');
      expect(PARALLAX_CSS).toContain('[data-sw-parallax-bg] [data-sw-parallax-layer]{position:absolute');
      expect(PARALLAX_CSS).toContain('[data-sw-parallax-bg]>:not([data-sw-parallax-layer]){position:relative;z-index:1}');
    });

    it('carries NO motion (movement is JS-applied) and NO brand colours (dark-safe)', () => {
      // no transitions/animations/transform in the sheet — the runtime applies all movement inline
      expect(PARALLAX_CSS).not.toContain('transition');
      expect(PARALLAX_CSS).not.toContain('@keyframes');
      expect(PARALLAX_CSS).not.toContain('transform');
      // structural CSS is unconditional (a no-JS / reduced-motion visitor still gets a clipped bg)
      expect(PARALLAX_CSS).not.toContain('prefers-reduced-motion');
      expect(PARALLAX_CSS).not.toContain('--sw-color');
    });
  });

  describe('PARALLAX_JS (runtime)', () => {
    it('bails entirely under reduced motion (accessibility — WCAG 2.3.3)', () => {
      expect(PARALLAX_JS).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
      // the bail is at the very top, before any work
      const head = PARALLAX_JS.slice(0, 160);
      expect(head).toContain('prefers-reduced-motion');
      expect(head).toContain('return');
    });

    it('selects every channel attribute (a channel can be used without the base translate)', () => {
      for (const attr of [
        'data-sw-parallax',
        'data-sw-parallax-bg',
        'data-sw-parallax-opacity',
        'data-sw-parallax-scale',
        'data-sw-parallax-blur',
      ]) {
        expect(PARALLAX_JS).toContain(`[${attr}]`);
      }
    });

    it('clamps every channel to its documented range (tenant data is never trusted raw)', () => {
      // speed ±2, opacity 0..1, scale 0..4, blur 0..40 — matches PARALLAX_LIMITS
      expect(PARALLAX_JS).toContain('clamp(num(el.getAttribute(\'data-sw-parallax\'),bg?0.3:0),-2,2)');
      expect(PARALLAX_JS).toContain("pair(el.getAttribute('data-sw-parallax-opacity'),0,1)");
      expect(PARALLAX_JS).toContain("pair(el.getAttribute('data-sw-parallax-scale'),0,4)");
      expect(PARALLAX_JS).toContain("pair(el.getAttribute('data-sw-parallax-blur'),0,40)");
      expect(PARALLAX_LIMITS.speed).toEqual({ min: -2, max: 2 });
      expect(PARALLAX_LIMITS.blur).toEqual({ min: 0, max: 40 });
    });

    it('is rAF-throttled, passive, and IntersectionObserver-gated', () => {
      expect(PARALLAX_JS).toContain('requestAnimationFrame');
      expect(PARALLAX_JS).toContain('{passive:true}');
      expect(PARALLAX_JS).toContain('IntersectionObserver');
      expect(PARALLAX_JS).toContain('willChange');
    });

    it('drives transform / opacity / filter (the three channels)', () => {
      expect(PARALLAX_JS).toContain('.style.transform=');
      expect(PARALLAX_JS).toContain('.style.opacity=');
      expect(PARALLAX_JS).toContain(".style.filter='blur(");
      expect(PARALLAX_JS).toContain('translate3d(');
    });

    it('does not let bundled JS close the tag early', () => {
      expect(PARALLAX_JS).not.toContain('</script');
    });
  });

  describe('parallaxPreviewDoc (editor builder preview)', () => {
    it('renders the sample beside a STATIC twin, the scroll hint, and the reduced-motion note', () => {
      const doc = parallaxPreviewDoc({ speed: 0.4 });
      expect(doc).toContain('class="box ref"'); // the un-animated reference twin (so the motion is legible)
      expect(doc).toContain('class="box sample"');
      expect(doc).toContain('data-sw-parallax="0.4"');
      expect(doc).toContain('reduced-motion setting'); // explains a deliberately-still preview
    });

    it('embeds the REAL runtime (CSS + JS) so the motion actually plays', () => {
      const doc = parallaxPreviewDoc();
      expect(doc).toContain(PARALLAX_CSS);
      expect(doc).toContain(PARALLAX_JS);
      expect(doc).toContain('data-sw-parallax="0.3"'); // default speed
    });

    // The embedded runtime JS/CSS references every channel attr NAME, so scope attribute assertions to
    // the sample element's opening tag (where the AUTHORED attrs live), not the whole document.
    const sampleTag = (doc: string): string => /<div class="box sample"([^>]*)>/.exec(doc)![1]!;

    it('emits a channel only for a valid from,to pair + omits the default (y) axis', () => {
      const tag = sampleTag(parallaxPreviewDoc({ axis: 'y', opacity: [0.2, 1], scale: null, blur: undefined }));
      expect(tag).toContain('data-sw-parallax-opacity="0.2,1"');
      expect(tag).not.toContain('data-sw-parallax-scale');
      expect(tag).not.toContain('data-sw-parallax-blur');
      expect(tag).not.toContain('data-sw-parallax-axis'); // y is the default
      expect(sampleTag(parallaxPreviewDoc({ axis: 'x' }))).toContain('data-sw-parallax-axis="x"');
    });

    it('CLAMPS every value to PARALLAX_LIMITS (untrusted query params never reach the markup raw)', () => {
      const doc = parallaxPreviewDoc({ speed: 99, opacity: [-5, 9], scale: [-1, 99], blur: [999, -1] });
      expect(doc).toContain(`data-sw-parallax="${PARALLAX_LIMITS.speed.max}"`); // 99 → 2
      expect(doc).toContain('data-sw-parallax-opacity="0,1"'); // -5→0, 9→1
      expect(doc).toContain(`data-sw-parallax-scale="0,${PARALLAX_LIMITS.scale.max}"`); // -1→0, 99→4
      expect(doc).toContain(`data-sw-parallax-blur="${PARALLAX_LIMITS.blur.max},0"`); // 999→40, -1→0
    });

    it('interpolates ONLY clamped numbers + the literal x axis — no string-injection surface', () => {
      // A would-be break-out value can only arrive as a number; non-finite → default/omitted.
      const tag = sampleTag(parallaxPreviewDoc({ speed: NaN, opacity: [NaN, 1] }));
      expect(tag).toContain('data-sw-parallax="0.3"'); // NaN speed → default
      expect(tag).not.toContain('data-sw-parallax-opacity'); // a NaN in the pair drops the channel
      // every authored data-sw-parallax* value is a clamped number or the literal x — no `"`-escape risk
      for (const m of tag.matchAll(/data-sw-parallax[a-z-]*="([^"]*)"/g)) {
        expect(m[1]).toMatch(/^(x|-?\d+(\.\d+)?(,-?\d+(\.\d+)?)?)$/);
      }
    });
  });

  describe('usesParallax', () => {
    it('detects any channel via the shared substring marker', () => {
      expect(usesParallax('<div data-sw-parallax="0.3"></div>')).toBe(true);
      expect(usesParallax('<div data-sw-parallax-opacity="0,1"></div>')).toBe(true);
      expect(usesParallax('<section data-sw-parallax-bg></section>')).toBe(true);
      expect(usesParallax('<div data-sw-parallax-blur="8,0"></div>')).toBe(true);
    });
    it('is false for unrelated content + non-strings', () => {
      expect(usesParallax('<div class="hero"></div>')).toBe(false);
      expect(usesParallax(null)).toBe(false);
      expect(usesParallax(undefined)).toBe(false);
    });
  });
});

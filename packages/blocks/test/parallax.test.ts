import { describe, it, expect } from 'vitest';
import { PARALLAX_CSS, PARALLAX_JS, PARALLAX_LIMITS, parallaxPreviewDoc, usesParallax } from '../src/parallax.js';

describe('parallax — scroll-linked property engine (v2)', () => {
  describe('PARALLAX_CSS (structural only)', () => {
    it('clips a scene + stacks its layers, and carries NO motion / NO brand colours (dark-safe)', () => {
      expect(PARALLAX_CSS).toContain('[data-sw-parallax-scene]{position:relative;overflow:hidden}');
      expect(PARALLAX_CSS).toContain('[data-sw-parallax-scene] [data-sw-parallax-layer]{position:absolute;inset:0}');
      // the old bespoke background channel is gone
      expect(PARALLAX_CSS).not.toContain('data-sw-parallax-bg');
      // movement is JS-applied → never in the sheet
      expect(PARALLAX_CSS).not.toContain('transition');
      expect(PARALLAX_CSS).not.toContain('@keyframes');
      expect(PARALLAX_CSS).not.toContain('transform');
      expect(PARALLAX_CSS).not.toContain('prefers-reduced-motion');
      expect(PARALLAX_CSS).not.toContain('--sw-color');
    });
  });

  describe('PARALLAX_JS (runtime)', () => {
    it('bails entirely under reduced motion (accessibility — WCAG 2.3.3), at the very top', () => {
      expect(PARALLAX_JS).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
      const head = PARALLAX_JS.slice(0, 160);
      expect(head).toContain('prefers-reduced-motion');
      expect(head).toContain('return');
    });

    it('selects on the FOUR base channels (speed + bg are gone)', () => {
      expect(PARALLAX_JS).toContain(
        "querySelectorAll('[data-sw-parallax-translate],[data-sw-parallax-opacity],[data-sw-parallax-scale],[data-sw-parallax-blur]')",
      );
      expect(PARALLAX_JS).not.toContain('[data-sw-parallax-bg]');
      // no leftover continuous-speed term
      expect(PARALLAX_JS).not.toContain("getAttribute('data-sw-parallax')");
    });

    it('clamps every channel to PARALLAX_LIMITS (tenant data is never trusted raw)', () => {
      expect(PARALLAX_JS).toContain(`chan(el,'translate',${PARALLAX_LIMITS.translate.min},${PARALLAX_LIMITS.translate.max},er)`);
      expect(PARALLAX_JS).toContain(`chan(el,'opacity',${PARALLAX_LIMITS.opacity.min},${PARALLAX_LIMITS.opacity.max},er)`);
      expect(PARALLAX_JS).toContain(`chan(el,'scale',${PARALLAX_LIMITS.scale.min},${PARALLAX_LIMITS.scale.max},er)`);
      expect(PARALLAX_JS).toContain(`chan(el,'blur',${PARALLAX_LIMITS.blur.min},${PARALLAX_LIMITS.blur.max},er)`);
      expect(PARALLAX_LIMITS.translate).toEqual({ min: -600, max: 600 });
      expect(PARALLAX_LIMITS.range).toEqual({ min: 0, max: 1 });
    });

    it('reads per-channel + element windows and an optional OUT phase (in → hold → out)', () => {
      expect(PARALLAX_JS).toContain("getAttribute('data-sw-parallax-'+name+'-range')"); // per-channel IN window
      expect(PARALLAX_JS).toContain("getAttribute('data-sw-parallax-range')"); // element default window
      expect(PARALLAX_JS).toContain("getAttribute('data-sw-parallax-'+name+'-out')"); // OUT values
      expect(PARALLAX_JS).toContain("getAttribute('data-sw-parallax-'+name+'-out-range')"); // OUT window
      // the cover-progress spine + the IN/OUT switch
      expect(PARALLAX_JS).toContain('(vh-r.top)/(vh+r.height)');
      expect(PARALLAX_JS).toContain('if(ch.o&&c>=ch.ow[0])');
      // guards: an OUT can't start before IN ends, and a zero-width OUT window is dropped (no 0/0 → NaN
      // for hand-authored `-out` without a windowed `-range`).
      expect(PARALLAX_JS).toContain('if(ow[0]<iw[1])ow=[iw[1],ow[1]]');
      expect(PARALLAX_JS).toContain('if(ow[1]<=ow[0]){o=null;ow=null;}');
    });

    it('is rAF-throttled, passive, IntersectionObserver-gated, two-pass', () => {
      expect(PARALLAX_JS).toContain('requestAnimationFrame');
      expect(PARALLAX_JS).toContain('{passive:true}');
      expect(PARALLAX_JS).toContain('IntersectionObserver');
      expect(PARALLAX_JS).toContain('willChange');
      expect(PARALLAX_JS).toContain('PASS 1');
      expect(PARALLAX_JS).toContain('PASS 2');
    });

    it('drives transform / opacity / filter, and does not close the tag early', () => {
      expect(PARALLAX_JS).toContain('.style.transform=');
      expect(PARALLAX_JS).toContain('.style.opacity=');
      expect(PARALLAX_JS).toContain(".style.filter='blur(");
      expect(PARALLAX_JS).toContain('translate3d(');
      expect(PARALLAX_JS).not.toContain('</script');
    });
  });

  describe('parallaxPreviewDoc (editor builder preview)', () => {
    // The embedded runtime JS/CSS references every channel attr NAME, so scope attribute assertions to
    // the sample element's opening tag (where the AUTHORED attrs live), not the whole document.
    const sampleTag = (doc: string): string => /<div class="box sample"([^>]*)>/.exec(doc)![1]!;

    it('renders the sample beside a STATIC twin, the scroll hint, and the reduced-motion note', () => {
      const doc = parallaxPreviewDoc({ translate: { from: 60, to: -60 } });
      expect(doc).toContain('class="box ref"');
      expect(doc).toContain('class="box sample"');
      expect(doc).toContain('data-sw-parallax-translate="60,-60"');
      expect(doc).toContain('reduced-motion setting');
    });

    it('embeds the REAL runtime (CSS + JS); an empty preview defaults to a visible translate', () => {
      const doc = parallaxPreviewDoc();
      expect(doc).toContain(PARALLAX_CSS);
      expect(doc).toContain(PARALLAX_JS);
      expect(sampleTag(doc)).toContain('data-sw-parallax-translate="40,-40"'); // default motion
    });

    it('emits per-channel windows + an OUT phase when supplied; omits the default y axis', () => {
      const tag = sampleTag(
        parallaxPreviewDoc({
          axis: 'y',
          range: [0, 0.8], // element default window
          opacity: { from: 0, to: 1, range: [0, 0.5], out: [1, 0], outRange: [0.6, 1] },
          scale: null,
        }),
      );
      expect(tag).toContain('data-sw-parallax-opacity="0,1"');
      expect(tag).toContain('data-sw-parallax-opacity-range="0,0.5"');
      expect(tag).toContain('data-sw-parallax-opacity-out="1,0"');
      expect(tag).toContain('data-sw-parallax-opacity-out-range="0.6,1"');
      expect(tag).toContain('data-sw-parallax-range="0,0.8"');
      expect(tag).not.toContain('data-sw-parallax-scale');
      expect(tag).not.toContain('data-sw-parallax-axis'); // y is the default
      expect(sampleTag(parallaxPreviewDoc({ axis: 'x', translate: { from: 1, to: 2 } }))).toContain('data-sw-parallax-axis="x"');
    });

    it('CLAMPS values + windows (untrusted query params never reach the markup raw)', () => {
      const tag = sampleTag(
        parallaxPreviewDoc({
          translate: { from: 9999, to: -9999, range: [-5, 9] }, // px clamp ±600; window clamp 0..1
          blur: { from: 999, to: -1 },
        }),
      );
      expect(tag).toContain(`data-sw-parallax-translate="${PARALLAX_LIMITS.translate.max},${PARALLAX_LIMITS.translate.min}"`);
      expect(tag).toContain('data-sw-parallax-translate-range="0,1"');
      expect(tag).toContain(`data-sw-parallax-blur="${PARALLAX_LIMITS.blur.max},0"`);
    });

    it('drops a malformed window (e <= s) and an OUT with a NaN — no string-injection surface', () => {
      const tag = sampleTag(
        parallaxPreviewDoc({ opacity: { from: 0, to: 1, range: [0.7, 0.3], out: [Number.NaN, 0] } }),
      );
      expect(tag).toContain('data-sw-parallax-opacity="0,1"');
      expect(tag).not.toContain('data-sw-parallax-opacity-range'); // e<=s → dropped
      expect(tag).not.toContain('data-sw-parallax-opacity-out'); // NaN pair → dropped
      // every authored value is a clamped number or pair (or the literal x) — no `"`-escape risk
      for (const m of tag.matchAll(/data-sw-parallax[a-z-]*="([^"]*)"/g)) {
        expect(m[1]).toMatch(/^(x|-?\d+(\.\d+)?(,-?\d+(\.\d+)?)?)$/);
      }
    });
  });

  describe('usesParallax', () => {
    it('detects any channel or scene via the shared substring marker', () => {
      expect(usesParallax('<div data-sw-parallax-translate="40,-40"></div>')).toBe(true);
      expect(usesParallax('<div data-sw-parallax-opacity="0,1"></div>')).toBe(true);
      expect(usesParallax('<section data-sw-parallax-scene></section>')).toBe(true);
      expect(usesParallax('<div data-sw-parallax-blur="8,0"></div>')).toBe(true);
    });
    it('is false for unrelated content + non-strings', () => {
      expect(usesParallax('<div class="hero"></div>')).toBe(false);
      expect(usesParallax(null)).toBe(false);
      expect(usesParallax(undefined)).toBe(false);
    });
  });
});

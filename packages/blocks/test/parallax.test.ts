import { describe, it, expect } from 'vitest';
import { PARALLAX_CSS, PARALLAX_JS, PARALLAX_LIMITS, usesParallax } from '../src/parallax.js';

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

import { describe, it, expect } from 'vitest';
import { applyParallaxStaticState } from '../src/parallax.js';
import { renderTemplate } from '../src/template.js';

/**
 * ★ THE BUG THIS FIXES. `PARALLAX_JS` returns immediately under `prefers-reduced-motion`, so an
 * element whose ONLY styling for a property is a parallax channel renders at its authored value —
 * a background photo dimmed to `0.08,0.18` shows at FULL opacity. That is not "no motion", it is a
 * different design, and it is what a reduced-motion visitor actually sees.
 *
 * It also silently corrupted the platform's own measurements: `screenshot.ts` sets
 * `reducedMotion: 'reduce'` for every capture, so visual_audit / compare_to_source / preview_page
 * were all judging a page no such visitor ever sees.
 *
 * TRANSLATE and SCALE are deliberately NOT given a static value — for those, "static, in flow" IS
 * the correct reduced-motion answer. Only the APPEARANCE channels are restored.
 */
describe('applyParallaxStaticState — appearance channels survive no-JS and reduced motion', () => {
  it('writes the START opacity onto an element that has no style attribute', () => {
    expect(applyParallaxStaticState('<div data-sw-parallax-opacity="0.08,0.18"></div>')).toBe(
      '<div style="opacity:0.08" data-sw-parallax-opacity="0.08,0.18"></div>',
    );
  });

  it('writes the START blur', () => {
    expect(applyParallaxStaticState('<div data-sw-parallax-blur="8,0"></div>')).toBe(
      '<div style="filter:blur(8px)" data-sw-parallax-blur="8,0"></div>',
    );
  });

  it('PREPENDS into an existing style so the author\'s own declaration still wins', () => {
    const out = applyParallaxStaticState('<div style="inset:-16% 0" data-sw-parallax-opacity="0.1,0.3"></div>');
    expect(out).toBe('<div style="opacity:0.1;inset:-16% 0" data-sw-parallax-opacity="0.1,0.3"></div>');
  });

  it('an author who set the property themselves is not overridden', () => {
    // Ours goes first, theirs later → theirs wins, which is the right precedence.
    const out = applyParallaxStaticState('<div style="opacity:.5" data-sw-parallax-opacity="0.1,0.3"></div>');
    expect(out.indexOf('opacity:0.1')).toBeLessThan(out.indexOf('opacity:.5'));
  });

  it('combines both appearance channels', () => {
    expect(applyParallaxStaticState('<div data-sw-parallax-opacity="0,1" data-sw-parallax-blur="6,0"></div>')).toContain(
      'style="opacity:0;filter:blur(6px)"',
    );
  });

  it('leaves TRANSLATE and SCALE alone — for motion, the natural state is correct', () => {
    const html = '<div data-sw-parallax-translate="40,-40" data-sw-parallax-scale="0.9,1.05"></div>';
    expect(applyParallaxStaticState(html)).toBe(html);
  });

  it('accepts a single value as a constant', () => {
    expect(applyParallaxStaticState('<div data-sw-parallax-opacity="0.13"></div>')).toContain('style="opacity:0.13"');
  });

  it('ignores a malformed channel rather than emitting broken CSS', () => {
    for (const bad of ['', 'abc', 'url(x)', '0.1,;color:red', '1,2,3,4']) {
      const html = `<div data-sw-parallax-opacity="${bad}"></div>`;
      expect(applyParallaxStaticState(html)).toBe(html);
    }
  });

  it('is a no-op on markup with no parallax at all', () => {
    const html = '<section class="hero"><p>hello</p></section>';
    expect(applyParallaxStaticState(html)).toBe(html);
  });

  it('handles several elements and leaves every other byte untouched', () => {
    const out = applyParallaxStaticState(
      '<div data-sw-parallax-opacity="0.2,1"><b>a</b></div><span data-sw-parallax-blur="4,0">b</span>',
    );
    expect(out).toBe(
      '<div style="opacity:0.2" data-sw-parallax-opacity="0.2,1"><b>a</b></div>' +
        '<span style="filter:blur(4px)" data-sw-parallax-blur="4,0">b</span>',
    );
  });

  it('is idempotent — running it twice does not stack declarations', () => {
    const once = applyParallaxStaticState('<div data-sw-parallax-opacity="0.08,0.18"></div>');
    expect(applyParallaxStaticState(once)).toBe(once);
  });

  it('runs as part of renderTemplate, so both render surfaces get it', () => {
    const out = renderTemplate('<div data-sw-parallax-opacity="0.08,0.18" class="bg"></div>', {});
    expect(out).toContain('opacity:0.08');
  });
});

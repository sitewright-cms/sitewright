import { describe, it, expect } from 'vitest';
import { PARALLAX_CSS } from '../src/parallax.js';

/**
 * ★ THE TRAP THIS REMOVES. Every `data-sw-parallax-layer` is `position:absolute`, so a scene whose
 * content lives in a layer has NOTHING in flow to give it height — the section collapses to zero and
 * everything inside it disappears. The guide's own depth-scene example puts content in a layer, which
 * reads as an endorsement of exactly that. Measured: a section with a video and an image gallery
 * rendered 0px tall.
 *
 * The fix is an opt-in in-flow variant. It cannot be the DEFAULT: existing cover layers oversize
 * themselves with an inline `inset:-14%`, which does nothing once the element is not absolute, so
 * flipping the default would collapse every background layer already in the wild to zero height.
 */
describe('parallax — a content layer can hold the section open', () => {
  it('still stacks ordinary layers absolutely (unchanged, so existing scenes are untouched)', () => {
    expect(PARALLAX_CSS).toContain('[data-sw-parallax-scene] [data-sw-parallax-layer]{position:absolute;inset:0}');
  });

  it('gives `data-sw-parallax-layer="content"` normal flow, so the scene takes its height', () => {
    expect(PARALLAX_CSS).toContain('[data-sw-parallax-scene] [data-sw-parallax-layer="content"]{position:relative;inset:auto}');
  });

  it('orders the content rule AFTER the absolute rule, or it would never win', () => {
    // Same specificity (0,2,0 vs 0,2,0 + an attribute value → the value selector is (0,3,0)), but
    // relying on that is fragile; source order is the guarantee that actually holds.
    expect(PARALLAX_CSS.indexOf('[data-sw-parallax-layer="content"]')).toBeGreaterThan(
      PARALLAX_CSS.indexOf('[data-sw-parallax-layer]{position:absolute'),
    );
  });

  it('keeps the sheet structural — the content layer adds no motion and no brand colour', () => {
    const start = PARALLAX_CSS.indexOf('[data-sw-parallax-layer="content"]');
    const rule = PARALLAX_CSS.slice(start, PARALLAX_CSS.indexOf('}', start) + 1);
    expect(rule).not.toContain('transform');
    expect(rule).not.toContain('transition');
    expect(rule).not.toContain('--sw-color');
  });
});

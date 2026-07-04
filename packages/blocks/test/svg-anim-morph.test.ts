import { describe, it, expect } from 'vitest';
import { SVG_ANIM_MORPH_JS, usesSvgAnimMorph } from '../src/svg-anim-morph.js';

describe('SVG morph runtime', () => {
  it('ships only when the literal morph marker is present (its own only-used-ships chunk)', () => {
    expect(usesSvgAnimMorph('<path data-sw-svg="morph" data-sw-svg-to="M0 0"/>')).toBe(true);
    expect(usesSvgAnimMorph('<path data-sw-svg="draw"/>')).toBe(false); // core-only, not morph
    expect(usesSvgAnimMorph('<div>plain</div>')).toBe(false);
    expect(usesSvgAnimMorph(null)).toBe(false);
  });

  it('bails under reduced motion (leaves the authored start shape — PE-safe)', () => {
    expect(SVG_ANIM_MORPH_JS).toContain('(prefers-reduced-motion: reduce)');
    const bail = SVG_ANIM_MORPH_JS.indexOf('(prefers-reduced-motion: reduce)');
    const write = SVG_ANIM_MORPH_JS.indexOf("setAttribute('d'");
    expect(bail).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(bail); // no d rewrite before the reduced-motion bail
  });

  it('samples both paths (getPointAtLength) and validates author path-data before use', () => {
    expect(SVG_ANIM_MORPH_JS).toContain('getPointAtLength');
    expect(SVG_ANIM_MORPH_JS).toContain('getTotalLength');
    expect(SVG_ANIM_MORPH_JS).toMatch(/MmLlHhVvCcSsQqTtAaZz/); // path-data grammar guard
    expect(SVG_ANIM_MORPH_JS).toContain('data-sw-svg-to');
  });

  it('is view/load triggered via IntersectionObserver + the shared timing helper', () => {
    expect(SVG_ANIM_MORPH_JS).toContain('IntersectionObserver');
    expect(SVG_ANIM_MORPH_JS).toContain('function swMs(');
    expect(SVG_ANIM_MORPH_JS).toContain("getAttribute('data-sw-once')!=='false'");
  });

  it('replays correctly (data-sw-once="false"): caches the ORIGINAL start d + restores it on viewport-leave', () => {
    // After a morph completes d IS the target; without caching, replay would sample target→target (no-op).
    expect(SVG_ANIM_MORPH_JS).toContain('__swMorphFrom');
    expect(SVG_ANIM_MORPH_JS).toContain('sample(el.__swMorphFrom)');
    // On viewport-leave (only when once="false" and not mid-morph) the start shape is restored.
    expect(SVG_ANIM_MORPH_JS).toMatch(/else if\(!once\(el\)&&!el\.__swMorphing&&el\.__swMorphFrom!=null\)el\.setAttribute\('d',el\.__swMorphFrom\)/);
  });

  it('cannot break out of a <script> block', () => {
    expect(SVG_ANIM_MORPH_JS.toLowerCase()).not.toContain('</script');
  });
});

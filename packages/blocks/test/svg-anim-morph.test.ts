import { describe, it, expect } from 'vitest';
import { SVG_ANIM_MORPH_JS, usesSvgAnimMorph } from '../src/svg-anim-morph.js';

describe('SVG morph runtime', () => {
  it('ships only when the literal morph marker is present (its own only-used-ships chunk)', () => {
    expect(usesSvgAnimMorph('<path data-sw-svg="morph" data-sw-svg-to="M0 0"/>')).toBe(true);
    expect(usesSvgAnimMorph('<path data-sw-svg="draw"/>')).toBe(false); // core-only, not morph
    expect(usesSvgAnimMorph('<div>plain</div>')).toBe(false);
    expect(usesSvgAnimMorph(null)).toBe(false);
    // Also ships for an <img data-sw-svg> — the referenced .svg may contain morph the page-scan can't see.
    expect(usesSvgAnimMorph('<img data-sw-svg src="/media/x/y/a.svg">')).toBe(true);
  });

  it('handles morph inside a runtime-inlined <img> SVG (runMorph on the sw-svg-inlined subtree)', () => {
    expect(SVG_ANIM_MORPH_JS).toContain('function runMorph(root)');
    expect(SVG_ANIM_MORPH_JS).toContain("addEventListener('sw-svg-inlined'");
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
    expect(SVG_ANIM_MORPH_JS).toContain("dv(el,'data-sw-once')!=='false'"); // once read via dv (element-or-svg)
    expect(SVG_ANIM_MORPH_JS).toContain("dv(el,'data-sw-svg-trigger')==='load'");
  });

  it('replays correctly (data-sw-once="false"): caches the ORIGINAL start d + restores it on viewport-leave', () => {
    // After a morph completes d IS the target; without caching, replay would sample target→target (no-op).
    expect(SVG_ANIM_MORPH_JS).toContain('__swMorphFrom');
    expect(SVG_ANIM_MORPH_JS).toContain('sample(el.__swMorphFrom)');
    // On viewport-leave (a replay OR a looping morph) the loop is stopped; the start shape is restored only
    // if no tween is mid-flight (__swMorphActive) — avoids an ugly mid-tween snap on a quick scroll-through.
    expect(SVG_ANIM_MORPH_JS).toContain("else if(el.__swMorphFrom!=null&&(!once(el)||loopOf(el)>0)){if(el.__swLoopT){clearTimeout(el.__swLoopT);el.__swLoopT=0;}if(!el.__swMorphActive){el.__swGen=(el.__swGen||0)+1;el.setAttribute('d',el.__swMorphFrom);}}");
  });

  it('honours the whole-SVG loop + click directives (read from the element OR its owner <svg>)', () => {
    // dv() reads a directive from the morph element, else its owner svg — so loop/click/trigger/once can be
    // authored on the root <svg> like the core engine's whole-SVG settings.
    expect(SVG_ANIM_MORPH_JS).toContain('function dv(el,name)');
    expect(SVG_ANIM_MORPH_JS).toContain('el.ownerSVGElement');
    // auto-repeat: snap to start + re-morph after the loop period (self-clearing, generation-guarded).
    expect(SVG_ANIM_MORPH_JS).toContain('function scheduleLoop(el,gen,total)');
    expect(SVG_ANIM_MORPH_JS).toContain('scheduleLoop(el,gen,dur+delay)');
    expect(SVG_ANIM_MORPH_JS).toContain('var LOOP_MIN=500,LOOP_MAX=600000');
    // click-to-replay on the owner svg (one listener per svg).
    expect(SVG_ANIM_MORPH_JS).toContain("dv(el,'data-sw-svg-click')!=='true'");
    expect(SVG_ANIM_MORPH_JS).toContain('s.__swMorphClick');
  });

  it('cannot break out of a <script> block', () => {
    expect(SVG_ANIM_MORPH_JS.toLowerCase()).not.toContain('</script');
  });
});

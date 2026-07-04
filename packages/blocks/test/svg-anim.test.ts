import { describe, it, expect } from 'vitest';
import {
  SVG_ANIM_CSS,
  SVG_ANIM_JS,
  SVG_ANIM_EFFECTS,
  SVG_ANIM_LIMITS,
  usesSvgAnim,
} from '../src/svg-anim.js';

describe('SVG animation stylesheet', () => {
  it('hides the pre-play state ONLY behind the runtime class, inside prefers-reduced-motion:no-preference', () => {
    // The only opacity:0 must be gated on BOTH .sw-svg-init (runtime-added → PE-first) and the
    // no-preference media query (→ reduced-motion visitors are never hidden).
    expect(SVG_ANIM_CSS).toContain('@media (prefers-reduced-motion: no-preference){[data-sw-svg].sw-svg-init{opacity:0}}');
    // No ungated hide of the base selector.
    expect(SVG_ANIM_CSS).not.toMatch(/\[data-sw-svg\]\s*\{[^}]*opacity:0/);
  });

  it('sets transform-box:fill-box so % translate + transform-origin resolve per-element (viewBox-safe)', () => {
    expect(SVG_ANIM_CSS).toContain('transform-box:fill-box');
  });

  it('cannot break out of a <style> block', () => {
    expect(SVG_ANIM_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('SVG animation runtime', () => {
  it('bails entirely under prefers-reduced-motion (never hides, never animates)', () => {
    expect(SVG_ANIM_JS).toContain('(prefers-reduced-motion: reduce)');
    // The reduced-motion return precedes ANY class-add so content stays visible.
    const idxBail = SVG_ANIM_JS.indexOf('(prefers-reduced-motion: reduce)');
    const idxInit = SVG_ANIM_JS.indexOf("classList.add('sw-svg-init')");
    expect(idxBail).toBeGreaterThan(-1);
    expect(idxInit).toBeGreaterThan(idxBail);
  });

  it('drives the draw effect with getTotalLength + stroke-dashoffset', () => {
    expect(SVG_ANIM_JS).toContain('getTotalLength');
    expect(SVG_ANIM_JS).toContain('strokeDashoffset');
    expect(SVG_ANIM_JS).toContain('strokeDasharray');
  });

  it('animates via the Web Animations API, not a scroll/rAF loop', () => {
    expect(SVG_ANIM_JS).toContain('.animate(');
  });

  it('allowlists the effect keyword (unknown → fade) — never trusts the raw attribute', () => {
    expect(SVG_ANIM_JS).toContain("return 'fade'");
    // The effect list is serialized into the runtime for the membership check.
    expect(SVG_ANIM_JS).toContain(JSON.stringify(SVG_ANIM_EFFECTS));
  });

  it('clamps duration to SVG_ANIM_LIMITS and reads timing via the shared swMs helper', () => {
    expect(SVG_ANIM_JS).toContain(`var DMIN=${SVG_ANIM_LIMITS.duration.min},DMAX=${SVG_ANIM_LIMITS.duration.max}`);
    expect(SVG_ANIM_JS).toContain("swMs(el,'data-sw-duration',400)");
    expect(SVG_ANIM_JS).toContain('function swMs('); // embedded from timing.ts
  });

  it('gates view-triggered units behind one IntersectionObserver (off-screen SVGs do no work)', () => {
    expect(SVG_ANIM_JS).toContain("'IntersectionObserver' in window");
    expect(SVG_ANIM_JS).toContain('io.observe(u.root)');
  });

  it('orchestrates scenes with a clamped stagger step and honours data-sw-once for replay', () => {
    expect(SVG_ANIM_JS).toContain("swMs(s,'data-sw-svg-stagger',0)");
    expect(SVG_ANIM_JS).toContain(`if(step>${SVG_ANIM_LIMITS.stagger.max})step=${SVG_ANIM_LIMITS.stagger.max}`); // stagger clamped to the advertised limit
    expect(SVG_ANIM_JS).toContain("getAttribute('data-sw-once')!=='false'");
    expect(SVG_ANIM_JS).toContain('resetUnit'); // replay path re-hides members
  });

  it('a standalone (non-scene) element uses its OWN data-sw-svg-trigger (no dead scene-attr check)', () => {
    expect(SVG_ANIM_JS).toContain('trigger:trig,members:[member(el,0)]');
    expect(SVG_ANIM_JS).not.toContain("root:el,trigger:el.getAttribute('data-sw-svg-scene-trigger')");
  });

  it('validates data-sw-svg-origin against an allowlist pattern (no style injection)', () => {
    expect(SVG_ANIM_JS).toMatch(/\/\^\[a-z- \]\{1,20\}\$\//);
  });

  it('cannot break out of a <script> block', () => {
    expect(SVG_ANIM_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('SVG animation detection + surface', () => {
  it('detects the data-sw-svg marker in authored HTML', () => {
    expect(usesSvgAnim('<svg><path data-sw-svg="draw"/></svg>')).toBe(true);
    expect(usesSvgAnim('<svg data-sw-svg-scene><path data-sw-svg="fade"/></svg>')).toBe(true);
    expect(usesSvgAnim('<div class="card">plain</div>')).toBe(false);
    expect(usesSvgAnim('')).toBe(false);
    expect(usesSvgAnim(undefined)).toBe(false);
    expect(usesSvgAnim(null)).toBe(false);
  });

  it('the marker does NOT collide with the entrance engine (data-sw-animation)', () => {
    // Critical: data-sw-svg must not be a substring of data-sw-animation (it isn't), else the
    // SVG runtime would ship on every entrance page.
    expect('data-sw-animation'.includes('data-sw-svg')).toBe(false);
  });

  it('exposes a stable, allowlisted effect vocabulary incl. draw, scale/expand, reveals, along-path + morph', () => {
    for (const e of ['draw', 'fade-up', 'flip-x', 'scale-tl', 'scale-c', 'expand-x', 'expand-b', 'along-path', 'reveal-right', 'reveal-iris', 'morph']) {
      expect(SVG_ANIM_EFFECTS).toContain(e);
    }
    expect(new Set(SVG_ANIM_EFFECTS).size).toBe(SVG_ANIM_EFFECTS.length); // no dupes
  });

  it('draw-then-fill: hides the fill during the draw, then reveals it (not shown throughout)', () => {
    expect(SVG_ANIM_JS).toContain('function svgDraw('); // draw setup path
    expect(SVG_ANIM_JS).toContain("fillOpacity='0'"); // fill hidden while drawing
    expect(SVG_ANIM_JS).toContain('function svgFillReveal('); // reveal AFTER the stroke draws
    expect(SVG_ANIM_JS).toContain('data-sw-svg-draw-color'); // author stroke color/width
    expect(SVG_ANIM_JS).toContain('data-sw-svg-draw-width');
  });

  it('supports an OUT (exit) direction: not init-hidden, plays natural→hidden', () => {
    expect(SVG_ANIM_JS).toContain("data-sw-svg-dir')==='out'");
    expect(SVG_ANIM_JS).toContain('if(m.io===');
    expect(SVG_ANIM_JS).toContain("if(m.io!=='out')m.el.classList.add('sw-svg-init')"); // OUT starts visible
  });

  it('drives reveals via clip-path and along-path via CSS offset-path, with validated path data', () => {
    expect(SVG_ANIM_JS).toContain('SVG_REVEAL');
    expect(SVG_ANIM_JS).toContain('clipPath');
    expect(SVG_ANIM_JS).toContain('offsetPath');
    expect(SVG_ANIM_JS).toContain('offsetDistance');
    // author path-data is grammar-validated before it reaches CSS.
    expect(SVG_ANIM_JS).toMatch(/MmLlHhVvCcSsQqTtAaZz/);
  });

  it('leaves morph to the separate morph runtime (the core skips data-sw-svg="morph")', () => {
    expect(SVG_ANIM_JS).toContain('isMorph');
    expect(SVG_ANIM_JS).toContain("getAttribute('data-sw-svg')==='morph'");
  });
});

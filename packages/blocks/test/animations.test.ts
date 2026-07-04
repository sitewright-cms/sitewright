import { describe, it, expect } from 'vitest';
import {
  ANIMATION_CSS,
  ANIMATION_JS,
  ANIMATION_EFFECTS,
  usesAnimations,
} from '../src/animations.js';

describe('animation stylesheet', () => {
  it('gates ALL motion behind prefers-reduced-motion: no-preference', () => {
    expect(ANIMATION_CSS.startsWith('@media (prefers-reduced-motion: no-preference){')).toBe(true);
    expect(ANIMATION_CSS.trimEnd().endsWith('}')).toBe(true);
  });

  it('hides content ONLY via the runtime-added .sw-animation-init class (PE: no-JS renders visible)', () => {
    // Every opacity:0 rule must be gated on .sw-animation-init — never a bare [data-sw-animation]
    // selector, which would hide content when the runtime doesn't run.
    for (const line of ANIMATION_CSS.split('\n')) {
      if (line.includes('opacity:0')) expect(line).toContain('.sw-animation-init');
    }
    expect(ANIMATION_CSS).not.toMatch(/\[data-sw-animation\]\s*\{/); // ungated base selector
  });

  it('defines an initial transform for every directional effect (plain fade is the base rule)', () => {
    for (const effect of ANIMATION_EFFECTS) {
      if (effect === 'fade') continue; // base rule, no dedicated transform
      expect(ANIMATION_CSS).toContain(`[data-sw-animation="${effect}"].sw-animation-init{transform:`);
    }
  });

  it('reveals via .sw-animation-active as the LAST rule (wins the order tie at equal specificity)', () => {
    const reveal = ANIMATION_CSS.indexOf('[data-sw-animation].sw-animation-active');
    expect(reveal).toBeGreaterThan(-1);
    expect(ANIMATION_CSS).toContain('opacity:1;pointer-events:auto;transform:none');
    // No effect rule after the reveal rule.
    expect(ANIMATION_CSS.slice(reveal)).not.toContain('.sw-animation-init{');
  });

  it('suspends pointer-events while hidden (invisible content must not be clickable)', () => {
    expect(ANIMATION_CSS).toContain('pointer-events:none');
  });

  it('cannot break out of a <style> block', () => {
    expect(ANIMATION_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('animation runtime', () => {
  it('bails out without IntersectionObserver and under prefers-reduced-motion', () => {
    expect(ANIMATION_JS).toContain("'IntersectionObserver' in window");
    expect(ANIMATION_JS).toContain('(prefers-reduced-motion: reduce)');
  });

  it('speaks the animation class protocol (sw-animation-init / sw-animation-active)', () => {
    expect(ANIMATION_JS).toContain("classList.add('sw-animation-init')");
    expect(ANIMATION_JS).toContain("classList.add('sw-animation-active')");
  });

  it('EXCLUDES Banner roots from the scroll observer (a data-sw-animation Banner drives its own entrance on reveal)', () => {
    expect(ANIMATION_JS).toContain('[data-sw-animation]:not([data-sw-component="banner"])');
  });

  it('clamps delay/duration and resolves easing through a fixed allowlist (no style injection)', () => {
    expect(ANIMATION_JS).toContain('Math.max(0,Math.min(v,20000))'); // shared swMs clamp (timing.ts)
    expect(ANIMATION_JS).toContain('parseInt');
    expect(ANIMATION_JS).toContain('isNaN(v)?def'); // non-numeric attribute → falls back to the default (0) → no inline style
    expect(ANIMATION_JS).toContain("swMs(el,'data-sw-duration',0)"); // duration read via the shared primitive
    // Easing values resolve through a NULL-PROTOTYPE map, so a hostile key
    // ('constructor', 'toString') misses instead of resolving to an inherited
    // member; the attribute string itself is never assigned to a style property.
    expect(ANIMATION_JS).toContain('var EASINGS=Object.create(null)');
    expect(ANIMATION_JS).not.toMatch(/style\.transitionTimingFunction=el\.getAttribute/);
  });

  it('replays only when data-sw-once="false"; unobserves otherwise (the default)', () => {
    expect(ANIMATION_JS).toContain("getAttribute('data-sw-once')!=='false'");
    expect(ANIMATION_JS).toContain('io.unobserve(el)');
  });

  it('cannot break out of a <script> block', () => {
    expect(ANIMATION_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('animation detection', () => {
  it('detects data-sw-animation in an authored HTML/template string', () => {
    expect(usesAnimations('<div data-sw-animation="fade-up">x</div>')).toBe(true);
    expect(usesAnimations('<div class="card">plain</div>')).toBe(false);
    expect(usesAnimations('')).toBe(false);
    expect(usesAnimations(undefined)).toBe(false);
    expect(usesAnimations(null)).toBe(false);
  });

});

import { describe, it, expect } from 'vitest';
import {
  ANIMATION_CSS,
  ANIMATION_JS,
  ANIMATION_NOSCRIPT,
  ANIMATION_EFFECTS,
  usesAnimations,
} from '../src/animations.js';

describe('animation stylesheet', () => {
  it('gates ALL motion behind prefers-reduced-motion: no-preference', () => {
    expect(ANIMATION_CSS.startsWith('@media (prefers-reduced-motion: no-preference){')).toBe(true);
    expect(ANIMATION_CSS.trimEnd().endsWith('}')).toBe(true);
  });

  it('hides non-banner content from FIRST PAINT (not gated on a JS-added class → no show/hide flash)', () => {
    // The hidden rule is 0-specificity-wrapped so the non-banner branch hides BEFORE the runtime runs:
    // there is no `.sw-XXX-init{opacity:0}` class gate that would leave content painted visible until the
    // deferred script hides it (the old cause of the show→hide→animate flash behind the preloader).
    expect(ANIMATION_CSS).toContain(
      '[data-sw-animation]:where(:not([data-sw-component="banner"]):not(.sw-animation-active),.sw-animation-init){opacity:0',
    );
    // The hide still lives inside the reduced-motion gate, so a reduced-motion visitor is never hidden.
    for (const line of ANIMATION_CSS.split('\n')) {
      if (line.includes('opacity:0')) expect(line).not.toMatch(/^\s*\[data-sw-animation\]\s*\{/);
    }
  });

  it('is PE-first via a CSS self-heal failsafe + a noscript un-hide (never strands content hidden)', () => {
    // A non-banner element the runtime never ARMS reveals itself after a grace period (JS off / script
    // failed) — content is never stranded invisible.
    expect(ANIMATION_CSS).toContain(
      '[data-sw-animation]:not([data-sw-component="banner"]):not(.sw-animation-armed):not(.sw-animation-active){animation:sw-anim-reveal',
    );
    expect(ANIMATION_CSS).toContain('@keyframes sw-anim-reveal{to{opacity:1;transform:none;pointer-events:auto}}');
    // The no-JS override cancels the first-paint hide + failsafe immediately (mirrors SVG_ANIM_NOSCRIPT).
    expect(ANIMATION_NOSCRIPT).toContain('[data-sw-animation]{opacity:1!important');
    expect(ANIMATION_NOSCRIPT).toContain('animation:none!important');
    expect(ANIMATION_NOSCRIPT).toContain('pointer-events:auto!important');
  });

  it('defines an initial transform for every directional effect (plain fade is the base rule)', () => {
    for (const effect of ANIMATION_EFFECTS) {
      if (effect === 'fade') continue; // base rule, no dedicated transform
      expect(ANIMATION_CSS).toContain(`[data-sw-animation="${effect}"]:where(`);
      expect(ANIMATION_CSS).toMatch(new RegExp(`\\[data-sw-animation="${effect}"\\]:where\\([^{]*\\)\\{transform:`));
    }
  });

  it('reveals via .sw-animation-active as the LAST rule (wins on specificity — (0,2,0) beats (0,1,0))', () => {
    const reveal = ANIMATION_CSS.indexOf('[data-sw-animation].sw-animation-active');
    expect(reveal).toBeGreaterThan(-1);
    expect(ANIMATION_CSS).toContain('opacity:1;pointer-events:auto;transform:none');
    // No effect/hidden transform rule after the reveal rule (it must be last so nothing overrides it).
    expect(ANIMATION_CSS.slice(reveal)).not.toContain(']:where(');
  });

  it('suspends pointer-events while hidden (invisible content must not be clickable)', () => {
    expect(ANIMATION_CSS).toContain('pointer-events:none');
  });

  it('cannot break out of a <style> block', () => {
    expect(ANIMATION_CSS.toLowerCase()).not.toContain('</style');
    expect(ANIMATION_NOSCRIPT.toLowerCase()).not.toContain('</style');
  });
});

describe('animation runtime', () => {
  it('bails out without IntersectionObserver and under prefers-reduced-motion', () => {
    expect(ANIMATION_JS).toContain("'IntersectionObserver' in window");
    expect(ANIMATION_JS).toContain('(prefers-reduced-motion: reduce)');
  });

  it('ARMS each element (cancels the CSS failsafe) and reveals via sw-animation-active', () => {
    // The runtime no longer HIDES via JS (CSS hides from first paint); it ARMS so the self-heal failsafe
    // stands down, then reveals in-view elements by adding .sw-animation-active.
    expect(ANIMATION_JS).toContain("classList.add('sw-animation-armed')");
    expect(ANIMATION_JS).toContain("classList.add('sw-animation-active')");
  });

  it('never suppresses/restores an inline transition (no transition:none reflow hack) — CSS hides pre-paint', () => {
    // Since content is hidden from FIRST PAINT by CSS, there is no already-painted state to suppress an
    // animate-OUT for: the reveal is the only transition, so the runtime must not touch el.style.transition.
    expect(ANIMATION_JS).not.toContain("el.style.transition='none'");
    expect(ANIMATION_JS).not.toContain("el.style.transition=''");
    expect(ANIMATION_JS).not.toContain('offsetHeight');
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

  it('gates the reveal on the page-ready signal (starts after preloader clear / load, not behind it)', () => {
    // Elements are armed as soon as JS runs, but OBSERVING (the reveal) waits for swWhenReady.
    expect(ANIMATION_JS).toContain('function swWhenReady(');
    expect(ANIMATION_JS).toContain("addEventListener('sw:ready'");
    expect(ANIMATION_JS).toContain('swWhenReady(function(){');
    // observation happens inside the ready callback, not eagerly in the setup loop.
    expect(ANIMATION_JS).toMatch(/swWhenReady\(function\(\)\{[\s\S]*io\.observe\(el\)/);
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

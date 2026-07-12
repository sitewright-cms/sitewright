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

  it('declares the reveal transition UNCONDITIONALLY (not on the hidden selector) so the reveal ANIMATES, not pops', () => {
    // REGRESSION GUARD: if the transition-property lived on the `:where()` hidden selector, adding
    // `.sw-animation-active` would make the element STOP matching it — so the transition would vanish in
    // the SAME style recalc that flips opacity/transform → the reveal would POP. It MUST sit on a bare
    // `[data-sw-animation]{…}` rule so it is present in BOTH the hidden and revealed states.
    expect(ANIMATION_CSS).toContain('[data-sw-animation]{transition-property:opacity,transform;transition-duration:450ms');
    // No `:where(...)`-gated rule may (re)declare transition-property — that reintroduces the pop coupling.
    for (const line of ANIMATION_CSS.split('\n')) {
      if (line.includes('transition-property')) expect(line).not.toContain(':where(');
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

  it('applies data-sw-delay + data-sw-duration inline (clamped via swMs) and resolves easing via a fixed allowlist', () => {
    expect(ANIMATION_JS).toContain('Math.max(0,Math.min(v,20000))'); // shared swMs clamp (timing.ts)
    expect(ANIMATION_JS).toContain('parseInt');
    expect(ANIMATION_JS).toContain('isNaN(v)?def'); // non-numeric attribute → falls back to the default → no inline style
    expect(ANIMATION_JS).toContain("swMs(el,'data-sw-duration',0)"); // custom duration read via the shared primitive
    expect(ANIMATION_JS).toContain("swMs(el,'data-sw-delay',0)"); // custom delay read via the shared primitive
    expect(ANIMATION_JS).toContain('el.style.transitionDuration=duration'); // applied inline
    expect(ANIMATION_JS).toContain('el.style.transitionDelay=delay'); // applied inline
    // Easing values resolve through a NULL-PROTOTYPE map, so a hostile key
    // ('constructor', 'toString') misses instead of resolving to an inherited
    // member; the attribute string itself is never assigned to a style property.
    expect(ANIMATION_JS).toContain('var EASINGS=Object.create(null)');
    expect(ANIMATION_JS).not.toMatch(/style\.transitionTimingFunction=el\.getAttribute/);
  });

  it('default duration is 450ms (SW_DURATION_DEFAULT) in the CSS; a custom data-sw-duration overrides inline', () => {
    expect(ANIMATION_CSS).toContain('transition-duration:450ms');
    // The runtime only writes an inline transitionDuration when data-sw-duration>0, so unset falls through
    // to the CSS default; when set, the inline value wins.
    expect(ANIMATION_JS).toContain('if(duration>0)el.style.transitionDuration=duration');
  });

  it('REPLAYS by default (unobserves only for data-sw-once="true"); resets on a FULL exit', () => {
    // Default = replay: the element is only unobserved when the author opts into play-once.
    expect(ANIMATION_JS).toContain("getAttribute('data-sw-once')==='true'");
    expect(ANIMATION_JS).not.toContain("getAttribute('data-sw-once')!=='false'"); // old play-once default is gone
    expect(ANIMATION_JS).toContain('io.unobserve(el)');
    // Reset (replay enabler) fires ONLY on a full exit — never while any part is still on screen.
    expect(ANIMATION_JS).toContain('entry.intersectionRatio===0');
    expect(ANIMATION_JS).toContain("classList.remove('sw-animation-active')");
  });

  it('reveals when MEANINGFULLY in view — per-element data-sw-threshold (default 0.2), later than an edge-touch', () => {
    // The reveal is gated on intersectionRatio vs a PER-ELEMENT threshold (data-sw-threshold, default 0.2),
    // not a bare isIntersecting edge-touch; the observer uses a negative bottom rootMargin so the trigger
    // line sits above the viewport bottom.
    expect(ANIMATION_JS).toContain("entry.intersectionRatio>=swRatio(el,'data-sw-threshold',0.2)");
    // A single observer applies ONE threshold list to all targets → the runtime UNIONS every element's
    // threshold (+ 0 for the reset) so the callback fires at each element's own crossing.
    expect(ANIMATION_JS).toContain("thrSet[swRatio(el,'data-sw-threshold',0.2)]=1");
    expect(ANIMATION_JS).toContain('threshold:THRESHOLDS');
    expect(ANIMATION_JS).toMatch(/rootMargin:'0px 0px -\d+% 0px'/);
    // swRatio parses + CLAMPS the threshold to [0,1] (never injects — compared only as a number).
    expect(ANIMATION_JS).toContain('function swRatio(el,attr,def){var v=parseFloat(el.getAttribute(attr));return isNaN(v)?def:Math.max(0,Math.min(v,1));}');
    // Guarded against a redundant re-add while already shown.
    expect(ANIMATION_JS).toContain("!el.classList.contains('sw-animation-active')");
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

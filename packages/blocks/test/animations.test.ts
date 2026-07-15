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

  it('REPLAYS by default via a SEPARATE full-viewport RESET observer (exitIo); resets only on a FULL exit, either direction', () => {
    // Default = replay: the element is only unobserved when the author opts into play-once.
    expect(ANIMATION_JS).toContain("getAttribute('data-sw-once')==='true'");
    expect(ANIMATION_JS).not.toContain("getAttribute('data-sw-once')!=='false'"); // old play-once default is gone
    expect(ANIMATION_JS).toContain('io.unobserve(el)');
    // The reset lives in a DEDICATED full-viewport observer (rootMargin 0, threshold [0]) whose ratio===0
    // fires EXACTLY when no part is on screen — top OR bottom. So (a) content resting in view (incl. the -20%
    // observer's bottom-margin band) is never reset while visible, and (b) an element scrolled fully off the
    // BOTTOM still resets — which a single -20% observer can't see (it reads ratio 0 at the -20% line and
    // never fires again below it), which is what broke bottom-exit replay.
    expect(ANIMATION_JS).toContain('var exitIo=new IntersectionObserver(');
    expect(ANIMATION_JS).toMatch(/exitIo=new IntersectionObserver\([\s\S]*?\},\{threshold:\[0\],root:scrollRoot\}\)/);
    expect(ANIMATION_JS).toContain("entry.intersectionRatio===0&&entry.target.classList.contains('sw-animation-active')");
    expect(ANIMATION_JS).toContain("entry.target.classList.remove('sw-animation-active')");
    // Every armed element is observed by BOTH the reveal observer and the reset observer.
    expect(ANIMATION_JS).toContain('io.observe(el)');
    expect(ANIMATION_JS).toContain('exitIo.observe(el)');
    // The old single-observer reset machinery (WeakSet gate + boundingClientRect off-screen probe) is GONE.
    expect(ANIMATION_JS).not.toContain('new WeakSet()');
    expect(ANIMATION_JS).not.toContain('r.top>=vp');
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
    // The observer root is PINNED to the body when it is the scroll container (whole-site preview's
    // body-scroll), else null — so a percentage rootMargin resolves against the real scrollport on every
    // engine, not just Chromium. The primary observer passes root:scrollRoot alongside its -20% margin.
    expect(ANIMATION_JS).toContain("if(getComputedStyle(document.body).overflowY==='auto')scrollRoot=document.body");
    expect(ANIMATION_JS).toContain("rootMargin:'0px 0px -20% 0px',root:scrollRoot");
    // swRatio parses + CLAMPS the threshold to [0,1] (never injects — compared only as a number).
    expect(ANIMATION_JS).toContain('function swRatio(el,attr,def){var v=parseFloat(el.getAttribute(attr));return isNaN(v)?def:Math.max(0,Math.min(v,1));}');
  });

  it('data-sw-once reveals once and stops BOTH observers (reveal + reset) watching it, so it can never re-hide', () => {
    // Reveal goes through the shared swReveal(el) helper: add the class, then for data-sw-once="true" detach
    // the element from the reveal observer AND the reset observer — otherwise the reset observer would still
    // hide the once-element when it later scrolls fully off. No `!contains(active)` guard (add is idempotent).
    expect(ANIMATION_JS).not.toContain("if(!el.classList.contains('sw-animation-active'))");
    expect(ANIMATION_JS).toContain('function swReveal(el){');
    expect(ANIMATION_JS).toContain("el.classList.add('sw-animation-active')");
    expect(ANIMATION_JS).toContain("if(el.getAttribute('data-sw-once')==='true'){io.unobserve(el);exitIo.unobserve(el);}");
  });

  it('gates the reveal on the page-ready signal (starts after preloader clear / load, not behind it)', () => {
    // Elements are armed as soon as JS runs, but OBSERVING (the reveal) waits for swWhenReady.
    expect(ANIMATION_JS).toContain('function swWhenReady(');
    expect(ANIMATION_JS).toContain("addEventListener('sw:ready'");
    expect(ANIMATION_JS).toContain('swWhenReady(function(){');
    // observation happens inside the ready callback, not eagerly in the setup loop.
    expect(ANIMATION_JS).toMatch(/swWhenReady\(function\(\)\{[\s\S]*io\.observe\(el\)/);
  });

  it('reveals ON LOAD via a SECOND full-viewport observer (loadIo) — no -20% margin, so on-screen content animates in without a scroll', () => {
    // The primary observer's negative bottom rootMargin is a SCROLL-reveal nicety, but at LOAD it would trap
    // on-screen content hidden — a section right under a tall hero is only a sliver past the shrink line, and
    // a card pinned to the bottom edge sits entirely below it, so both stay blank until the visitor scrolls.
    // A SECOND observer over the FULL viewport (default rootMargin) reveals them at load; being an observer it
    // also catches a near-fold element a late lazy image shifts into view AFTER ready.
    expect(ANIMATION_JS).toContain('var loadIo=new IntersectionObserver(');
    // loadIo has NO negative rootMargin (full viewport) — that is the whole point. The only observer that
    // carries the -20% bottom margin is the primary `io`. Both share the resolved scroll `root`.
    expect(ANIMATION_JS).toMatch(/loadIo=new IntersectionObserver\([\s\S]*?\},\{threshold:THRESHOLDS,root:scrollRoot\}\)/);
    // It only reveals (via swReveal — no reset branch) …
    expect(ANIMATION_JS).toContain('swReveal(entry.target)');
    expect(ANIMATION_JS).toContain('loadIo.observe(el)');
    // … and disconnects at the FIRST scroll so the primary -20% observer owns reveal-as-you-scroll after that.
    // capture:true also catches an inner-container scroll (scroll doesn't bubble) so loadIo never lingers.
    expect(ANIMATION_JS).toMatch(/addEventListener\('scroll',function\(\)\{loadIo\.disconnect\(\);\},\{once:true,capture:true,passive:true\}\)/);
    // The disconnect is ARMED only after loadIo's first async delivery (loadArmed flag) — an early scroll
    // before loadIo has ever revealed must NOT be able to disconnect it (else the blank band returns).
    expect(ANIMATION_JS).toContain('var loadArmed=false');
    expect(ANIMATION_JS).toContain('if(!loadArmed){loadArmed=true;addEventListener(');
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

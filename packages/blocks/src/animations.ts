// Animation (Entrance + Scroll-Reveal): a first-party runtime for the `data-sw-animation`
// attribute vocabulary (`data-sw-animation="fade-up"`, `data-sw-delay="200"`, …).
//
// Tenants and AI agents author plain `data-sw-animation` attributes in code-first page sources,
// skeleton slots, snippets, or raw Html blocks — one small, self-describing vocabulary. No
// third-party animation library is bundled (WOW.js never will be — GPL + abandoned); this module
// ships a tiny audited implementation under the same only-used-ships discipline as components.ts.
// Timing is shared with the SVG engine via the `data-sw-duration/-delay/-easing/-once` primitives
// (see timing.ts), so there is one timing language across every animation family.
//
// Invariants:
// - No-FOUC: a scroll-reveal element is hidden from FIRST PAINT by CSS (see {@link HIDDEN}) so it never
//   flashes visible in its final position before the deferred runtime reveals it (the old class-gated
//   hide painted content visible until the script ran, then popped it hidden — a visible flash through
//   the translucent preloader). The runtime reveals by adding `.sw-animation-active`.
// - PE-first is preserved WITHOUT leaving content visible pre-JS: a `<noscript>` un-hide
//   ({@link ANIMATION_NOSCRIPT}) restores content when scripting is off, and a CSS self-heal failsafe
//   reveals any element the runtime never `sw-animation-armed`s (script failed to load). Mirrors the SVG
//   engine (svg-anim.ts). A Banner is the sole `.sw-animation-init` user — it ships `hidden` and
//   self-drives its entrance (banner.ts), so it is excluded from the first-paint hide + the failsafe.
// - Accessibility: all motion (and the first-paint hide + failsafe) sits inside
//   `prefers-reduced-motion: no-preference`, and the runtime also bails out under reduced motion.
// - First-party, audited, static code only — tenants supply DATA (attribute values, parsed /
//   clamped / allowlisted below); never JavaScript.
import { SW_TIMING_ATTRS, SW_DURATION_DEFAULT, SW_EASINGS, SW_TIMING_CORE, SW_READY_CORE } from './timing.js';

/** The `data-sw-animation` effects with a dedicated initial transform (plain `fade` is the base rule). */
export const ANIMATION_EFFECTS: readonly string[] = [
  'fade',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'zoom-in',
  'zoom-out',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'flip-up',
  'flip-down',
  'flip-left',
  'flip-right',
];

// Initial (pre-reveal) transform per effect. An unknown/empty effect simply
// falls back to the base opacity fade — graceful, never broken.
const EFFECT_TRANSFORMS: ReadonlyArray<readonly [string, string]> = [
  ['fade-up', 'translate3d(0,2rem,0)'],
  ['fade-down', 'translate3d(0,-2rem,0)'],
  ['fade-right', 'translate3d(-2rem,0,0)'],
  ['fade-left', 'translate3d(2rem,0,0)'],
  ['zoom-in', 'scale3d(.6,.6,.6)'],
  ['zoom-out', 'scale3d(1.2,1.2,1.2)'],
  ['slide-up', 'translate3d(0,100%,0)'],
  ['slide-down', 'translate3d(0,-100%,0)'],
  ['slide-right', 'translate3d(-100%,0,0)'],
  ['slide-left', 'translate3d(100%,0,0)'],
  ['flip-up', 'perspective(2500px) rotateX(-100deg)'],
  ['flip-down', 'perspective(2500px) rotateX(100deg)'],
  ['flip-left', 'perspective(2500px) rotateY(-100deg)'],
  ['flip-right', 'perspective(2500px) rotateY(100deg)'],
];

// The hidden-state selector. Two branches, both 0-specificity-wrapped in `:where()` so the
// `.sw-animation-active` reveal rule (0,2,0) always wins over these hidden rules (0,1,0):
//  - non-banner scroll-reveal elements are hidden from FIRST PAINT (NOT gated on a JS-added class), so
//    they never flash visible in their final position before the deferred runtime reveals them. PE-first
//    is preserved by the noscript un-hide + the CSS self-heal failsafe below (mirrors the SVG engine),
//    not by leaving content visible pre-JS — which caused a visible show→hide→animate flash through the
//    translucent preloader.
//  - a Banner (`data-sw-component="banner"`) is EXCLUDED from the first-paint hide (it ships `hidden`,
//    so it can't flash) and instead drives the SAME hidden state itself via the runtime-added
//    `.sw-animation-init` class — its reveal is triggered by the banner runtime, not a scroll.
const HIDDEN = ':where(:not([data-sw-component="banner"]):not(.sw-animation-active),.sw-animation-init)';

/**
 * The animation stylesheet. Non-banner elements are hidden from FIRST PAINT (see {@link HIDDEN}); a
 * Banner self-drives the same hidden state via `.sw-animation-init`. `.sw-animation-active` (last rule)
 * reveals. The default transition-duration is SW_DURATION_DEFAULT (400ms — aligned with the shared timing
 * default; `data-sw-duration` overrides it inline). `pointer-events` is suspended while hidden so
 * invisible content can't be clicked. A self-heal failsafe reveals any element the runtime never armed
 * (JS disabled / the script failed) after a grace period, so content is never stranded hidden.
 *
 * CRITICAL: the `transition` is declared UNCONDITIONALLY on `[data-sw-animation]` — NOT on the {@link
 * HIDDEN} selector. If the transition lived on the hidden rule, adding `.sw-animation-active` would make
 * the element stop matching that rule, so the transition-property would VANISH in the same style recalc
 * that flips opacity/transform → the reveal would POP instead of animate. Keeping it unconditional means
 * the transition is present in BOTH the hidden and revealed states, so the reveal always animates.
 */
export const ANIMATION_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  // Transition — ALWAYS present on a managed element (see the CRITICAL note above). Duration/easing are
  // overridable per-element inline by the runtime from data-sw-duration / data-sw-easing.
  `[data-sw-animation]{transition-property:opacity,transform;transition-duration:${SW_DURATION_DEFAULT}ms;transition-timing-function:cubic-bezier(.25,.46,.45,.94)}`,
  // First-paint / un-activated HIDE (opacity + pointer-events).
  `[data-sw-animation]${HIDDEN}{opacity:0;pointer-events:none}`,
  ...EFFECT_TRANSFORMS.map(
    ([effect, transform]) => `[data-sw-animation="${effect}"]${HIDDEN}{transform:${transform}}`,
  ),
  // Self-heal failsafe: an element the runtime never armed (JS off / the script failed to load) reveals
  // itself after a grace period so first-paint-hidden content can never be stranded. An armed element
  // (runtime present) opts out and waits for its scroll-triggered reveal. Banners self-manage → excluded.
  '[data-sw-animation]:not([data-sw-component="banner"]):not(.sw-animation-armed):not(.sw-animation-active){animation:sw-anim-reveal .01s linear 9s forwards}',
  '@keyframes sw-anim-reveal{to{opacity:1;transform:none;pointer-events:auto}}',
  '[data-sw-animation].sw-animation-active{opacity:1;pointer-events:auto;transform:none}',
  '}',
].join('\n');

/** No-JS override (emitted inside a `<noscript><style>` by the build/preview): when scripting is off the
 *  runtime can never reveal, so cancel the first-paint hide + failsafe immediately — a no-JS visitor sees
 *  the content at once (restores the PE-first "never hide content without JS" guarantee). Mirrors
 *  SVG_ANIM_NOSCRIPT. (A Banner stays `hidden` regardless — it needs JS to show, so opacity:1 is inert.) */
export const ANIMATION_NOSCRIPT =
  '[data-sw-animation]{opacity:1!important;transform:none!important;pointer-events:auto!important;animation:none!important}';

/** Scroll-reveal trigger point: the reveal fires once at least this fraction of the element is in view
 *  (0.2 = 20% — "meaningfully in view", intentionally later than a bare edge-touch). The reveal also
 *  RESETS on a full exit (ratio 0) so it replays on re-entry from any scroll direction. */
const REVEAL_RATIO = 0.2;

// The runtime. Notes:
// - Content is hidden from FIRST PAINT by CSS ({@link HIDDEN}) — it never flashes visible before the
//   reveal. The runtime marks each element `sw-animation-armed` so the CSS self-heal failsafe stands down
//   (this runtime owns them and guarantees the reveal), then DEFERS observing (the reveal itself) until
//   the page is ready (swWhenReady) so the entrance doesn't fire behind a still-visible preloader.
// - `data-sw-delay` / `data-sw-duration` are parsed + clamped (swMs, timing.ts); `data-sw-easing`
//   resolves through a fixed allowlist map. Attribute values can therefore never inject style/script.
// - Scroll-reveal fires when the element is MEANINGFULLY in view ({@link REVEAL_RATIO}) — later / more in
//   view than a bare edge-touch. By DEFAULT the reveal REPLAYS: the element is RESET on a full exit
//   (ratio 0) and re-reveals on re-entry from ANY scroll direction (mirrors the SVG engine's approach).
//   `data-sw-once="true"` opts into play-once (unobserved after the first reveal).
export const ANIMATION_JS = `(function(){
  'use strict';
  if(!('IntersectionObserver' in window))return;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // Banner roots are EXCLUDED: a Banner with an animation effect drives the same
  // sw-animation-init/sw-animation-active classes itself on reveal (the reveal, not a scroll, is the
  // trigger — and fixed banners near a viewport edge are dropped by this observer's rootMargin, which
  // would yank their entrance back off).
  var els=document.querySelectorAll('[data-sw-animation]:not([data-sw-component="banner"])');
  if(els.length===0)return;
  ${SW_TIMING_CORE}
  ${SW_READY_CORE}
  // Null-prototype map: a hostile key ('constructor', 'toString', …) must miss, not resolve to an
  // inherited Object.prototype member.
  var EASINGS=Object.create(null);
  ${Object.entries(SW_EASINGS)
    .map(([k, v]) => `EASINGS[${JSON.stringify(k)}]=${JSON.stringify(v)};`)
    .join('')}
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var el=entry.target;
      // REVEAL only once the element is MEANINGFULLY in view (ratio past REVEAL_RATIO, and past the
      // rootMargin line 20% up from the bottom) — later / more in view than a bare edge-touch.
      if(entry.isIntersecting&&entry.intersectionRatio>=${REVEAL_RATIO}){
        if(!el.classList.contains('sw-animation-active')){
          el.classList.add('sw-animation-active');
          // DEFAULT keeps observing so the reveal REPLAYS on re-entry; data-sw-once="true" plays once.
          if(el.getAttribute('${SW_TIMING_ATTRS.once}')==='true')io.unobserve(el);
        }
      }else if(entry.intersectionRatio===0){
        // FULLY out of view → reset so the reveal replays on re-entry from ANY scroll direction. Resetting
        // ONLY on a full exit (not on partial) means the reveal never reverses while any part is on screen.
        el.classList.remove('sw-animation-active');
      }
    });
  },{threshold:[0,${REVEAL_RATIO}],rootMargin:'0px 0px -20% 0px'});
  // The elements are ALREADY hidden from first paint by CSS (no flash). ARM them now so the CSS self-heal
  // failsafe stands down — this runtime has taken ownership and swWhenReady guarantees the reveal below.
  Array.prototype.forEach.call(els,function(el){
    el.classList.add('sw-animation-armed');
  });
  swWhenReady(function(){
    // DEFER the reveal (observing) until the page is ready — after the preloader clears — so the entrance
    // animates in the open, not behind the still-visible overlay. A failsafe in swWhenReady guarantees
    // observation begins even if the ready signal never arrives.
    Array.prototype.forEach.call(els,function(el){
      var delay=swMs(el,'${SW_TIMING_ATTRS.delay}',0);
      if(delay>0)el.style.transitionDelay=delay+'ms';
      var duration=swMs(el,'${SW_TIMING_ATTRS.duration}',0);
      if(duration>0)el.style.transitionDuration=duration+'ms';
      var easing=EASINGS[el.getAttribute('${SW_TIMING_ATTRS.easing}')||''];
      if(easing)el.style.transitionTimingFunction=easing;
      io.observe(el);
    });
  });
})();`;

// Detection is a literal substring match: `data-sw-animation` written via a Handlebars variable
// won't be detected (don't do that), and a prose mention of "data-sw-animation" over-ships ~2.5KB of
// assets — benign in both directions.
const ANIMATION_MARKER = 'data-sw-animation';

/** Whether an authored HTML/template string uses entrance / scroll-reveal animations. */
export function usesAnimations(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(ANIMATION_MARKER);
}

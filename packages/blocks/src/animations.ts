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
 * reveals. The default transition-duration is SW_DURATION_DEFAULT (450ms — aligned with the shared timing
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
// - `data-sw-delay` (start delay, ms) / `data-sw-duration` (length, ms; default {@link SW_DURATION_DEFAULT})
//   are parsed + clamped (swMs, timing.ts) and applied inline; `data-sw-easing` resolves through a fixed
//   allowlist map. Attribute values can therefore never inject style/script.
// - Scroll-reveal fires when the element is MEANINGFULLY in view — its intersectionRatio reaches
//   `data-sw-threshold` (0-1 fraction; default {@link REVEAL_RATIO}) — later / more in view than a bare
//   edge-touch. By DEFAULT the reveal REPLAYS: the element is RESET on a full exit (ratio 0) and re-reveals
//   on re-entry from ANY scroll direction (mirrors the SVG engine's approach). `data-sw-once="true"` opts
//   into play-once (unobserved after the first reveal).
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
  // Per-element reveal threshold: data-sw-threshold (0-1 fraction of the element in view; default
  // REVEAL_RATIO). swRatio parses + clamps to [0,1]; a non-numeric value falls back to the default (no
  // injection — the value is only ever compared as a number). A single observer applies ONE threshold
  // list to all its targets, so we UNION every element's threshold (+ 0 for the reset) → the callback
  // fires exactly at each element's own crossing.
  function swRatio(el,attr,def){var v=parseFloat(el.getAttribute(attr));return isNaN(v)?def:Math.max(0,Math.min(v,1));}
  var thrSet={};thrSet['0']=1;
  Array.prototype.forEach.call(els,function(el){thrSet[swRatio(el,'data-sw-threshold',${REVEAL_RATIO})]=1;});
  var THRESHOLDS=[];for(var tk in thrSet)THRESHOLDS.push(parseFloat(tk));
  // Scroll ROOT for both observers. In the whole-site PREVIEW the page scrolls on <body> (the renderer sets
  // html{overflow:hidden} body{overflow-y:auto} for a styled scrollbar in the sandboxed frame) — a NON-ROOT
  // scroll container. With root:null, Chromium resolves the implicit root + a PERCENTAGE rootMargin against
  // that body scrollport correctly, but WebKit/Gecko can resolve them against the (never-scrolling) layout
  // viewport instead, so the -20% line drifts and the reveal fires far too late. Pin the root to the actual
  // scroll container whenever the body is it; a normally-scrolling published page has body overflowY
  // 'visible' → root stays null (the layout viewport), unchanged.
  var scrollRoot=null;try{if(getComputedStyle(document.body).overflowY==='auto')scrollRoot=document.body;}catch(e){}
  // RESET (replay) observer — SEPARATE from the reveal observer, over the FULL viewport (rootMargin 0). Its
  // intersectionRatio===0 fires EXACTLY when NO part of the element is on screen, whether it left past the
  // TOP or past the BOTTOM. Re-arm the replay only then. This is what lets replay work in BOTH directions
  // while never blinking visible content: (a) a revealed element resting anywhere in view — including the
  // reveal observer's bottom-20% margin band — keeps ratio>0 here, so it's never yanked back hidden; (b) an
  // element scrolled fully off the BOTTOM still resets — which the -20% reveal observer CANNOT detect (it
  // reads ratio 0 already at the -20% line and never fires again as the element continues off-screen).
  var exitIo=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.intersectionRatio===0&&entry.target.classList.contains('sw-animation-active'))entry.target.classList.remove('sw-animation-active');
    });
  },{threshold:[0],root:scrollRoot});
  // Reveal an element once. data-sw-once="true" then stops BOTH observers watching it → it can never reset.
  function swReveal(el){
    el.classList.add('sw-animation-active');
    if(el.getAttribute('${SW_TIMING_ATTRS.once}')==='true'){io.unobserve(el);exitIo.unobserve(el);}
  }
  // SCROLL-REVEAL observer: -20% bottom margin → REVEAL fires only once the element is MEANINGFULLY in view
  // (intersectionRatio past data-sw-threshold / REVEAL_RATIO, past the line 20% up from the bottom) — later /
  // more in view than a bare edge-touch. Reveal only; exitIo above owns the reset (replay).
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var el=entry.target;
      if(entry.isIntersecting&&entry.intersectionRatio>=swRatio(el,'data-sw-threshold',${REVEAL_RATIO}))swReveal(el);
    });
  },{threshold:THRESHOLDS,rootMargin:'0px 0px -20% 0px',root:scrollRoot});
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
      io.observe(el);      // reveal (-20% "clearly in view")
      exitIo.observe(el);  // reset (replay) when FULLY off the viewport
    });
    // ON-LOAD entrance: a THIRD observer against the FULL viewport (NO -20% bottom margin) reveals whatever
    // is already MEANINGFULLY in view at load — an above-the-fold entrance (a section under a tall hero, whose
    // fade-up transform also pushes it lower; or a card pinned to the bottom edge) animates in immediately
    // instead of waiting for a scroll. Being an OBSERVER, not a one-shot read, it also catches a near-fold
    // element that a late-loading lazy image shifts INTO view AFTER ready. It only reveals (never resets); the
    // exitIo reset never fires while an element is in view, so an on-load reveal is never yanked back. At the
    // FIRST user scroll it disconnects → the -20% observer owns reveal-as-you-scroll from then on (so scroll
    // reveals still fire "clearly on screen", not at the bottom edge).
    var loadArmed=false;
    var loadIo=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting&&entry.intersectionRatio>=swRatio(entry.target,'data-sw-threshold',${REVEAL_RATIO}))swReveal(entry.target);
      });
      // (loadIo shares the same scroll root as the primary observer — see scrollRoot above.)
      // Arm the hand-off ONLY after loadIo has actually DELIVERED its first batch (IO callbacks are async —
      // never synchronous with observe()). Otherwise an early scroll — a carried-over wheel/touch gesture, or
      // another script's scrollTo()/scroll-restoration on load — could disconnect loadIo before it ever
      // reveals, silently reintroducing the blank band. capture:true also catches a scroll of an INNER
      // container (scroll events don't bubble) so loadIo never lingers past the first user scroll.
      if(!loadArmed){loadArmed=true;addEventListener('scroll',function(){loadIo.disconnect();},{once:true,capture:true,passive:true});}
    },{threshold:THRESHOLDS,root:scrollRoot});
    Array.prototype.forEach.call(els,function(el){loadIo.observe(el);});
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

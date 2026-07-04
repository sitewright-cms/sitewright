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
// - PE-first: the hidden initial state is gated on the `.sw-animation-init` class, which only the
//   runtime adds. No JS / no IntersectionObserver / reduced motion → content renders fully visible
//   (we deliberately never hide content without JS).
// - The reveal is driven by adding `.sw-animation-active` (last rule, same specificity) — authored
//   CSS may target `.sw-animation-init` / `.sw-animation-active` for bespoke reveals.
// - Accessibility: all motion sits inside `prefers-reduced-motion: no-preference`, and the runtime
//   also bails out under reduced motion.
// - First-party, audited, static code only — tenants supply DATA (attribute values, parsed /
//   clamped / allowlisted below); never JavaScript.
import { SW_TIMING_ATTRS, SW_DURATION_DEFAULT, SW_EASINGS, SW_TIMING_CORE } from './timing.js';

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

/**
 * The animation stylesheet. Hidden state is `[data-sw-animation].sw-animation-init` (runtime-added,
 * so no-JS renders visible); `.sw-animation-active` (last rule, same specificity) reveals. The default
 * transition-duration is SW_DURATION_DEFAULT (400ms — intentionally lowered from the historical 600ms
 * to align with the shared timing default; `data-sw-duration` overrides it inline).
 * `pointer-events` is suspended while hidden so invisible content can't be clicked.
 */
export const ANIMATION_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  `[data-sw-animation].sw-animation-init{opacity:0;pointer-events:none;transition-property:opacity,transform;transition-duration:${SW_DURATION_DEFAULT}ms;transition-timing-function:cubic-bezier(.25,.46,.45,.94)}`,
  ...EFFECT_TRANSFORMS.map(
    ([effect, transform]) => `[data-sw-animation="${effect}"].sw-animation-init{transform:${transform}}`,
  ),
  '[data-sw-animation].sw-animation-active{opacity:1;pointer-events:auto;transform:none}',
  '}',
].join('\n');

// The runtime. Notes:
// - `sw-animation-init` is added just before observing, so the pre-JS document is fully visible
//   (PE-first) and the reveal transition starts from the hidden state.
// - `data-sw-delay` / `data-sw-duration` are parsed + clamped (swMs, timing.ts); `data-sw-easing`
//   resolves through a fixed allowlist map. Attribute values can therefore never inject style/script.
// - `data-sw-once="false"` keeps the element observed and replays the reveal each time it re-enters
//   the viewport; otherwise it is unobserved after the first reveal (the default).
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
  // Null-prototype map: a hostile key ('constructor', 'toString', …) must miss, not resolve to an
  // inherited Object.prototype member.
  var EASINGS=Object.create(null);
  ${Object.entries(SW_EASINGS)
    .map(([k, v]) => `EASINGS[${JSON.stringify(k)}]=${JSON.stringify(v)};`)
    .join('')}
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var el=entry.target;
      if(entry.isIntersecting){
        el.classList.add('sw-animation-active');
        if(el.getAttribute('${SW_TIMING_ATTRS.once}')!=='false')io.unobserve(el);
      }else{
        el.classList.remove('sw-animation-active');
      }
    });
  },{threshold:0.1,rootMargin:'0px 0px -48px 0px'});
  Array.prototype.forEach.call(els,function(el){
    var delay=swMs(el,'${SW_TIMING_ATTRS.delay}',0);
    if(delay>0)el.style.transitionDelay=delay+'ms';
    var duration=swMs(el,'${SW_TIMING_ATTRS.duration}',0);
    if(duration>0)el.style.transitionDuration=duration+'ms';
    var easing=EASINGS[el.getAttribute('${SW_TIMING_ATTRS.easing}')||''];
    if(easing)el.style.transitionTimingFunction=easing;
    el.classList.add('sw-animation-init');
    io.observe(el);
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

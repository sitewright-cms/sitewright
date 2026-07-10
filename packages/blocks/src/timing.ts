// Shared timing vocabulary for the Sitewright animation engines.
//
// BOTH the entrance/scroll-reveal engine (`data-sw-animation`, animations.ts) and the SVG engine
// (`data-sw-svg`, svg-anim.ts) read the SAME author attributes, so there is ONE timing language to
// learn and document:
//
//   data-sw-duration="600"   animation length in ms (default 400 when unset/blank)
//   data-sw-delay="200"      start delay in ms
//   data-sw-easing="ease-out"  timing curve — resolved through the allowlist below
//   data-sw-once="false"     replay each time the element re-enters view (default: play once)
//
// These are DATA only: values are parsed / clamped / allowlisted by each runtime, never executed.

/** The shared timing attribute names. Referenced by both runtimes, the editor, and tests. */
export const SW_TIMING_ATTRS = {
  duration: 'data-sw-duration',
  delay: 'data-sw-delay',
  easing: 'data-sw-easing',
  once: 'data-sw-once',
} as const;

/** Default animation duration (ms) applied when `data-sw-duration` is unset or non-numeric. */
export const SW_DURATION_DEFAULT = 400;

/** Hard clamp for any author-supplied duration / delay (ms). Shared by both engines. */
export const SW_TIMING_MAX_MS = 20000;

/** Allowlisted easing keywords → CSS timing-function. Both engines accept these; the SVG engine
 *  layers a few spring curves (back/bounce/elastic) on top for its WAAPI keyframes. */
export const SW_EASINGS: Readonly<Record<string, string>> = {
  linear: 'linear',
  ease: 'ease',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
};

/** A runtime JS snippet (IIFE-embeddable) that defines `swMs(el,attr,def)` — parse a millisecond
 *  attribute, clamp to [0, SW_TIMING_MAX_MS], falling back to `def`. Embedded verbatim in both
 *  engine runtimes so their timing parse can never drift. */
export const SW_TIMING_CORE = `
  function swMs(el,attr,def){var v=parseInt(el.getAttribute(attr)||'',10);return isNaN(v)?def:Math.max(0,Math.min(v,${SW_TIMING_MAX_MS}));}
`;

/** The global "the page is ready to start entrance animations" signal. The preloader dispatches it on
 *  `document` when it clears; the entrance + SVG engines gate their first reveal on it so animations begin
 *  AFTER the preloader/page-load — coordinated, not fired behind a still-visible overlay. */
export const SW_READY_EVENT = 'sw:ready';

/** A runtime JS snippet (IIFE-embeddable) defining `swWhenReady(cb)`: run `cb` once the page is ready to
 *  animate — after the preloader clears (it dispatches `${SW_READY_EVENT}`), or IMMEDIATELY when there is
 *  no active preloader on the page. A failsafe fires `cb` even if the signal never arrives, so a missing/
 *  broken preloader can never strand the animations un-triggered. Embedded verbatim in both engines. */
export const SW_READY_CORE = `
  function swWhenReady(cb){
    var pl=document.querySelector('[data-sw-preloader]');
    if(pl&&pl.classList&&pl.classList.contains('sw-loading')){
      var done=false,t=0,fire=function(){if(done)return;done=true;if(t)clearTimeout(t);cb();};
      document.addEventListener('${SW_READY_EVENT}',fire,{once:true});
      t=setTimeout(fire,9000); // failsafe (past the preloader's own 8s max) — never strand animations
    }else{cb();}
  }
`;

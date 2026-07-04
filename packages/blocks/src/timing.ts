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

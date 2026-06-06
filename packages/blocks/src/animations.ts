// Scroll-reveal animations: a first-party runtime for the industry-standard AOS
// attribute vocabulary (`data-aos="fade-up"`, `data-aos-delay="200"`, …).
//
// Tenants and AI agents author plain `data-aos` attributes in code-first page
// sources, skeleton slots, snippets, or raw Html blocks — the vocabulary every
// HTML template (and every LLM) already knows. The AOS npm package is NOT
// bundled (and WOW.js never will be — GPL + abandoned); this module ships a
// tiny audited implementation of the same attribute protocol instead, under
// the same only-used-ships discipline as components.ts.
//
// Invariants:
// - PE-first: the hidden initial state is gated on the `.aos-init` class,
//   which only the runtime adds. No JS / no IntersectionObserver / reduced
//   motion → content renders fully visible (real AOS hides content without
//   JS; we deliberately do not).
// - Class protocol matches real AOS (`aos-init` / `aos-animate`), so authored
//   CSS targeting those classes (a common template idiom) behaves as expected.
// - Accessibility: all motion sits inside `prefers-reduced-motion:
//   no-preference`, and the runtime also bails out under reduced motion.
// - First-party, audited, static code only — tenants supply DATA (attribute
//   values, parsed/clamped/allowlisted below); never JavaScript.
import { walk } from '@sitewright/core';
import type { PageNode } from '@sitewright/schema';

/** The `data-aos` effects with a dedicated initial transform (plain `fade` is the base rule). */
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
 * The animation stylesheet. Hidden state is `[data-aos].aos-init` (runtime-added,
 * so no-JS renders visible); `.aos-animate` (last rule, same specificity) reveals.
 * `pointer-events` is suspended while hidden so invisible content can't be clicked.
 */
export const ANIMATION_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  '[data-aos].aos-init{opacity:0;pointer-events:none;transition-property:opacity,transform;transition-duration:.6s;transition-timing-function:cubic-bezier(.25,.46,.45,.94)}',
  ...EFFECT_TRANSFORMS.map(([effect, transform]) => `[data-aos="${effect}"].aos-init{transform:${transform}}`),
  '[data-aos].aos-animate{opacity:1;pointer-events:auto;transform:none}',
  '}',
].join('\n');

// The runtime. Notes:
// - `aos-init` is added just before observing, so the pre-JS document is fully
//   visible (PE-first) and the reveal transition starts from the hidden state.
// - `data-aos-delay`/`data-aos-duration` are parseInt-ed and clamped to
//   [0, 5000] ms; `data-aos-easing` resolves through a fixed allowlist map.
//   Attribute values can therefore never inject style or script.
// - `data-aos-once="false"` keeps the element observed and replays the reveal
//   each time it re-enters the viewport; otherwise it is unobserved after the
//   first reveal (AOS default).
export const ANIMATION_JS = `(function(){
  'use strict';
  if(!('IntersectionObserver' in window))return;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var els=document.querySelectorAll('[data-aos]');
  if(els.length===0)return;
  // Null-prototype map: a hostile key ('constructor', 'toString', …) must miss,
  // not resolve to an inherited Object.prototype member.
  var EASINGS=Object.create(null);
  EASINGS['linear']='linear';EASINGS['ease']='ease';EASINGS['ease-in']='ease-in';
  EASINGS['ease-out']='ease-out';EASINGS['ease-in-out']='ease-in-out';
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var el=entry.target;
      if(entry.isIntersecting){
        el.classList.add('aos-animate');
        if(el.getAttribute('data-aos-once')!=='false')io.unobserve(el);
      }else{
        el.classList.remove('aos-animate');
      }
    });
  },{threshold:0.1,rootMargin:'0px 0px -48px 0px'});
  Array.prototype.forEach.call(els,function(el){
    var ms=function(attr){
      var v=parseInt(el.getAttribute(attr)||'',10);
      return isNaN(v)?0:Math.max(0,Math.min(v,5000));
    };
    var delay=ms('data-aos-delay');
    if(delay>0)el.style.transitionDelay=delay+'ms';
    var duration=ms('data-aos-duration');
    if(duration>0)el.style.transitionDuration=duration+'ms';
    var easing=EASINGS[el.getAttribute('data-aos-easing')||''];
    if(easing)el.style.transitionTimingFunction=easing;
    el.classList.add('aos-init');
    io.observe(el);
  });
})();`;

// Detection is a literal substring match: `data-aos` written via a Handlebars
// variable won't be detected (don't do that), and a prose mention of
// "data-aos" over-ships ~2.5KB of assets — benign in both directions.
const ANIMATION_MARKER = 'data-aos';

/** Whether an authored HTML/template string uses scroll-reveal animations. */
export function usesAnimations(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(ANIMATION_MARKER);
}

/**
 * Whether a block tree uses scroll-reveal animations — i.e. any node carries a
 * string prop containing `data-aos` (in practice the raw `Html` block, whose
 * markup is emitted unescaped; escaped text props can't form a live attribute,
 * so a match there only over-ships the assets).
 */
export function treeUsesAnimations(root: PageNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found || !node.props) return;
    for (const value of Object.values(node.props)) {
      if (typeof value === 'string' && value.includes(ANIMATION_MARKER)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

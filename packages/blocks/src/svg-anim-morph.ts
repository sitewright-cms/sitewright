// SVG path MORPH — the one SVG-animation effect that can't run on WAAPI (the `d` attribute isn't
// animatable cross-browser and SMIL is deprecated). Shipped as a SEPARATE only-used-ships chunk
// (svg-anim-morph.js) so the ~1KB interpolator loads ONLY on pages that actually morph — the core
// svg-anim.js deliberately skips data-sw-svg="morph".
//
//   <path data-sw-svg="morph" data-sw-svg-to="M…" d="M…"> — tween the element's `d` toward the target.
//   timing via the shared data-sw-duration/-delay/-easing/-once primitives; trigger view|load.
//
// Interpolation is a compact, first-party, "flubber-class" SAMPLE-based morph: both the start `d` and
// the target `d` are sampled to the SAME number of points (via getPointAtLength on a detached path),
// then each point is linearly interpolated and the element's `d` is rewritten per frame as a polyline.
// This is robust to arbitrary path pairs (no command-structure matching needed); on completion the exact
// target `d` is set so the shape lands precisely. Cleaner morphs come from start/target paths of similar
// shape + winding (documented in the builder).
//
// Invariants:
// - PE-first: with no JS / under reduced motion the element renders at its authored `d` (the start
//   shape) — a valid, visible shape; morph never hides content.
// - Accessibility: the runtime BAILS entirely under prefers-reduced-motion (no shape change).
// - Author `data-sw-svg-to` is grammar-validated before it touches the DOM; the runtime only ever writes
//   a `d` it COMPUTED from sampled numeric points, never the raw attribute mid-flight.
import { SW_TIMING_CORE } from './timing.js';

export const SVG_ANIM_MORPH_JS = `(function(){
  'use strict';
  var els=document.querySelectorAll('[data-sw-svg="morph"]');
  if(els.length===0)return;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  ${SW_TIMING_CORE}
  var NS='http://www.w3.org/2000/svg',N=64;
  var PATHRE=/^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\\s+-]{1,4000}$/;
  // Sample a d-string into N+1 evenly-spaced points via a detached <path>. Null when it isn't a real path.
  function sample(d){
    if(!d||!PATHRE.test(d))return null;
    var pth=document.createElementNS(NS,'path');pth.setAttribute('d',d);
    var len;try{len=pth.getTotalLength();}catch(e){return null;}
    if(!len||!isFinite(len))return null;
    var pts=[],i,pt;for(i=0;i<=N;i++){try{pt=pth.getPointAtLength(len*i/N);}catch(e){return null;}pts.push([pt.x,pt.y]);}
    return pts;
  }
  function toD(pts){var s='M'+pts[0][0].toFixed(2)+' '+pts[0][1].toFixed(2),i;for(i=1;i<pts.length;i++)s+='L'+pts[i][0].toFixed(2)+' '+pts[i][1].toFixed(2);return s+'Z';}
  var EASE=Object.create(null);
  EASE['linear']=function(t){return t;};
  EASE['ease-in']=function(t){return t*t;};
  EASE['ease-out']=function(t){return 1-(1-t)*(1-t);};
  EASE['ease-in-out']=function(t){return t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;};
  EASE['back']=function(t){var c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);};
  function easeOf(el){return EASE[el.getAttribute('data-sw-easing')||'']||EASE['ease-out'];}
  var raf=window.requestAnimationFrame||function(f){return setTimeout(function(){f(+new Date());},16);};
  function run(el){
    if(el.__swMorphing)return;
    var to=el.getAttribute('data-sw-svg-to');if(!to||!PATHRE.test(to))return;
    var A=sample(el.getAttribute('d')),B=sample(to);
    if(!A||!B){el.setAttribute('d',to);return;} // un-samplable → jump to target (still correct, just no tween)
    var dur=swMs(el,'data-sw-duration',400),delay=swMs(el,'data-sw-delay',0),ease=easeOf(el);
    if(dur<=0){el.setAttribute('d',to);return;}
    el.__swMorphing=true;var start=null;
    function frame(ts){
      if(start===null)start=ts;var elapsed=ts-start-delay;
      if(elapsed<0){raf(frame);return;}
      var t=Math.min(elapsed/dur,1),e=ease(t),pts=[],i;
      for(i=0;i<A.length;i++)pts.push([A[i][0]+(B[i][0]-A[i][0])*e,A[i][1]+(B[i][1]-A[i][1])*e]);
      el.setAttribute('d',toD(pts));
      if(t<1){raf(frame);}else{el.setAttribute('d',to);el.__swMorphing=false;}
    }
    raf(frame);
  }
  var once=function(el){return el.getAttribute('data-sw-once')!=='false';};
  var view=[];
  Array.prototype.forEach.call(els,function(el){
    if(el.getAttribute('data-sw-svg-trigger')==='load')run(el);else view.push(el);
  });
  if(view.length===0)return;
  if(!('IntersectionObserver' in window)){view.forEach(run);return;}
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){if(en.isIntersecting){run(en.target);if(once(en.target))io.unobserve(en.target);}});
  },{threshold:0.15,rootMargin:'0px 0px -10% 0px'});
  view.forEach(function(el){io.observe(el);});
})();`;

// Detection is the literal morph marker — a page ships this chunk ONLY when it actually morphs.
const SVG_ANIM_MORPH_MARKER = 'data-sw-svg="morph"';

/** Whether an authored HTML/template string uses the SVG morph effect. */
export function usesSvgAnimMorph(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(SVG_ANIM_MORPH_MARKER);
}

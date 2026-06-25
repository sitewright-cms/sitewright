// Parallax / scroll-linked property engine: a first-party runtime for a small data-attribute
// vocabulary that drives several CHANNELS off each element's scroll position.
//
//   data-sw-parallax="0.3"            translate (speed-based; the headline parallax knob)
//   data-sw-parallax-axis="y|x"       translate axis (default y)
//   data-sw-parallax-opacity="0,1"    opacity   interpolated from,to across the element's view-progress
//   data-sw-parallax-scale="0.9,1"    scale     (composes with translate on the same transform)
//   data-sw-parallax-blur="8,0"       filter: blur(px) from,to
//   data-sw-parallax-bg                a clipped section whose oversized background LAYER drifts
//
// Authored as plain attributes in code-first sources, snippets, or raw Html blocks — like data-aos
// (see animations.ts). The vocabulary every HTML template / LLM understands; NO third-party library
// is bundled. Tenants supply DATA only (values parsed / clamped / validated below), never JavaScript.
//
// Invariants:
// - PE-first: the runtime only ADDS a transform / opacity / filter to an otherwise in-flow element.
//   No JS / no IntersectionObserver / reduced motion → every element sits at its natural state; no
//   broken layout, no layout shift (the channels are visual-only; the element's box is untouched).
// - Accessibility: parallax is a known vestibular trigger (WCAG 2.3.3). The CSS carries NO motion;
//   ALL movement is applied by the runtime, which BAILS entirely under prefers-reduced-motion: reduce.
// - Performance: one rAF-throttled write per frame; transform/opacity on the compositor; will-change
//   toggled by an IntersectionObserver so off-screen elements neither compute nor hold a GPU layer.

/** Per-channel clamp ranges — shared by the runtime, the editor builder, and tests. */
export const PARALLAX_LIMITS = {
  /** translate speed factor: 0 static, + recedes (lags scroll), − leads (foreground). */
  speed: { min: -2, max: 2 },
  opacity: { min: 0, max: 1 },
  scale: { min: 0, max: 4 },
  /** filter blur radius, px. */
  blur: { min: 0, max: 40 },
} as const;

// --- CSS --------------------------------------------------------------------
// Structural only (the MOTION is JS-applied, so it is never in the sheet). These rules are UNCONDITIONAL
// — a reduced-motion / no-JS visitor still gets a correctly clipped, layered background section, just
// without the drift. No brand colours here (the author sets the layer's background-image), so the sheet
// stays dark-theme-safe.
export const PARALLAX_CSS = [
  '[data-sw-parallax-bg]{position:relative;overflow:hidden}',
  // The drifting layer: oversized + clipped so the runtime's translate never reveals an edge.
  '[data-sw-parallax-bg] [data-sw-parallax-layer]{position:absolute;inset:-14% 0;z-index:0;background-size:cover;background-position:center}',
  // Lift the section's own content above the background layer without the author managing z-index.
  '[data-sw-parallax-bg]>:not([data-sw-parallax-layer]){position:relative;z-index:1}',
].join('');

// --- runtime ----------------------------------------------------------------
// SCALE constants keep in-view drift modest: an element at the viewport edge with speed 1 drifts ≈75px;
// a background layer drifts more (×0.4) but is clamped to the overflow slack so no edge is ever revealed.
export const PARALLAX_JS = `(function(){
  'use strict';
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var els=document.querySelectorAll('[data-sw-parallax],[data-sw-parallax-bg],[data-sw-parallax-opacity],[data-sw-parallax-scale],[data-sw-parallax-blur]');
  if(els.length===0)return;
  function num(v,d){var n=parseFloat(v);return isNaN(n)?d:n;}
  function clamp(n,lo,hi){return n<lo?lo:(n>hi?hi:n);}
  function pair(v,lo,hi){if(v==null)return null;var p=(''+v).split(',');var a=parseFloat(p[0]),b=parseFloat(p[1]);if(isNaN(a)||isNaN(b))return null;return [clamp(a,lo,hi),clamp(b,lo,hi)];}
  function lerp(a,b,t){return a+(b-a)*t;}
  var items=[];
  Array.prototype.forEach.call(els,function(el){
    var bg=el.hasAttribute('data-sw-parallax-bg');
    items.push({
      el:el,
      target:bg?(el.querySelector('[data-sw-parallax-layer]')||el):el,
      bg:bg,
      speed:clamp(num(el.getAttribute('data-sw-parallax'),bg?0.3:0),-2,2),
      axis:el.getAttribute('data-sw-parallax-axis')==='x'?'x':'y',
      opacity:pair(el.getAttribute('data-sw-parallax-opacity'),0,1),
      scale:pair(el.getAttribute('data-sw-parallax-scale'),0,4),
      blur:pair(el.getAttribute('data-sw-parallax-blur'),0,40),
      active:true
    });
  });
  var io=('IntersectionObserver' in window)?new IntersectionObserver(function(es){
    es.forEach(function(e){
      for(var i=0;i<items.length;i++){if(items[i].el===e.target){
        items[i].active=e.isIntersecting;
        items[i].target.style.willChange=e.isIntersecting?'transform':'';
      }}
    });
  },{rootMargin:'25% 0px 25% 0px'}):null;
  if(io)items.forEach(function(it){io.observe(it.el);});
  var vh=window.innerHeight,ticking=false;
  function render(){
    ticking=false;
    var vc=vh/2;
    for(var i=0;i<items.length;i++){
      var it=items[i];if(!it.active)continue;
      var r=it.el.getBoundingClientRect();
      var raw=(vc-(r.top+r.height/2))*it.speed;
      var d=raw*(it.bg?0.4:0.2);
      var tx=it.axis==='x'?d:0,ty=it.axis==='x'?0:d;
      if(it.bg){var slack=r.height*0.14;tx=clamp(tx,-slack,slack);ty=clamp(ty,-slack,slack);}
      var p=clamp((vh-r.top)/(vh+r.height),0,1);
      var tf='translate3d('+tx.toFixed(2)+'px,'+ty.toFixed(2)+'px,0)';
      if(it.scale)tf+=' scale('+lerp(it.scale[0],it.scale[1],p).toFixed(3)+')';
      it.target.style.transform=tf;
      if(it.opacity)it.target.style.opacity=lerp(it.opacity[0],it.opacity[1],p).toFixed(3);
      if(it.blur)it.target.style.filter='blur('+lerp(it.blur[0],it.blur[1],p).toFixed(2)+'px)';
    }
  }
  function onScroll(){if(!ticking){ticking=true;(window.requestAnimationFrame||function(f){return f();})(render);}}
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',function(){vh=window.innerHeight;onScroll();},{passive:true});
  render();
})();`;

// Detection is a literal substring match: every channel attribute contains `data-sw-parallax`, so one
// marker gates the whole family. A `data-sw-parallax` written via a Handlebars variable won't be
// detected (don't do that); a prose mention over-ships ~1.5KB — benign in both directions.
const PARALLAX_MARKER = 'data-sw-parallax';

/** Whether an authored HTML/template string uses any parallax channel. */
export function usesParallax(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(PARALLAX_MARKER);
}

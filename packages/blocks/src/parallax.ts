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
    var opacity=pair(el.getAttribute('data-sw-parallax-opacity'),${PARALLAX_LIMITS.opacity.min},${PARALLAX_LIMITS.opacity.max});
    var blur=pair(el.getAttribute('data-sw-parallax-blur'),${PARALLAX_LIMITS.blur.min},${PARALLAX_LIMITS.blur.max});
    items.push({
      el:el,
      target:bg?(el.querySelector('[data-sw-parallax-layer]')||el):el,
      bg:bg,
      speed:clamp(num(el.getAttribute('data-sw-parallax'),bg?0.3:0),${PARALLAX_LIMITS.speed.min},${PARALLAX_LIMITS.speed.max}),
      axis:el.getAttribute('data-sw-parallax-axis')==='x'?'x':'y',
      opacity:opacity,
      scale:pair(el.getAttribute('data-sw-parallax-scale'),${PARALLAX_LIMITS.scale.min},${PARALLAX_LIMITS.scale.max}),
      blur:blur,
      // only hint the properties this element actually animates
      wc:'transform'+(opacity?',opacity':'')+(blur?',filter':''),
      active:true,
      r:null
    });
  });
  var io=('IntersectionObserver' in window)?new IntersectionObserver(function(es){
    es.forEach(function(e){
      for(var i=0;i<items.length;i++){if(items[i].el===e.target){
        items[i].active=e.isIntersecting;
        items[i].target.style.willChange=e.isIntersecting?items[i].wc:'';
      }}
    });
  },{rootMargin:'25% 0px 25% 0px'}):null;
  if(io)items.forEach(function(it){io.observe(it.el);});
  var vh=window.innerHeight,ticking=false;
  function render(){
    ticking=false;
    var vc=vh/2,i,it,r;
    // PASS 1 — read every rect first (no interleaved writes → one layout, no thrash)
    for(i=0;i<items.length;i++){it=items[i];it.r=it.active?it.el.getBoundingClientRect():null;}
    // PASS 2 — write styles only (no reads)
    for(i=0;i<items.length;i++){
      it=items[i];r=it.r;if(!r)continue;
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

// --- editor builder preview doc ---------------------------------------------
// A self-contained, scrollable preview DOCUMENT for the Library "Parallax builder": the chosen element
// beside a STATIC twin, so the (deliberately subtle) scroll-linked motion is legible — the "Parallax"
// box visibly shifts / fades / scales / blurs relative to the un-animated "Static" one. It must be
// served from a SAME-ORIGIN route under `Content-Security-Policy: sandbox allow-scripts` and loaded via
// the iframe `src` (NOT `srcdoc`): the editor's own CSP is `script-src 'self'`, which a srcdoc iframe
// inherits and which blocks the inline runtime — so the engine never runs. The sandbox CSP gives the
// doc an opaque, isolated origin where inline script DOES run, with no access to the editor session.
// Fixed demo colours (no brand vars) → the ONLY interpolated values are clamped numbers + the literal
// 'x' axis, so there is no string-injection surface.
export interface ParallaxPreviewOpts {
  speed?: number;
  axis?: 'x' | 'y';
  opacity?: readonly [number, number] | null;
  scale?: readonly [number, number] | null;
  blur?: readonly [number, number] | null;
}

function clampNum(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Build the Parallax-builder preview document (see note above). Every numeric is clamped to
 *  PARALLAX_LIMITS; channels are emitted only when a valid from,to pair is supplied. */
export function parallaxPreviewDoc(opts: ParallaxPreviewOpts = {}): string {
  const L = PARALLAX_LIMITS;
  const speed = clampNum(typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 0.3, L.speed.min, L.speed.max);
  const axis = opts.axis === 'x' ? 'x' : 'y';
  const pair = (v: readonly [number, number] | null | undefined, lo: number, hi: number): string | null =>
    v && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? `${clampNum(v[0], lo, hi)},${clampNum(v[1], lo, hi)}` : null;
  const op = pair(opts.opacity, L.opacity.min, L.opacity.max);
  const sc = pair(opts.scale, L.scale.min, L.scale.max);
  const bl = pair(opts.blur, L.blur.min, L.blur.max);
  const attrs = [
    `data-sw-parallax="${speed}"`,
    axis === 'x' ? 'data-sw-parallax-axis="x"' : '',
    op ? `data-sw-parallax-opacity="${op}"` : '',
    sc ? `data-sw-parallax-scale="${sc}"` : '',
    bl ? `data-sw-parallax-blur="${bl}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
    `html{scroll-behavior:auto}body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#1a1a23}` +
    `.hint{position:sticky;top:0;z-index:2;text-align:center;font-size:12px;font-weight:600;padding:8px 10px;` +
    `background:rgba(255,255,255,.86);backdrop-filter:blur(4px);border-bottom:1px solid rgba(0,0,0,.1)}` +
    `.pad{height:90vh}` +
    `.row{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:center;margin:0 1.5rem}` +
    `.box{display:grid;place-items:center;min-height:120px;padding:1.25rem;border-radius:18px;font-weight:700;text-align:center;line-height:1.25}` +
    `.box small{display:block;font-size:11px;font-weight:600;opacity:.7;margin-top:4px}` +
    `.ref{background:transparent;color:#1a1a23;border:2px dashed rgba(0,0,0,.28)}` +
    `.sample{color:#fff;background:linear-gradient(135deg,#4f46e5,#0ea5e9);box-shadow:0 18px 50px rgba(0,0,0,.2)}` +
    PARALLAX_CSS +
    `</style></head><body>` +
    `<div class="hint">↕ Scroll inside this frame — watch “Parallax” shift against “Static”</div>` +
    `<div class="pad"></div>` +
    `<div class="row"><div class="box ref">Static<small>no effect</small></div>` +
    `<div class="box sample" ${attrs}>Parallax<small>this element</small></div></div>` +
    `<div class="pad"></div>` +
    `<script>if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){var h=document.querySelector('.hint');if(h)h.textContent='Motion is off under your system reduced-motion setting — visitors with it see no parallax.';}</script>` +
    `<script>${PARALLAX_JS}</script></body></html>`
  );
}

// Detection is a literal substring match: every channel attribute contains `data-sw-parallax`, so one
// marker gates the whole family. A `data-sw-parallax` written via a Handlebars variable won't be
// detected (don't do that); a prose mention over-ships ~1.5KB — benign in both directions.
const PARALLAX_MARKER = 'data-sw-parallax';

/** Whether an authored HTML/template string uses any parallax channel. */
export function usesParallax(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(PARALLAX_MARKER);
}

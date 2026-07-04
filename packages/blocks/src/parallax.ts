// Parallax / scroll-linked property engine: a first-party runtime for a small data-attribute
// vocabulary that drives several CHANNELS off each element's scroll position.
//
//   data-sw-parallax-translate="40,-40"   from→to motion in px (axis via -axis; default y)
//   data-sw-parallax-axis="y|x"           translate axis (default y)
//   data-sw-parallax-opacity="0,1"        opacity   from→to
//   data-sw-parallax-scale="0.9,1.05"     scale     from→to (composes with translate on transform)
//   data-sw-parallax-blur="8,0"           filter: blur(px) from→to
//
// ANCHORING — every channel interpolates over a WINDOW of the element's pass through the viewport:
//   c = (vh − top)/(vh + height)  ∈ [0,1]   (0 enter-bottom · 0.5 viewport-centre · 1 exit-top)
//   data-sw-parallax-<ch>-range="s,e"       the channel's IN window (cover-fraction); after `e` it HOLDS
//   data-sw-parallax-range="s,e"            element-level default window (per-channel -range overrides)
//   data-sw-parallax-<ch>-out="from,to"     optional OUT phase values (in → hold → out)
//   data-sw-parallax-<ch>-out-range="s,e"   OUT window (default = the remainder after IN)
//   default window is 0,1 (the full pass-through).
//
// SCENES — a depth stack (incl. the background) is a clipping container with absolutely-positioned
// layers, each its own element carrying its own channels (no bespoke background logic):
//   data-sw-parallax-scene                  position:relative; overflow:hidden (clips)
//   data-sw-parallax-layer                  an absolutely-positioned, independently-animated layer
//
// Authored as plain attributes in code-first sources, snippets, or raw Html blocks — like data-sw-animation
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
  /** translate offset, px (from→to). */
  translate: { min: -600, max: 600 },
  opacity: { min: 0, max: 1 },
  scale: { min: 0, max: 4 },
  /** filter blur radius, px. */
  blur: { min: 0, max: 40 },
  /** anchor window endpoints, as a fraction of the element's viewport pass-through. */
  range: { min: 0, max: 1 },
} as const;

// --- CSS --------------------------------------------------------------------
// Structural only (the MOTION is JS-applied, so it is never in the sheet). These rules are UNCONDITIONAL
// — a reduced-motion / no-JS visitor still gets a correctly clipped, layered scene, just without the
// drift. No brand colours here (the author styles the layers), so the sheet stays dark-theme-safe. A
// layer that TRANSLATES a cover image should be oversized by the author (e.g. inline `inset:-12%` or a
// base scale) so the motion never reveals an edge — the runtime applies no slack-clamp.
export const PARALLAX_CSS = [
  '[data-sw-parallax-scene]{position:relative;overflow:hidden}',
  // Stacked, full-bleed layers; the author orders/styles them (z-index, background, object-fit).
  '[data-sw-parallax-scene] [data-sw-parallax-layer]{position:absolute;inset:0}',
].join('');

// --- runtime ----------------------------------------------------------------
// Shared MATH, embedded verbatim in BOTH the production runtime and the builder-preview runtime so the two
// can never drift: the helpers (clamp/pair/win/lerp), `chan` (resolve a channel's IN window + optional
// OUT phase — an OUT can't start before IN ends, a zero-width OUT is dropped), `val` (channel value at
// cover-progress c: in → hold → out), `pxParse` (read an element's channels), `pxCover` (the progress
// spine), and `pxApply` (write transform/opacity/filter from a parse).
const PARALLAX_CORE = `
  function clamp(n,lo,hi){return n<lo?lo:(n>hi?hi:n);}
  function pair(v,lo,hi){if(v==null)return null;var p=(''+v).split(',');var a=parseFloat(p[0]),b=parseFloat(p[1]);if(isNaN(a)||isNaN(b))return null;return [clamp(a,lo,hi),clamp(b,lo,hi)];}
  function win(v){var p=pair(v,0,1);return (p&&p[1]>p[0])?p:null;}
  function lerp(a,b,t){return a+(b-a)*t;}
  function chan(el,name,lo,hi,er){
    var p=pair(el.getAttribute('data-sw-parallax-'+name),lo,hi);if(!p)return null;
    var iw=win(el.getAttribute('data-sw-parallax-'+name+'-range'))||er||[0,1];
    var o=pair(el.getAttribute('data-sw-parallax-'+name+'-out'),lo,hi);
    var ow=null;
    if(o){
      ow=win(el.getAttribute('data-sw-parallax-'+name+'-out-range'))||[iw[1],1];
      if(ow[0]<iw[1])ow=[iw[1],ow[1]];
      if(ow[1]<=ow[0]){o=null;ow=null;}
    }
    return {f:p[0],t:p[1],iw:iw,o:o,ow:ow};
  }
  function val(c,ch){
    if(ch.o&&c>=ch.ow[0])return lerp(ch.o[0],ch.o[1],clamp((c-ch.ow[0])/(ch.ow[1]-ch.ow[0]),0,1));
    return lerp(ch.f,ch.t,clamp((c-ch.iw[0])/(ch.iw[1]-ch.iw[0]),0,1));
  }
  function pxParse(el){var er=win(el.getAttribute('data-sw-parallax-range'));return {
    axis:el.getAttribute('data-sw-parallax-axis')==='x'?'x':'y',
    tr:chan(el,'translate',${PARALLAX_LIMITS.translate.min},${PARALLAX_LIMITS.translate.max},er),
    op:chan(el,'opacity',${PARALLAX_LIMITS.opacity.min},${PARALLAX_LIMITS.opacity.max},er),
    sc:chan(el,'scale',${PARALLAX_LIMITS.scale.min},${PARALLAX_LIMITS.scale.max},er),
    bl:chan(el,'blur',${PARALLAX_LIMITS.blur.min},${PARALLAX_LIMITS.blur.max},er)};}
  function pxCover(r,vh){return clamp((vh-r.top)/(vh+r.height),0,1);}
  function pxApply(el,P,c){var tf='';
    if(P.tr){var d=val(c,P.tr);tf=P.axis==='x'?'translate3d('+d.toFixed(2)+'px,0,0)':'translate3d(0,'+d.toFixed(2)+'px,0)';}
    if(P.sc)tf+=(tf?' ':'')+'scale('+val(c,P.sc).toFixed(3)+')';
    // Only WRITE a property this element actually drives — never clobber an author's CSS transform/etc.
    if(tf)el.style.transform=tf;
    if(P.op)el.style.opacity=val(c,P.op).toFixed(3);
    if(P.bl)el.style.filter='blur('+val(c,P.bl).toFixed(2)+'px)';
  }`;

export const PARALLAX_JS = `(function(){
  'use strict';
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var els=document.querySelectorAll('[data-sw-parallax-translate],[data-sw-parallax-opacity],[data-sw-parallax-scale],[data-sw-parallax-blur]');
  if(els.length===0)return;
  ${PARALLAX_CORE}
  var items=[];
  Array.prototype.forEach.call(els,function(el){
    var P=pxParse(el);if(!P.tr&&!P.op&&!P.sc&&!P.bl)return;
    var wc=[];if(P.tr||P.sc)wc.push('transform');if(P.op)wc.push('opacity');if(P.bl)wc.push('filter');
    items.push({el:el,P:P,wc:wc.join(','),active:true,r:null});
  });
  if(items.length===0)return;
  var io=('IntersectionObserver' in window)?new IntersectionObserver(function(es){
    es.forEach(function(e){for(var i=0;i<items.length;i++){if(items[i].el===e.target){items[i].active=e.isIntersecting;items[i].el.style.willChange=e.isIntersecting?items[i].wc:'';}}});
  },{rootMargin:'25% 0px 25% 0px'}):null;
  if(io)items.forEach(function(it){io.observe(it.el);});
  var vh=window.innerHeight,ticking=false;
  function render(){
    ticking=false;var i,it;
    // PASS 1 — read every rect first (no interleaved writes → one layout, no thrash)
    for(i=0;i<items.length;i++){it=items[i];it.r=it.active?it.el.getBoundingClientRect():null;}
    // PASS 2 — write styles only (no reads)
    for(i=0;i<items.length;i++){it=items[i];if(!it.r)continue;pxApply(it.el,it.P,pxCover(it.r,vh));}
  }
  function onScroll(){if(!ticking){ticking=true;(window.requestAnimationFrame||function(f){return f();})(render);}}
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',function(){vh=window.innerHeight;onScroll();},{passive:true});
  render();
})();`;

// The builder-preview runtime: drives the SINGLE `.sample` element off scroll, re-reading its attributes
// every frame, and accepts LIVE updates from the editor via postMessage — so changing a value never
// reloads the iframe and the scroll position is preserved. Same MATH as production (shared PARALLAX_CORE).
const PARALLAX_PREVIEW_JS = `(function(){
  'use strict';
  ${PARALLAX_CORE}
  var el=document.querySelector('.sample');if(!el)return;
  if(parent)parent.postMessage({type:'sw-px-ready'},'*');
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var vh=window.innerHeight,ticking=false;
  function render(){ticking=false;pxApply(el,pxParse(el),pxCover(el.getBoundingClientRect(),vh));}
  function onScroll(){if(!ticking){ticking=true;(window.requestAnimationFrame||function(f){return f();})(render);}}
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',function(){vh=window.innerHeight;onScroll();},{passive:true});
  // Live updates pushed by the builder — no reload, so the scroll position is preserved. Only whitelisted
  // data-sw-parallax-* attributes with numeric/comma/x values are applied (the doc is sandboxed anyway).
  window.addEventListener('message',function(e){var d=e.data;if(!d||d.type!=='sw-px'||!(d.entries instanceof Array))return;
    var a=el.attributes,i;for(i=a.length-1;i>=0;i--){if(a[i].name.indexOf('data-sw-parallax-')===0)el.removeAttribute(a[i].name);}
    for(i=0;i<d.entries.length;i++){var k=''+d.entries[i][0],v=''+d.entries[i][1];if(/^[a-z-]+$/.test(k)&&/^[-0-9.,x]*$/.test(v))el.setAttribute('data-sw-parallax-'+k,v);}
    el.style.transform='';el.style.opacity='';el.style.filter=''; // reset first so a REMOVED channel clears
    render();
  });
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

/** One channel's config for the preview: IN from→to, an optional IN window, and an optional OUT phase. */
export interface ParallaxChannel {
  from: number;
  to: number;
  range?: readonly [number, number] | null;
  out?: readonly [number, number] | null;
  outRange?: readonly [number, number] | null;
}

export interface ParallaxPreviewOpts {
  axis?: 'x' | 'y';
  /** element-level default window for channels without their own. */
  range?: readonly [number, number] | null;
  translate?: ParallaxChannel | null;
  opacity?: ParallaxChannel | null;
  scale?: ParallaxChannel | null;
  blur?: ParallaxChannel | null;
}

function clampNum(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** A "from,to" string of two clamped numbers, or null when the input isn't a finite pair. */
function pairStr(v: readonly [number, number] | null | undefined, lo: number, hi: number): string | null {
  return v && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
    ? `${clampNum(v[0], lo, hi)},${clampNum(v[1], lo, hi)}`
    : null;
}

/** A window "s,e" of two cover-fractions with e > s, or null. */
function winStr(v: readonly [number, number] | null | undefined): string | null {
  if (!v || v.length !== 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null;
  const s = clampNum(v[0], 0, 1);
  const e = clampNum(v[1], 0, 1);
  return e > s ? `${s},${e}` : null;
}

/** The attributes for one channel: the from,to plus optional per-channel window + OUT phase. */
function channelAttrs(name: string, ch: ParallaxChannel | null | undefined, lo: number, hi: number): string[] {
  const main = ch ? pairStr([ch.from, ch.to], lo, hi) : null;
  if (!ch || !main) return [];
  const out: string[] = [`data-sw-parallax-${name}="${main}"`];
  const rng = winStr(ch.range);
  if (rng) out.push(`data-sw-parallax-${name}-range="${rng}"`);
  const o = pairStr(ch.out, lo, hi);
  if (o) {
    out.push(`data-sw-parallax-${name}-out="${o}"`);
    const orng = winStr(ch.outRange);
    if (orng) out.push(`data-sw-parallax-${name}-out-range="${orng}"`);
  }
  return out;
}

/** Build the Parallax-builder preview document (see note above). Every numeric is clamped to
 *  PARALLAX_LIMITS; channels/windows/OUT are emitted only when a valid from,to pair is supplied. */
export function parallaxPreviewDoc(opts: ParallaxPreviewOpts = {}): string {
  const L = PARALLAX_LIMITS;
  const axis = opts.axis === 'x' ? 'x' : 'y';
  const hasAny = opts.translate || opts.opacity || opts.scale || opts.blur;
  // With no channels at all, default to a visible translate so the empty preview still demonstrates motion.
  const translate = opts.translate ?? (hasAny ? null : { from: 40, to: -40 });
  const elRange = winStr(opts.range);
  const attrs = [
    ...channelAttrs('translate', translate, L.translate.min, L.translate.max),
    ...channelAttrs('opacity', opts.opacity, L.opacity.min, L.opacity.max),
    ...channelAttrs('scale', opts.scale, L.scale.min, L.scale.max),
    ...channelAttrs('blur', opts.blur, L.blur.min, L.blur.max),
    axis === 'x' ? 'data-sw-parallax-axis="x"' : '',
    elRange ? `data-sw-parallax-range="${elRange}"` : '',
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
    `<script>${PARALLAX_PREVIEW_JS}</script></body></html>`
  );
}

// Detection is a literal substring match: every channel/structural attribute contains `data-sw-parallax`,
// so one marker gates the whole family. A `data-sw-parallax` written via a Handlebars variable won't be
// detected (don't do that); a prose mention over-ships ~2KB — benign in both directions.
const PARALLAX_MARKER = 'data-sw-parallax';

/** Whether an authored HTML/template string uses any parallax channel or scene. */
export function usesParallax(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(PARALLAX_MARKER);
}

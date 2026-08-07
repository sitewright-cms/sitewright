// FIXED-BACKGROUND EMULATION — preview surfaces only.
//
// THE DEFECT (measured, Chromium 1223): `background-attachment: fixed` paints as `scroll` inside an
// iframe that any ancestor has SCALED. The page editor's responsive modes (Laptop / Tablet / Mobile)
// lay the preview out at the device width and scale it down to fit the pane, so every fixed background
// in the page editor scrolled — while the same page in the whole-site `/preview` (never scaled) was
// correct. That mismatch is exactly what an author reports as "fixed backgrounds are broken in the page
// preview".
//
// WHAT DOESN'T WORK (all measured before settling on this): `transform: scale()` on the wrapper, on the
// iframe itself, and CSS `zoom` all break it identically. It is not a choice of scaling technique — a
// scaled iframe simply resolves fixed-attachment against its composited layer instead of its viewport.
//
// WHAT DOES WORK: `position: fixed` INSIDE the scaled iframe still resolves against the iframe's own
// viewport (measured ✓). And a viewport-filling fixed element painting the same background with
// `attachment: scroll` is, by definition, what fixed-attachment paints — the fixed positioning area IS
// the viewport. So each affected element gets a fixed, inset-0 layer carrying its background, clipped
// to the element's current viewport rect. No geometry maths, no image measurement: the browser resolves
// `cover`/`contain`/percentages against the viewport exactly as it would have.
//
// Preview-only by construction: the published site has no scaling ancestor and needs none of this.
//
// ★ THE CLIP IS LIVE STATE, NOT A ONE-TIME MEASUREMENT. Everything below exists because the first
// version treated adoption as a one-way door and the clip as something only scrolling could invalidate.
// Measured against the live editor (bionic-germany / Kontakt), that produced a layer whose clip-path
// froze at `inset(64px 0px 58.8125px)` and never moved again — a background that is not fixed, not
// scrolled, just stuck, which is worse than the bug it replaced. Three rules keep it honest:
//   1. An ADOPTED host must be recognised by its LAYER, never by its background-image — adoption sets
//      that image to `none`, so an image test drops the host on the very next rescan (see collect()).
//   2. Adoption is REVERSIBLE. A media query can hand the host back to `attachment: scroll` — this is
//      not exotic, it is the standard "no fixed backgrounds on mobile" rule, and the device modes walk
//      straight into it. Releasing restores the host's own paint (see clip()).
//   3. A REFLOW moves the host without a scroll, a resize or a childList mutation: a webfont or an
//      image above it settles, a pane is dragged, a device mode changes. The clip has to be recomputed
//      then too, or the author keeps looking at a clip measured before the page had settled.

/** Marker attribute on a generated layer, so re-running the runtime is idempotent. */
const LAYER_ATTR = 'data-sw-fixed-bg';
/** The host's own inline values, stashed on the layer so adoption can be undone exactly. */
const PREV_IMAGE_ATTR = 'data-sw-fixed-bg-prev-image';
const PREV_ISOLATION_ATTR = 'data-sw-fixed-bg-prev-isolation';

export const FIXED_BG_PREVIEW_CSS = [
  // The layer fills the viewport and paints behind its host's content. `z-index:-1` puts it behind the
  // host's in-flow children but IN FRONT of the host's own background; the host is given
  // `isolation:isolate` by the runtime so that -1 can never escape behind the host itself.
  `[${LAYER_ATTR}]{position:fixed;inset:0;z-index:-1;pointer-events:none;background-attachment:scroll}`,
].join('');

export const FIXED_BG_PREVIEW_JS = `(function(){
  'use strict';
  var LAYER='${LAYER_ATTR}';
  var PREV_IMAGE='${PREV_IMAGE_ATTR}';
  var PREV_ISOLATION='${PREV_ISOLATION_ATTR}';
  // Copied verbatim so the browser resolves cover/contain/percentages against the layer — which is the
  // viewport, i.e. precisely the positioning area fixed-attachment would have used.
  var PROPS=['backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat','backgroundOrigin','backgroundClip','backgroundBlendMode'];
  var pairs=[];
  // Geometry changes that are neither a scroll nor a window resize: a device mode relayouts the page,
  // a pane drag narrows it, a late image or webfont above the host settles it into a new position. A
  // full rescan (not just a re-clip) because the same width change can flip a media query, which both
  // RELEASES a host that is no longer fixed and RE-ADOPTS one that just became fixed again.
  var sizes=typeof ResizeObserver==='function'?new ResizeObserver(function(){rescan();}):null;
  function wantsFixed(cs){return cs.backgroundAttachment.indexOf('fixed')>=0;}
  function adopt(el,cs){
    var layer=document.createElement('div');
    layer.setAttribute(LAYER,'');
    layer.setAttribute('aria-hidden','true');
    // Stash what we are about to overwrite, so release() can put the host back exactly as authored
    // (usually empty strings — the background normally comes from a stylesheet, not the style attribute).
    layer.setAttribute(PREV_IMAGE,el.style.backgroundImage||'');
    layer.setAttribute(PREV_ISOLATION,el.style.isolation||'');
    el.insertBefore(layer,el.firstChild);
    for(var p=0;p<PROPS.length;p++)layer.style[PROPS[p]]=cs[PROPS[p]];
    // Hand the paint over: the host keeps its background COLOR, the layer takes the image.
    el.style.backgroundImage='none';
    // A stacking context on the host keeps the z-index:-1 layer from sliding behind the host's own
    // background (or out of the host entirely) when the host is otherwise unpositioned.
    el.style.isolation='isolate';
    if(sizes)sizes.observe(el);
    return layer;
  }
  function release(el,layer){
    el.style.backgroundImage=layer.getAttribute(PREV_IMAGE)||'';
    el.style.isolation=layer.getAttribute(PREV_ISOLATION)||'';
    if(sizes)sizes.unobserve(el);
    if(layer.parentNode)layer.parentNode.removeChild(layer);
  }
  function collect(){
    pairs.length=0;
    var all=document.querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      var el=all[i];
      if(el.hasAttribute(LAYER))continue;
      var cs;
      try{cs=getComputedStyle(el);}catch(e){continue;}
      var layer=el.querySelector(':scope>['+LAYER+']');
      // ALREADY ADOPTED — this test comes FIRST, and the ordering is the whole point. adopt() sets the
      // host's background-image to 'none', so an adopted host FAILS the "is there an image to paint"
      // guard below. Running that guard first dropped every adopted host from the pairs list on the next
      // rescan (a MutationObserver fires within milliseconds on any live page), leaving clip() to
      // iterate an empty list forever — the frozen clip-path measured in the editor.
      if(layer){pairs.push([el,layer]);continue;}
      if(!wantsFixed(cs))continue;
      if(!cs.backgroundImage||cs.backgroundImage==='none')continue;
      pairs.push([el,adopt(el,cs)]);
    }
  }
  // Rounded hosts: a rectangular clip would paint square corners over a rounded section. The 4-value
  // 'round' form cannot express an ELLIPTICAL radius (which computes to two lengths), so in that case
  // skip rounding rather than emit an invalid clip-path — an invalid value drops the clip entirely and
  // the background floods the whole viewport.
  function radiusOf(cs){
    var r=[cs.borderTopLeftRadius,cs.borderTopRightRadius,cs.borderBottomRightRadius,cs.borderBottomLeftRadius];
    var any=false;
    for(var i=0;i<4;i++){
      if(!r[i]||r[i].indexOf(' ')>=0)return '';
      if(r[i]!=='0px')any=true;
    }
    return any?' round '+r.join(' '):'';
  }
  function clip(){
    for(var i=0;i<pairs.length;i++){
      var el=pairs[i][0],layer=pairs[i][1];
      // GONE from the document: hide the layer and stop tracking the host, including its size
      // observation. Keeping the pair around leaked one entry (and one observed element) per removal,
      // which a preview that swaps whole subtrees does all day. If it is ever re-attached, that is a
      // childList mutation, so the rescan re-pairs it from its surviving layer.
      if(!el.isConnected){
        layer.style.display='none';
        if(sizes)sizes.unobserve(el);
        pairs.splice(i,1);i--;
        continue;
      }
      var cs;
      try{cs=getComputedStyle(el);}catch(e){continue;}
      // RELEASE the moment the host stops asking for a fixed background. This lives here, not only in
      // collect(), because the trigger is usually a media query: the width changes, no DOM mutation
      // happens, so a rescan may never come — and a host left adopted paints the desktop treatment at
      // mobile widths while its own background stays blank.
      if(!wantsFixed(cs)){release(el,layer);pairs.splice(i,1);i--;continue;}
      var r=el.getBoundingClientRect();
      var vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
      // Fully outside the viewport → nothing to paint (also avoids a negative inset).
      if(r.bottom<=0||r.top>=vh||r.right<=0||r.left>=vw){layer.style.display='none';continue;}
      layer.style.display='';
      layer.style.clipPath='inset('+Math.max(0,r.top)+'px '+Math.max(0,vw-r.right)+'px '+Math.max(0,vh-r.bottom)+'px '+Math.max(0,r.left)+'px'+radiusOf(cs)+')';
    }
  }
  var ticking=false;
  function onScroll(){if(ticking)return;ticking=true;requestAnimationFrame(function(){ticking=false;clip();});}
  // Re-collect when the DOM changes. A single pass at init would miss every element that appears
  // LATER — a carousel's cloned slides, content a modal injects on open, anything a runtime enhances
  // into place. Those would silently fall back to the broken paint with nothing to explain it.
  // Coalesced into one rAF so a burst of mutations costs one pass, and collect() is idempotent (it
  // reuses the layer it already made and skips elements whose background it has already taken over).
  // TERMINATION: collect() inserts layers, which is itself a childList mutation — but the pass that
  // follows finds those layers already present and inserts nothing, so the loop settles after one
  // extra scan. Only childList is observed, so the style-attribute writes collect() makes cannot
  // re-trigger it. (No backticks in this string: it is a template literal.)
  var scanQueued=false;
  function rescan(){
    if(scanQueued)return;
    scanQueued=true;
    requestAnimationFrame(function(){scanQueued=false;collect();clip();});
  }
  function init(){
    collect();
    clip();
    // capture:true — the whole-site preview scrolls the BODY, and a non-root scroller's scroll event
    // does not bubble to a plain window listener (see the body-scroller contract).
    window.addEventListener('scroll',onScroll,{passive:true,capture:true});
    window.addEventListener('resize',onScroll,{passive:true});
    // Late-loading images/fonts settle the layout without scrolling, resizing or mutating anything.
    window.addEventListener('load',rescan);
    if(sizes){
      // documentElement: the viewport box. body: content REFLOW — content above the host growing moves
      // the host without resizing it, so observing the host alone is not enough (adopt() observes each
      // host as well, for the host's own box).
      sizes.observe(document.documentElement);
      if(document.body)sizes.observe(document.body);
    }
    // Observe from the document root: an element with a fixed background can be inserted anywhere,
    // and this is a preview-only surface where being correct beats shaving a MutationObserver.
    if(typeof MutationObserver==='function'){
      new MutationObserver(rescan).observe(document.documentElement,{childList:true,subtree:true});
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();`;

/** Whether an authored/rendered HTML string may contain a fixed background worth emulating.
 *  `bg-fixed` is the Tailwind utility; the longhand covers hand-written CSS and imported clones. */
export function usesFixedBackground(html: string | null | undefined): boolean {
  if (typeof html !== 'string') return false;
  return html.includes('bg-fixed') || html.includes('background-attachment');
}

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

/** Marker attribute on a generated layer, so re-running the runtime is idempotent. */
const LAYER_ATTR = 'data-sw-fixed-bg';

export const FIXED_BG_PREVIEW_CSS = [
  // The layer fills the viewport and paints behind its host's content. `z-index:-1` puts it behind the
  // host's in-flow children but IN FRONT of the host's own background; the host is given
  // `isolation:isolate` by the runtime so that -1 can never escape behind the host itself.
  `[${LAYER_ATTR}]{position:fixed;inset:0;z-index:-1;pointer-events:none;background-attachment:scroll}`,
].join('');

export const FIXED_BG_PREVIEW_JS = `(function(){
  'use strict';
  var LAYER='${LAYER_ATTR}';
  // Copied verbatim so the browser resolves cover/contain/percentages against the layer — which is the
  // viewport, i.e. precisely the positioning area fixed-attachment would have used.
  var PROPS=['backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat','backgroundOrigin','backgroundClip','backgroundBlendMode'];
  var pairs=[];
  function collect(){
    pairs.length=0;
    var all=document.querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      var el=all[i];
      if(el.hasAttribute(LAYER))continue;
      var cs;
      try{cs=getComputedStyle(el);}catch(e){continue;}
      // Only elements that actually ASK for a fixed background, and only when there is an image to paint.
      if(cs.backgroundAttachment.indexOf('fixed')<0)continue;
      if(!cs.backgroundImage||cs.backgroundImage==='none')continue;
      var layer=el.querySelector(':scope>['+LAYER+']');
      // Already adopted (its image now lives on the layer): keep the existing pair, don't re-read a
      // backgroundImage we ourselves set to 'none'.
      if(layer){pairs.push([el,layer]);continue;}
      layer=document.createElement('div');
      layer.setAttribute(LAYER,'');
      layer.setAttribute('aria-hidden','true');
      el.insertBefore(layer,el.firstChild);
      for(var p=0;p<PROPS.length;p++)layer.style[PROPS[p]]=cs[PROPS[p]];
      // Hand the paint over: the host keeps its background COLOR, the layer takes the image.
      el.style.backgroundImage='none';
      // A stacking context on the host keeps the z-index:-1 layer from sliding behind the host's own
      // background (or out of the host entirely) when the host is otherwise unpositioned.
      el.style.isolation='isolate';
      pairs.push([el,layer]);
    }
  }
  function clip(){
    for(var i=0;i<pairs.length;i++){
      var el=pairs[i][0],layer=pairs[i][1];
      if(!el.isConnected){layer.style.display='none';continue;}
      var r=el.getBoundingClientRect();
      var vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
      // Fully outside the viewport → nothing to paint (also avoids a negative inset).
      if(r.bottom<=0||r.top>=vh||r.right<=0||r.left>=vw){layer.style.display='none';continue;}
      layer.style.display='';
      layer.style.clipPath='inset('+Math.max(0,r.top)+'px '+Math.max(0,vw-r.right)+'px '+Math.max(0,vh-r.bottom)+'px '+Math.max(0,r.left)+'px)';
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

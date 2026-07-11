// Lazy-loading: a first-party runtime for the industry-standard vanilla-lazyload /
// lozad vocabulary (`data-src` / `data-srcset` / `data-bg`).
//
// Native `loading="lazy"` already covers plain `<img>`/`<iframe>` (and the image
// pipeline emits an LQIP blur placeholder), so this fills the gap native lazy does
// NOT cover: BACKGROUND images (`data-bg`) and a deferred `data-src`/`data-srcset`
// swap with a blur-up fade. The DATA-ATTRIBUTE is the marker: any element carrying
// `data-src`/`data-srcset`/`data-bg` is lazy-loaded — no `lazyload` class is required
// (it stays accepted for backward compatibility). The swap is element-agnostic, so
// `<img data-src>` AND `<iframe data-src>` both get their real `src`/`srcset` set on
// scroll-in. Same only-used-ships discipline as components.ts / animations.ts.
//
// MEDIA (`<video>`/`<audio>`): a `data-src` on the element or on a `<source data-src>` child is the
// deferred URL — nothing is fetched until the element enters the viewport (or a closed modal that holds
// it is opened, which is just the same visibility change). On enter the runtime copies data-src → src,
// calls `.load()`, and — if the element carries `autoplay` OR `data-autoplay` — plays it (muted autoplay
// is the browser-allowed case); on LEAVE it pauses (so a video pauses when it scrolls out of view, and a
// modal video pauses when the modal closes), resuming on re-enter. This is why a muted-autoplay promo
// video belongs in `data-src` + `data-autoplay`: the plain `autoplay` attribute alone would force a full
// download on page load THROUGH `preload="none"`, defeating the whole point.
//
// Invariants:
// - PE-first: with no JS / no IntersectionObserver, a `data-bg`/`data-src` element
//   stays un-decorated (the runtime adds `.lazyloading`); the fade lives behind
//   `prefers-reduced-motion: no-preference`, so reduced motion = instant swap.
// - First-party, audited, static code only — tenants supply DATA (the URL in
//   `data-bg`/`data-src`); never JS. The runtime only ever copies that value into
//   `src`/`srcset`/`background-image` — exactly what a literal `<img src>`/`<iframe src>`
//   already does, so it grants no capability beyond authoring those tags directly (the bg
//   value is additionally CSS-url()-escaped against a `url("…")` string breakout).
/**
 * The lazy-load stylesheet. `.lazyloading` (runtime-added) fades a freshly-revealed
 * element in; `.lazyloaded` is the settled state. No-JS → neither class is added,
 * so content shows immediately (PE-first). The fade is reduced-motion-gated.
 */
export const LAZYLOAD_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  '[data-bg].lazyloading,[data-src].lazyloading,[data-srcset].lazyloading{opacity:0}',
  '[data-bg],[data-src],[data-srcset]{transition:opacity .4s ease}',
  '[data-bg].lazyloaded,[data-src].lazyloaded,[data-srcset].lazyloaded{opacity:1}',
  '}',
].join('\n');

// The runtime. On intersect, an element is "loaded": ANY element gets `data-src`
// /`data-srcset` copied to `src`/`srcset` (so `<img>` and `<iframe>` both work), and
// any element with `data-bg` gets it set as `background-image`. The fade-in settles
// on the background preloader, or the element's own `load` event (img + iframe both
// fire it), or immediately when there's nothing to await. A wide `rootMargin` starts
// the load just before the element scrolls in.
export const LAZYLOAD_JS = `(function(){
  'use strict';
  if(!('IntersectionObserver' in window))return;
  var raw=document.querySelectorAll('[data-src],[data-srcset],[data-bg]');
  if(raw.length===0)return;
  // A <source data-src> can't be observed (no layout box) — observe its parent <video>/<audio> instead.
  var els=[];
  Array.prototype.forEach.call(raw,function(el){var t=(el.tagName==='SOURCE')?el.parentNode:el;if(t&&els.indexOf(t)<0)els.push(t);});
  function isMedia(el){return el.tagName==='VIDEO'||el.tagName==='AUDIO';}
  function wantsPlay(el){return el.autoplay||el.hasAttribute('data-autoplay');}
  function reveal(el){
    // MEDIA: copy data-src (on the element AND any <source data-src> child) → src, then load(). No fade
    // classes (a video isn't awaited like an <img>); autoplay is handled by the observer on intersect.
    if(isMedia(el)){
      Array.prototype.forEach.call(el.querySelectorAll('source[data-src]'),function(s){if(!s.getAttribute('src'))s.setAttribute('src',s.getAttribute('data-src'));});
      var m=el.getAttribute('data-src');if(m&&!el.getAttribute('src'))el.setAttribute('src',m);
      if(typeof el.load==='function'){try{el.load();}catch(e){}}
      return;
    }
    el.classList.add('lazyloading');
    var settled=false;
    var done=function(){if(settled)return;settled=true;el.classList.remove('lazyloading');el.classList.add('lazyloaded');};
    var bg=el.getAttribute('data-bg');
    var src=el.getAttribute('data-src');
    var srcset=el.getAttribute('data-srcset');
    // Settle the fade on: a preloaded background, else the media's own 'load' (img + iframe both
    // fire it; img also 'error'), else immediately. Only <img>/<iframe> emit a load we can await —
    // a data-src on any other element has no src to load, so settle it at once (never leave it
    // stuck at opacity:0, invisible).
    var pre, firesLoad = el.tagName==='IMG' || el.tagName==='IFRAME';
    if(bg){pre=new Image();pre.onload=done;pre.onerror=done;}
    else if((src||srcset)&&firesLoad){el.addEventListener('load',done,{once:true});el.addEventListener('error',done,{once:true});}
    else{done();}
    if(srcset)el.setAttribute('srcset',srcset);
    if(src)el.setAttribute('src',src);
    if(bg){
      // Encode \\ and " so the value can't break out of the CSS url("...") string.
      el.style.backgroundImage='url("'+bg.replace(/\\\\/g,'%5C').replace(/"/g,'%22')+'")';
      pre.src=bg;
    }
    // Safety net: if no load/error/preload event ever fires (network hang, a srcset with no chosen
    // candidate), reveal anyway after a deadline so the element can't stay invisible.
    if(!settled)setTimeout(done,3000);
  }
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var el=entry.target;
      if(entry.isIntersecting){
        if(!el.__swLazyOn){el.__swLazyOn=1;reveal(el);}
        // MEDIA plays on enter (and resumes on re-enter) when it wants autoplay; stays OBSERVED so it can
        // pause on leave. Everything else is one-shot — unobserve so it never re-fires.
        if(isMedia(el)){if(wantsPlay(el)&&el.paused){var p=el.play();if(p&&p.catch)p.catch(function(){});}}
        else{io.unobserve(el);}
      }else if(isMedia(el)&&!el.paused){el.pause();}
    });
  },{rootMargin:'200px 0px',threshold:0});
  Array.prototype.forEach.call(els,function(el){io.observe(el);});
})();`;

// The markers: `data-bg`, `data-src` (substring also covers `data-srcset`), and the
// legacy `lazyload` class. A stray prose mention only over-ships ~1KB — benign.
function hasMarker(html: string): boolean {
  return html.includes('data-bg') || html.includes('data-src') || html.includes('lazyload');
}

/** Whether an authored HTML/template string uses lazy-loading. */
export function usesLazyload(html: string | null | undefined): boolean {
  return typeof html === 'string' && hasMarker(html);
}


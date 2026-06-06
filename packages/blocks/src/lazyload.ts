// Lazy-loading: a first-party runtime for the industry-standard vanilla-lazyload /
// lozad vocabulary (`class="lazyload"` + `data-src` / `data-srcset` / `data-bg`).
//
// Native `loading="lazy"` already covers plain `<img>`/`<iframe>` (and the image
// pipeline emits an LQIP blur placeholder), so this fills the gap native lazy does
// NOT cover: BACKGROUND images (`data-bg`) and an opt-in `data-src`/`data-srcset`
// swap with a blur-up fade. Same only-used-ships discipline as components.ts /
// animations.ts; the AOS-style class protocol (`lazyload` → `lazyloaded`) is what
// every template and LLM already emits.
//
// Invariants:
// - PE-first: with no JS / no IntersectionObserver, a `data-bg`/`data-src` element
//   stays un-decorated (the runtime adds `.lazyloading`); the fade lives behind
//   `prefers-reduced-motion: no-preference`, so reduced motion = instant swap.
// - First-party, audited, static code only — tenants supply DATA (the URL in
//   `data-bg`/`data-src`, validated as an attribute by the template layer); never JS.
import { walk } from '@sitewright/core';
import type { PageNode } from '@sitewright/schema';

/**
 * The lazy-load stylesheet. `.lazyloading` (runtime-added) fades a freshly-revealed
 * element in; `.lazyloaded` is the settled state. No-JS → neither class is added,
 * so content shows immediately (PE-first). The fade is reduced-motion-gated.
 */
export const LAZYLOAD_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  '[data-bg].lazyloading,img.lazyload.lazyloading{opacity:0}',
  '[data-bg],img.lazyload{transition:opacity .4s ease}',
  '[data-bg].lazyloaded,img.lazyload.lazyloaded{opacity:1}',
  '}',
].join('\n');

// The runtime. On intersect, an element is "loaded": an `<img>` gets its `data-src`
// /`data-srcset` copied to `src`/`srcset`; any element with `data-bg` gets it set as
// `background-image`. The `lazyloading`→`load`→`lazyloaded` class dance drives the
// fade. A wide `rootMargin` starts the load just before the element scrolls in.
export const LAZYLOAD_JS = `(function(){
  'use strict';
  if(!('IntersectionObserver' in window))return;
  var els=document.querySelectorAll('img.lazyload[data-src],img.lazyload[data-srcset],[data-bg]');
  if(els.length===0)return;
  function reveal(el){
    el.classList.add('lazyloading');
    var settled=false;
    var done=function(){if(settled)return;settled=true;el.classList.remove('lazyloading');el.classList.add('lazyloaded');};
    var bg=el.getAttribute('data-bg');
    if(bg){
      var img=new Image();
      img.onload=done;img.onerror=done;
      img.src=bg;
      // Encode \\ and " so the value can't break out of the CSS url("...") string.
      el.style.backgroundImage='url("'+bg.replace(/\\\\/g,'%5C').replace(/"/g,'%22')+'")';
    }
    // For an <img>, swap data-src/-srcset → src/srcset. The background (when present)
    // already drives the class transition, so only wire the <img> load when there's no bg.
    if(el.tagName==='IMG'){
      var src=el.getAttribute('data-src');
      var srcset=el.getAttribute('data-srcset');
      if(srcset)el.setAttribute('srcset',srcset);
      if(src){if(!bg)el.addEventListener('load',done,{once:true});el.setAttribute('src',src);}
      else if(!bg)done();
    }else if(!bg){done();}
  }
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting)return;
      io.unobserve(entry.target);
      reveal(entry.target);
    });
  },{rootMargin:'200px 0px',threshold:0});
  Array.prototype.forEach.call(els,function(el){io.observe(el);});
})();`;

// `data-bg` is the unambiguous marker; `lazyload` (as a class) is the secondary one.
// A prose mention only over-ships ~1KB — benign.
function hasMarker(html: string): boolean {
  return html.includes('data-bg') || html.includes('lazyload');
}

/** Whether an authored HTML/template string uses lazy-loading. */
export function usesLazyload(html: string | null | undefined): boolean {
  return typeof html === 'string' && hasMarker(html);
}

/** Whether a block tree uses lazy-loading — any node with a string prop carrying the marker. */
export function treeUsesLazyload(root: PageNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found || !node.props) return;
    for (const value of Object.values(node.props)) {
      if (typeof value === 'string' && hasMarker(value)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

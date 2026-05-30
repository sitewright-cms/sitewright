// Platform-authored, dependency-free behavior + styling for INTERACTIVE component
// blocks (the "Components" palette: Carousel, and future Modal/Lightbox/etc.).
//
// These are NOT tenant code — they are first-party, audited, static assets shipped
// only when the matching block is used (the same "only-used-ships" discipline as
// icons.ts / brand-icons.ts / the Tailwind sheet). The tenant supplies only DATA
// (slides, captions) through typed block props; never JavaScript. This keeps the
// "no per-tenant code execution" invariant intact: the JS below is bundled to a
// `components.js` served from the site's own origin (CSP `default-src 'self'`),
// and runs on the published/exported site. The editor's sandboxed live-preview
// shows the progressive-enhancement fallback (no script) — components degrade to
// usable semantic HTML (a scroll-snap carousel still swipes/scrolls) without JS.
import { walk } from '@sitewright/core';
import type { PageNode } from '@sitewright/schema';

/** A component's static styling + behavior (either may be empty). */
export interface ComponentAsset {
  css: string;
  js: string;
}

// --- Carousel -------------------------------------------------------------
// PE-first: the track is a CSS scroll-snap row (swipeable with no JS). Arrows +
// dots are hidden until JS marks the root `data-sw-enhanced`, so the no-JS
// fallback never shows inert controls. Respects prefers-reduced-motion.
const CAROUSEL_CSS = [
  '[data-sw-block="Carousel"]{position:relative}',
  '[data-sw-block="Carousel"] [data-sw-part="track"]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch}',
  '[data-sw-block="Carousel"] [data-sw-part="track"]::-webkit-scrollbar{display:none}',
  '[data-sw-block="Carousel"] [data-sw-part="slide"]{flex:0 0 100%;scroll-snap-align:start;min-width:0}',
  '[data-sw-block="Carousel"] [data-sw-part="slide"] img{display:block;width:100%;height:auto}',
  '[data-sw-block="Carousel"] [data-sw-part="prev"],[data-sw-block="Carousel"] [data-sw-part="next"],[data-sw-block="Carousel"] [data-sw-part="dots"]{display:none}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="prev"],[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="next"]{display:flex;align-items:center;justify-content:center;position:absolute;top:50%;transform:translateY(-50%);width:2.5rem;height:2.5rem;border:0;border-radius:9999px;background:rgba(0,0,0,.5);color:#fff;cursor:pointer;font-size:1.25rem;line-height:1}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="prev"]{left:.5rem}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="next"]{right:.5rem}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="dots"]{display:flex;justify-content:center;gap:.5rem;padding:.75rem 0}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button{width:.6rem;height:.6rem;border-radius:9999px;border:0;background:currentColor;opacity:.35;cursor:pointer;padding:0}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button[aria-current="true"]{opacity:1}',
  '@media (prefers-reduced-motion: reduce){[data-sw-block="Carousel"] [data-sw-part="track"]{scroll-behavior:auto}}',
].join('');

// Dependency-free enhancement. Finds every carousel, wires arrows/dots/keyboard/
// autoplay, keeps the active dot in sync with manual scroll, and pauses autoplay
// on hover/focus and under reduced-motion.
const CAROUSEL_JS = `(function(){
  function enhance(root){
    var track=root.querySelector('[data-sw-part="track"]');
    if(!track)return;
    var slides=Array.prototype.slice.call(track.querySelectorAll('[data-sw-part="slide"]'));
    if(slides.length<2)return;
    var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var loop=root.getAttribute('data-loop')==='true';
    var index=0;
    function clamp(i){return loop?(i+slides.length)%slides.length:Math.max(0,Math.min(slides.length-1,i));}
    function go(i){var n=clamp(i);if(n===index&&!loop){return;}index=n;slides[index].scrollIntoView({behavior:reduce?'auto':'smooth',inline:'start',block:'nearest'});sync();}
    var dotsWrap=root.querySelector('[data-sw-part="dots"]');
    var dots=[];
    if(dotsWrap){dotsWrap.removeAttribute('aria-hidden');slides.forEach(function(_,i){var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Go to slide '+(i+1));b.addEventListener('click',function(){go(i);});dotsWrap.appendChild(b);dots.push(b);});}
    function sync(){for(var i=0;i<dots.length;i++){dots[i].setAttribute('aria-current',i===index?'true':'false');}}
    var prev=root.querySelector('[data-sw-part="prev"]');
    var next=root.querySelector('[data-sw-part="next"]');
    if(prev)prev.addEventListener('click',function(){go(index-1);});
    if(next)next.addEventListener('click',function(){go(index+1);});
    root.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){go(index-1);}else if(e.key==='ArrowRight'){go(index+1);}});
    var st;
    track.addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(function(){var min=Infinity,mi=0,tl=track.getBoundingClientRect().left;slides.forEach(function(s,i){var d=Math.abs(s.getBoundingClientRect().left-tl);if(d<min){min=d;mi=i;}});index=mi;sync();},100);},{passive:true});
    var auto=root.getAttribute('data-autoplay')==='true';
    var interval=parseInt(root.getAttribute('data-interval'),10)||5000;
    var timer=null;
    function play(){stop();if(auto&&!reduce){timer=setInterval(function(){go(index+1);},interval);}}
    function stop(){if(timer){clearInterval(timer);timer=null;}}
    root.addEventListener('mouseenter',stop);root.addEventListener('mouseleave',play);
    root.addEventListener('focusin',function(e){if(!root.contains(e.relatedTarget)){stop();}});
    root.addEventListener('focusout',function(e){if(!root.contains(e.relatedTarget)){play();}});
    root.setAttribute('data-sw-enhanced','true');
    sync();play();
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="carousel"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// Registry keyed by block `type`. Only blocks with behavior/styling belong here
// (Slide is a plain child block — no entry). Insertion order = bundle order.
const COMPONENTS = new Map<string, ComponentAsset>([['Carousel', { css: CAROUSEL_CSS, js: CAROUSEL_JS }]]);

/** Block types that are interactive components (have bundled CSS/JS). */
export const COMPONENT_TYPES: ReadonlySet<string> = new Set(COMPONENTS.keys());

/** The distinct component block types used anywhere in a (resolved) tree. */
export function usedComponentTypes(root: PageNode): string[] {
  const seen = new Set<string>();
  walk(root, (node) => {
    if (COMPONENTS.has(node.type)) seen.add(node.type);
  });
  return [...seen];
}

/**
 * Bundles the CSS + JS for the given component types into single strings (deduped,
 * in stable registry order). Unknown types are ignored. Empty when none are used,
 * so callers ship nothing for sites that use no components.
 */
export function componentAssets(types: Iterable<string>): { css: string; js: string } {
  const want = new Set(types);
  const css: string[] = [];
  const js: string[] = [];
  for (const [type, asset] of COMPONENTS) {
    if (!want.has(type)) continue;
    if (asset.css) css.push(asset.css);
    if (asset.js) js.push(asset.js);
  }
  return { css: css.join('\n'), js: js.join('\n') };
}

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

// --- Accordion --------------------------------------------------------------
// ZERO JavaScript: built on native <details>/<summary>, so it is fully
// interactive everywhere — including the editor's sandboxed (script-free)
// preview. The registry entry contributes styling only.
const ACCORDION_CSS = [
  '[data-sw-block="Accordion"]{display:block}',
  '[data-sw-block="AccordionItem"]{border:1px solid rgba(0,0,0,.12);border-radius:.375rem;margin-bottom:.5rem;overflow:hidden}',
  '[data-sw-block="AccordionItem"]>summary{cursor:pointer;padding:.75rem 1rem;font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center}',
  '[data-sw-block="AccordionItem"]>summary::-webkit-details-marker{display:none}',
  '[data-sw-block="AccordionItem"]>summary::after{content:"+";font-weight:400;margin-left:1rem}',
  '[data-sw-block="AccordionItem"][open]>summary::after{content:"\\2013"}',
  '[data-sw-block="AccordionItem"] [data-sw-part="content"]{padding:0 1rem 1rem}',
].join('');

// --- Lightbox ----------------------------------------------------------------
// A thumbnail grid that opens a full-screen overlay. PE-first: each item is an
// anchor to the full image, so with no JS clicking simply opens the image. The
// overlay is hidden until JS marks the root enhanced.
const LIGHTBOX_CSS = [
  '[data-sw-block="Lightbox"]{display:block}',
  '[data-sw-block="Lightbox"] [data-sw-part="grid"]{display:grid;grid-template-columns:repeat(auto-fill,minmax(8rem,1fr));gap:.5rem}',
  '[data-sw-block="Lightbox"] [data-sw-part="item"]{display:block}',
  '[data-sw-block="Lightbox"] [data-sw-part="item"] img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:1}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"]{display:none}',
  '[data-sw-block="Lightbox"][data-sw-enhanced="true"] [data-sw-part="overlay"][data-open="true"]{display:flex;position:fixed;inset:0;z-index:9999;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.92)}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] img{max-width:90vw;max-height:80vh;object-fit:contain}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] figcaption{color:#fff;padding:.5rem 1rem;text-align:center}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] button{position:absolute;background:none;border:0;color:#fff;font-size:2.5rem;line-height:1;cursor:pointer;padding:.5rem}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] [data-sw-part="close"]{top:.5rem;right:1rem}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] [data-sw-part="lb-prev"]{left:.5rem;top:50%;transform:translateY(-50%)}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] [data-sw-part="lb-next"]{right:.5rem;top:50%;transform:translateY(-50%)}',
].join('');

// Dependency-free. Builds the overlay via the DOM (no innerHTML beyond a one-time
// clear) and shows the full image from each item's own href + data-caption.
// Focus moves into the overlay on open and returns to the trigger on close;
// Escape / arrow keys are handled while open.
const LIGHTBOX_JS = `(function(){
  function enhance(root){
    var items=Array.prototype.slice.call(root.querySelectorAll('[data-sw-part="item"]'));
    var overlay=root.querySelector('[data-sw-part="overlay"]');
    if(!items.length||!overlay)return;
    var idx=0,lastFocus=null;
    function mkBtn(part,label,txt){var b=document.createElement('button');b.type='button';b.setAttribute('data-sw-part',part);b.setAttribute('aria-label',label);b.textContent=txt;return b;}
    overlay.innerHTML='';
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Image viewer');
    var btnClose=mkBtn('close','Close','\\u00d7'),btnPrev=mkBtn('lb-prev','Previous','\\u2039'),btnNext=mkBtn('lb-next','Next','\\u203a');
    var img=document.createElement('img'),cap=document.createElement('figcaption');
    overlay.appendChild(btnClose);overlay.appendChild(btnPrev);overlay.appendChild(img);overlay.appendChild(cap);overlay.appendChild(btnNext);
    if(items.length<2){btnPrev.style.display='none';btnNext.style.display='none';}
    function show(i){
      idx=(i+items.length)%items.length;var a=items[idx],thumb=a.querySelector('img');
      img.setAttribute('src',a.getAttribute('href'));img.setAttribute('alt',thumb?thumb.getAttribute('alt')||'':'');
      var c=a.getAttribute('data-caption')||'';cap.textContent=c;cap.style.display=c?'block':'none';
      overlay.setAttribute('data-open','true');overlay.removeAttribute('aria-hidden');btnClose.focus();
    }
    function close(){overlay.removeAttribute('data-open');overlay.setAttribute('aria-hidden','true');if(lastFocus){lastFocus.focus();}}
    items.forEach(function(a,i){a.addEventListener('click',function(e){e.preventDefault();lastFocus=a;show(i);});});
    btnClose.addEventListener('click',close);
    btnPrev.addEventListener('click',function(){show(idx-1);});
    btnNext.addEventListener('click',function(){show(idx+1);});
    overlay.addEventListener('click',function(e){if(e.target===overlay){close();}});
    document.addEventListener('keydown',function(e){if(overlay.getAttribute('data-open')!=='true')return;if(e.key==='Escape'){close();}else if(e.key==='ArrowLeft'){show(idx-1);}else if(e.key==='ArrowRight'){show(idx+1);}else if(e.key==='Tab'){var f=[btnClose,btnPrev,btnNext].filter(function(b){return b.style.display!=='none';}),first=f[0],last=f[f.length-1];if(e.shiftKey){if(document.activeElement===first){e.preventDefault();last.focus();}}else if(document.activeElement===last){e.preventDefault();first.focus();}}});
    root.setAttribute('data-sw-enhanced','true');
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="lightbox"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- Modal -------------------------------------------------------------------
// A trigger button that opens a native <dialog> (which provides focus trap,
// Escape, ::backdrop, and background inerting for free). JS only wires open/close.
const MODAL_CSS = [
  '[data-sw-block="Modal"]{display:inline-block}',
  '[data-sw-block="Modal"] dialog{position:relative;border:0;border-radius:.5rem;padding:1.5rem;max-width:min(90vw,32rem);box-shadow:0 10px 40px rgba(0,0,0,.2)}',
  '[data-sw-block="Modal"] dialog::backdrop{background:rgba(0,0,0,.5)}',
  '[data-sw-block="Modal"] [data-sw-part="close"]{position:absolute;top:.5rem;right:.75rem;border:0;background:none;font-size:1.5rem;line-height:1;cursor:pointer}',
].join('');

const MODAL_JS = `(function(){
  function enhance(root){
    var dialog=root.querySelector('[data-sw-part="dialog"]'),openBtn=root.querySelector('[data-sw-part="open"]');
    if(!dialog||!openBtn||typeof dialog.showModal!=='function')return;
    var closeBtn=root.querySelector('[data-sw-part="close"]');
    openBtn.addEventListener('click',function(){dialog.showModal();});
    if(closeBtn)closeBtn.addEventListener('click',function(){dialog.close();});
    dialog.addEventListener('click',function(e){if(e.target===dialog){dialog.close();}});
    root.setAttribute('data-sw-enhanced','true');
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="modal"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- CookieConsent -----------------------------------------------------------
// A dismissable banner, hidden until JS confirms consent isn't yet stored. PE-safe:
// rendered with the `hidden` attribute, so with no JS there is no banner (and no
// JS means nothing to consent to). localStorage access is guarded (sandboxed
// preview / disabled storage).
const COOKIE_CONSENT_CSS = [
  '[data-sw-block="CookieConsent"][hidden]{display:none}',
  '[data-sw-block="CookieConsent"]{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:9998;display:flex;flex-wrap:wrap;align-items:center;gap:1rem;padding:1rem 1.25rem;background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:.5rem;box-shadow:0 6px 24px rgba(0,0,0,.15)}',
  '[data-sw-block="CookieConsent"] p{margin:0;flex:1;min-width:12rem;font-size:.875rem}',
  '[data-sw-block="CookieConsent"] [data-sw-part="accept"]{border:0;border-radius:.375rem;padding:.5rem 1rem;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer}',
].join('');

const COOKIE_CONSENT_JS = `(function(){
  var KEY='sw-cookie-consent';
  function enhance(root){
    try{if(localStorage.getItem(KEY)==='1'){return;}}catch(e){}
    root.removeAttribute('hidden');
    var accept=root.querySelector('[data-sw-part="accept"]');
    if(accept)accept.addEventListener('click',function(){try{localStorage.setItem(KEY,'1');}catch(e){}root.setAttribute('hidden','');});
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="cookie-consent"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// Registry keyed by block `type`. Only blocks with behavior/styling belong here
// (child blocks like Slide/AccordionItem/LightboxItem are styled by their parent's
// entry — no entry of their own). Insertion order = bundle order.
const COMPONENTS = new Map<string, ComponentAsset>([
  ['Carousel', { css: CAROUSEL_CSS, js: CAROUSEL_JS }],
  ['Accordion', { css: ACCORDION_CSS, js: '' }],
  ['Lightbox', { css: LIGHTBOX_CSS, js: LIGHTBOX_JS }],
  ['Modal', { css: MODAL_CSS, js: MODAL_JS }],
  ['CookieConsent', { css: COOKIE_CONSENT_CSS, js: COOKIE_CONSENT_JS }],
]);

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

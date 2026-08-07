// Ripple / "waves" click effect: a first-party runtime for the industry-standard
// Waves.js / Material vocabulary (`class="waves-effect waves-light"`). Waves.js
// itself is MIT but unmaintained; this ships a tiny audited implementation of the
// same class protocol instead, under the same only-used-ships discipline as
// components.ts / animations.ts. The classes (`waves-effect`, `waves-light`,
// `waves-block`) are what every template and LLM already emits.
//
// Invariants:
// - The ripple span is built with createElement and positioned via inline numeric
//   styles only — NEVER innerHTML — so a tenant class string can't inject markup
//   (same rule as the Lightbox/Carousel component JS).
// - Motion sits behind `prefers-reduced-motion: no-preference`; reduced motion =
//   no ripple. No-JS → a plain (still clickable) element.
// - First-party, audited, static code only; tenants add only the marker classes.
// Platform-owned controls that get a ripple WITHOUT carrying the marker class. The lightbox viewer
// is re-rendered through morphdom, which strips any attribute (class included) absent from its own
// template — so a class we stamp on its arrows or thumbnail strip does not survive the next paint.
// Naming them in the selector instead is immune to that, and they are our own `sw-lightbox-*` names
// (set via the vendor's classNames map), not a third-party's.
export const RIPPLE_HOSTS = '.waves-effect,.sw-lightbox-arrow-left,.sw-lightbox-arrow-right,.sw-lightbox-nav a';

/**
 * The ripple stylesheet. `.waves-effect` clips its overflow so the expanding circle
 * stays inside; `.waves-ripple` is the injected span that scales + fades. The default tint
 * derives from the base-content token so it INVERTS with the palette (a dark tint on a light
 * surface, a light tint on a dark one); `waves-light` forces a white tint for surfaces that are
 * dark in BOTH schemes (e.g. a coloured button).
 */
export const RIPPLE_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  '.waves-effect{position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}',
  // The same containing box for the implicit hosts above — a ripple needs a positioned, clipping
  // parent or the circle escapes and paints over the viewer. The nav thumbnails already clip via
  // their <li>; the anchor itself needs the position.
  '.sw-lightbox-arrow-left,.sw-lightbox-arrow-right,.sw-lightbox-nav a{position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}',
  // The viewer is a near-black overlay in every palette, so its ripple is always the light tint.
  '.sw-lightbox-arrow-left .waves-ripple,.sw-lightbox-arrow-right .waves-ripple,.sw-lightbox-nav a .waves-ripple{background:rgba(255,255,255,.45)}',
  '.waves-ripple{position:absolute;border-radius:50%;pointer-events:none;background:color-mix(in oklab,var(--sw-color-base-content,#000) 20%,transparent);transform:scale(0);opacity:.5;will-change:transform,opacity}',
  '.waves-effect.waves-light .waves-ripple{background:rgba(255,255,255,.45)}',
  '.waves-rippling{animation:sw-waves .6s ease-out forwards}',
  '@keyframes sw-waves{to{transform:scale(1);opacity:0}}',
  '}',
].join('\n');

// The runtime. On pointerdown on (or inside) a `.waves-effect`, build one ripple span sized to
// cover the element from the click point, animate it, and remove it on animationend
// (or after a timeout fallback). Pure DOM construction — no innerHTML.
// DELEGATED (one document-level listener, no per-element bind): elements injected AFTER init —
// the modal's auto close button, any runtime-built control — ripple without a re-scan hook.
export const RIPPLE_JS = `(function(){
  'use strict';
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  function spawn(el,e){
    var rect=el.getBoundingClientRect();
    var x=(e.clientX!=null?e.clientX:rect.left+rect.width/2)-rect.left;
    var y=(e.clientY!=null?e.clientY:rect.top+rect.height/2)-rect.top;
    var size=Math.max(rect.width,rect.height)*2;
    var span=document.createElement('span');
    span.className='waves-ripple waves-rippling';
    span.style.width=span.style.height=size+'px';
    span.style.left=(x-size/2)+'px';
    span.style.top=(y-size/2)+'px';
    el.appendChild(span);
    var remove=function(){if(span.parentNode)span.parentNode.removeChild(span);};
    span.addEventListener('animationend',remove,{once:true});
    setTimeout(remove,800);
  }
  document.addEventListener('pointerdown',function(e){
    var t=e.target;
    var el=t&&t.closest?t.closest('${RIPPLE_HOSTS}'):null;
    if(el)spawn(el,e);
  },{passive:true});
})();`;

const RIPPLE_MARKER = 'waves-effect';

/** Whether an authored HTML/template string uses the ripple effect. */
export function usesRipple(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(RIPPLE_MARKER);
}


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
/**
 * The ripple stylesheet. `.waves-effect` clips its overflow so the expanding circle
 * stays inside; `.waves-ripple` is the injected span that scales + fades. `waves-light`
 * tints the ripple white (for dark/colored buttons); default is a subtle dark tint.
 */
export const RIPPLE_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  '.waves-effect{position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}',
  '.waves-ripple{position:absolute;border-radius:50%;pointer-events:none;background:rgba(0,0,0,.2);transform:scale(0);opacity:.5;will-change:transform,opacity}',
  '.waves-effect.waves-light .waves-ripple{background:rgba(255,255,255,.45)}',
  '.waves-rippling{animation:sw-waves .6s ease-out forwards}',
  '@keyframes sw-waves{to{transform:scale(1);opacity:0}}',
  '}',
].join('\n');

// The runtime. On pointerdown on a `.waves-effect`, build one ripple span sized to
// cover the element from the click point, animate it, and remove it on animationend
// (or after a timeout fallback). Pure DOM construction — no innerHTML.
export const RIPPLE_JS = `(function(){
  'use strict';
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  function spawn(e){
    var el=e.currentTarget;
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
  function bind(el){el.addEventListener('pointerdown',spawn);}
  Array.prototype.forEach.call(document.querySelectorAll('.waves-effect'),bind);
})();`;

const RIPPLE_MARKER = 'waves-effect';

/** Whether an authored HTML/template string uses the ripple effect. */
export function usesRipple(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(RIPPLE_MARKER);
}


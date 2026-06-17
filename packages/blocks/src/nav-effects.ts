// Nav-effects runtime — the small first-party script behind the three JS-backed nav schemes
// (`sw-nav-line-sliding-bottom`, `sw-nav-sliding-pill`, `sw-nav-spotlight-sliding`). Every other nav
// scheme is pure CSS; this ships only when one of these three is active (same only-used-ships
// discipline as the cart / preloader / ripple runtimes), gated by `navEffectUsesRuntime` in
// @sitewright/schema.
//
// What it does, mirroring the effect CSS selectors exactly (class on <body> → scoped to the
// #top-nav / #mobile-nav landmarks; or class on a per-element nav container):
//   • the two SLIDING schemes get a single `<span class="sw-nav-indicator">` appended to each nav
//     scope; the runtime publishes the active/hovered link's rect as the `--sw-ind-*` custom props on
//     the scope, and the CSS composes those into a bottom bar (line) or a full pill. The pill/line
//     animate via the CSS transition — the runtime only moves the numbers.
//   • the SPOTLIGHT scheme tracks the pointer over each scope and publishes `--sw-mx` / `--sw-my`.
//
// Invariants (same as the other runtimes):
//   • The indicator span is built with createElement + numeric inline styles — NEVER innerHTML — so
//     no tenant string can inject markup.
//   • Static, audited, first-party code; no tenant input reaches it. No-JS → the link still works,
//     it just has no sliding indicator / spotlight (graceful degradation).
//   • Positions read from getBoundingClientRect (robust to the <li> nesting daisyUI menus use).

import { JS_NAV_EFFECTS } from '@sitewright/schema';

/** The nav-effects runtime, linked per page (publish) or inlined in the preview. */
export const NAV_EFFECTS_JS = `(function(){
  'use strict';
  function scopes(cls){
    var out=[];
    function add(el){ if(out.indexOf(el)<0) out.push(el); }
    Array.prototype.forEach.call(document.querySelectorAll('.'+cls),function(el){
      if(el.matches('.menu,nav,[role="navigation"]')) add(el);
      Array.prototype.forEach.call(el.querySelectorAll('#top-nav,#mobile-nav'),add);
    });
    return out;
  }
  function activeLink(scope){ return scope.querySelector('a.active,a[aria-current="page"]'); }
  function setRect(scope,link){
    if(!link){ scope.style.setProperty('--sw-ind-width','0px'); return; }
    var s=scope.getBoundingClientRect(), r=link.getBoundingClientRect();
    scope.style.setProperty('--sw-ind-left',(r.left-s.left)+'px');
    scope.style.setProperty('--sw-ind-top',(r.top-s.top)+'px');
    scope.style.setProperty('--sw-ind-width',r.width+'px');
    scope.style.setProperty('--sw-ind-height',r.height+'px');
  }
  function initSlide(scope){
    if(scope.querySelector(':scope > .sw-nav-indicator')) return;
    if(getComputedStyle(scope).position==='static') scope.style.position='relative';
    var ind=document.createElement('span');
    ind.className='sw-nav-indicator';
    ind.setAttribute('aria-hidden','true');
    scope.appendChild(ind);
    var settle=function(){ setRect(scope,activeLink(scope)); };
    Array.prototype.forEach.call(scope.querySelectorAll('a'),function(a){
      a.addEventListener('mouseenter',function(){ setRect(scope,a); });
    });
    scope.addEventListener('mouseleave',settle);
    if(window.requestAnimationFrame) requestAnimationFrame(settle); else settle();
    window.addEventListener('resize',settle);
  }
  function initSpot(scope){
    scope.addEventListener('pointermove',function(e){
      var s=scope.getBoundingClientRect();
      scope.style.setProperty('--sw-mx',(e.clientX-s.left)+'px');
      scope.style.setProperty('--sw-my',(e.clientY-s.top)+'px');
    });
    scope.addEventListener('pointerleave',function(){
      scope.style.setProperty('--sw-mx','-9999px');
    });
  }
  function run(){
    scopes('sw-nav-line-sliding-bottom').forEach(initSlide);
    scopes('sw-nav-sliding-pill').forEach(initSlide);
    scopes('sw-nav-spotlight-sliding').forEach(initSpot);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run);
  else run();
})();`;

// Derived from the schema source-of-truth so the publish/preview scan can't drift from the runtime.
const NAV_EFFECT_RUNTIME_MARKERS = JS_NAV_EFFECTS.map((e) => `sw-nav-${e}`);

/**
 * Whether a rendered HTML/body-class string uses one of the JS-backed nav schemes (so the preview
 * inlines, and the publish links, the nav-effects runtime). Publish gates on the chosen effect via
 * {@link navEffectUsesRuntime}; the preview only sees the body class, so it scans for the marker.
 */
export function usesNavEffects(html: string | null | undefined): boolean {
  return typeof html === 'string' && NAV_EFFECT_RUNTIME_MARKERS.some((m) => html.includes(m));
}

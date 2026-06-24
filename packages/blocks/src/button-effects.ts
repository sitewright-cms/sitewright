// Button-effects runtime — the small, only-when-used JS for the per-button effect scheme. Three jobs:
//   1. RIPPLE on every `.btn` (the always-on baseline; the CSS span lives in base-css.ts).
//   2. MAGNETIC — `sw-btn-fx-magnetic` buttons drift toward the cursor.
//   3. SPOTLIGHT — `sw-btn-fx-spotlight` buttons publish `--sw-btn-mx`/`--sw-btn-my` pointer vars the CSS reads.
// The effect/shape/accent CSS itself is in @sitewright/tailwind (effects.ts); the baseline (ripple span,
// hover fill/lift) is in base-css.ts. Schema is the source-of-truth for the JS-backed effect names.
//
// Invariants (same as nav-effects.ts / ripple.ts):
// - Injected nodes are built with createElement + numeric inline styles ONLY — never innerHTML — so a
//   tenant class string can't inject markup.
// - Motion sits behind `prefers-reduced-motion: reduce` (no ripple / no magnetic drift); no-JS → the
//   button still works, just without ripple/pointer effects.
// - First-party, audited, static code only; tenants add only the marker classes.

import { JS_BUTTON_EFFECTS } from '@sitewright/schema';

/**
 * The runtime IIFE. Resolves the magnetic/spotlight targets with the same guard the CSS uses (the
 * class on `<body>` as a site default scopes descendant `.btn` that don't carry their own fx override;
 * or the class on the button itself), then binds ripple to every `.btn`.
 */
export const BUTTON_EFFECTS_JS = `(function(){
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function ripple(e){
    if(reduce) return;
    var el=e.currentTarget, r=el.getBoundingClientRect();
    var span=document.createElement('span');
    span.className='sw-btn-ripple';
    var size=Math.max(r.width,r.height)*2.2;
    span.style.width=span.style.height=size+'px';
    span.style.left=((e.clientX!=null?e.clientX:r.left+r.width/2)-r.left)+'px';
    span.style.top=((e.clientY!=null?e.clientY:r.top+r.height/2)-r.top)+'px';
    el.appendChild(span);
    var rm=function(){if(span.parentNode)span.parentNode.removeChild(span);};
    span.addEventListener('animationend',rm,{once:true});
    setTimeout(rm,800);
  }
  function magnetic(el){
    el.addEventListener('pointermove',function(e){
      var r=el.getBoundingClientRect();
      el.style.transform='translate('+((e.clientX-r.left-r.width/2)*0.4)+'px,'+((e.clientY-r.top-r.height/2)*0.4)+'px)';
    });
    el.addEventListener('pointerleave',function(){el.style.transform='';});
  }
  function spotlight(el){
    el.addEventListener('pointermove',function(e){
      var r=el.getBoundingClientRect();
      el.style.setProperty('--sw-btn-mx',(e.clientX-r.left)+'px');
      el.style.setProperty('--sw-btn-my',(e.clientY-r.top)+'px');
    });
  }
  // resolve the actual .btn targets for an fx effect, matching the CSS guard (body default OR per-button)
  function targets(name){
    return document.querySelectorAll(
      '.sw-btn-fx-'+name+' .btn:not([class*="sw-btn-fx-"]), .btn.sw-btn-fx-'+name
    );
  }
  function run(){
    Array.prototype.forEach.call(document.querySelectorAll('.btn'),function(b){ b.addEventListener('pointerdown',ripple); });
    if(!reduce) Array.prototype.forEach.call(targets('magnetic'),magnetic);
    Array.prototype.forEach.call(targets('spotlight'),spotlight);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();`;

// A button is rippled if a `.btn` is present; magnetic/spotlight add their own pointer behaviour. The
// runtime ships whenever the page has any `.btn` (ripple is the baseline) OR a JS-backed fx class. The
// regex matches `btn` as a whole class TOKEN (followed by a space or the closing quote) so a bare
// daisyUI modifier like `class="btn-primary"` without the `.btn` base doesn't over-ship the runtime.
const BTN_CLASS_RE = /class="[^"]*\bbtn[\s"]/;
const JS_FX_MARKERS = JS_BUTTON_EFFECTS.map((e) => `sw-btn-fx-${e}`);

/** Whether an authored HTML string needs the button-effects runtime (a `.btn` for ripple, or a JS fx). */
export function usesButtonEffects(html: string | null | undefined): boolean {
  if (typeof html !== 'string') return false;
  return BTN_CLASS_RE.test(html) || JS_FX_MARKERS.some((m) => html.includes(m));
}

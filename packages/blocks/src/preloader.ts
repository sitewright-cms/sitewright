// Platform-authored PRELOADER — a full-screen overlay shown on first paint and during internal
// navigation, then cleared once the page is ready. First-party, CSP-clean (the JS ships as an
// external preloader.js served from the site's own origin), and only-used-ships: the CSS/JS ship
// only when the site enables a preloader (website.theme.preloaderEffect ≠ 'none').
//
// Authoring is no-code: the editor's effect picker stores `theme.preloaderEffect`; the platform then
// injects `<div data-sw-preloader class="loading sw-preloader-<effect>">…</div>` as the FIRST body
// child (renderDocument) plus a `<noscript>` rule that hides it when scripting is off (so a no-JS
// visitor is never blocked behind a stuck overlay).
//
// Behaviour (preloader.js): show on load → clear on window.load (after a short minimum so it doesn't
// ugly-flash on fast loads) → lock page scroll while shown → re-show on clicks to internal links
// (any same-origin href, resolved against the current URL — bare-relative included) to bridge the
// navigation → restore on bfcache (pageshow) → an 8s failsafe so a hung resource can never block.
//
// The overlay is a half-transparent brand-background pane with a backdrop blur, so page content
// shows softly behind it. Every effect is themed entirely by the --sw-color-* brand tokens.

import type { PreloaderEffect } from '@sitewright/schema';
import { SW_READY_EVENT } from './timing.js';

/** A built-in abstract "spark" brand mark — the fallback logo + the draw-on target (inline SVG so it
 *  can be stroke-animated, which a raster/<img> logo cannot). Tinted with the brand primary. */
const SPARK_SVG =
  '<svg class="pl-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3C35 22 42 29 61 32C42 35 35 42 32 61C29 42 22 35 3 32C22 29 29 22 32 3Z"/></svg>';

function escAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The logo element for logo-* effects: the configured site logo as an <img>, else the built-in mark. */
function logoEl(logo: string | undefined): string {
  return logo
    ? `<img class="pl-logo-img" src="${escAttr(logo)}" alt="" aria-hidden="true">`
    : SPARK_SVG;
}

/** Inner markup per effect. Generic effects are fixed; logo-* effects use the site logo (logo-draw
 *  always uses the inline mark because stroke-drawing needs inline SVG paths). */
function innerMarkup(effect: PreloaderEffect, logo: string | undefined): string {
  switch (effect) {
    case 'spinner':
      return '<div class="pl-spinner"></div>';
    case 'dual':
      return '<div class="pl-dual"></div>';
    case 'dots':
      return '<div class="pl-dots"><span></span><span></span><span></span></div>';
    case 'bars':
      return '<div class="pl-bars"><span></span><span></span><span></span><span></span><span></span></div>';
    case 'pulse':
      return '<div class="pl-pulse"><span></span><span></span><span></span></div>';
    case 'progress':
      return '<div class="pl-progress"><span></span></div>';
    case 'logo-pulse':
      return `<div class="pl-stack pl-logo-pulse">${logoEl(logo)}</div>`;
    case 'logo-draw':
      return `<div class="pl-stack pl-logo-draw">${SPARK_SVG}</div>`;
    case 'logo-sheen':
      return `<div class="pl-stack"><span class="pl-logo-sheen">${logoEl(logo)}</span></div>`;
    default:
      return '<div class="pl-spinner"></div>';
  }
}

export interface PreloaderOptions {
  /** Resolved site logo URL for logo-* effects (falls back to the built-in mark when absent). */
  logo?: string;
  /** Preview mode (editor): render the markup WITHOUT the `loading` class so it stays hidden. */
  preview?: boolean;
}

/**
 * The preloader slot HTML — `<div data-sw-preloader class="loading sw-preloader-<effect>">…</div>` —
 * for the chosen effect, or '' when disabled ('none'/undefined). Emitted as the first body child.
 */
export function preloaderHtml(effect: PreloaderEffect | 'none' | undefined, opts: PreloaderOptions = {}): string {
  if (!effect || effect === 'none') return '';
  const loading = opts.preview ? '' : 'loading ';
  return (
    `<div data-sw-preloader class="${loading}sw-preloader-${effect}" role="status" aria-live="polite" aria-busy="true" aria-label="Loading">` +
    innerMarkup(effect, opts.logo) +
    '</div>'
  );
}

/** True when a rendered surface contains the preloader marker (only-used-ships gate). */
export function usesPreloader(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.indexOf('data-sw-preloader') !== -1;
}

// --- CSS --------------------------------------------------------------------
export const PRELOADER_CSS = [
  // Frosted overlay: half-transparent brand background + backdrop blur. Fade is purely a TRANSITION
  // (no keyframe animation), which is the whole point: a fresh page load ships the overlay ALREADY
  // `loading`, and CSS transitions don't animate the first painted state → it shows INSTANTLY. The
  // transition only fires when `loading` is toggled afterwards: removed → fade OUT (page ready);
  // re-added on the leaving page during an internal-link click → fade IN (the runtime delays the
  // navigation until that fade completes). visibility is delayed to the end of the fade-out so the
  // overlay stops catching pointer events.
  '[data-sw-preloader]{position:fixed;inset:0;z-index:99990;display:grid;place-items:center;background:color-mix(in srgb,var(--sw-color-base-100,#fff) 62%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .45s ease,visibility 0s linear .45s}',
  '[data-sw-preloader].loading{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .45s ease}',
  // All inner rules are scoped under the marker so the .pl-* class names can't collide with author CSS.
  // Sizes are deliberately large (~2×) for visibility on the full-screen overlay.
  '[data-sw-preloader] .pl-mark{width:148px;height:148px;display:block}',
  '[data-sw-preloader] .pl-mark path{fill:var(--sw-color-primary,#4f46e5)}',
  '[data-sw-preloader] .pl-logo-img{max-width:280px;max-height:192px;width:auto;height:auto;display:block}',
  '[data-sw-preloader] .pl-stack{display:grid;place-items:center;gap:32px;text-align:center}',
  // 1 · spinner
  '[data-sw-preloader] .pl-spinner{width:116px;height:116px;border-radius:50%;border:10px solid color-mix(in srgb,var(--sw-color-primary,#4f46e5) 18%,transparent);border-top-color:var(--sw-color-primary,#4f46e5);animation:sw-pl-spin .9s linear infinite}',
  '@keyframes sw-pl-spin{to{transform:rotate(360deg)}}',
  // 2 · dual orbit
  '[data-sw-preloader] .pl-dual{width:120px;height:120px;position:relative}',
  '[data-sw-preloader] .pl-dual::before,[data-sw-preloader] .pl-dual::after{content:"";position:absolute;inset:0;border-radius:50%;border:8px solid transparent;animation:sw-pl-spin 1.1s linear infinite}',
  '[data-sw-preloader] .pl-dual::before{border-top-color:var(--sw-color-primary,#4f46e5);border-bottom-color:var(--sw-color-primary,#4f46e5)}',
  '[data-sw-preloader] .pl-dual::after{inset:18px;border-left-color:var(--sw-color-accent,var(--sw-color-primary,#4f46e5));border-right-color:var(--sw-color-accent,var(--sw-color-primary,#4f46e5));animation-direction:reverse;animation-duration:.8s}',
  // 3 · bouncing dots
  '[data-sw-preloader] .pl-dots{display:flex;gap:22px}',
  '[data-sw-preloader] .pl-dots span{width:28px;height:28px;border-radius:50%;background:var(--sw-color-primary,#4f46e5);animation:sw-pl-bounce 1s ease-in-out infinite}',
  '[data-sw-preloader] .pl-dots span:nth-child(2){animation-delay:.16s}',
  '[data-sw-preloader] .pl-dots span:nth-child(3){animation-delay:.32s}',
  '@keyframes sw-pl-bounce{0%,80%,100%{transform:translateY(0);opacity:.45}40%{transform:translateY(-32px);opacity:1}}',
  // 4 · equalizer bars
  '[data-sw-preloader] .pl-bars{display:flex;align-items:center;gap:12px;height:92px}',
  '[data-sw-preloader] .pl-bars span{width:14px;height:100%;border-radius:8px;background:var(--sw-color-primary,#4f46e5);transform-origin:center;animation:sw-pl-eq 1s ease-in-out infinite}',
  '[data-sw-preloader] .pl-bars span:nth-child(2){animation-delay:.12s}',
  '[data-sw-preloader] .pl-bars span:nth-child(3){animation-delay:.24s}',
  '[data-sw-preloader] .pl-bars span:nth-child(4){animation-delay:.36s}',
  '[data-sw-preloader] .pl-bars span:nth-child(5){animation-delay:.48s}',
  '@keyframes sw-pl-eq{0%,100%{transform:scaleY(.32)}50%{transform:scaleY(1)}}',
  // 5 · radar pulse
  '[data-sw-preloader] .pl-pulse{position:relative;width:140px;height:140px}',
  '[data-sw-preloader] .pl-pulse span{position:absolute;inset:0;border-radius:50%;border:6px solid var(--sw-color-primary,#4f46e5);opacity:0;animation:sw-pl-ring 1.8s cubic-bezier(.2,.7,.3,1) infinite}',
  '[data-sw-preloader] .pl-pulse span:nth-child(2){animation-delay:.6s}',
  '[data-sw-preloader] .pl-pulse span:nth-child(3){animation-delay:1.2s}',
  '@keyframes sw-pl-ring{0%{transform:scale(.25);opacity:.9}100%{transform:scale(1);opacity:0}}',
  // 6 · top progress bar (anchored to the top of the overlay)
  '[data-sw-preloader] .pl-progress{position:absolute;top:0;left:0;right:0;height:8px;background:color-mix(in srgb,var(--sw-color-primary,#4f46e5) 16%,transparent);overflow:hidden}',
  '[data-sw-preloader] .pl-progress span{position:absolute;inset:0 100% 0 0;background:linear-gradient(90deg,var(--sw-color-primary,#4f46e5),var(--sw-color-accent,var(--sw-color-primary,#4f46e5)));border-radius:0 8px 8px 0;animation:sw-pl-prog 1.4s cubic-bezier(.65,.05,.35,1) infinite}',
  '@keyframes sw-pl-prog{0%{inset:0 100% 0 0}50%{inset:0 18% 0 0}100%{inset:0 0 0 100%}}',
  // 7 · logo breathe (img or mark)
  '[data-sw-preloader] .pl-logo-pulse .pl-mark,[data-sw-preloader] .pl-logo-pulse .pl-logo-img{animation:sw-pl-breathe 1.5s ease-in-out infinite}',
  '@keyframes sw-pl-breathe{0%,100%{transform:scale(.86);opacity:.55}50%{transform:scale(1);opacity:1}}',
  // 8 · logo draw-on (built-in mark, stroke → fill loop). stroke-width is in viewBox units so it
  // scales up automatically with the larger mark.
  '[data-sw-preloader] .pl-logo-draw .pl-mark path{fill:none;stroke:var(--sw-color-primary,#4f46e5);stroke-width:3;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:240;stroke-dashoffset:240;animation:sw-pl-draw 2s ease-in-out infinite}',
  '@keyframes sw-pl-draw{0%{stroke-dashoffset:240;fill:transparent}55%{stroke-dashoffset:0;fill:transparent}80%,100%{stroke-dashoffset:0;fill:var(--sw-color-primary,#4f46e5)}}',
  // 9 · logo shimmer (sweeping highlight; fine over an <img>)
  '[data-sw-preloader] .pl-logo-sheen{position:relative;display:inline-block;overflow:hidden;border-radius:24px}',
  '[data-sw-preloader] .pl-logo-sheen::after{content:"";position:absolute;top:0;left:-60%;width:55%;height:100%;background:linear-gradient(100deg,transparent,color-mix(in srgb,#fff 75%,transparent),transparent);animation:sw-pl-sheen 1.6s ease-in-out infinite}',
  '@keyframes sw-pl-sheen{0%{left:-60%}60%,100%{left:130%}}',
  // reduced motion: drop the fade transition (instant show/hide) + freeze any animation on the
  // overlay or its descendants.
  '@media (prefers-reduced-motion:reduce){[data-sw-preloader]{transition:none}[data-sw-preloader],[data-sw-preloader] *{animation-duration:.001s!important;animation-iteration-count:1!important}}',
].join('');

// --- runtime ----------------------------------------------------------------
export const PRELOADER_JS = `(function(){
  var pl=document.querySelector('[data-sw-preloader]');
  if(!pl)return;
  var docEl=document.documentElement, MIN=400, MAX=8000, start=Date.now(), navigated=false, failsafe;
  var reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  function lock(){docEl.style.overflow='hidden';}
  // Clearing the overlay is the "page is ready" moment → announce it so entrance/SVG animations start
  // NOW (they gate on this instead of firing behind the still-visible overlay). Idempotent listeners.
  function clear(){pl.classList.remove('loading');docEl.style.overflow='';try{document.dispatchEvent(new CustomEvent('${SW_READY_EVENT}'));}catch(e){}}
  if(pl.classList.contains('loading'))lock(); // shipped already-loading on a fresh load → instant cover
  function done(){setTimeout(clear,Math.max(0,MIN-(Date.now()-start)));}
  if(document.readyState==='complete'){done();}else{window.addEventListener('load',done);}
  failsafe=setTimeout(clear,MAX); // failsafe — a hung resource must never block the page
  window.addEventListener('pageshow',function(e){if(e.persisted){clear();}}); // bfcache restore
  // Internal-link navigation: FADE the overlay in over the current page, THEN navigate — so the
  // transition to the next page reads as a smooth fade, not an abrupt pop. (A fresh page load shows
  // the overlay instantly: it ships already-loading and CSS transitions don't animate the first
  // painted state.) Detect internal links by resolving the href against the current URL so absolute
  // ("/x"), relative ("./x"/"../x") AND bare same-dir links ("about" — what {{sw-url}} emits) all
  // count; external origins, mailto:/tel:, and same-page #hash links are excluded.
  document.addEventListener('click',function(e){
    var a=e.target.closest?e.target.closest('a'):null;
    if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var href=a.getAttribute('href');
    if(!href||a.hasAttribute('download'))return;
    if(a.target&&a.target!=='_self')return;
    if(/\\bexternal\\b/.test(a.getAttribute('rel')||''))return;
    var url;
    try{url=new URL(href,location.href);}catch(_){return;}
    if(url.origin!==location.origin)return; // external site, mailto:, tel:, etc.
    if(url.pathname===location.pathname&&url.search===location.search)return; // same page (#hash only)
    e.preventDefault(); // take over so the overlay can fade in BEFORE we leave
    lock();
    // Replace the boot failsafe (it could fire mid-navigation and clear the overlay) with one that
    // only fires if the navigation never happens (e.g. a beforeunload prompt is cancelled).
    clearTimeout(failsafe);failsafe=setTimeout(clear,MAX);
    // navigated is module-scoped → at most one location.assign even on a rapid double-click.
    var go=function(){if(navigated)return;navigated=true;window.location.assign(url.href);};
    // Already covering (clicked during the initial load) or reduced motion → no fade, just go.
    if(reduce||pl.classList.contains('loading')){pl.classList.add('loading');go();return;}
    pl.classList.add('loading'); // opacity 0→1 transition fires (the overlay was cleared/hidden)
    pl.addEventListener('transitionend',function te(ev){if(ev.target===pl&&ev.propertyName==='opacity'){pl.removeEventListener('transitionend',te);go();}});
    setTimeout(go,600); // fallback if transitionend doesn't fire
  });
})();`;

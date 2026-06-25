// BACK-TO-TOP — a platform-injected button that appears after the first viewport of scroll and
// scrolls the page back to the top. Only-used-ships (like the preloader / cart): the markup + CSS +
// JS ship ONLY when `website.effects.backToTop` is on. The button is a vendored `.btn` carrying the
// `sw-btn-shape-square` icon shape, so it inherits the site's button face / effect / accent defaults;
// it sits fixed bottom-right and SLIDES up (show) / down (hide) with a fade.

// chevron-up (Lucide). aria-hidden — the button itself carries the accessible label.
const CHEVRON_UP =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';

/** The back-to-top button markup (empty string when disabled). */
export function backToTopHtml(enabled: boolean | undefined): string {
  if (!enabled) return '';
  return `<button type="button" data-sw-back-to-top class="btn sw-btn-shape-square" aria-label="Back to top">${CHEVRON_UP}</button>`;
}

/** True when a rendered surface contains the back-to-top marker (only-used-ships gate). */
export function usesBackToTop(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.indexOf('data-sw-back-to-top') !== -1;
}

// --- CSS --------------------------------------------------------------------
export const BACK_TO_TOP_CSS = [
  // Fixed BOTTOM-CENTER, above page content. The `translate` prop carries BOTH the -50% horizontal
  // centring AND the vertical slide (an INDIVIDUAL prop, so it composes with the .btn's transform-based
  // hover scale instead of clobbering it). Hidden = faded + slid DOWN; the runtime adds `.sw-visible`
  // after the first viewport of scroll → it slides UP into view. `[data-…].btn` beats the base `.btn`
  // position. HIDDEN ON MOBILE (a small viewport scrolls fast + has little room for a floating button).
  '[data-sw-back-to-top].btn{position:fixed;left:50%;bottom:1.25rem;z-index:9996;opacity:0;translate:-50% 1.5rem;pointer-events:none}',
  '[data-sw-back-to-top].sw-visible{opacity:1;translate:-50% 0;pointer-events:auto}',
  '@media (max-width:639.98px){[data-sw-back-to-top].btn{display:none}}',
  '@media (prefers-reduced-motion:no-preference){[data-sw-back-to-top]{transition:opacity .3s ease,translate .3s cubic-bezier(.16,1,.3,1)}}',
  '[data-sw-back-to-top] svg{width:1.4rem;height:1.4rem}',
].join('');

// --- runtime ----------------------------------------------------------------
// Toggles `.sw-visible` once the page is scrolled past the first viewport; clicking scrolls to top
// (smooth, unless the visitor prefers reduced motion). rAF-throttled. No-JS → the button never appears.
export const BACK_TO_TOP_JS = `(function(){
  var b=document.querySelector('[data-sw-back-to-top]');
  if(!b)return;
  var shown=false, ticking=false;
  function update(){
    ticking=false;
    var y=window.pageYOffset||document.documentElement.scrollTop||0;
    var want=y>(window.innerHeight||600);
    if(want!==shown){shown=want;b.classList.toggle('sw-visible',shown);}
  }
  function onScroll(){if(!ticking){ticking=true;window.requestAnimationFrame(update);}}
  b.addEventListener('click',function(){
    var reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches);
    try{window.scrollTo({top:0,behavior:reduce?'auto':'smooth'});}catch(e){window.scrollTo(0,0);}
  });
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll,{passive:true});
  update();
})();`;

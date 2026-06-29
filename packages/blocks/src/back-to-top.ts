// BACK-TO-TOP — a platform-injected button that appears after the first viewport of scroll and
// scrolls the page back to the top. ON BY DEFAULT; ships (markup + CSS + JS) unless the site sets
// `website.effects.backToTop` to false. The button is a LARGE vendored `.btn.btn-primary` (solid CI
// face) carrying the `sw-btn-shape-square` icon shape; it sits fixed BOTTOM-CENTRE (hidden on mobile)
// and SLIDES up (show) / down (hide) — a pure transform slide, NO opacity fade.

// chevron-up (Lucide). aria-hidden — the button itself carries the accessible label.
const CHEVRON_UP =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';

/** The back-to-top button markup (empty string when disabled). */
export function backToTopHtml(enabled: boolean | undefined): string {
  if (!enabled) return '';
  return `<button type="button" data-sw-back-to-top class="btn btn-primary sw-btn-shape-square" aria-label="Back to top">${CHEVRON_UP}</button>`;
}

// --- CSS --------------------------------------------------------------------
export const BACK_TO_TOP_CSS = [
  // Fixed BOTTOM-CENTER, above page content. The `translate` prop carries BOTH the -50% horizontal
  // centring AND the vertical slide (an INDIVIDUAL prop, so it composes with the .btn's transform-based
  // hover scale instead of clobbering it). Hidden = faded + slid DOWN; the runtime adds `.sw-visible`
  // after the first viewport of scroll → it slides UP into view. `[data-…].btn` beats the base `.btn`
  // position. HIDDEN ON MOBILE (a small viewport scrolls fast + has little room for a floating button).
  // Wide, short FAB — explicit width 4.5rem × height 2.5rem (the square-shape's aspect-ratio:1 is
  // overridden when BOTH dims are set) + padding:0 so the chevron centres cleanly. SLIDE-ONLY: hidden =
  // slid FULLY below the viewport (NO opacity), .sw-visible = slid home. `visibility:hidden` (delayed to
  // the end of the slide-out) keeps the hidden button out of the TAB ORDER + a11y tree; on show the delay
  // is 0 so it becomes focusable at once. `[data-…].btn` beats the base `.btn` sizing.
  '[data-sw-back-to-top].btn{position:fixed;left:50%;bottom:1.5rem;z-index:9996;width:4.5rem;height:2.5rem;padding:0;visibility:hidden;translate:-50% calc(100% + 2rem);pointer-events:none}',
  '[data-sw-back-to-top].sw-visible{visibility:visible;translate:-50% 0;pointer-events:auto}',
  '@media (max-width:639.98px){[data-sw-back-to-top].btn{display:none}}',
  // The transition selectors carry `.btn` (0,2,0 / 0,3,0) so they OUTRANK the `.btn{transition:transform,
  // box-shadow}` baseline that the compiled utility sheet (loaded LAST, equal 0,1,0 specificity) would
  // otherwise win with by source order — that clobbered the `translate` transition and made the button POP
  // instead of slide. transform/box-shadow stay listed so the hover lift/shadow still ease.
  '@media (prefers-reduced-motion:no-preference){[data-sw-back-to-top].btn{transition:translate .35s cubic-bezier(.16,1,.3,1),transform .22s cubic-bezier(.16,1,.3,1),box-shadow .22s ease,visibility 0s linear .35s}[data-sw-back-to-top].btn.sw-visible{transition:translate .35s cubic-bezier(.16,1,.3,1),transform .22s cubic-bezier(.16,1,.3,1),box-shadow .22s ease,visibility 0s}}',
  '[data-sw-back-to-top] svg{width:1.4rem;height:1.4rem}',
].join('');

// --- runtime ----------------------------------------------------------------
// Toggles `.sw-visible` once the page is scrolled past the first viewport AND hides again at the very
// bottom (so the fixed FAB never sits on top of the footer / sub-footer text); clicking scrolls to top
// (smooth, unless the visitor prefers reduced motion). rAF-throttled. No-JS → the button never appears.
export const BACK_TO_TOP_JS = `(function(){
  var b=document.querySelector('[data-sw-back-to-top]');
  if(!b)return;
  var shown=false, ticking=false;
  function update(){
    ticking=false;
    var doc=document.documentElement;
    var y=window.pageYOffset||doc.scrollTop||0;
    var vh=window.innerHeight||600;
    // Hide within ~80px of the page bottom — that's the FAB's footprint (bottom:1.5rem + 2.5rem tall),
    // so it slides away before it would overlap the footer instead of covering it.
    var atBottom=(y+vh)>=((doc.scrollHeight||0)-80);
    var want=y>vh && !atBottom;
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

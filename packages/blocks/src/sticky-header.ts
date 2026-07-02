// STICKY (fixed) TOP-HEADER — fixes the platform `#main-nav` landmark to the top of the viewport
// when the site opts in (website.effects.stickyHeader). renderDocument emits stickyHeaderCss(mode)
// straight into the inline <style> (keyed on the mode → byte-identical output when off), so the
// `--sw-header-h` offset token is correct at FIRST PAINT — no JS-derived layout, no layout shift.
//
// The offset is OPT-IN via the `.sw-top-padding` utility: drop it on the first section to clear the
// fixed header, OR on an inner element so a full-bleed hero/slider background bleeds UNDER the header
// while its text clears it. When stickyHeader is 'none' the utility/token aren't emitted, so the
// class is inert and a static-header site is unchanged.
//
// 'hide-on-scroll' and 'shrink' also ship STICKY_HEADER_JS, which ONLY toggles state classes on
// <html> as the visitor scrolls (`sw-scrolled` for the shrink/shadow threshold, `sw-nav-hidden` for
// the hide-on-scroll direction) — it never touches the initial layout. 'pinned' is pure CSS.
//
// Custom headers of a non-default height override the token themselves (`:root{--sw-header-h:5rem}`
// in website.criticalCss, which is emitted after this base CSS so it wins).

import type { StickyHeaderMode } from '@sitewright/schema';

// The default `#main-nav` recipe (a DaisyUI `.navbar`) is taller than its 4rem min-height because the
// logo is a `.btn` (an h-8/h-7 mark + button padding): MEASURED in headless Chromium at 74.59px desktop
// (>=lg) and 70.59px mobile. The logo mark is a fixed h-8/h-7 across brands, so these are stable. We
// round UP to a clean rem with a ~1px safety margin so content ALWAYS clears the bar (never overlaps),
// keyed on the recipe's own `lg` (1024px) breakpoint. A custom header of a different height overrides
// `--sw-header-h` in website.criticalCss. First-paint-correct → no layout shift.
const HEADER_HEIGHT_MOBILE = '4.5rem'; // 72px ≥ measured 70.59px
const HEADER_HEIGHT_DESKTOP = '4.75rem'; // 76px ≥ measured 74.59px
const HEADER_LG_BREAKPOINT = '1024px'; // Tailwind `lg` — where the recipe swaps mobile→desktop bar

/**
 * The sticky-header CSS for a mode (empty string when off). Emitted by renderDocument into the inline
 * base `<style>`, so it's present at first paint. Covers ALL modes: the fixed `#main-nav` landmark,
 * the `--sw-header-h` offset token + the `.sw-top-padding` spacer + `scroll-padding-top` for anchors,
 * plus the per-mode scroll-state rules (driven by STICKY_HEADER_JS).
 */
export function stickyHeaderCss(mode: StickyHeaderMode | 'none' | null | undefined): string {
  if (!mode || mode === 'none') return '';
  const base = [
    // Offset token (first-paint-correct) + the opt-in spacer utility + the in-page-anchor scroll offset
    // so a jump-link lands BELOW the fixed header, not behind it. The token rides on :root so both the
    // spacer (inherits down) and html's scroll-padding (same element) read one source of truth. The
    // value is breakpoint-aware (the recipe's mobile bar is shorter than the desktop bar).
    `:root{--sw-header-h:${HEADER_HEIGHT_MOBILE};scroll-padding-top:var(--sw-header-h)}`,
    `@media (min-width:${HEADER_LG_BREAKPOINT}){:root{--sw-header-h:${HEADER_HEIGHT_DESKTOP}}}`,
    '.sw-top-padding{padding-top:var(--sw-header-h)}',
    // Pin the landmark to the top, full width. z-index 30 sits ABOVE page content but BELOW the mobile
    // drawer (its backdrop/panel are z-40/z-50, so an open drawer correctly covers the header) and the
    // consent banner / back-to-top floats (9996+). The landmark itself stays transparent — the recipe's
    // own `.navbar` paints the background, leaving a transparent-over-hero design possible.
    '#main-nav{position:fixed;top:0;left:0;right:0;z-index:30}',
  ];
  if (mode === 'hide-on-scroll') {
    // Slide the whole header out of view on scroll-down (runtime adds `sw-nav-hidden`), back on scroll-up.
    // A pure transform slide (gap-free, because the header is out of flow).
    base.push('html.sw-nav-hidden #main-nav{translate:0 -100%}');
    // a11y: if a keyboard user tabs INTO the (hidden) header, reveal it so focus isn't off-screen — the
    // higher-specificity :focus-within rule beats the hide rule above; it slides back out on blur.
    base.push('html.sw-nav-hidden #main-nav:focus-within{translate:0 0}');
    base.push(
      '@media (prefers-reduced-motion:no-preference){#main-nav{transition:translate .3s cubic-bezier(.16,1,.3,1)}}',
    );
  } else if (mode === 'shrink') {
    // Condense the bar past the scroll threshold (runtime adds `sw-scrolled`): tighter `.navbar` +
    // a soft drop shadow. The OFFSET token stays at full height so content never reflows as it shrinks.
    base.push('html.sw-scrolled #main-nav{box-shadow:0 2px 10px rgba(15,23,42,.08)}');
    base.push(
      'html.sw-scrolled #main-nav .navbar{min-height:3.25rem;padding-top:.125rem;padding-bottom:.125rem}',
    );
    base.push(
      '@media (prefers-reduced-motion:no-preference){#main-nav,#main-nav .navbar{transition:min-height .3s ease,padding .3s ease,box-shadow .3s ease}}',
    );
  }
  return base.join('');
}

// --- runtime ----------------------------------------------------------------
// Toggles scroll-state classes on <html> for the JS-backed modes. Reads the body class to decide
// behavior: `sw-header-hide-on-scroll` tracks scroll direction (slide away / reveal); `sw-scrolled`
// (the "is the page scrolled" flag, used by shrink + any author CSS) is set for both. rAF-throttled,
// passive listener. No-JS → the header stays put (still fixed + visible, just no shrink/hide).
export const STICKY_HEADER_JS = `(function(){
  var root=document.documentElement;
  var nav=document.getElementById('main-nav');
  var hide=/\\bsw-header-hide-on-scroll\\b/.test(document.body.className||'');
  // The hide-reveal threshold = the REAL header height (measured, not assumed) so it matches the
  // breakpoint-aware offset token AND a custom header. Measuring here only sizes the scroll threshold,
  // never the layout, so it can't cause a shift. Re-measured on resize (breakpoint / wrap changes).
  var headerH=72;
  function measure(){headerH=nav?nav.getBoundingClientRect().height:72;}
  var lastY=window.pageYOffset||root.scrollTop||0;
  var scrolled=false, hidden=false, ticking=false;
  function update(){
    ticking=false;
    var y=window.pageYOffset||root.scrollTop||0;
    var s=y>4;
    if(s!==scrolled){scrolled=s;root.classList.toggle('sw-scrolled',s);}
    if(hide){
      if(y>headerH && y>lastY+2 && !hidden){hidden=true;root.classList.add('sw-nav-hidden');}
      else if((y<lastY-2 || y<=headerH) && hidden){hidden=false;root.classList.remove('sw-nav-hidden');}
    }
    lastY=y;
  }
  function onScroll(){if(!ticking){ticking=true;window.requestAnimationFrame(update);}}
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',function(){measure();onScroll();},{passive:true});
  measure();
  update();
})();`;

// STICKY (fixed) TOP-HEADER — fixes the platform `#main-nav` landmark to the top of the viewport
// when the site opts in (website.effects.stickyHeader). renderDocument emits stickyHeaderCss(mode)
// straight into the inline <style>, so the `--sw-header-h` offset token is correct at FIRST PAINT —
// no JS-derived layout, no layout shift.
//
// The modes are POSITIONAL ONLY ('pinned' | 'hide-on-scroll'). The platform deliberately ships no
// "how the bar LOOKS once scrolled" mode: such an effect is only safe to ship generically if it is
// STRUCTURE-INDEPENDENT. Sliding the whole landmark is; condensing it is not — that needs to know
// which row collapses. So the retired 'shrink' mode (which targeted the stock DaisyUI `.navbar` and
// silently did nothing for a hand-authored header) is gone, and ANY visual scroll response is now
// authored against `html.sw-scrolled`. See LEGACY_STICKY_HEADER_MODES in @sitewright/schema.
//
// WHAT SHIPS WHERE:
//   • `--sw-header-h` (the published bar height) — EVERY site, fixed or static. Inert on its own.
//   • STICKY_HEADER_JS — EVERY site. It only toggles state classes on <html> (`sw-scrolled` always;
//     `sw-nav-hidden` for the hide-on-scroll direction) and never touches the initial layout, so
//     `sw-scrolled` is a universal authoring hook rather than a private detail of one mode.
//   • `.sw-top-padding`, `scroll-padding-top`, `position:fixed` — FIXED MODES ONLY. Emitting the
//     spacer for a header that scrolls away would give every page carrying the class a phantom gap.
//
// The offset is AUTHOR-DIRECTED via `.sw-top-padding`: drop it on the first section to clear the fixed
// header, OR on an inner element so a full-bleed hero/slider background bleeds UNDER the header while
// its text clears it. When a page uses NEITHER, `#page-content` clears the bar on its own — the offset
// used to be purely opt-in, which meant any page that never opted in rendered its first 76-242px behind
// the header, and the importer turns `pinned` on automatically. Opting in anywhere disables the
// fallback, so an author who has made a choice always keeps it.
//
// Custom headers of a non-default height override the token themselves (`:root{--sw-header-h:5rem}`
// in website.criticalCss, which is emitted after this base CSS so it wins). The token is a hardcoded
// constant sized for the stock recipe — it is NOT measured; only the runtime's hide threshold and
// anchor-rest sync measure the real bar.

import { normalizeStickyHeader, type StickyHeaderSetting } from '@sitewright/schema';

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
export function stickyHeaderCss(
  rawMode: StickyHeaderSetting | null | undefined,
): string {
  // A stored RETIRED value keeps its positioning and loses only its recipe-specific styling
  // (`shrink` → `pinned`), so an existing site stays fixed instead of silently un-sticking.
  const mode = normalizeStickyHeader(rawMode);
  const fixed = !!mode && mode !== 'none';
  // The offset TOKEN ships for EVERY site, fixed header or not. `--sw-header-h` is the one published
  // answer to "how tall is the bar", and author CSS keyed on `html.sw-scrolled` — now a UNIVERSAL hook,
  // since the runtime ships unconditionally — routinely needs it. On a static header the token is inert:
  // nothing consumes it, because the spacer + anchor offset below are emitted only when the bar is
  // actually fixed and therefore actually overlaying content. Emitting the spacer unconditionally would
  // give any page carrying `.sw-top-padding` a phantom offset under a header that scrolls away.
  const token = [
    `:root{--sw-header-h:${HEADER_HEIGHT_MOBILE}}`,
    `@media (min-width:${HEADER_LG_BREAKPOINT}){:root{--sw-header-h:${HEADER_HEIGHT_DESKTOP}}}`,
  ];
  if (!fixed) return token.join('');
  const base = [
    ...token,
    // The opt-in spacer utility + the in-page-anchor scroll offset, so a jump-link lands BELOW the fixed
    // header rather than behind it. Both read the one `:root` token above (the spacer inherits down;
    // html's scroll-padding sits on the same element), and both are FIXED-ONLY — see the note above.
    ':root{scroll-padding-top:var(--sw-header-h)}',
    '.sw-top-padding{padding-top:var(--sw-header-h)}',
    // SAFETY NET. The spacer above is opt-in, which meant a fixed header that nothing opted OUT from
    // simply covered the top of the page — and the importer sets `pinned` automatically whenever it
    // detects a fixed source header, so an imported site shipped every page broken by default. Measured
    // on a real import: a 242px pinned bar sitting on 242px of content, on all 16 pages.
    // So when NOTHING inside the content wrapper opted in, the platform clears the bar itself. The
    // moment an author places `.sw-top-padding` anywhere inside — on the first section, or on an inner
    // element so a full-bleed hero bleeds UNDER the bar — this rule drops out and their choice stands,
    // which keeps every existing site pixel-identical and preserves the full-bleed pattern.
    // `:has()` is unsupported only in browsers that also predate it; there the rule is skipped and the
    // behaviour is exactly today's, so this can never be worse than before.
    '#page-content:not(:has(.sw-top-padding)){padding-top:var(--sw-header-h)}',
    // Pin the landmark to the top, full width. z-index 30 sits ABOVE page content but BELOW the mobile
    // drawer (its backdrop/panel are z-40/z-50, so an open drawer correctly covers the header) and the
    // consent banner / back-to-top floats (9996+). The landmark itself stays transparent — the recipe's
    // own `.navbar` paints the background, leaving a transparent-over-hero design possible.
    '#main-nav{position:fixed;top:0;left:0;right:0;z-index:30}',
    // Measurement guard for the runtime's anchor-rest sync: it force-toggles `sw-scrolled` to measure
    // the bar at its SCROLLED height, and this suppresses transitions during that forced toggle so the
    // measurement can never flash a reverse animation. Emitted for every fixed mode (not just the old
    // `shrink`), because the collapse it measures is now AUTHOR CSS that could be on any header.
    'html.sw-measure #main-nav,html.sw-measure #main-nav *{transition:none!important}',
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
  }
  // NOTE: there is deliberately no built-in "condense on scroll" rule. It used to live here as the
  // `shrink` mode and targeted `#main-nav .navbar` — i.e. it only ever worked for the stock DaisyUI
  // recipe, and silently did nothing for a hand-authored header while still appearing to be enabled.
  // A scroll effect can only ship generically if it is STRUCTURE-INDEPENDENT (sliding the whole
  // landmark, above, is); condensing needs to know which row collapses, so it belongs to the author,
  // keyed on the universal `html.sw-scrolled` class. See LEGACY_STICKY_HEADER_MODES in the schema.
  return base.join('');
}

// --- runtime ----------------------------------------------------------------
// Ships on EVERY site. Toggles `html.sw-scrolled` (the universal "is the page scrolled" hook that any
// header — stock or hand-authored — keys its scroll response off) and, when the body carries
// `sw-header-hide-on-scroll`, also tracks direction for the slide-away. rAF-throttled, passive
// listener. No-JS → the header stays put (still fixed + visible, just no scroll response).
export const STICKY_HEADER_JS = `(function(){
  var root=document.documentElement;
  var nav=document.getElementById('main-nav');
  var hide=/\\bsw-header-hide-on-scroll\\b/.test(document.body.className||'');
  // Is the bar FIXED (ANY positional mode)? Match the body class the platform emits per mode, rather
  // than the computed position: computed style depends on the stylesheet having been parsed, so it is
  // empty in jsdom and racy before CSS lands, whereas the class is on the markup from first byte. The
  // open character class also keeps this true for any mode added later; 'none' emits no class at all.
  // The anchor sync below is only meaningful when the bar actually overlays content.
  var fixed=/\\bsw-header-[a-z-]+\\b/.test(document.body.className||'');
  // The hide-reveal threshold = the REAL header height (measured, not assumed) so it matches the
  // breakpoint-aware offset token AND a custom header. Measuring here only sizes the scroll threshold,
  // never the layout, so it can't cause a shift. Re-measured on resize (breakpoint / wrap changes).
  var headerH=72;
  function measure(){headerH=nav?nav.getBoundingClientRect().height:72;thresholds();}
  // ANCHOR-REST sync — now GENERIC (it used to run only for the built-in shrink mode). An anchor jump
  // computes its target from scroll-padding-top at CLICK time, but by the time the smooth scroll rests a
  // collapsing bar is SHORTER — the static token (sized for the full bar) then leaves a strip of the
  // PREVIOUS section visible under it. Pin scroll-padding-top to the bar's SCROLLED height, measured via
  // a forced sw-scrolled toggle under the sw-measure transition guard, all within one synchronous task —
  // nothing paints. Nothing about that was shrink-specific: forcing the class measures whatever the
  // AUTHOR's own html.sw-scrolled CSS does, so a hand-authored collapse lands anchors correctly too.
  // (Without this, retiring the shrink mode would have handed every hand-authored collapse a broken
  // anchor.) A bar that does NOT change height measures the same value twice and the pin is a no-op.
  // Pinned on BOTH the root (the published site's scroller) AND the body (the editor preview's scroll
  // container — html{overflow:hidden} there, so root scroll-padding is inert); each inline style beats
  // its stylesheet token. The layout spacer (sw-top-padding) keeps the full-height token → no reflow.
  // NOTE: no backticks anywhere in this literal — one would terminate it.
  function syncAnchorRest(){
    if(!fixed||!nav)return;
    var h;
    if(root.classList.contains('sw-scrolled')){h=nav.getBoundingClientRect().height;}
    else{
      root.classList.add('sw-measure');
      root.classList.add('sw-scrolled');
      h=nav.getBoundingClientRect().height;
      root.classList.remove('sw-scrolled');
      void nav.offsetHeight;
      root.classList.remove('sw-measure');
    }
    if(h){root.style.scrollPaddingTop=h+'px';document.body.style.scrollPaddingTop=h+'px';}
  }
  var lastY=window.pageYOffset||root.scrollTop||document.body.scrollTop||0;
  var scrolled=false, hidden=false, ticking=false;
  // HYSTERESIS. A single threshold cannot work here, because the state FEEDS BACK INTO THE SCROLL
  // POSITION that decides it: html.sw-scrolled collapses the bar, a shorter bar shortens the document,
  // and the browser clamps scrollTop down to match — back under the threshold, which un-collapses it,
  // which lengthens the document again. Measured on a real site with the old y>4 test: 14 flips from
  // one gesture, cycling ON y=7 navH=89 docH=2788 / off y=4 navH=86 docH=2785 indefinitely.
  // So: enter the scrolled state only once the reader has genuinely moved past the bar, and leave it
  // at a much lower mark. The gap is far wider than any collapse-induced clamp, so the loop cannot
  // bridge it. Recomputed with headerH on resize.
  var onAt=122, offAt=36;
  function thresholds(){onAt=headerH+50;offAt=Math.max(4,Math.round(headerH*0.5));}
  function update(){
    ticking=false;
    var y=window.pageYOffset||root.scrollTop||document.body.scrollTop||0;
    var s=scrolled?(y>offAt):(y>onAt);
    if(s!==scrolled){scrolled=s;root.classList.toggle('sw-scrolled',s);}
    if(hide){
      if(y>headerH && y>lastY+2 && !hidden){hidden=true;root.classList.add('sw-nav-hidden');}
      else if((y<lastY-2 || y<=headerH) && hidden){hidden=false;root.classList.remove('sw-nav-hidden');}
    }
    lastY=y;
  }
  function onScroll(){if(!ticking){ticking=true;window.requestAnimationFrame(update);}}
  // capture:true so a BODY scroll (the editor preview's scroll container) still reaches this even on a
  // surface without the preview scroll bridge — same hardening as the back-to-top/scrollspy runtimes;
  // the rAF ticking guard coalesces a bridge-redispatched + captured pair into one update.
  window.addEventListener('scroll',onScroll,{passive:true,capture:true});
  // Resize work (measure + the forced-toggle anchor-rest sync = up to 3 synchronous layouts) is
  // rAF-throttled like scroll — a continuous drag-resize fires resize per frame or faster.
  var rzTicking=false;
  function onResize(){
    if(rzTicking)return;
    rzTicking=true;
    window.requestAnimationFrame(function(){rzTicking=false;measure();syncAnchorRest();update();});
  }
  window.addEventListener('resize',onResize,{passive:true});
  measure();
  syncAnchorRest();
  update();
})();`;

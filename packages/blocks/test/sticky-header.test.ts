import { describe, expect, it } from 'vitest';
import { stickyHeaderCss, STICKY_HEADER_JS } from '../src/sticky-header.js';

describe('stickyHeaderCss', () => {
  it('a static header gets the offset TOKEN but none of the fixed-header rules', () => {
    // The token is the published "how tall is the bar" number and author CSS on the universal
    // `html.sw-scrolled` hook needs it, so it ships for every site…
    for (const mode of ['none', undefined, null] as const) {
      const css = stickyHeaderCss(mode);
      expect(css).toContain(':root{--sw-header-h:4.5rem}');
      expect(css).toContain('@media (min-width:1024px){:root{--sw-header-h:4.75rem}}');
      // …but on its own it is INERT. Emitting the spacer or the anchor offset for a header that
      // scrolls away would give any page carrying `.sw-top-padding` a phantom gap at the top.
      expect(css).not.toContain('.sw-top-padding');
      expect(css).not.toContain('scroll-padding-top');
      expect(css).not.toContain('position:fixed');
    }
  });

  it('every mode emits the offset token, the opt-in spacer, the anchor offset and the fixed landmark', () => {
    for (const mode of ['pinned', 'hide-on-scroll', 'shrink'] as const) {
      const css = stickyHeaderCss(mode);
      // breakpoint-aware offset token (mobile bar shorter than desktop), measured from the stock recipe.
      // The token rule and the anchor offset are SEPARATE rules now: the token ships for every site,
      // the anchor offset only when the bar is actually fixed.
      expect(css).toContain(':root{--sw-header-h:4.5rem}');
      expect(css).toContain('@media (min-width:1024px){:root{--sw-header-h:4.75rem}}');
      expect(css).toContain(':root{scroll-padding-top:var(--sw-header-h)}');
      expect(css).toContain('.sw-top-padding{padding-top:var(--sw-header-h)}');
      expect(css).toContain('#main-nav{position:fixed;top:0;left:0;right:0;z-index:30}');
    }
  });

  it('a fixed header clears the content wrapper itself when the page never opted in', () => {
    // The regression this closes: the offset was purely opt-in via `.sw-top-padding`, and the importer
    // turns `pinned` on automatically whenever it detects a fixed source header — so an imported site
    // shipped EVERY page with its first 76-242px hidden behind the bar. Measured on a real import:
    // a 242px pinned header over 242px of content, zero `.sw-top-padding` elements, on all 16 pages.
    for (const mode of ['pinned', 'hide-on-scroll'] as const) {
      expect(stickyHeaderCss(mode)).toContain(
        '#page-content:not(:has(.sw-top-padding)){padding-top:var(--sw-header-h)}',
      );
    }
  });

  it('the fallback defers the moment an author opts in — so it can never double up', () => {
    // `:not(:has(.sw-top-padding))` is the whole safety property: an author who put the spacer on the
    // first section, OR on an inner element so a full-bleed hero bleeds UNDER the bar, keeps exactly
    // the layout they authored. Guard the selector shape, since dropping the :not() would silently
    // add a second header's worth of padding to every existing site that had opted in.
    const css = stickyHeaderCss('pinned');
    expect(css).toContain('#page-content:not(:has(.sw-top-padding))');
    expect(css).not.toMatch(/#page-content\{padding-top/);
  });

  it('a static header gets NO content-wrapper padding (it overlays nothing)', () => {
    for (const mode of ['none', undefined, null] as const) {
      expect(stickyHeaderCss(mode)).not.toContain('#page-content');
    }
  });

  it('pinned is pure positioning — the platform styles no scroll response of its own', () => {
    const css = stickyHeaderCss('pinned');
    expect(css).not.toContain('sw-nav-hidden');
    // No rule of the platform's own keys off the scrolled state — that is the AUTHOR's layer now.
    expect(css).not.toContain('html.sw-scrolled #main-nav{');
    expect(css).not.toContain('.navbar');
    // The only `transition` present is the measurement guard, which suppresses transitions during the
    // runtime's forced sw-scrolled toggle. It ships for every fixed mode because the collapse it
    // measures is author CSS that could be on any header.
    expect(css).toContain('html.sw-measure #main-nav,html.sw-measure #main-nav *{transition:none!important}');
  });

  it('hide-on-scroll slides via a transform, reveals on focus-within (a11y), motion reduced-motion gated', () => {
    const css = stickyHeaderCss('hide-on-scroll');
    expect(css).toContain('html.sw-nav-hidden #main-nav{translate:0 -100%}');
    // tabbing into the hidden header reveals it (higher specificity than the hide rule)
    expect(css).toContain('html.sw-nav-hidden #main-nav:focus-within{translate:0 0}');
    expect(css).toContain('@media (prefers-reduced-motion:no-preference)');
    expect(css).not.toContain('sw-scrolled #main-nav .navbar'); // not the shrink rule
  });

  it('the retired shrink mode is normalized to pinned — no built-in condense survives anywhere', () => {
    const css = stickyHeaderCss('shrink');
    // It keeps its POSITIONING, so an existing site does not silently un-stick…
    expect(css).toContain('#main-nav{position:fixed;top:0;left:0;right:0;z-index:30}');
    expect(css).toBe(stickyHeaderCss('pinned'));
    // …and loses only the recipe-specific styling. The condense targeted `#main-nav .navbar`, i.e. it
    // only ever worked for the stock DaisyUI recipe and silently did nothing for a hand-authored
    // header while still appearing to be enabled. No mode may ship it now.
    for (const mode of ['pinned', 'hide-on-scroll', 'shrink', 'none'] as const) {
      expect(stickyHeaderCss(mode)).not.toContain('.navbar');
      expect(stickyHeaderCss(mode)).not.toContain('min-height:3.25rem');
    }
    // The measurement guard is NOT shrink-specific any more: the anchor sync measures whatever the
    // author's own html.sw-scrolled CSS does, so every fixed mode ships it.
    expect(stickyHeaderCss('pinned')).toContain('sw-measure');
    expect(stickyHeaderCss('hide-on-scroll')).toContain('sw-measure');
    // …but a static header has no anchor offset to sync, so it stays out.
    expect(stickyHeaderCss('none')).not.toContain('sw-measure');
  });
});

describe('STICKY_HEADER_JS', () => {
  it('is a self-invoking, passive scroll-state runtime that toggles the state classes', () => {
    expect(STICKY_HEADER_JS.startsWith('(function(){')).toBe(true);
    expect(STICKY_HEADER_JS.trimEnd().endsWith('})();')).toBe(true);
    // toggles the scroll flag + reads the hide mode off the body class + uses a passive listener + rAF
    expect(STICKY_HEADER_JS).toContain("sw-scrolled");
    expect(STICKY_HEADER_JS).toContain('sw-header-hide-on-scroll');
    expect(STICKY_HEADER_JS).toContain('sw-nav-hidden');
    expect(STICKY_HEADER_JS).toContain('{passive:true}');
    expect(STICKY_HEADER_JS).toContain('requestAnimationFrame');
    // body-scroller hardening (same as back-to-top/scrollspy): capture-phase scroll listener +
    // body.scrollTop position fallback, so the runtime works even without the preview scroll bridge
    expect(STICKY_HEADER_JS).toContain('{passive:true,capture:true}');
    expect(STICKY_HEADER_JS).toContain('document.body.scrollTop');
    // GENERIC anchor-rest sync: pins scroll-padding-top to the measured SCROLLED bar (via the
    // sw-measure transition guard) so anchors rest flush — no strip of the previous section shows
    // under a collapsed bar. Re-synced on resize. It gates on ANY positional mode's body class, so a
    // hand-authored collapse gets correct anchors too; matching the class (not the computed position)
    // keeps it working before stylesheets land and under jsdom.
    expect(STICKY_HEADER_JS).toContain('sw-header-[a-z-]+');
    expect(STICKY_HEADER_JS).not.toContain('sw-header-shrink');
    expect(STICKY_HEADER_JS).toContain('sw-measure');
    expect(STICKY_HEADER_JS).toContain("style.scrollPaddingTop=h+'px'");
    expect(STICKY_HEADER_JS).toContain('measure();syncAnchorRest();update()'); // rAF-throttled resize path
    // the hide-reveal threshold MEASURES the real header (no hardcoded height → matches any breakpoint/custom header)
    expect(STICKY_HEADER_JS).toContain("getElementById('main-nav')");
    expect(STICKY_HEADER_JS).toContain('getBoundingClientRect');
    // no raw backtick (would break the template literal when embedded) and no </script> breakout
    expect(STICKY_HEADER_JS).not.toContain('`');
    expect(STICKY_HEADER_JS).not.toContain('</script');
  });
});

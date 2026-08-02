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
        '#page-content{padding-top:var(--sw-header-offset,var(--sw-header-legacy-offset,var(--sw-header-h)))}',
      );
    }
  });

  it('the offset AMOUNT is a token an author can set per page, without moving anchors', () => {
    const css = stickyHeaderCss('pinned');
    // One class used to mean two things — "pad here" AND "hands off, I did it myself" — so reserving
    // the space any other way did not register and the platform padded on top (a clone measured 503px
    // where the original had 251, under two different class names), and "pad PLUS my own margin" could
    // not be said at all. The amount is now a value: 0 to take over, a length to change it, or
    // calc(var(--sw-header-h) + …) to keep the bar clearance and add your own air.
    expect(css).toContain('padding-top:var(--sw-header-offset,');
    // `--sw-header-h` keeps ONE meaning (how tall the bar is) — anchors and ScrollSpy read it, so
    // changing the offset must not move where a jump-link lands.
    expect(css).toContain(':root{scroll-padding-top:var(--sw-header-h)}');
    expect(css).toContain('.sw-top-padding{padding-top:var(--sw-header-h)}');
  });

  it('the OLD sentinel still zeroes the offset, so existing sites are pixel-identical', () => {
    // Sites using the documented full-bleed pattern opted out by placing `.sw-top-padding` on an inner
    // element. That keeps working — it supplies a fallback value now — and an explicit token beats it,
    // because it sits earlier in the var() chain. No migration.
    const css = stickyHeaderCss('pinned');
    expect(css).toContain('#page-content:has(.sw-top-padding){--sw-header-legacy-offset:0px}');
    expect(css).toContain('var(--sw-header-offset,var(--sw-header-legacy-offset,var(--sw-header-h)))');
  });

  it('the safety net switches OFF for a bar that does not rest at the top', () => {
    // It assumes "fixed" means "covers the top", which every built-in mode does — but a hand-authored bar
    // that parks at the BOTTOM of the viewport at scroll 0 and slides up on scroll got a phantom 79px
    // band of dead space above its hero. Measured on a real clone: #page-content padding-top 79px, hero
    // top 79, --sw-header-h 79px, on a design whose bar was nowhere near the top.
    for (const mode of ['pinned', 'hide-on-scroll'] as const) {
      const css = stickyHeaderCss(mode);
      expect(css).toContain('html:not(.sw-header-offtop) #page-content{padding-top:var(--sw-header-offset');
    }
    // The runtime measures the AT-REST top edge — judging while scrolled would misread a bar that
    // legitimately sits at 0 only after sliding up.
    const js = STICKY_HEADER_JS;
    expect(js).toContain('sw-header-offtop');
    expect(js).toContain("root.classList.contains('sw-scrolled')");
  });

  it('the fallback defers the moment an author opts in — so it can never double up', () => {
    // The safety property is unchanged; only where it is written moved. An author who put the spacer
    // on the first section, OR on an inner element so a full-bleed hero bleeds UNDER the bar, must
    // still get exactly the layout they authored — losing that would silently add a second header's
    // worth of padding to every existing site that had opted in. It now rides the var() chain: the
    // sentinel sets the legacy fallback to 0, and the chain resolves to it whenever the author has
    // not named an offset of their own. Measured in Chromium across all six cases (default, sentinel,
    // token 0, token 120px, calc, and token-beats-sentinel) before this was committed.
    const css = stickyHeaderCss('pinned');
    expect(css).toContain('#page-content:has(.sw-top-padding){--sw-header-legacy-offset:0px}');
    expect(css).toContain('var(--sw-header-legacy-offset,var(--sw-header-h))');
    // The sentinel must sit BEHIND an explicit token in the chain, or the old class would override
    // the new, more specific instruction.
    expect(css.indexOf('--sw-header-offset,')).toBeLessThan(css.lastIndexOf('--sw-header-legacy-offset,'));
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

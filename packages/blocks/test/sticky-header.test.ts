import { describe, expect, it } from 'vitest';
import { stickyHeaderCss, STICKY_HEADER_JS } from '../src/sticky-header.js';

describe('stickyHeaderCss', () => {
  it('returns "" for a static header (none/undefined) so a default site is byte-identical', () => {
    expect(stickyHeaderCss('none')).toBe('');
    expect(stickyHeaderCss(undefined)).toBe('');
    expect(stickyHeaderCss(null)).toBe('');
  });

  it('every mode emits the offset token, the opt-in spacer, the anchor offset and the fixed landmark', () => {
    for (const mode of ['pinned', 'hide-on-scroll', 'shrink'] as const) {
      const css = stickyHeaderCss(mode);
      // breakpoint-aware offset token (mobile bar shorter than desktop), measured from the stock recipe
      expect(css).toContain(':root{--sw-header-h:4.5rem;scroll-padding-top:var(--sw-header-h)}');
      expect(css).toContain('@media (min-width:1024px){:root{--sw-header-h:4.75rem}}');
      expect(css).toContain('.sw-top-padding{padding-top:var(--sw-header-h)}');
      expect(css).toContain('#main-nav{position:fixed;top:0;left:0;right:0;z-index:30}');
    }
  });

  it('pinned is pure positioning — no scroll-state rules, no transition', () => {
    const css = stickyHeaderCss('pinned');
    expect(css).not.toContain('sw-nav-hidden');
    expect(css).not.toContain('sw-scrolled');
    expect(css).not.toContain('transition');
  });

  it('hide-on-scroll slides via a transform, reveals on focus-within (a11y), motion reduced-motion gated', () => {
    const css = stickyHeaderCss('hide-on-scroll');
    expect(css).toContain('html.sw-nav-hidden #main-nav{translate:0 -100%}');
    // tabbing into the hidden header reveals it (higher specificity than the hide rule)
    expect(css).toContain('html.sw-nav-hidden #main-nav:focus-within{translate:0 0}');
    expect(css).toContain('@media (prefers-reduced-motion:no-preference)');
    expect(css).not.toContain('sw-scrolled #main-nav .navbar'); // not the shrink rule
  });

  it('shrink condenses the bar past the scroll threshold + a soft shadow, reduced-motion gated', () => {
    const css = stickyHeaderCss('shrink');
    expect(css).toContain('html.sw-scrolled #main-nav{box-shadow');
    expect(css).toContain('html.sw-scrolled #main-nav .navbar{min-height:3.25rem');
    expect(css).toContain('@media (prefers-reduced-motion:no-preference)');
    expect(css).not.toContain('sw-nav-hidden');
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
    // the hide-reveal threshold MEASURES the real header (no hardcoded height → matches any breakpoint/custom header)
    expect(STICKY_HEADER_JS).toContain("getElementById('main-nav')");
    expect(STICKY_HEADER_JS).toContain('getBoundingClientRect');
    // no raw backtick (would break the template literal when embedded) and no </script> breakout
    expect(STICKY_HEADER_JS).not.toContain('`');
    expect(STICKY_HEADER_JS).not.toContain('</script');
  });
});

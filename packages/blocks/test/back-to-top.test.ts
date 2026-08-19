import { describe, expect, it } from 'vitest';
import { backToTopHtml, BACK_TO_TOP_CSS, BACK_TO_TOP_JS } from '../src/back-to-top.js';

describe('back-to-top', () => {
  it('renders the button only when enabled', () => {
    expect(backToTopHtml(undefined)).toBe('');
    expect(backToTopHtml(false)).toBe('');
    const html = backToTopHtml(true);
    expect(html).toContain('data-sw-back-to-top');
    expect(html).toContain('class="btn btn-primary sw-btn-shape-square"');
    expect(html).toContain('aria-label="Back to top"');
  });

  it('is a wide-but-short FAB (4.5rem × 2.5rem) with a proportional chevron', () => {
    expect(BACK_TO_TOP_CSS).toContain('width:4.5rem;height:2.5rem');
    expect(BACK_TO_TOP_CSS).toContain('[data-sw-back-to-top] svg{width:1.4rem;height:1.4rem}');
    // fixed BOTTOM-RIGHT corner (not centred), above content but below the consent/preloader floats;
    // hidden on mobile
    expect(BACK_TO_TOP_CSS).toContain('position:fixed;right:1.5rem;bottom:1.5rem');
    expect(BACK_TO_TOP_CSS).not.toContain('left:50%');
    expect(BACK_TO_TOP_CSS).toContain('z-index:9996');
    expect(BACK_TO_TOP_CSS).toContain('@media (max-width:639.98px)');
  });

  it('lifts a bottom-right/bottom banner above the FAB slot (the Banner DEFAULT is the same corner, z-index 9997)', () => {
    expect(BACK_TO_TOP_CSS).toContain(
      'body:has([data-sw-back-to-top]) [data-sw-component="banner"]:is(:not([data-position]),[data-position="bottom-right"],[data-position="bottom"]){bottom:5rem}',
    );
  });

  it('the slide transition is scoped to `.btn` so it outranks the utility-sheet `.btn` transition (no pop)', () => {
    // The transition rules carry `.btn` (0,2,0 / 0,3,0) so they beat the later `.btn{transition:transform…}`
    // baseline that would otherwise clobber `translate` and make the button POP instead of slide.
    expect(BACK_TO_TOP_CSS).toContain('[data-sw-back-to-top].btn{transition:translate .35s');
    expect(BACK_TO_TOP_CSS).toContain('[data-sw-back-to-top].btn.sw-visible{transition:translate .35s');
    // !important — the styles.css baseline `.btn:not([class*=sw-btn-fx-])` (0,2,0, loaded last) ties the
    // specificity, so the transition must be !important to own the `translate` easing (else it pops).
    expect(BACK_TO_TOP_CSS).toContain('visibility 0s linear .35s!important');
    expect(BACK_TO_TOP_CSS).toContain('visibility 0s!important');
  });

  it('runtime: passive scroll-to-top, shows after a screen, STAYS SHOWN at the bottom — no breakout', () => {
    expect(BACK_TO_TOP_JS.startsWith('(function(){')).toBe(true);
    expect(BACK_TO_TOP_JS).toContain('scrollTo');
    expect(BACK_TO_TOP_JS).toContain('{passive:true');
    // Visibility is a function of scroll DEPTH alone. The button used to slide away within 80px of
    // the end to stay off the footer, which took it out from under the pointer exactly where a
    // visitor who has finished reading reaches for it.
    expect(BACK_TO_TOP_JS).toContain('var want=y>vh;');
    expect(BACK_TO_TOP_JS).not.toContain('atBottom');
    expect(BACK_TO_TOP_JS).not.toContain('`');
    expect(BACK_TO_TOP_JS).not.toContain('${');
    expect(BACK_TO_TOP_JS).not.toContain('</script');
  });

  it('runtime works on the editor preview BODY scroller, not just the viewport', () => {
    // The preview scrolls on <body> (html{overflow:hidden}), where documentElement.scrollTop stays 0.
    // The runtime must read body.scrollTop as a position fallback and listen with capture:true (a body
    // scroll never reaches a bubbling window listener).
    expect(BACK_TO_TOP_JS).toContain('document.body.scrollTop');
    expect(BACK_TO_TOP_JS).toContain('{passive:true,capture:true}');
  });
});

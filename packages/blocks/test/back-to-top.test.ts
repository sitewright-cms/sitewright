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
    // fixed bottom-centre, above content but below the consent/preloader floats; hidden on mobile
    expect(BACK_TO_TOP_CSS).toContain('position:fixed');
    expect(BACK_TO_TOP_CSS).toContain('z-index:9996');
    expect(BACK_TO_TOP_CSS).toContain('@media (max-width:639.98px)');
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

  it('runtime: passive scroll-to-top, shows after a screen, HIDES at the page bottom — no breakout', () => {
    expect(BACK_TO_TOP_JS.startsWith('(function(){')).toBe(true);
    expect(BACK_TO_TOP_JS).toContain('scrollTo');
    expect(BACK_TO_TOP_JS).toContain('{passive:true}');
    // hides near the very bottom so it never covers the footer
    expect(BACK_TO_TOP_JS).toContain('scrollHeight');
    expect(BACK_TO_TOP_JS).toContain('atBottom');
    expect(BACK_TO_TOP_JS).not.toContain('`');
    expect(BACK_TO_TOP_JS).not.toContain('</script');
  });
});

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

  it('is a compact 2.5rem square FAB with a proportional chevron', () => {
    expect(BACK_TO_TOP_CSS).toContain('width:2.5rem;height:2.5rem');
    expect(BACK_TO_TOP_CSS).toContain('[data-sw-back-to-top] svg{width:1.2rem;height:1.2rem}');
    // fixed bottom-centre, above content but below the consent/preloader floats; hidden on mobile
    expect(BACK_TO_TOP_CSS).toContain('position:fixed');
    expect(BACK_TO_TOP_CSS).toContain('z-index:9996');
    expect(BACK_TO_TOP_CSS).toContain('@media (max-width:639.98px)');
  });

  it('runtime is a passive, self-invoking scroll-to-top — no </script> or backtick breakout', () => {
    expect(BACK_TO_TOP_JS.startsWith('(function(){')).toBe(true);
    expect(BACK_TO_TOP_JS).toContain('scrollTo');
    expect(BACK_TO_TOP_JS).toContain('{passive:true}');
    expect(BACK_TO_TOP_JS).not.toContain('`');
    expect(BACK_TO_TOP_JS).not.toContain('</script');
  });
});

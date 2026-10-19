import { describe, it, expect } from 'vitest';
import { IN_PAGE_FRAGMENT_FN } from '../src/in-page-link.js';
import { NAV_LINK_JS } from '../src/nav-runtime.js';
import { STICKY_HEADER_JS } from '../src/sticky-header.js';

/** Compile the shared rule against a stubbed `location.pathname`. */
function at(pathname: string): (href: string) => string {
  // The rule ships as JS SOURCE, so run it the way a page would: as code, with its own `location`.
  return new Function('location', `${IN_PAGE_FRAGMENT_FN}; return inPageFragment;`)({ pathname }) as (href: string) => string;
}

describe('IN_PAGE_FRAGMENT_FN — the one "stays on this page" rule', () => {
  it('returns the fragment of a bare #anchor, and of a path-prefixed anchor to THIS page', () => {
    const home = at('/');
    expect(home('#about')).toBe('#about');
    expect(home('/#about')).toBe('#about');
    expect(home('./#about')).toBe('#about');
    const about = at('/about/');
    expect(about('/about/#team')).toBe('#team');
    expect(about('/about#team')).toBe('#team'); // trailing slash is not a different page
    expect(at('/en/')('/en/#about')).toBe('#about');
  });

  it('resolves under a path-served base (/sites/<slug>/…) by suffix', () => {
    expect(at('/sites/acme/about/')('/about/#team')).toBe('#team');
  });

  it('returns "" for a link that leaves the page, or has no fragment at all', () => {
    expect(at('/')('/blog/#latest')).toBe('');
    expect(at('/about/')('/pricing/#plans')).toBe('');
    expect(at('/')('/blog/')).toBe('');
    expect(at('/')('https://example.com/')).toBe('');
  });

  it('hands a bare "#" back as-is — each caller decides it means nothing', () => {
    expect(at('/')('#')).toBe('#');
  });

  it('is the SAME copy in both runtimes that act on in-page links, so they can never disagree', () => {
    expect(NAV_LINK_JS).toContain(IN_PAGE_FRAGMENT_FN);
    expect(STICKY_HEADER_JS).toContain(IN_PAGE_FRAGMENT_FN);
  });

  it('is embeddable as an inline <script> — no raw backtick, interpolation, or </script> breakout', () => {
    expect(IN_PAGE_FRAGMENT_FN).not.toContain('`');
    expect(IN_PAGE_FRAGMENT_FN).not.toContain('${');
    expect(IN_PAGE_FRAGMENT_FN).not.toContain('</script');
  });
});

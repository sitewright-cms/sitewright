import { describe, expect, it } from 'vitest';
import { SCROLLSPY_JS, usesScrollSpy } from '../src/scrollspy.js';

describe('usesScrollSpy', () => {
  it('detects both opt-in surfaces (the attribute and the site-wide body class) via one marker', () => {
    expect(usesScrollSpy('<ul class="menu" data-sw-scrollspy><li><a href="#a">A</a></li></ul>')).toBe(true);
    expect(usesScrollSpy('<body class="sw-nav-box-solid sw-scrollspy">')).toBe(true);
    expect(usesScrollSpy('<ul class="menu"><li><a href="#a">A</a></li></ul>')).toBe(false);
    expect(usesScrollSpy('')).toBe(false);
    expect(usesScrollSpy(undefined)).toBe(false);
    expect(usesScrollSpy(null)).toBe(false);
  });
});

describe('SCROLLSPY_JS', () => {
  it('is a self-invoking, passive, rAF-throttled scroll runtime', () => {
    expect(SCROLLSPY_JS.startsWith('(function(){')).toBe(true);
    expect(SCROLLSPY_JS.trimEnd().endsWith('})();')).toBe(true);
    expect(SCROLLSPY_JS).toContain('{passive:true}');
    expect(SCROLLSPY_JS).toContain('requestAnimationFrame');
  });

  it('reads both scope sources — the attribute and the site-wide body class scoped to #main-nav menus', () => {
    expect(SCROLLSPY_JS).toContain('[data-sw-scrollspy]');
    expect(SCROLLSPY_JS).toContain('sw-scrollspy');
    expect(SCROLLSPY_JS).toContain("getElementById('main-nav')");
    expect(SCROLLSPY_JS).toContain("qsa('.menu',navEl)");
  });

  it('toggles the platform active convention — .active + aria-current="true"', () => {
    expect(SCROLLSPY_JS).toContain("classList.add('active')");
    expect(SCROLLSPY_JS).toContain("classList.remove('active')");
    expect(SCROLLSPY_JS).toContain("setAttribute('aria-current','true')");
    expect(SCROLLSPY_JS).toContain("removeAttribute('aria-current')");
  });

  it('resolves anchors by existing section element (path-prefixed safe) via the link hash', () => {
    // hash is read off the resolved <a> so /#about and /en/#about both yield #about; section must exist
    expect(SCROLLSPY_JS).toContain('a.hash');
    expect(SCROLLSPY_JS).toContain('getElementById(id)');
    // a hashless self-link is the top sentinel
    expect(SCROLLSPY_JS).toContain('samePage');
  });

  it('measures the real fixed header for the offset and resolves the rem token as a fallback', () => {
    expect(SCROLLSPY_JS).toContain('--sw-header-h');
    expect(SCROLLSPY_JS).toContain('getBoundingClientRect');
    expect(SCROLLSPY_JS).toContain('/rem$/'); // rem→px resolution (parseFloat alone cannot)
  });

  it('handles the bottom-of-page edge case (a short final section still activates)', () => {
    expect(SCROLLSPY_JS).toContain('scrollHeight');
    expect(SCROLLSPY_JS).toContain('innerHeight');
  });

  it('is embeddable as an inline <script> — no raw backtick, interpolation, or </script> breakout', () => {
    expect(SCROLLSPY_JS).not.toContain('`');
    expect(SCROLLSPY_JS).not.toContain('${');
    expect(SCROLLSPY_JS).not.toContain('</script');
  });
});

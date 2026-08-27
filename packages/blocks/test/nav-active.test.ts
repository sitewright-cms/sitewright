import { describe, expect, it } from 'vitest';
import { NAV_ACTIVE_JS, usesNavMenu } from '../src/nav-active.js';

describe('usesNavMenu (the only-used-ships gate)', () => {
  it('matches a platform nav menu in authored source and rendered HTML alike', () => {
    expect(usesNavMenu('<ul class="menu menu-horizontal"><li><a href="/">Home</a></li></ul>')).toBe(true);
    expect(usesNavMenu('<ul class="dropdown-content menu z-30 p-2">')).toBe(true);
    expect(usesNavMenu("<ul class='menu'>")).toBe(true);
    expect(usesNavMenu('<ul CLASS = "menu">')).toBe(true);
  });

  it('does not match a page with no menu at all', () => {
    expect(usesNavMenu('<p>Hello</p><a href="/about">About</a>')).toBe(false);
    expect(usesNavMenu('<div class="menubar">')).toBe(false); // no `menu` token
    expect(usesNavMenu('the word menu in prose is not a class')).toBe(false);
    expect(usesNavMenu(undefined)).toBe(false);
    expect(usesNavMenu(null)).toBe(false);
  });
});

describe('NAV_ACTIVE_JS', () => {
  it('is a self-contained IIFE that is safe to inline in a <script>', () => {
    expect(NAV_ACTIVE_JS.trim().startsWith('(function')).toBe(true);
    expect(NAV_ACTIVE_JS).not.toContain('`');
    expect(NAV_ACTIVE_JS).not.toContain('${');
    expect(NAV_ACTIVE_JS).not.toContain('</script');
  });

  it('never takes over the navigation (no preventDefault) and listens in the capture phase', () => {
    // The whole point is to be invisible to the navigation: the browser follows the link exactly as
    // it would with JS off. Capture so a bubble-phase preventDefault (the preloader bridge) can't
    // hide the click from us regardless of which script tag came first.
    expect(NAV_ACTIVE_JS).not.toContain('e.preventDefault');
    expect(NAV_ACTIVE_JS).toContain("document.addEventListener('click',function(e){");
    expect(NAV_ACTIVE_JS.trimEnd().endsWith('})();')).toBe(true);
    expect(NAV_ACTIVE_JS).toContain('},true);');
    // Everything is addressed through the CARRIES-THE-HIGHLIGHT selector, never "every nav link".
    expect(NAV_ACTIVE_JS).toContain("document.querySelectorAll('.menu a.active')");
  });

  it('moves the .active class and never writes aria-current', () => {
    expect(NAV_ACTIVE_JS).toContain("classList.add('active')");
    expect(NAV_ACTIVE_JS).toContain("classList.remove('active')");
    // aria-current says where the visitor IS. Mid-click they are still on the old page, so the
    // runtime must not touch it — asserting the absence is what keeps that from creeping back in.
    expect(NAV_ACTIVE_JS).not.toContain('aria-current');
  });

  it('carries the preloader bridge’s same-site / not-an-anchor predicate', () => {
    expect(NAV_ACTIVE_JS).toContain('url.origin!==location.origin'); // external site, mailto:, tel:
    expect(NAV_ACTIVE_JS).toContain('url.pathname===location.pathname&&url.search===location.search'); // in-page #anchor
    expect(NAV_ACTIVE_JS).toContain("a.hasAttribute('download')");
    expect(NAV_ACTIVE_JS).toContain('e.metaKey||e.ctrlKey||e.shiftKey||e.altKey');
  });

  it('restores the server-rendered highlight on a bfcache Back', () => {
    expect(NAV_ACTIVE_JS).toContain("window.addEventListener('pageshow',function(e){");
    expect(NAV_ACTIVE_JS).toContain('if(!e.persisted||!lit)return;');
  });
});

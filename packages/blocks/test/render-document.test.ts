import { describe, expect, it } from 'vitest';
import type { Brand, Page } from '@sitewright/schema';
import { renderDocument } from '../src/render.js';

// Minimal code-first page (the block tree was retired in #250; `root` stays a
// required stub on the Page type, `bodyHtml` carries the rendered body).
const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } } as Page;
const brand = { name: 'Acme', colors: { primary: '#0a7' } } as Brand;

describe('renderDocument — document shell', () => {
  it('returns a full, brand-themed HTML document wrapping bodyHtml in <main>', () => {
    const doc = renderDocument(page, { brand, bodyHtml: '<h1>Hi</h1>' });
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('--sw-color-primary: #0a7;');
    expect(doc).toContain('<main id="page-content"><h1>Hi</h1></main>');
    expect(doc).toContain('</html>');
  });

  it('injects the preloader as the FIRST body child + a noscript hide, when provided', () => {
    const doc = renderDocument(page, { brand, bodyHtml: '<h1>Hi</h1>', preloader: '<div data-sw-preloader class="loading sw-preloader-spinner"></div>' });
    const bodyOpen = doc.indexOf('<body');
    const pl = doc.indexOf('data-sw-preloader');
    const main = doc.indexOf('<main id="page-content">');
    expect(pl).toBeGreaterThan(bodyOpen);
    expect(pl).toBeLessThan(main); // before <main> (and before nav slots) → first body child
    expect(doc).toContain('<noscript><style>[data-sw-preloader]{display:none!important}</style></noscript>');
  });

  it('omits the preloader (and its noscript) when none is provided', () => {
    const doc = renderDocument(page, { brand, bodyHtml: '<h1>Hi</h1>' });
    expect(doc).not.toContain('data-sw-preloader');
    expect(doc).not.toContain('noscript');
  });

  it('rawFidelity omits the platform base + typography CSS but keeps the page body/head', () => {
    const opts = { brand, bodyHtml: '<style>.a{color:red}</style><h1 class="a">Hi</h1>', head: '<link rel="stylesheet" href="/x.css" />' };
    const normal = renderDocument(page, opts);
    const raw = renderDocument(page, { ...opts, rawFidelity: true });
    // Normal render ships the platform base CSS (normalize layer + brand vars); raw fidelity does not.
    expect(normal).toContain('@layer sw-normalize {');
    expect(normal).toContain('--sw-color-primary');
    expect(raw).not.toContain('@layer sw-normalize {');
    expect(raw).not.toContain('--sw-color-primary');
    // The imported page's own styling + head survive in raw mode.
    expect(raw).toContain('<style>.a{color:red}</style>');
    expect(raw).toContain('<link rel="stylesheet" href="/x.css" />');
    expect(raw).toContain('<main id="page-content">');
  });

  it('prepends the base layer (modern-normalize + platform defaults) ahead of the skeleton', () => {
    const doc = renderDocument(page, { brand });
    const head = doc.slice(0, doc.indexOf('</head>'));
    expect(head).toContain('@layer sw-normalize {');
    expect(head).toContain(':is(nav, [role="navigation"]) a, .menu a, .btn { text-decoration: inherit; }');
    expect(head).toContain('*::-webkit-scrollbar-button { width: 0; height: 0; display: none; }');
    // base layer comes BEFORE the brand vars + skeleton body rule (so they override it)
    expect(head.indexOf('@layer sw-normalize')).toBeLessThan(head.indexOf('--sw-color-primary'));
    expect(head.indexOf('@layer sw-normalize')).toBeLessThan(head.indexOf('body{margin:0;min-height:100vh'));
  });

  it('lays the page out as a sticky-footer flex column (no page background under the footer)', () => {
    const doc = renderDocument(page, { brand });
    const head = doc.slice(0, doc.indexOf('</head>'));
    // full-height flex column body + a growing main → footer pinned to the bottom
    expect(head).toContain('min-height:100dvh;display:flex;flex-direction:column');
    expect(head).toContain('#page-content{flex:1 0 auto}');
    // footer landmark is a flex column so its content fills it (no gap strip below)
    expect(head).toContain('#footer{display:flex;flex-direction:column}');
    expect(doc).toContain('<main id="page-content">');
  });

  it('scrollbar is a solid primary thumb on a solid (page-bg) track — no transparency', () => {
    const doc = renderDocument(page, { brand });
    const head = doc.slice(0, doc.indexOf('</head>'));
    expect(head).toContain('*::-webkit-scrollbar-thumb { background-color: var(--sw-color-primary, #4f46e5); border-radius: 9999px; }');
    expect(head).toContain('*::-webkit-scrollbar { width: 8px; height: 8px; background: var(--sw-color-base-100, #ffffff); }');
  });

  describe('opt-in themes', () => {
    it('emits NOTHING when disabled / unset (existing single-theme sites unchanged)', () => {
      const off = renderDocument(page, { brand });
      expect(off).not.toContain('prefers-color-scheme: dark');
      expect(off).not.toContain('data-sw-theme');
      const explicitOff = renderDocument(page, { brand, theme: { enabled: false, default: 'dark' } });
      expect(explicitOff).not.toContain('prefers-color-scheme: dark');
      expect(explicitOff).not.toContain('data-sw-theme');
    });

    it('enabled + auto: inlines the dark CSS and leaves <html> WITHOUT data-sw-theme (OS governs)', () => {
      const doc = renderDocument(page, { brand, theme: { enabled: true, default: 'auto' } });
      expect(doc).toContain(':root[data-sw-theme="dark"]{');
      expect(doc).toContain('@media (prefers-color-scheme: dark)');
      // auto pins nothing on the <html> TAG (the only data-sw-theme is inside the CSS selectors).
      const htmlTag = doc.slice(doc.indexOf('<html'), doc.indexOf('>', doc.indexOf('<html')) + 1);
      expect(htmlTag).not.toContain('data-sw-theme');
    });

    it('enabled + pinned dark/light: server-sets <html data-sw-theme> so there is no flash', () => {
      const dark = renderDocument(page, { brand, theme: { enabled: true, default: 'dark' } });
      expect(dark).toContain('data-sw-theme="dark"');
      const light = renderDocument(page, { brand, theme: { enabled: true, default: 'light' } });
      expect(light).toContain('data-sw-theme="light"');
    });
  });

  describe('sync head scripts (the toggle no-flash init)', () => {
    it('headScripts → a SYNC (no-defer) <script src> in <head>, before <title>', () => {
      const doc = renderDocument(page, { brand, headScripts: ['theme.js'] });
      const head = doc.slice(doc.indexOf('<head>'), doc.indexOf('</head>'));
      expect(head).toContain('<script src="theme.js"></script>');
      expect(head).not.toContain('<script defer src="theme.js"');
      // pre-paint: it sits before the <title> (and well before </body>'s deferred component scripts)
      expect(head.indexOf('<script src="theme.js"')).toBeLessThan(head.indexOf('<title>'));
    });

    it('headInlineScripts → an inline <script> in <head> with </script> neutralized', () => {
      const doc = renderDocument(page, { brand, headInlineScripts: ['var x=1;//</script>'] });
      const head = doc.slice(doc.indexOf('<head>'), doc.indexOf('</head>'));
      expect(head).toContain('<script>var x=1;//<\\/script></script>');
    });

    it('omits both when not provided (single-theme sites unchanged)', () => {
      const doc = renderDocument(page, { brand });
      const head = doc.slice(doc.indexOf('<head>'), doc.indexOf('</head>'));
      expect(head).not.toContain('theme.js');
    });
  });
});

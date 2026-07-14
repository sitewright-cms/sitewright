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

  it('emits the derived --sw-color-*-content tokens for a NON-themed site (keeps .btn-accent labels legible)', () => {
    // A dark accent (#006241) → white text-on-brand. Without this token emitted unconditionally, Tailwind
    // purges --color-accent-content and .btn-accent falls through to a hardcoded dark fallback (dark-on-dark).
    const themed = { name: 'Acme', colors: { primary: '#3F71B7', secondary: '#E85C04', accent: '#006241' } } as Brand;
    const doc = renderDocument(page, { brand: themed, bodyHtml: '<a class="btn btn-accent">x</a>' });
    expect(doc).toContain('--sw-color-accent-content:#ffffff'); // derived white, purge-proof (inline :root)
  });

  it('injects the preloader as the FIRST body child + a noscript hide, when provided', () => {
    const doc = renderDocument(page, { brand, bodyHtml: '<h1>Hi</h1>', preloader: '<div data-sw-preloader class="sw-loading sw-preloader-spinner"></div>' });
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

  it('rawFidelity skips the platform utility stylesheet (its Tailwind utilities would collide with imported classes)', () => {
    const opts = { brand, bodyHtml: '<div class="w-100">x</div>', stylesheets: ['/styles.css'] };
    expect(renderDocument(page, opts)).toContain('<link rel="stylesheet" href="/styles.css" />'); // normal: linked
    expect(renderDocument(page, { ...opts, rawFidelity: true })).not.toContain('/styles.css'); // raw: skipped
  });

  it('rawFidelity omits ALL platform JS (theme-init head scripts + deferred component runtimes) but keeps inline scripts (the preview bridge)', () => {
    const opts = { brand, bodyHtml: '<h1>Hi</h1>', headScripts: ['theme.js'], scripts: ['components.js'], inlineScripts: ['/*bridge*/'] };
    const normal = renderDocument(page, opts);
    expect(normal).toContain('theme.js');
    expect(normal).toContain('components.js');
    const raw = renderDocument(page, { ...opts, rawFidelity: true });
    expect(raw).not.toContain('theme.js'); // platform no-flash init dropped
    expect(raw).not.toContain('components.js'); // platform component runtime dropped
    expect(raw).toContain('/*bridge*/'); // editor/preview bridge inline script preserved
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

  it('previewScroll moves the scroll onto <body> ONLY in preview (so the sub-frame shows a real scrollbar)', () => {
    // Publish (default): the viewport scrolls — no body-scroll override.
    expect(renderDocument(page, { brand })).not.toContain('body{height:100%;min-height:0;overflow-y:auto');
    // Preview: <html> is clipped and <body> becomes the scroll container, with an OPAQUE brand
    // scrollbar-color (overriding daisyUI's translucent one) so the bar is visible in the sub-frame.
    const preview = renderDocument(page, { brand, previewScroll: true });
    expect(preview).toContain('html{height:100%;overflow:hidden}');
    expect(preview).toContain('body{height:100%;min-height:0;overflow-y:auto;scrollbar-width:thin;');
    expect(preview).toContain('scrollbar-color:var(--sw-color-primary,#4f46e5) var(--sw-color-base-100,#ffffff)}');
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

  describe('content width (--sw-container)', () => {
    it('ships the .sw-container helper in the base CSS (consumes --sw-container)', () => {
      const doc = renderDocument(page, { brand, bodyHtml: '<div class="sw-container">x</div>' });
      expect(doc).toContain('.sw-container');
      expect(doc).toContain('max-width: var(--sw-container');
    });

    it('emits :root{--sw-container} from the setting (px or none)', () => {
      expect(renderDocument(page, { brand, containerWidth: '1440px' })).toContain('--sw-container:1440px');
      expect(renderDocument(page, { brand, containerWidth: 'none' })).toContain('--sw-container:none');
    });

    it('does not emit the var when unset (the helper falls back to its default)', () => {
      expect(renderDocument(page, { brand })).not.toContain(':root{--sw-container:');
    });

    it('sanitizes a bad containerWidth (defense-in-depth — never injects CSS)', () => {
      const doc = renderDocument(page, { brand, containerWidth: '1px}html{display:none' });
      expect(doc).not.toContain('--sw-container:1px}');
      expect(doc).not.toContain('html{display:none');
    });

    it('omits the container var on a raw-fidelity page (no platform CSS)', () => {
      const doc = renderDocument(page, { brand, rawFidelity: true, containerWidth: '1440px' });
      expect(doc).not.toContain('--sw-container:1440px');
    });
  });

  describe('sticky (fixed) header', () => {
    it('a static header (none/absent) emits no sticky CSS — byte-identical default', () => {
      const off = renderDocument(page, { brand, bodyHtml: '<h1>Hi</h1>' });
      expect(off).not.toContain('--sw-header-h');
      expect(off).not.toContain('.sw-top-padding');
      expect(off).not.toContain('#main-nav{position:fixed');
      // explicit 'none' is identical to absent
      expect(renderDocument(page, { brand, bodyHtml: '<h1>Hi</h1>', stickyHeader: 'none' })).toBe(off);
    });

    it('every mode fixes #main-nav + emits the offset token, spacer utility and anchor offset', () => {
      for (const mode of ['pinned', 'hide-on-scroll', 'shrink'] as const) {
        const doc = renderDocument(page, { brand, bodyHtml: '<h1>Hi</h1>', stickyHeader: mode });
        expect(doc).toContain('#main-nav{position:fixed;top:0;left:0;right:0;z-index:30}');
        expect(doc).toContain('--sw-header-h:4.5rem');
        expect(doc).toContain('@media (min-width:1024px){:root{--sw-header-h:4.75rem}}');
        expect(doc).toContain('scroll-padding-top:var(--sw-header-h)');
        expect(doc).toContain('.sw-top-padding{padding-top:var(--sw-header-h)}');
      }
    });

    it('hide-on-scroll slides the header out; shrink condenses it — each its own state rule', () => {
      const hide = renderDocument(page, { brand, stickyHeader: 'hide-on-scroll' });
      expect(hide).toContain('html.sw-nav-hidden #main-nav{translate:0 -100%}');
      expect(hide).not.toContain('html.sw-scrolled #main-nav .navbar');

      const shrink = renderDocument(page, { brand, stickyHeader: 'shrink' });
      expect(shrink).toContain('html.sw-scrolled #main-nav .navbar');
      expect(shrink).not.toContain('sw-nav-hidden');

      // 'pinned' is pure positioning — no scroll-state rule at all
      const pinned = renderDocument(page, { brand, stickyHeader: 'pinned' });
      expect(pinned).not.toContain('sw-nav-hidden');
      expect(pinned).not.toContain('sw-scrolled');
    });

    it('omits the sticky CSS on a raw-fidelity page (no platform CSS)', () => {
      const doc = renderDocument(page, { brand, rawFidelity: true, stickyHeader: 'pinned' });
      expect(doc).not.toContain('--sw-header-h');
      expect(doc).not.toContain('#main-nav{position:fixed');
    });
  });
});

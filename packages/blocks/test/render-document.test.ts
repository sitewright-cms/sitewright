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
});

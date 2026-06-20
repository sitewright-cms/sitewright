import { describe, expect, it } from 'vitest';
import { getBody, parse, serialize } from '../src/dom.js';
import { extractChrome, type ParsedPage } from '../src/transform/chrome.js';
import { DEFAULT_LIMITS } from '../src/limits.js';

const ctx = { siteBase: 'https://ex.com/', internalRoutes: new Map<string, string>(), assetMap: new Map<string, string>(), limits: DEFAULT_LIMITS };

function pp(url: string, html: string): ParsedPage {
  const doc = parse(html);
  return { url, doc, body: getBody(doc) };
}

const HEADER = '<header><nav><a href="/about">About</a></nav></header>';
const FOOTER = '<footer><p>shared footer</p></footer>';
const wrap = (extra = '') => `<html><body>${extra}<main>content</main></body></html>`;

describe('extractChrome', () => {
  it('hoists shared asides into sidebarLeft/Right and removes them from page bodies', () => {
    const asides = '<aside class="sidebar">left rail</aside><aside class="sidebar">right rail</aside>';
    const pages = ['/a', '/b', '/c'].map((u) => pp(u, `<html><body>${asides}<main>content</main></body></html>`));
    const result = extractChrome(pages, ctx);
    expect(result.sidebarLeft).toContain('left rail');
    expect(result.sidebarRight).toContain('right rail');
    for (const p of pages) expect(serialize(getBody(p.doc)!.children)).not.toContain('rail');
  });

  it('hoists a separate slide-out mobile menu into mobileNav (distinct from the header)', () => {
    const chrome = '<div id="top-nav"><a href="/about">Desktop</a></div><div id="mobile-nav"><a href="/about">MobileMenu</a></div>';
    const pages = ['/a', '/b', '/c'].map((u) => pp(u, `<html><body>${chrome}<main>content</main></body></html>`));
    const result = extractChrome(pages, ctx);
    expect(result.topNav).toContain('Desktop');
    expect(result.mobileNav).toContain('MobileMenu'); // the slide-out menu went to its own slot
    for (const p of pages) {
      const html = serialize(getBody(p.doc)!.children);
      expect(html).not.toContain('mobile-nav');
      expect(html).not.toContain('top-nav');
    }
  });

  it('removes a per-page-varying shared header from EVERY page (not just the identical majority)', () => {
    // 2 pages share an identical header; a 3rd has the same header but a different active link + lazy hint.
    const hdr = (active: string, extra = '') => `<header><a href="/" class="${active}">Home</a><img src="/logo.png"${extra}></header>`;
    const pages = [
      pp('/a', `<html><body>${hdr('active')}<main>a</main></body></html>`),
      pp('/b', `<html><body>${hdr('active')}<main>b</main></body></html>`),
      pp('/c', `<html><body>${hdr('', ' loading="lazy" srcset="/logo2.png 2x"')}<main>c</main></body></html>`),
    ];
    const result = extractChrome(pages, ctx);
    expect(result.topNav).toBeDefined();
    for (const p of pages) expect(serialize(getBody(p.doc)!.children)).not.toContain('<header'); // incl. the variant page
  });

  it('removes a JS preloader + cookie banner from every page and enables the platform preloader', () => {
    const cruft = '<div class="preloader"><div class="spinner"></div></div><div id="cookie-consent">Accept</div>';
    const pages = ['/a', '/b'].map((u) => pp(u, `<html><body>${cruft}<main>content</main></body></html>`));
    const result = extractChrome(pages, ctx);
    expect(result.preloaderEffect).toBe('spinner'); // the foreign preloader → the platform's own
    for (const p of pages) {
      const html = serialize(getBody(p.doc)!.children);
      expect(html).not.toContain('preloader');
      expect(html).not.toContain('cookie-consent');
    }
  });

  it('hoists a shared header + footer and removes them from page bodies', () => {
    const pages = [
      pp('https://ex.com/', `<html><body>${HEADER}<main>a</main>${FOOTER}</body></html>`),
      pp('https://ex.com/b', `<html><body>${HEADER}<main>b</main>${FOOTER}</body></html>`),
    ];
    const result = extractChrome(pages, ctx);
    expect(result.extracted).toBe(true);
    expect(result.topNav).toContain('href="/about"');
    expect(result.footer).toContain('shared footer');
    // Removed from the page bodies.
    for (const p of pages) {
      const html = serialize(p.body!.children);
      expect(html).not.toContain('shared footer');
      expect(html).not.toContain('<header');
    }
  });

  it('does not extract chrome present on fewer than 60% of pages', () => {
    const pages = [
      pp('https://ex.com/', `<html><body>${HEADER}<main>a</main></body></html>`),
      pp('https://ex.com/b', wrap()),
      pp('https://ex.com/c', wrap()),
    ];
    const result = extractChrome(pages, ctx);
    expect(result.topNav).toBeUndefined();
    expect(result.extracted).toBe(false);
  });

  it('extracts a footer even when there is no shared header', () => {
    const pages = [
      pp('https://ex.com/', `<html><body><main>a</main>${FOOTER}</body></html>`),
      pp('https://ex.com/b', `<html><body><main>b</main>${FOOTER}</body></html>`),
    ];
    const result = extractChrome(pages, ctx);
    expect(result.topNav).toBeUndefined();
    expect(result.footer).toContain('shared footer');
  });
});

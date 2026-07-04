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

  it('hoists a hyphenated-id sidebar wrapper (e.g. #side-bar-left-wrapper) but not a no-sidebar modifier', () => {
    const sidebar = '<div id="side-bar-left-wrapper" class="wrapper">fb rail</div>';
    const ok = ['/a', '/b', '/c'].map((u) => pp(u, `<html><body>${sidebar}<main>content</main></body></html>`));
    expect(extractChrome(ok, ctx).sidebarLeft).toContain('fb rail');

    const modifier = '<div class="no-sidebar">page wrapper</div>';
    const no = ['/a', '/b', '/c'].map((u) => pp(u, `<html><body>${modifier}<main>content</main></body></html>`));
    const r = extractChrome(no, ctx);
    expect(r.sidebarLeft).toBeUndefined(); // a `no-sidebar` layout modifier must NOT be hoisted as a sidebar
    for (const p of no) expect(serialize(getBody(p.doc)!.children)).toContain('page wrapper');
  });

  it('extracts only the header → mainNav; a standalone mobile menu is left in the body (one nav slot)', () => {
    // The platform has a SINGLE Main Navigation slot, so a separate slide-out mobile menu is NOT
    // hoisted into its own slot anymore — only the header goes to mainNav.
    const chrome = '<header><a href="/about">Desktop</a></header><div class="mobile-menu"><a href="/about">MobileMenu</a></div>';
    const pages = ['/a', '/b', '/c'].map((u) => pp(u, `<html><body>${chrome}<main>content</main></body></html>`));
    const result = extractChrome(pages, ctx);
    expect(result.mainNav).toContain('Desktop');
    expect('mobileNav' in result).toBe(false); // the separate mobile slot was removed
    for (const p of pages) {
      const html = serialize(getBody(p.doc)!.children);
      expect(html).not.toContain('Desktop'); // the header was hoisted out of the body
      expect(html).toContain('MobileMenu'); // the standalone mobile menu stays in the body (not hoisted)
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
    expect(result.mainNav).toBeDefined();
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

  it('KEEPS a content-rich "loading-overlay" (the hero reusing splash markup), still removes a bare preloader', () => {
    // phoenix-tech.net reuses `.loading-overlay > .splash-*` markup as its ABOVE-THE-FOLD hero (logo +
    // headline + CTAs). A bare spinner overlay is a real preloader; the content-rich one is the hero.
    const hero =
      '<div class="loading-overlay animated"><div class="splash-heading"><h1>NEXT-GEN WEB DEVELOPMENT</h1></div>' +
      '<a class="btn" href="#start">GET STARTED</a><a class="btn" href="#about">ABOUT PHOENIX</a></div>';
    const bare = '<div class="loading-overlay"><div class="spinner"></div></div>';
    const heroPages = ['/a', '/b'].map((u) => pp(u, `<html><body>${hero}<main>content</main></body></html>`));
    const heroResult = extractChrome(heroPages, ctx);
    expect(heroResult.preloaderEffect).toBeUndefined(); // NOT treated as a preloader
    for (const p of heroPages) {
      const html = serialize(getBody(p.doc)!.children);
      expect(html).toContain('NEXT-GEN WEB DEVELOPMENT'); // the hero survives
      expect(html).toContain('GET STARTED');
    }
    const barePages = ['/a', '/b'].map((u) => pp(u, `<html><body>${bare}<main>content</main></body></html>`));
    const bareResult = extractChrome(barePages, ctx);
    expect(bareResult.preloaderEffect).toBe('spinner'); // a genuine spinner-only overlay IS removed
    for (const p of barePages) expect(serialize(getBody(p.doc)!.children)).not.toContain('loading-overlay');
  });

  it('finds the REAL preloader when a content-rich hero overlay appears first', () => {
    const hero = '<div class="loading-overlay"><h1>Hero</h1><a href="#a">CTA One</a><a href="#b">CTA Two</a></div>';
    const preloader = '<div class="preloader"><div class="spinner"></div></div>';
    const pages = ['/a', '/b'].map((u) => pp(u, `<html><body>${hero}${preloader}<main>content</main></body></html>`));
    const result = extractChrome(pages, ctx);
    expect(result.preloaderEffect).toBe('spinner'); // the genuine spinner is still found + removed
    for (const p of pages) {
      const html = serialize(getBody(p.doc)!.children);
      expect(html).toContain('Hero'); // hero kept
      expect(html).not.toContain('spinner'); // real preloader gone
    }
  });

  it('strips HTML comments from hoisted chrome (header/footer)', () => {
    const hdr = '<header><!-- legacy nav --><nav><a href="/about">About</a></nav></header>';
    const pages = ['/a', '/b', '/c'].map((u) => pp(u, `<html><body>${hdr}<main>content</main></body></html>`));
    const result = extractChrome(pages, ctx);
    expect(result.mainNav).toBeDefined();
    expect(result.mainNav).not.toContain('<!--');
    expect(result.mainNav).not.toContain('legacy nav');
    expect(result.mainNav).toContain('>About</a>'); // the real nav link survives (href normalizes via ctx routes)
  });

  it('hoists a shared header + footer and removes them from page bodies', () => {
    const pages = [
      pp('https://ex.com/', `<html><body>${HEADER}<main>a</main>${FOOTER}</body></html>`),
      pp('https://ex.com/b', `<html><body>${HEADER}<main>b</main>${FOOTER}</body></html>`),
    ];
    const result = extractChrome(pages, ctx);
    expect(result.extracted).toBe(true);
    expect(result.mainNav).toContain('href="/about"');
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
    expect(result.mainNav).toBeUndefined();
    expect(result.extracted).toBe(false);
  });

  it('extracts a footer even when there is no shared header', () => {
    const pages = [
      pp('https://ex.com/', `<html><body><main>a</main>${FOOTER}</body></html>`),
      pp('https://ex.com/b', `<html><body><main>b</main>${FOOTER}</body></html>`),
    ];
    const result = extractChrome(pages, ctx);
    expect(result.mainNav).toBeUndefined();
    expect(result.footer).toContain('shared footer');
  });
});

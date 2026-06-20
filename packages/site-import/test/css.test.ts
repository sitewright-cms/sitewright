import { describe, expect, it } from 'vitest';
import { parse } from '../src/dom.js';
import { collectCssRefs, packCss, type CollectedCss } from '../src/transform/css.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import type { CapturedSite } from '../src/types.js';

const PAGE = 'https://ex.com/';

function siteWithCss(css?: string): CapturedSite {
  const assets = new Map();
  if (css) assets.set('https://ex.com/s.css', { sourceRef: 'https://ex.com/s.css', kind: 'css', bytes: new TextEncoder().encode(css) });
  return { baseUrl: PAGE, pages: [], assets, origin: { kind: 'crawl', label: 'x' } };
}

function pages(html: string): { url: string; doc: ReturnType<typeof parse> }[] {
  return [{ url: PAGE, doc: parse(html) }];
}

/** collect → pack in one step (default empty assetMap = nothing self-hosted). */
function run(html: string, site = siteWithCss(), limits = DEFAULT_LIMITS, assetMap = new Map<string, string>()): CollectedCss & { imageRefs: Map<string, unknown> } {
  const c = collectCssRefs(pages(html), site);
  return { ...packCss(c.cssText, assetMap, limits), imageRefs: c.imageRefs };
}

describe('collectCssRefs + packCss', () => {
  it('concatenates inline <style> and stylesheet assets, minified', () => {
    const css = run('<html><head><style>.a { color: red; } /* note */</style></head><body></body></html>', siteWithCss('.b { margin: 0 }'));
    expect(css.criticalCss).toContain('.a{color:red}');
    expect(css.criticalCss).toContain('.b{margin:0}');
    expect(css.criticalCss).not.toContain('/* note */');
    expect(css.overflow).toBe(false);
  });

  it('returns nothing when there is no CSS', () => {
    expect(run('<html><body></body></html>')).toMatchObject({ overflow: false });
  });

  it('deduplicates identical style blocks and ignores empty ones', () => {
    const css = run('<html><head><style>.a{color:red}</style><style></style><style>.a{color:red}</style></head><body></body></html>');
    expect((css.criticalCss!.match(/\.a\{color:red\}/g) ?? []).length).toBe(1);
  });

  it('overflows from criticalCss into a head <style>, then flags drop', () => {
    const big = '.x{color:red}'.repeat(40);
    const css = run(`<html><head><style>${big}</style></head><body></body></html>`, siteWithCss(), { ...DEFAULT_LIMITS, maxCriticalCssBytes: 50, maxHeadCssBytes: 80 });
    expect(css.criticalCss && Buffer.byteLength(css.criticalCss)).toBeLessThanOrEqual(50);
    expect(css.headStyle).toMatch(/^<style>.*<\/style>$/);
    expect(css.overflow).toBe(true);
  });

  it('flags overflow when even the head budget is too small for a wrapper', () => {
    const big = '.x{color:red}'.repeat(20);
    const css = run(`<html><head><style>${big}</style></head><body></body></html>`, siteWithCss(), { ...DEFAULT_LIMITS, maxCriticalCssBytes: 30, maxHeadCssBytes: 5 });
    expect(css.criticalCss).toBeTruthy();
    expect(css.headStyle).toBeUndefined();
    expect(css.overflow).toBe(true);
  });

  it('neutralizes a </style> breakout', () => {
    const css = run('<html><head><style>.a{content:"x"}</style></head><body></body></html>', siteWithCss('.b{}</style><script>evil()</script>'));
    expect(css.criticalCss).not.toContain('</style>');
  });

  it('collects a url() image (resolved absolute) and rewrites it to the hosted ref', () => {
    const c = collectCssRefs(pages('<html><head><style>.h{background:url(/img/bg.png)}</style></head><body></body></html>'), siteWithCss());
    expect([...c.imageRefs.keys()]).toEqual(['https://ex.com/img/bg.png']);
    const packed = packCss(c.cssText, new Map([['https://ex.com/img/bg.png', '/media/p/a/bg.jpg']]), DEFAULT_LIMITS);
    expect(packed.criticalCss).toContain("url('/media/p/a/bg.jpg')");
  });

  it('resolves a stylesheet-asset url() against the stylesheet URL, not the page', () => {
    // s.css lives at https://ex.com/s.css; "img/x.png" → https://ex.com/img/x.png.
    const c = collectCssRefs(pages('<html><body></body></html>'), siteWithCss('.h{background:url(img/x.png)}'));
    expect([...c.imageRefs.keys()]).toEqual(['https://ex.com/img/x.png']);
  });

  it('rewrites a non-image (font) url() to an absolute hotlink, not collected for hosting', () => {
    const c = collectCssRefs(pages('<html><body></body></html>'), siteWithCss('@font-face{font-family:x;src:url(fonts/x.woff2)}'));
    expect(c.imageRefs.size).toBe(0); // fonts aren't self-hosted
    expect(c.cssText).toContain("url('https://ex.com/fonts/x.woff2')"); // resolved to absolute
    const packed = packCss(c.cssText, new Map(), DEFAULT_LIMITS);
    expect(packed.criticalCss).toContain("url('https://ex.com/fonts/x.woff2')"); // passes through unchanged
  });

  it('keeps an un-hosted url() as an absolute https hotlink, and keeps data: inline', () => {
    const c = collectCssRefs(pages('<html><head><style>.h{background:url(https://cdn.x/a.png)}.d{background:url(data:image/png;base64,AAA)}</style></head><body></body></html>'), siteWithCss());
    const packed = packCss(c.cssText, new Map(), DEFAULT_LIMITS); // empty map → nothing hosted
    expect(packed.criticalCss).toContain("url('https://cdn.x/a.png')");
    expect(packed.criticalCss).toContain('url(data:image/png;base64,AAA)');
  });
});

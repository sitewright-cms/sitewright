import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { parse } from '../src/dom.js';
import { collectCssRefs, buildPageStyles, buildHostableCss } from '../src/transform/css.js';
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

/** collect → build the page <style> block (default empty assetMap = nothing self-hosted). */
function run(html: string, site = siteWithCss(), assetMap = new Map<string, string>()): { style: string; imageRefs: Map<string, unknown> } {
  const c = collectCssRefs(pages(html), site);
  return { style: buildPageStyles(c.cssText, assetMap), imageRefs: c.imageRefs };
}

describe('collectCssRefs + buildPageStyles', () => {
  it('concatenates inline <style> and stylesheet assets into ONE minified <style> block', () => {
    const { style } = run('<html><head><style>.a { color: red; } /* note */</style></head><body></body></html>', siteWithCss('.b { margin: 0 }'));
    expect(style).toMatch(/^<style>.*<\/style>$/);
    expect(style).toContain('.a{color:red}');
    expect(style).toContain('.b{margin:0}');
    expect(style).not.toContain('/* note */');
  });

  it('returns nothing when there is no CSS', () => {
    expect(run('<html><body></body></html>').style).toBe('');
  });

  it('keeps the FULL stylesheet — no byte cap (the slot is the page source, not the website slots)', () => {
    const big = '.x{color:red}'.repeat(4000); // ~52 KB, far over the old 10 KB/20 KB caps
    const { style } = run(`<html><head><style>${big}</style></head><body></body></html>`);
    expect(Buffer.byteLength(style)).toBeGreaterThan(40_000); // not truncated
    expect((style.match(/\.x\{color:red\}/g) ?? []).length).toBe(4000);
  });

  it('the generated <style> passes validateTemplate', () => {
    const { style } = run('<html><head><style>.a{color:red}@media(max-width:5px){.b{margin:0}}</style></head><body></body></html>');
    expect(() => validateTemplate(style)).not.toThrow();
  });

  it('neutralizes a </style> breakout and stray {{ }} so the literal <style> stays valid', () => {
    const { style } = run('<html><body></body></html>', siteWithCss('.a{content:"x"}</style><script>evil()</script>.b::before{content:"{{x}}"}'));
    expect(style).not.toContain('</style><script>');
    expect(style).not.toContain('{{x}}');
    expect(() => validateTemplate(style)).not.toThrow();
  });

  it('collects a url() image (resolved absolute) and rewrites it to the hosted ref', () => {
    const c = collectCssRefs(pages('<html><head><style>.h{background:url(/img/bg.png)}</style></head><body></body></html>'), siteWithCss());
    expect([...c.imageRefs.keys()]).toEqual(['https://ex.com/img/bg.png']);
    const style = buildPageStyles(c.cssText, new Map([['https://ex.com/img/bg.png', '/media/p/a/bg.jpg']]));
    expect(style).toContain("url('/media/p/a/bg.jpg')");
  });

  it('resolves a stylesheet-asset url() against the stylesheet URL, not the page', () => {
    const c = collectCssRefs(pages('<html><body></body></html>'), siteWithCss('.h{background:url(img/x.png)}'));
    expect([...c.imageRefs.keys()]).toEqual(['https://ex.com/img/x.png']);
  });

  it('collectCssRefs leaves a font url() absolute (it is self-hosted separately via collectFontFaces)', () => {
    const c = collectCssRefs(pages('<html><body></body></html>'), siteWithCss('@font-face{font-family:x;src:url(fonts/x.woff2)}'));
    expect(c.imageRefs.size).toBe(0);
    expect(c.cssText).toContain("url('https://ex.com/fonts/x.woff2')");
  });

  it('keeps an un-hosted url() as an absolute https hotlink, and keeps data: inline', () => {
    const c = collectCssRefs(pages('<html><head><style>.h{background:url(https://cdn.x/a.png)}.d{background:url(data:image/png;base64,AAA)}</style></head><body></body></html>'), siteWithCss());
    const style = buildPageStyles(c.cssText, new Map());
    expect(style).toContain("url('https://cdn.x/a.png')");
    expect(style).toContain('url(data:image/png;base64,AAA)');
  });
});

describe('buildHostableCss — Tailwind utility-collision sanitizing', () => {
  const host = (css: string): string => {
    const c = collectCssRefs(pages('<html><head></head><body></body></html>'), siteWithCss(css));
    return buildHostableCss(c.cssText, new Map());
  };

  it('strips !important from colliding layout utilities so the platform Tailwind can override', () => {
    // The MDB/Bootstrap `.hidden{display:none!important}` would otherwise beat the platform `lg:block`.
    expect(host('.hidden{display:none!important}')).toBe('.hidden{display:none}');
    expect(host('.invisible{visibility:hidden !important}')).toBe('.invisible{visibility:hidden}');
    expect(host('.flex{display:flex!important}')).toBe('.flex{display:flex}');
    expect(host('.relative{position:relative!important}')).toBe('.relative{position:relative}');
  });

  it('leaves !important on NON-colliding (framework-specific) classes untouched', () => {
    // `.primary-color` is not a Tailwind utility name → no collision → keep the author intent.
    expect(host('.primary-color{color:#0ca3c8!important}')).toContain('!important');
  });

  it('only touches the targeted rule, not neighbours', () => {
    expect(host('.hidden{display:none!important}.card{padding:8px!important}')).toBe('.hidden{display:none}.card{padding:8px!important}');
  });
});

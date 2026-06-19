import { describe, expect, it } from 'vitest';
import { parse } from '../src/dom.js';
import { collectCss } from '../src/transform/css.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import type { CapturedSite } from '../src/types.js';

function siteWithCss(css?: string): CapturedSite {
  const assets = new Map();
  if (css) assets.set('k', { sourceRef: 'k', kind: 'css', bytes: new TextEncoder().encode(css) });
  return { baseUrl: 'https://ex.com/', pages: [], assets, origin: { kind: 'crawl', label: 'x' } };
}

describe('collectCss', () => {
  it('concatenates inline <style> and stylesheet assets, minified', () => {
    const docs = [parse('<html><head><style>.a { color: red; } /* note */</style></head><body></body></html>')];
    const css = collectCss(docs, siteWithCss('.b { margin: 0 }'), DEFAULT_LIMITS);
    expect(css.criticalCss).toContain('.a{color:red}');
    expect(css.criticalCss).toContain('.b{margin:0}');
    expect(css.criticalCss).not.toContain('/* note */');
    expect(css.overflow).toBe(false);
  });

  it('returns nothing when there is no CSS', () => {
    expect(collectCss([parse('<html><body></body></html>')], siteWithCss(), DEFAULT_LIMITS)).toEqual({ overflow: false });
  });

  it('deduplicates identical style blocks and ignores empty ones', () => {
    const docs = [parse('<html><head><style>.a{color:red}</style><style></style><style>.a{color:red}</style></head><body></body></html>')];
    const css = collectCss(docs, siteWithCss(), DEFAULT_LIMITS);
    const count = (css.criticalCss!.match(/\.a\{color:red\}/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('overflows from criticalCss into a head <style>, then flags drop', () => {
    const big = '.x{color:red}'.repeat(40); // ~520 bytes
    const limits = { ...DEFAULT_LIMITS, maxCriticalCssBytes: 50, maxHeadCssBytes: 80 };
    const css = collectCss([parse(`<html><head><style>${big}</style></head><body></body></html>`)], siteWithCss(), limits);
    expect(css.criticalCss && Buffer.byteLength(css.criticalCss)).toBeLessThanOrEqual(50);
    expect(css.headStyle).toMatch(/^<style>.*<\/style>$/);
    expect(css.overflow).toBe(true);
  });

  it('flags overflow when even the head budget is too small for a wrapper', () => {
    const big = '.x{color:red}'.repeat(20);
    const css = collectCss([parse(`<html><head><style>${big}</style></head><body></body></html>`)], siteWithCss(), { ...DEFAULT_LIMITS, maxCriticalCssBytes: 30, maxHeadCssBytes: 5 });
    expect(css.criticalCss).toBeTruthy();
    expect(css.headStyle).toBeUndefined();
    expect(css.overflow).toBe(true);
  });

  it('neutralizes a </style> breakout', () => {
    const css = collectCss([parse('<html><head><style>.a{content:"x"}</style></head><body></body></html>')], siteWithCss('.b{}</style><script>evil()</script>'), DEFAULT_LIMITS);
    expect(css.criticalCss).not.toContain('</style>');
  });
});

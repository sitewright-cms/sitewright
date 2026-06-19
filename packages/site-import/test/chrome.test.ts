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

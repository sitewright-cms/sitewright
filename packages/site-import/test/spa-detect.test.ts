import { describe, expect, it } from 'vitest';
import { looksClientRendered } from '../src/spa-detect.js';

describe('looksClientRendered', () => {
  it('flags an empty-body SPA shell with a mount node + bundle', () => {
    expect(looksClientRendered('<html><body><div id="root"></div><script src="/app.js"></script></body></html>')).toBe(true);
    expect(looksClientRendered('<html><body><div id="__next"></div><script src="/_next/x.js"></script></body></html>')).toBe(true);
  });

  it('flags an essentially-blank body that still ships JS (no recognized mount)', () => {
    expect(looksClientRendered('<html><body><script src="/bundle.js"></script></body></html>')).toBe(true);
  });

  it('does NOT flag a server-rendered page with real content', () => {
    const html = `<html><body><header>Acme</header><main><h1>Welcome to Acme</h1><p>${'We build great things. '.repeat(20)}</p></main><script src="/analytics.js"></script></body></html>`;
    expect(looksClientRendered(html)).toBe(false);
  });

  it('does NOT flag an empty page without scripts (just a stub)', () => {
    expect(looksClientRendered('<html><body><div id="root"></div></body></html>')).toBe(false);
  });

  it('handles empty/non-string input', () => {
    expect(looksClientRendered('')).toBe(false);
    expect(looksClientRendered(undefined as unknown as string)).toBe(false);
  });
});

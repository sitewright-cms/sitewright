import { describe, expect, it } from 'vitest';
import { assetKey, normalizePageUrl, pickFromSrcset, resolveUrl, rewriteHref, routePath, sameOrigin } from '../src/url-util.js';

describe('normalizePageUrl', () => {
  it('drops query/fragment, index.html, trailing slash; lowercases host', () => {
    expect(normalizePageUrl('https://Ex.com/about/?utm=1#x')).toBe('https://ex.com/about');
    expect(normalizePageUrl('https://ex.com/dir/index.html')).toBe('https://ex.com/dir');
    expect(normalizePageUrl('https://ex.com/')).toBe('https://ex.com/');
    expect(normalizePageUrl('https://ex.com')).toBe('https://ex.com/');
  });
  it('returns null for an unparseable URL', () => {
    expect(normalizePageUrl('::::')).toBeNull();
  });
});

describe('assetKey', () => {
  it('keeps the query (cache-busting) but drops the fragment', () => {
    expect(assetKey('/img/a.png?v=2#x', 'https://ex.com/p')).toBe('https://ex.com/img/a.png?v=2');
  });
  it('returns null for a bad ref', () => {
    expect(assetKey('http://[bad', 'not-a-base')).toBeNull();
  });
});

describe('sameOrigin / routePath', () => {
  it('classifies internal vs external', () => {
    expect(sameOrigin('https://ex.com/x', 'https://ex.com/')).toBe(true);
    expect(sameOrigin('https://other.com/x', 'https://ex.com/')).toBe(false);
    expect(routePath('https://ex.com/a/b', 'https://ex.com/')).toBe('/a/b');
    expect(routePath('https://ex.com/', 'https://ex.com/')).toBe('/');
    expect(routePath('https://other.com/a', 'https://ex.com/')).toBeNull();
  });
});

describe('rewriteHref', () => {
  const site = 'https://ex.com/';
  const routes = new Map([['https://ex.com/contact', '/contact']]);
  it('keeps anchors and mailto/tel', () => {
    expect(rewriteHref('#top', 'https://ex.com/p', site, routes)).toEqual({ kind: 'keep' });
    expect(rewriteHref('mailto:a@b.com', 'https://ex.com/p', site, routes)).toEqual({ kind: 'keep' });
  });
  it('maps internal links to their final route', () => {
    expect(rewriteHref('/contact', 'https://ex.com/p', site, routes)).toEqual({ kind: 'set', value: '/contact' });
    expect(rewriteHref('contact', 'https://ex.com/', site, routes)).toEqual({ kind: 'set', value: '/contact' });
  });
  it('falls back to the clean path for an uncaptured internal link', () => {
    expect(rewriteHref('/blog/post', 'https://ex.com/p', site, routes)).toEqual({ kind: 'set', value: '/blog/post' });
  });
  it('keeps external https links absolute', () => {
    expect(rewriteHref('https://other.com/x', 'https://ex.com/p', site, routes)).toEqual({ kind: 'set', value: 'https://other.com/x' });
  });
  it('flags unsafe schemes', () => {
    expect(rewriteHref('javascript:alert(1)', 'https://ex.com/p', site, routes)).toEqual({ kind: 'unsafe' });
    expect(rewriteHref('data:text/html,x', 'https://ex.com/p', site, routes)).toEqual({ kind: 'unsafe' });
  });
});

describe('pickFromSrcset', () => {
  it('picks the largest width descriptor', () => {
    expect(pickFromSrcset('a.jpg 400w, b.jpg 800w, c.jpg 1200w')).toBe('c.jpg');
  });
  it('falls back to the last candidate without descriptors', () => {
    expect(pickFromSrcset('a.jpg, b.jpg 2x')).toBe('b.jpg');
  });
  it('returns undefined for empty', () => {
    expect(pickFromSrcset('   ')).toBeUndefined();
  });
});

describe('edge cases', () => {
  it('sameOrigin returns false for an unparseable URL', () => {
    expect(sameOrigin('::nope', 'https://ex.com/')).toBe(false);
  });
  it('routePath returns null for an unparseable URL', () => {
    expect(routePath('::nope', 'https://ex.com/')).toBeNull();
  });
});

describe('resolveUrl', () => {
  it('resolves relative against base and returns null on failure', () => {
    expect(resolveUrl('../x', 'https://ex.com/a/b')).toBe('https://ex.com/x');
    expect(resolveUrl('x', 'not a url')).toBeNull();
  });
});

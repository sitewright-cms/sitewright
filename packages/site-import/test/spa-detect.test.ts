import { describe, expect, it } from 'vitest';
import { looksClientRendered, embedWrapperFrame } from '../src/spa-detect.js';

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

describe('embedWrapperFrame', () => {
  it('returns the framed URL for a bare wrapper dominated by one iframe (Arena-style)', () => {
    const html = `<html><body><div class="banner">Report</div><div class="iframe-container"><iframe id="preview" src="https://abc123.arena.site/?embed=true" sandbox="allow-scripts"></iframe></div></body></html>`;
    expect(embedWrapperFrame(html)).toBe('https://abc123.arena.site/?embed=true');
  });

  it('does NOT flag a real content page that merely embeds a widget (map/video)', () => {
    const html = `<html><body><header>Acme Plumbing</header><main><h1>Contact us</h1><p>${'Visit our Windhoek office for a quote. '.repeat(20)}</p><iframe src="https://www.google.com/maps/embed?pb=1"></iframe></main></body></html>`;
    expect(embedWrapperFrame(html)).toBeNull();
  });

  it('ignores inline <script>/<style> bodies when measuring the wrapper text (analytics snippet ≠ prose)', () => {
    const bigScript = `!function(t,e){${'var x=1;'.repeat(400)}}(document,window);`;
    const html = `<html><head><style>.a{color:red}${'.x{}'.repeat(200)}</style></head><body><div class="banner">Report content</div><script>${bigScript}</script><div class="iframe-container"><iframe src="https://abc.arena.site/?embed=true"></iframe></div></body></html>`;
    expect(embedWrapperFrame(html)).toBe('https://abc.arena.site/?embed=true');
  });

  it('returns null when there is no https iframe', () => {
    expect(embedWrapperFrame('<html><body><div id="root"></div></body></html>')).toBeNull();
    expect(embedWrapperFrame('<html><body><iframe src="/local/frame"></iframe></body></html>')).toBeNull();
    expect(embedWrapperFrame('')).toBeNull();
  });
});

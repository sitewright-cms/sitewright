import { describe, expect, it, vi } from 'vitest';
import { crawlSite, extractLinks, extractStylesheets, type FetchedResource } from '../src/import/crawl.js';

const enc = (s: string) => new TextEncoder().encode(s);

const SITE: Record<string, string> = {
  'https://ex.com/': '<a href="/about">a</a><a href="/contact">c</a><a href="https://other.com/x">ext</a><link rel="stylesheet" href="/s.css">',
  'https://ex.com/about': '<a href="/">home</a><a href="/deep">d</a>',
  'https://ex.com/contact': 'contact',
  'https://ex.com/deep': 'deep',
};
const CSS: Record<string, string> = { 'https://ex.com/s.css': '.a{color:red}' };

function fetcher(): (url: string) => Promise<FetchedResource | null> {
  return async (url) => {
    if (url in SITE) return { url, status: 200, contentType: 'text/html; charset=utf-8', bytes: enc(SITE[url]!) };
    if (url in CSS) return { url, status: 200, contentType: 'text/css', bytes: enc(CSS[url]!) };
    return null;
  };
}

const baseOpts = { maxPages: 50, maxDepth: 3, sameOriginOnly: true, maxBytesTotal: 10_000_000, maxStylesheets: 40 };

describe('extractLinks / extractStylesheets', () => {
  it('extracts hrefs and stylesheet links regardless of quoting', () => {
    expect(extractLinks(`<a href="/a">x</a><a href='/b'>y</a><a href=/c>z</a>`)).toEqual(['/a', '/b', '/c']);
    expect(extractStylesheets('<link rel="stylesheet" href="/s.css"><link rel="icon" href="/f.png">')).toEqual(['/s.css']);
  });
});

describe('crawlSite', () => {
  it('crawls same-origin pages and fetches stylesheets as assets', async () => {
    const res = await crawlSite('https://ex.com/', baseOpts, { fetchResource: fetcher(), isAllowed: async () => true });
    const urls = res.site.pages.map((p) => p.sourceUrl).sort();
    expect(urls).toEqual(['https://ex.com/', 'https://ex.com/about', 'https://ex.com/contact', 'https://ex.com/deep']);
    expect([...res.site.assets.keys()]).toContain('https://ex.com/s.css');
    expect(res.site.assets.get('https://ex.com/s.css')?.kind).toBe('css');
    expect(res.site.baseUrl).toBe('https://ex.com/');
    expect(res.truncated).toBe(false);
  });

  it('fetches a depth level concurrently, not serially', async () => {
    let inFlight = 0, maxInFlight = 0;
    const slow = async (url: string): Promise<FetchedResource | null> => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (url in SITE) return { url, status: 200, contentType: 'text/html; charset=utf-8', bytes: enc(SITE[url]!) };
      if (url in CSS) return { url, status: 200, contentType: 'text/css', bytes: enc(CSS[url]!) };
      return null;
    };
    const res = await crawlSite('https://ex.com/', baseOpts, { fetchResource: slow, isAllowed: async () => true });
    expect(res.site.pages).toHaveLength(4);
    expect(maxInFlight).toBeGreaterThan(1); // about + contact (depth 1) fetched together (was strictly serial)
  });

  it('respects maxDepth', async () => {
    const res = await crawlSite('https://ex.com/', { ...baseOpts, maxDepth: 1 }, { fetchResource: fetcher(), isAllowed: async () => true });
    const urls = res.site.pages.map((p) => p.sourceUrl);
    expect(urls).toContain('https://ex.com/about');
    expect(urls).not.toContain('https://ex.com/deep'); // depth 2
  });

  it('respects maxPages and reports truncation', async () => {
    const res = await crawlSite('https://ex.com/', { ...baseOpts, maxPages: 2 }, { fetchResource: fetcher(), isAllowed: async () => true });
    expect(res.site.pages).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });

  it('does not leave the origin when sameOriginOnly is set', async () => {
    const f = vi.fn(fetcher());
    await crawlSite('https://ex.com/', baseOpts, { fetchResource: f, isAllowed: async () => true });
    expect(f.mock.calls.flat()).not.toContain('https://other.com/x');
  });

  it('scopes a SUBPATH-hosted seed to its base path + directory-normalizes a slashless seed', async () => {
    const sub: Record<string, string> = {
      'https://ex.com/sites/droombos/': '<a href="./accommodation/">acc</a><a href="./contact/">c</a><a href="/sites/other/">out</a>',
      'https://ex.com/sites/droombos/accommodation/': 'acc',
      'https://ex.com/sites/droombos/contact/': 'contact',
      'https://ex.com/sites/other/': 'a DIFFERENT site on the same host — must NOT be crawled',
    };
    const f = async (url: string): Promise<FetchedResource | null> =>
      url in sub ? { url, status: 200, contentType: 'text/html', bytes: enc(sub[url]!) } : null;
    // Seed WITHOUT the trailing slash — the crawler must directory-normalize it so `./accommodation/`
    // resolves UNDER /sites/droombos/, not up at /sites/accommodation/.
    const res = await crawlSite('https://ex.com/sites/droombos', baseOpts, { fetchResource: f, isAllowed: async () => true });
    expect(res.site.baseUrl).toBe('https://ex.com/sites/droombos/'); // directory-normalized base
    const urls = res.site.pages.map((p) => p.sourceUrl).sort();
    expect(urls).toEqual([
      'https://ex.com/sites/droombos/',
      'https://ex.com/sites/droombos/accommodation/',
      'https://ex.com/sites/droombos/contact/',
    ]);
    expect(urls).not.toContain('https://ex.com/sites/other/'); // sibling outside the subpath scope
  });

  it('skips and warns on SSRF-blocked URLs', async () => {
    const res = await crawlSite('https://ex.com/', baseOpts, {
      fetchResource: fetcher(),
      isAllowed: async (u) => u !== 'https://ex.com/contact',
    });
    expect(res.site.pages.map((p) => p.sourceUrl)).not.toContain('https://ex.com/contact');
    expect(res.warnings.some((w) => w.includes('contact'))).toBe(true);
  });

  it('does not follow http:// links (https-only discovery)', async () => {
    const SITE2: Record<string, string> = {
      'https://ex.com/': '<a href="http://ex.com/insecure">i</a><a href="/ok">o</a>',
      'https://ex.com/ok': 'ok',
    };
    const f = vi.fn(async (url: string): Promise<FetchedResource | null> =>
      url in SITE2 ? { url, status: 200, contentType: 'text/html', bytes: enc(SITE2[url]!) } : null,
    );
    const res = await crawlSite('https://ex.com/', baseOpts, { fetchResource: f, isAllowed: async () => true });
    expect(res.site.pages.map((p) => p.sourceUrl)).toEqual(['https://ex.com/', 'https://ex.com/ok']);
    expect(f.mock.calls.flat()).not.toContain('http://ex.com/insecure');
  });

  it('warns when a fetch fails', async () => {
    const res = await crawlSite('https://ex.com/missing', baseOpts, { fetchResource: fetcher(), isAllowed: async () => true });
    expect(res.site.pages).toHaveLength(0);
    expect(res.warnings.some((w) => w.startsWith('fetch failed'))).toBe(true);
  });

  it('re-renders a client-rendered shell and discovers its runtime links', async () => {
    const SHELL = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    const RENDERED = '<html><body><nav><a href="/team">Team</a></nav><main>home</main></body></html>';
    const fetchResource = async (url: string): Promise<FetchedResource | null> => {
      if (url === 'https://spa.com/') return { url, status: 200, contentType: 'text/html', bytes: enc(SHELL) };
      if (url === 'https://spa.com/team') return { url, status: 200, contentType: 'text/html', bytes: enc('<html><body>team page</body></html>') };
      return null;
    };
    const render = vi.fn(async () => RENDERED);
    const res = await crawlSite('https://spa.com/', baseOpts, { fetchResource, isAllowed: async () => true, render });
    expect(render).toHaveBeenCalledWith('https://spa.com/', expect.anything()); // the shell was re-rendered
    expect(res.site.pages.map((p) => p.sourceUrl)).toEqual(['https://spa.com/', 'https://spa.com/team']);
    expect(res.site.pages[0]!.html).toContain('home'); // stored HTML is the rendered DOM, not the shell
  });

  it('does not re-render a server-rendered page', async () => {
    const render = vi.fn(async () => '<html><body>UNUSED</body></html>');
    await crawlSite('https://ex.com/', baseOpts, { fetchResource: fetcher(), isAllowed: async () => true, render });
    expect(render).not.toHaveBeenCalled();
  });
});

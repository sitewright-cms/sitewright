// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand, Page } from '@sitewright/schema';
import { STATS_JS, statsScriptTag } from '../src/stats.js';
import { renderDocument } from '../src/render.js';

// The tracker reads its own <script> tag (document.currentScript), so each run plants a tag and points
// currentScript at it before evaluating the runtime — the way a browser runs it.

type Beacon = { url: string; body: Record<string, unknown> };

function run(tag: string, opts: { prerendering?: boolean; referrer?: string; search?: string } = {}): Beacon[] {
  const sent: Beacon[] = [];
  document.body.innerHTML = tag;
  const el = document.querySelector('script[data-sw-stats]');
  Object.defineProperty(document, 'currentScript', { value: el, configurable: true });
  Object.defineProperty(document, 'prerendering', { value: opts.prerendering ?? false, configurable: true });
  Object.defineProperty(document, 'referrer', { value: opts.referrer ?? '', configurable: true });
  if (opts.search !== undefined) history.replaceState(null, '', `/${opts.search}`);
  Object.defineProperty(navigator, 'sendBeacon', {
    value: (url: string, body: string) => {
      sent.push({ url, body: JSON.parse(body) as Record<string, unknown> });
      return true;
    },
    configurable: true,
  });
  // The runtime is a first-party string, evaluated as a page would.
  (0, eval)(STATS_JS);
  return sent;
}

const tag = (over: Partial<Parameters<typeof statsScriptTag>[0]> = {}): string =>
  statsScriptTag({ src: '_assets/_sw/stats.js?v=1', base: 'https://cms.example.com/', project: 'p1', route: '/about/', token: 'tok', ...over });

describe('the statistics tracker', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ sends ONE beacon with the signed route to the assembled collector address', () => {
    const sent = run(tag());
    expect(sent).toEqual([{ url: 'https://cms.example.com/a/p1', body: { r: '/about/', k: 'tok', h: location.hostname } }]);
  });

  it('beacons root-relative when the platform has no public URL', () => {
    expect(run(tag({ base: '' }))[0]?.url).toBe('/a/p1');
  });

  it('★ never writes the collector URL into the markup', () => {
    const html = tag();
    expect(html).not.toContain('cms.example.com');
    expect(html).not.toContain('/a/p1');
  });

  it('reports a referring HOST (never its path), and nothing for an internal navigation', () => {
    expect(run(tag(), { referrer: 'https://www.google.com/search?q=secret' })[0]?.body.f).toBe('www.google.com');
    expect(run(tag(), { referrer: `${location.origin}/previous/` })[0]?.body.f).toBeUndefined();
  });

  it('reports a campaign from utm_source or ref', () => {
    expect(run(tag(), { search: '?utm_source=newsletter&utm_medium=email' })[0]?.body.u).toBe('newsletter');
    expect(run(tag(), { search: '?ref=partner' })[0]?.body.u).toBe('partner');
  });

  it('★ waits for a prerendered page to be SHOWN before counting it', () => {
    const sent = run(tag(), { prerendering: true });
    expect(sent).toEqual([]);
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(sent).toHaveLength(1);
  });

  it('reports the automation flag and a touch screen', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    const body = run(tag())[0]?.body;
    expect(body).toMatchObject({ w: 1, t: 1 });
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  });

  it('does nothing with a damaged tag, or in a browser without sendBeacon', () => {
    expect(run('<script data-sw-stats="not-base64!"></script>')).toEqual([]);
    expect(run(`<script data-sw-stats="${Buffer.from('{"p":1}').toString('base64')}"></script>`)).toEqual([]);
    const sent: unknown[] = [];
    document.body.innerHTML = tag();
    Object.defineProperty(document, 'currentScript', { value: document.querySelector('script'), configurable: true });
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
    expect(() => (0, eval)(STATS_JS)).not.toThrow();
    expect(sent).toEqual([]);
  });
});

describe('renderDocument and the tracker', () => {
  const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } } as Page;
  const brand = { name: 'Acme', colors: { primary: '#0a7' } } as Brand;

  it('emits the tag at body end', () => {
    const html = renderDocument(page, { brand, bodyHtml: '<p>x</p>', statsTag: tag() });
    expect(html).toMatch(/data-sw-stats="[^"]+"><\/script><\/body>/);
  });

  it('★ keeps it on a RAW-HTML page, which drops every other platform script', () => {
    const html = renderDocument(page, { brand, bodyHtml: '<p>x</p>', rawFidelity: true, scripts: ['core.js'], statsTag: tag() });
    expect(html).not.toContain('core.js');
    expect(html).toContain('data-sw-stats=');
  });
});

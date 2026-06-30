import { describe, expect, it } from 'vitest';
import { pagePath, pagesById } from '@sitewright/core';
import { buildRoutes } from '../src/transform/routes.js';
import { normalizePageUrl } from '../src/url-util.js';
import type { CapturedSite } from '../src/types.js';

function site(urls: string[]): CapturedSite {
  return {
    baseUrl: 'https://ex.com/',
    pages: urls.map((u) => ({ sourceUrl: u, html: '' })),
    assets: new Map(),
    origin: { kind: 'crawl', label: 'ex.com' },
  };
}

describe('buildRoutes', () => {
  it('builds a single-segment path + parent tree from deep URLs', () => {
    const r = buildRoutes(site(['https://ex.com/', 'https://ex.com/about', 'https://ex.com/services/web-design']));
    const byId = pagesById(r.pages);
    const home = r.pages.find((p) => p.path === '' && !p.parent)!;
    expect(home).toBeTruthy();
    const about = r.pages.find((p) => p.path === 'about')!;
    expect(about.parent).toBe(home.id); // a top-level page nests UNDER home (route still /about)
    expect(pagePath(about, byId)).toBe('/about');
    const web = r.pages.find((p) => p.path === 'web-design')!;
    const services = byId.get(web.parent!)!;
    expect(services.path).toBe('services');
    expect(services.parent).toBe(home.id); // the synthesized mid-level parent also nests under home
    expect(pagePath(web, byId)).toBe('/services/web-design');
    // The synthesized parent has no captured page but exists in the tree.
    expect(services).toBeTruthy();
  });

  it('maps captured URLs to their final routes for link rewriting', () => {
    const r = buildRoutes(site(['https://ex.com/', 'https://ex.com/services/web-design']));
    expect(r.internalRoutes.get(normalizePageUrl('https://ex.com/services/web-design')!)).toBe('/services/web-design');
  });

  it('assigns header nav from navLinks order when provided', () => {
    const urls = ['https://ex.com/', 'https://ex.com/about', 'https://ex.com/contact'];
    const r = buildRoutes(site(urls), { navLinks: [normalizePageUrl('https://ex.com/contact')!, normalizePageUrl('https://ex.com/about')!] });
    const contact = r.pages.find((p) => p.path === 'contact')!;
    const about = r.pages.find((p) => p.path === 'about')!;
    expect(contact.nav).toEqual({ slots: ['header'], order: 0 });
    expect(about.nav).toEqual({ slots: ['header'], order: 1 });
  });

  it('falls back to top-level captured pages for nav', () => {
    const r = buildRoutes(site(['https://ex.com/', 'https://ex.com/about', 'https://ex.com/services/web-design']));
    const about = r.pages.find((p) => p.path === 'about')!;
    expect(about.nav?.slots).toEqual(['header']);
    // nested + home are not auto-nav'd
    expect(r.pages.find((p) => p.path === 'web-design')!.nav).toBeUndefined();
    expect(r.pages.find((p) => p.path === '')!.nav).toBeUndefined();
  });

  it('de-duplicates colliding slugs under the same parent', () => {
    // Two distinct source segments slugifying to the same value under the same (root) parent.
    const r = buildRoutes(site(['https://ex.com/About', 'https://ex.com/about']));
    const slugs = r.pages.map((p) => p.path).filter(Boolean).sort();
    expect(slugs).toEqual(['about', 'about-2']);
    expect(r.diagnostics.some((d) => d.code === 'slug-deduped')).toBe(true);
    // ids are unique
    expect(new Set(r.pages.map((p) => p.id)).size).toBe(r.pages.length);
  });

  it('caps the number of nav entries at maxNav', () => {
    const urls = ['https://ex.com/', 'https://ex.com/a', 'https://ex.com/b'];
    const r = buildRoutes(site(urls), { navLinks: [normalizePageUrl('https://ex.com/a')!, normalizePageUrl('https://ex.com/b')!], maxNav: 1 });
    expect(r.pages.filter((p) => p.nav).length).toBe(1);
  });

  it('skips non-internal pages with a diagnostic', () => {
    const r = buildRoutes(site(['https://other.com/x']));
    expect(r.pages).toHaveLength(0);
    expect(r.diagnostics.some((d) => d.code === 'page-skipped')).toBe(true);
  });
});

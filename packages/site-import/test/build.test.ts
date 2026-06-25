import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { buildImportBundle } from '../src/build.js';
import type { CapturedSite, MediaPort } from '../src/types.js';

function stubMedia(): MediaPort {
  let n = 0;
  return { hostAsset: async () => ({ ref: `/media/test/${n++}.jpg` }) };
}

const HEADER =
  '<header><nav><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a></nav><img src="/logo.png" alt="logo"></header>';
const FOOTER = '<footer><p>© Acme</p><a href="/privacy">Privacy</a></footer>';

function page(title: string, main: string, headExtra = ''): string {
  return `<html><head><title>${title}</title>${headExtra}</head><body>${HEADER}<main>${main}</main>${FOOTER}</body></html>`;
}

function site(pages: { sourceUrl: string; html: string }[]): CapturedSite {
  return { baseUrl: 'https://ex.com/', pages, assets: new Map(), origin: { kind: 'crawl', label: 'ex.com' } };
}

const HOME_HEAD = '<meta property="og:site_name" content="Acme"><meta property="og:image" content="https://ex.com/og.jpg"><meta name="theme-color" content="#0a7">';

describe('buildImportBundle (integration)', () => {
  it('produces a faithful, self-contained, valid bundle from a multi-page site', async () => {
    const result = await buildImportBundle(
      site([
        { sourceUrl: 'https://ex.com/', html: page('Acme | Home', '<h1>Welcome</h1><script>track()</script>', HOME_HEAD) },
        { sourceUrl: 'https://ex.com/about', html: page('About', '<h2>About us</h2>', '<meta name="description" content="who we are">') },
        { sourceUrl: 'https://ex.com/contact', html: page('Contact', '<h2>Contact</h2>') },
      ]),
      { media: stubMedia() },
    );

    expect(result.bundles).toHaveLength(1);
    const bundle = result.bundles[0]!;

    // Every page source is validateTemplate-clean and script-free.
    for (const p of bundle.pages) {
      expect(() => validateTemplate(p.source ?? '')).not.toThrow();
      expect(p.source ?? '').not.toContain('<script');
    }
    // No bundle-level validation issues.
    expect(result.diagnostics.filter((d) => d.code === 'bundle-invalid')).toEqual([]);

    // Pages: home + about + contact.
    const home = bundle.pages.find((p) => p.path === '')!;
    const about = bundle.pages.find((p) => p.path === 'about')!;
    expect(home).toBeTruthy();
    expect(about.title).toBe('About');

    // Identity extracted from the home head.
    expect(bundle.project.identity.name).toBe('Acme');
    expect(bundle.project.identity.colors.primary).toBe('#0a7');
    expect(bundle.project.settings).toEqual({ defaultLocale: 'en', locales: ['en'] });

    // Shared chrome hoisted into slots (and removed from page bodies).
    expect(result.stats.chromeExtracted).toBe(true);
    expect(bundle.project.website?.topNav).toContain('href="/about"');
    expect(bundle.project.website?.topNav).toContain('/media/test/');
    expect(bundle.project.website?.footer).toContain('© Acme');
    expect(bundle.project.website?.topNav).not.toContain('<script');
    expect(bundle.project.website?.effects?.backToTop).toBe(true); // platform back-to-top enabled
    expect(home.source).toContain('Welcome');
    expect(home.source).not.toContain('© Acme');

    // Stats.
    expect(result.stats.imagesHosted).toBeGreaterThanOrEqual(1);
    expect(result.stats.scriptsDropped).toBeGreaterThanOrEqual(1);
  });

  it('publishes captured pages (draft stubs) with a swImport rewrite marker', async () => {
    const result = await buildImportBundle(
      site([
        { sourceUrl: 'https://ex.com/', html: page('Acme | Home', '<h1>Welcome</h1>', HOME_HEAD) },
        { sourceUrl: 'https://ex.com/about', html: page('About', '<h2>About</h2>') },
      ]),
      { media: stubMedia(), importedAt: '2026-06-20T00:00:00.000Z' },
    );
    const pages = result.bundles[0]!.pages;
    expect(pages.length).toBeGreaterThan(0);
    // Captured pages (real content, swImport marker) go live; synthesized stub parents stay draft.
    for (const p of pages) {
      const captured = !!(p.data as { swImport?: unknown } | undefined)?.swImport;
      expect(p.status).toBe(captured ? 'published' : 'draft');
    }
    const home = pages.find((p) => p.path === '')!;
    const marker = (home.data as { swImport?: { sourceUrl?: string; rewritten?: boolean; importedAt?: string } }).swImport;
    expect(marker).toEqual({ sourceUrl: 'https://ex.com/', rewritten: false, importedAt: '2026-06-20T00:00:00.000Z' });
  });

  it('labels a trilingual crawl with locales + translationGroups', async () => {
    const ALT = '<link rel="alternate" hreflang="en" href="https://ex.com/about"><link rel="alternate" hreflang="de" href="https://ex.com/de/about">';
    const result = await buildImportBundle(
      site([
        { sourceUrl: 'https://ex.com/', html: page('Acme', '<h1>Home</h1>', `${HOME_HEAD}<link rel="alternate" hreflang="de" href="https://ex.com/de/">`) },
        { sourceUrl: 'https://ex.com/about', html: page('About', '<h2>About</h2>', ALT) },
        { sourceUrl: 'https://ex.com/de/', html: page('Acme DE', '<h1>Startseite</h1>') },
        { sourceUrl: 'https://ex.com/de/about', html: page('Über uns', '<h2>Über uns</h2>', ALT) },
      ]),
      { media: stubMedia() },
    );
    const bundle = result.bundles[0]!;
    expect(bundle.project.settings).toEqual({ defaultLocale: 'en', locales: ['en', 'de'] });
    const deAbout = bundle.pages.find((p) => p.path === 'about' && p.locale === 'de')!;
    expect(deAbout).toBeTruthy();
    const enAbout = bundle.pages.find((p) => p.path === 'about' && !p.locale)!;
    expect(deAbout.translationGroup).toBe(enAbout.translationGroup); // same group links the variants
    // No validateProject failures (en /about and de /de/about are distinct routes).
    expect(result.diagnostics.filter((d) => d.code === 'bundle-invalid')).toEqual([]);
  });

  it('infers a dataset + {{#each}} loop from a repeated card grid', async () => {
    const cards = Array.from({ length: 5 }, (_, i) => `<article class="member"><img src="/p${i}.jpg"><h3>Person ${i}</h3><p>Role ${i}</p></article>`).join('');
    const result = await buildImportBundle(
      site([{ sourceUrl: 'https://ex.com/', html: page('Acme', `<h2>Our Team</h2><section class="team">${cards}</section>`, HOME_HEAD) }]),
      { media: stubMedia() },
    );
    const bundle = result.bundles[0]!;
    expect(bundle.datasets).toHaveLength(1);
    expect(bundle.datasets[0]!.slug).toBe('ourteam');
    expect(bundle.entries).toHaveLength(5);
    expect(bundle.entries.every((e) => e.dataset === 'ourteam')).toBe(true);
    const home = bundle.pages.find((p) => p.path === '')!;
    expect(home.source).toContain('{{#each dataset.ourteam}}');
    expect(home.source).not.toContain('Person 0'); // the literal cards are gone, replaced by the loop
    expect(() => validateTemplate(home.source!)).not.toThrow();
    expect(result.diagnostics.some((d) => d.code === 'dataset-inferred')).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === 'bundle-invalid')).toEqual([]);
  });

  it('inlines the full CSS as a <style> in the page source (accurate replica)', async () => {
    const result = await buildImportBundle(
      site([{ sourceUrl: 'https://ex.com/', html: page('Acme', '<h1>Welcome</h1>', '<style>.brand{color:#1565a8}</style>') }]),
      { media: stubMedia() },
    );
    const home = result.bundles[0]!.pages.find((p) => p.path === '')!;
    expect(home.source!.startsWith('<style>')).toBe(true);
    expect(home.source).toContain('.brand{color:#1565a8}');
    expect(result.bundles[0]!.project.website?.criticalCss).toBeUndefined(); // no longer in the bounded slot
  });

  it('EDITABLE path: hosts CSS as a linked stylesheet (out of source) when hostStylesheet is available', async () => {
    const media: MediaPort = { ...stubMedia(), hostStylesheet: async () => '/media/site/css1/styles.css' };
    const result = await buildImportBundle(
      site([{ sourceUrl: 'https://ex.com/', html: page('Acme', '<h1>Welcome</h1>', '<style>.brand{color:#1565a8}</style>') }]),
      { media },
    );
    const bundle = result.bundles[0]!;
    const home = bundle.pages.find((p) => p.path === '')!;
    expect(home.source).not.toContain('<style>'); // CSS is NOT inlined — page source stays editable markup
    expect(home.source).toContain('<h1>Welcome</h1>');
    expect(bundle.project.website?.head).toContain('<link rel="stylesheet" href="/media/site/css1/styles.css">');
  });

  it('falls back to body-only (css-overflow) when full CSS + content exceeds the source cap', async () => {
    const bigCss = '.x{color:red}'.repeat(60); // ~780 bytes, over the tiny cap below
    const result = await buildImportBundle(
      site([{ sourceUrl: 'https://ex.com/', html: page('Acme', '<h1>Welcome</h1>', `<style>${bigCss}</style>`) }]),
      { media: stubMedia(), limits: { maxSourceBytes: 320 } },
    );
    const home = result.bundles[0]!.pages.find((p) => p.path === '')!;
    expect(home.source).not.toContain('<style>'); // CSS omitted (would have blown the cap)
    expect(home.source).toContain('Welcome'); // content kept
    expect(result.diagnostics.some((d) => d.code === 'css-overflow')).toBe(true);
    expect(() => validateTemplate(home.source!)).not.toThrow();
  });

  it('drops an inferred dataset (no orphan, no leaked marker) when its container is truncated away', async () => {
    const cards = Array.from({ length: 6 }, (_, i) => `<article class="member"><img src="/p${i}.jpg"><h3>Person ${i}</h3><p>Role ${i}</p></article>`).join('');
    const result = await buildImportBundle(
      site([{ sourceUrl: 'https://ex.com/', html: page('Acme', `<h2>Our Team</h2><section class="team">${cards}</section>`, HOME_HEAD) }]),
      { media: stubMedia(), limits: { maxSourceBytes: 40 } }, // tiny → fitSource drops the grid container
    );
    const bundle = result.bundles[0]!;
    const home = bundle.pages.find((p) => p.path === '')!;
    expect(home.source).not.toContain('@@SWDS'); // the sentinel never leaks as visible text
    // Any dataset that wasn't actually wired into a page is dropped (no orphans).
    expect(bundle.entries.every((e) => bundle.datasets.some((d) => d.slug === e.dataset))).toBe(true);
    if (!home.source!.includes('{{#each')) expect(bundle.datasets).toHaveLength(0);
    expect(() => validateTemplate(home.source!)).not.toThrow();
  });

  it('does not extract chrome for a single page (keeps it inline)', async () => {
    const result = await buildImportBundle(
      site([{ sourceUrl: 'https://ex.com/', html: page('Solo', '<h1>Solo</h1>', HOME_HEAD) }]),
      { media: stubMedia() },
    );
    expect(result.stats.chromeExtracted).toBe(false);
    const home = result.bundles[0]!.pages[0]!;
    expect(home.source).toContain('© Acme'); // footer stays inline
    expect(() => validateTemplate(home.source ?? '')).not.toThrow();
  });

  it('falls back to a host-derived name and empty pages for an empty crawl', async () => {
    const result = await buildImportBundle(site([]), { media: stubMedia() });
    expect(result.bundles[0]!.pages).toHaveLength(0);
    expect(result.bundles[0]!.project.identity.name).toBe('Ex');
  });

  it('uses a generic name when the base URL is unparseable', async () => {
    const result = await buildImportBundle(
      { baseUrl: 'not-a-url', pages: [], assets: new Map(), origin: { kind: 'upload', label: 'bundle' } },
      { media: stubMedia() },
    );
    expect(result.bundles[0]!.project.identity.name).toBe('Website');
  });

  it('caps the number of pages and reports the truncation', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({ sourceUrl: `https://ex.com/p${i}`, html: page(`P${i}`, `<p>${i}</p>`) }));
    const result = await buildImportBundle(site(pages), { media: stubMedia(), limits: { maxPages: 3 } });
    expect(result.bundles[0]!.pages.length).toBeLessThanOrEqual(3);
    expect(result.diagnostics.some((d) => d.code === 'page-skipped')).toBe(true);
  });
});

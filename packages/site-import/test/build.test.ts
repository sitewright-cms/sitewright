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
    expect(home.source).toContain('Welcome');
    expect(home.source).not.toContain('© Acme');

    // Stats.
    expect(result.stats.imagesHosted).toBeGreaterThanOrEqual(1);
    expect(result.stats.scriptsDropped).toBeGreaterThanOrEqual(1);
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

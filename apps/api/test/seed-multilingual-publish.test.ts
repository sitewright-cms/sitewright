import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import {
  EXAMPLE_IDENTITY,
  EXAMPLE_WEBSITE,
  EXAMPLE_PAGES,
  EXAMPLE_DATASETS,
  EXAMPLE_ENTRIES,
  EXAMPLE_FORMS,
} from '../src/seed-data.js';

/**
 * End-to-end guard for the SEEDED German showcase: pushes the real demo content
 * (identity, datasets, German `services-de` entries, the `/de` locale-variant pages,
 * the language-switcher topNav) through the actual publish pipeline and asserts the
 * exported German pages carry `<html lang="de">`, the localized dataset, hreflang,
 * and a working switcher — so a future edit to the demo can't silently break the
 * multilingual story it exists to showcase.
 */
describe('seeded demo — German multilingual showcase publishes correctly', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'example';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-seed-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-seed-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Example Project', slug);

    const proj = client.project(projectId);
    // Mirror seed.ts (plus a siteUrl, so hreflang is emitted), then load every seed artifact.
    await proj.putContent('settings', 'settings', {
      identity: EXAMPLE_IDENTITY,
      website: { ...EXAMPLE_WEBSITE, siteUrl: 'https://northwind.example' },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    for (const dataset of EXAMPLE_DATASETS) {
      expect((await proj.putContent('dataset', dataset.id, dataset)).statusCode, dataset.id).toBe(200);
    }
    for (const entry of EXAMPLE_ENTRIES) {
      expect((await proj.putContent('entry', entry.id, entry)).statusCode, entry.id).toBe(200);
    }
    for (const form of EXAMPLE_FORMS) {
      expect((await proj.putContent('form', form.id, form)).statusCode, form.id).toBe(200);
    }
    for (const page of EXAMPLE_PAGES) {
      expect((await proj.putContent('page', page.id, page)).statusCode, page.id).toBe(200);
    }
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('renders the English home at the root with English service data', async () => {
    const en = await client.get(`/sites/${slug}/index.html`);
    expect(en.statusCode).toBe(200);
    expect(en.body).toContain('<html lang="en">');
    expect(en.body).toContain('Web Design'); // services (base) dataset
    expect(en.body).not.toContain('Webdesign'); // not the German variant
  });

  it('renders the German home at /de with lang=de and the localized service data', async () => {
    const de = await client.get(`/sites/${slug}/de/index.html`);
    expect(de.statusCode).toBe(200);
    expect(de.body).toContain('<html lang="de">'); // page.locale drives <html lang>
    expect(de.body).toContain('Websites, die Ihnen mehr Geschäft'); // German hero
    expect(de.body).toContain('Webdesign'); // data.services auto-resolved → services-de
    expect(de.body).not.toContain('Web Design');
  });

  it('renders the German Services page at /de/leistungen (slug + parent chain) from the services-de dataset', async () => {
    // The German Services page has slug `leistungen` and parents to the German home (`de`),
    // so its computed route is /de/leistungen (the localized URL).
    const de = await client.get(`/sites/${slug}/de/leistungen/index.html`);
    expect(de.statusCode).toBe(200);
    expect(de.body).toContain('<html lang="de">');
    expect(de.body).toContain('Strategie &amp; UX'); // German service title (HTML-escaped &)
    expect(de.body).toContain('Wartungspakete');
  });

  it('nests the service sub-pages under Services (page tree → nav dropdown + own routes)', async () => {
    // The sub-pages publish at their nested paths.
    const wd = await client.get(`/sites/${slug}/services/web-design/index.html`);
    expect(wd.statusCode).toBe(200);
    expect(wd.body).toContain('Web Design');
    expect((await client.get(`/sites/${slug}/services/seo/index.html`)).statusCode).toBe(200);
    // Services has dropdown:true → the nav renders it as a <details> with its children
    // (Web Design, SEO & Performance) nested — proving the parent/child tree is wired.
    const home = (await client.get(`/sites/${slug}/index.html`)).body;
    const nav = home.match(/menu menu-horizontal[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect(nav).toContain('<details>');
    expect(nav).toContain('Web Design');
    expect(nav).toContain('SEO &amp; Performance');
  });

  it('emits hreflang alternates + x-default for the linked home/services groups', async () => {
    const de = (await client.get(`/sites/${slug}/de/index.html`)).body;
    expect(de).toContain('<link rel="alternate" hreflang="en" href="https://northwind.example/" />');
    expect(de).toContain('<link rel="alternate" hreflang="de" href="https://northwind.example/de/" />');
    expect(de).toContain('<link rel="alternate" hreflang="x-default" href="https://northwind.example/" />');
  });

  it('shows the language switcher (page.translations) on grouped pages and hides it elsewhere', async () => {
    // The home is grouped → the switcher renders both locale links.
    const en = (await client.get(`/sites/${slug}/index.html`)).body;
    expect(en).toContain('aria-label="Language"');
    // The switcher link is a REAL link, rebased page-relative (from the root: "/de" → "de").
    expect(en).toContain('href="de"'); // points at the German home, portably
    expect(en).toMatch(/hreflang="de"[^>]*>de</); // switcher link to the German variant
    // The About page is English-only (ungrouped) → no switcher.
    const about = (await client.get(`/sites/${slug}/about/index.html`)).body;
    expect(about).not.toContain('aria-label="Language"');
  });
});

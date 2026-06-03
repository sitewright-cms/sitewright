import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: a project with locales ['en','de'] (default 'en') publishes the
// default locale at the site root and 'de' under /de/, using per-page translations
// with default-locale fallback, and locale-prefixed internal links.

describe('multilingual publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-i18n-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-i18n-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('emits per-locale output with translation, fallback, and locale-prefixed links', async () => {
    const proj = client.project(projectId);
    // Two locales; en is default.
    expect(
      (
        await proj.putContent('settings', 'settings', {
          brand: { name: 'Acme', colors: { primary: '#0a7' } },
          settings: { defaultLocale: 'en', locales: ['en', 'de'] },
        })
      ).statusCode,
    ).toBe(200);

    // Home + About, each with an internal link to the other.
    const home = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Section',
        children: [
          { id: 'h', type: 'Heading', props: { text: 'Welcome' } },
          { id: 'l', type: 'Link', props: { text: 'About', href: '/about' } },
        ],
      },
    };
    const about = {
      id: 'about',
      path: '/about',
      title: 'About',
      root: { id: 'r2', type: 'Section', children: [{ id: 'h2', type: 'Heading', props: { text: 'About us' } }] },
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'about', about)).statusCode).toBe(200);

    // A German translation of the HOME page only (About is untranslated → fallback).
    const homeDe = {
      id: 'home__de',
      pageId: 'home',
      locale: 'de',
      title: 'Startseite',
      root: {
        id: 'r',
        type: 'Section',
        children: [
          { id: 'h', type: 'Heading', props: { text: 'Willkommen' } },
          { id: 'l', type: 'Link', props: { text: 'Über uns', href: '/about' } },
        ],
      },
    };
    expect((await proj.putContent('translation', 'home__de', homeDe)).statusCode).toBe(200);

    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // Default locale at the site root, untouched (no /en/ prefix).
    const enHome = await client.get(`/sites/${slug}/index.html`);
    expect(enHome.statusCode).toBe(200);
    expect(enHome.body).toContain('Welcome');
    expect(enHome.body).toContain('href="about"'); // root-relative, no locale prefix
    expect(enHome.body).toContain('<html lang="en">');

    // German home uses the translated content + lang + a de-prefixed internal link.
    const deHome = await client.get(`/sites/${slug}/de/index.html`);
    expect(deHome.statusCode).toBe(200);
    expect(deHome.body).toContain('Willkommen');
    expect(deHome.body).not.toContain('Welcome');
    expect(deHome.body).toContain('<html lang="de">');
    // Portable relative link, routed via the site root, staying inside /de/:
    // from /de/index.html, ../de/about resolves to /de/about.
    expect(deHome.body).toContain('href="../de/about"');

    // German About FALLS BACK to the default-locale content (no translation),
    // but is still published under /de/about/.
    const deAbout = await client.get(`/sites/${slug}/de/about/index.html`);
    expect(deAbout.statusCode).toBe(200);
    expect(deAbout.body).toContain('About us'); // default content (fallback)
    expect(deAbout.body).toContain('<html lang="de">');
  });

  it('emits hreflang alternates (+ x-default) on every locale variant when a site URL is set', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#0a7' } },
      website: { siteUrl: 'https://acme.example' },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    await proj.putContent('page', 'home', { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // Both the en (root) and de variants carry the SAME alternate set (absolute URLs).
    for (const path of ['index.html', 'de/index.html']) {
      const html = (await client.get(`/sites/${slug}/${path}`)).body;
      expect(html).toContain('<link rel="alternate" hreflang="en" href="https://acme.example/" />');
      expect(html).toContain('<link rel="alternate" hreflang="de" href="https://acme.example/de/" />');
      expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://acme.example/" />');
    }
  });

  it('emits no hreflang for a single-locale site, or when no site URL is set', async () => {
    const proj = client.project(projectId);
    // Multilingual but no siteUrl → hreflang needs absolute URLs, so none.
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    await proj.putContent('page', 'home', { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${slug}/index.html`)).body).not.toContain('hreflang');

    // Single locale + siteUrl → still no hreflang (nothing to alternate to).
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#0a7' } },
      website: { siteUrl: 'https://acme.example' },
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${slug}/index.html`)).body).not.toContain('hreflang');
  });

  it('prefixes auto-nav links per locale and ignores a default-locale translation', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    // Two header-nav pages; home renders the auto-nav.
    await proj.putContent('page', 'home', {
      id: 'home',
      path: '/',
      title: 'Home',
      nav: { slots: ['header'], order: 1 },
      root: { id: 'r', type: 'Nav', props: { slot: 'header' } },
    });
    await proj.putContent('page', 'about', {
      id: 'about',
      path: '/about',
      title: 'About',
      nav: { slots: ['header'], order: 2 },
      root: { id: 'r2', type: 'Heading', props: { text: 'About' } },
    });
    // A translation stored for the DEFAULT locale must be ignored (default uses page.root).
    await proj.putContent('translation', 'home__en', {
      id: 'home__en',
      pageId: 'home',
      locale: 'en',
      root: { id: 'r', type: 'Heading', props: { text: 'SHOULD-NOT-APPEAR' } },
    });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // Default home: nav link to /about is root-relative, and the default-locale
    // translation was ignored (the Nav root, not the translated Heading, rendered).
    const enHome = await client.get(`/sites/${slug}/index.html`);
    expect(enHome.body).toContain('data-sw-block="Nav"');
    expect(enHome.body).toContain('href="about"');
    expect(enHome.body).not.toContain('SHOULD-NOT-APPEAR');

    // German home: the auto-nav link to /about is kept inside /de/.
    const deHome = await client.get(`/sites/${slug}/de/index.html`);
    expect(deHome.body).toContain('href="../de/about"');
  });

  it('rejects a publish where a page path collides with a locale prefix', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    // A page at /de collides with the 'de' locale's home (both → de/index.html).
    await proj.putContent('page', 'de-page', { id: 'de-page', path: '/de', title: 'DE', root: { id: 'r', type: 'Section' } });
    await proj.putContent('page', 'home', { id: 'home', path: '/', title: 'Home', root: { id: 'r2', type: 'Section' } });
    const res = await client.post(`${proj.base}/publish`);
    expect(res.statusCode).toBe(409); // PublishError → conflict, not a silent overwrite
    expect((res.json() as { error: string }).error).toMatch(/collision/i);
  });

  it('a single-locale project publishes only at the root (no locale prefix)', async () => {
    const proj = client.project(projectId);
    // Default project settings are { defaultLocale: 'en', locales: ['en'] }.
    const page = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }] },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${slug}/en/index.html`)).statusCode).toBe(404); // no prefix dir
  });
});

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
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-i18n-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-i18n-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
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
    const enHome = await client.get(`/sites/${projectId}/index.html`);
    expect(enHome.statusCode).toBe(200);
    expect(enHome.body).toContain('Welcome');
    expect(enHome.body).toContain('href="about"'); // root-relative, no locale prefix
    expect(enHome.body).toContain('<html lang="en">');

    // German home uses the translated content + lang + a de-prefixed internal link.
    const deHome = await client.get(`/sites/${projectId}/de/index.html`);
    expect(deHome.statusCode).toBe(200);
    expect(deHome.body).toContain('Willkommen');
    expect(deHome.body).not.toContain('Welcome');
    expect(deHome.body).toContain('<html lang="de">');
    // Portable relative link, routed via the site root, staying inside /de/:
    // from /de/index.html, ../de/about resolves to /de/about.
    expect(deHome.body).toContain('href="../de/about"');

    // German About FALLS BACK to the default-locale content (no translation),
    // but is still published under /de/about/.
    const deAbout = await client.get(`/sites/${projectId}/de/about/index.html`);
    expect(deAbout.statusCode).toBe(200);
    expect(deAbout.body).toContain('About us'); // default content (fallback)
    expect(deAbout.body).toContain('<html lang="de">');
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

    expect((await client.get(`/sites/${projectId}/index.html`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${projectId}/en/index.html`)).statusCode).toBe(404); // no prefix dir
  });
});

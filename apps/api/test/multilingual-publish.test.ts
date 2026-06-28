import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the document-level multilingual model (docs/i18n-content-model.md).
// A locale VARIANT of a page is its own Page (own path/title/locale), variants are
// linked by `translationGroup`. Each renders once at its own path with `<html lang>`;
// hreflang/x-default come from the group; datasets are duplicated per locale
// (`<slug>-<locale>`) and resolved by auto-suffix.

describe('multilingual publish (locale variants are pages)', () => {
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

  const root = { id: 'r', type: 'Section' as const };

  it('renders each locale variant once at its own path, with its own lang + content', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    // The English (default) home and its German variant — separate pages, linked by group.
    await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root, translationGroup: 'home',
      source: '<section><h1>Welcome</h1></section>',
    });
    await proj.putContent('page', 'home-de', {
      id: 'home-de', path: 'de', parent: 'home', title: 'Startseite', locale: 'de', translationGroup: 'home', root,
      source: '<section><h1>Willkommen</h1></section>',
    });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const en = await client.get(`/sites/${slug}/index.html`);
    expect(en.body).toContain('<html lang="en">');
    expect(en.body).toContain('Welcome');

    const de = await client.get(`/sites/${slug}/de/index.html`);
    expect(de.statusCode).toBe(200);
    expect(de.body).toContain('<html lang="de">'); // page.locale drives lang
    expect(de.body).toContain('Willkommen');
    expect(de.body).not.toContain('Welcome');
  });

  it('emits hreflang + x-default from the translation group (with a site URL)', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      website: { siteUrl: 'https://acme.example' },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: '<h1>Hi</h1>' });
    await proj.putContent('page', 'home-de', { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root, source: '<h1>Hallo</h1>' });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    for (const path of ['index.html', 'de/index.html']) {
      const html = (await client.get(`/sites/${slug}/${path}`)).body;
      expect(html).toContain('<link rel="alternate" hreflang="en" href="https://acme.example/" />');
      expect(html).toContain('<link rel="alternate" hreflang="de" href="https://acme.example/de/" />');
      expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://acme.example/" />');
    }
  });

  it('emits no hreflang for an ungrouped page or when no site URL is set', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    // Grouped variants but no siteUrl → hreflang needs absolute URLs → none.
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: '<h1>Hi</h1>' });
    await proj.putContent('page', 'home-de', { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root, source: '<h1>Hallo</h1>' });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${slug}/index.html`)).body).not.toContain('hreflang');
  });

  it('auto-resolves data.<name> to the <name>-<locale> dataset for a locale variant', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    // Two datasets: the base and its German duplicate (underscore suffix — a dataset slug is a Handlebars path).
    await proj.putContent('dataset', 'services', { id: 'services', name: 'Services', slug: 'services', fields: [{ name: 'name', type: 'text' }] });
    await proj.putContent('dataset', 'services_de', { id: 'services_de', name: 'Services (DE)', slug: 'services_de', fields: [{ name: 'name', type: 'text' }] });
    await proj.putContent('entry', 'svc_en', { id: 'svc_en', dataset: 'services', status: 'published', values: { name: 'Web Design' } });
    await proj.putContent('entry', 'svc_de', { id: 'svc_de', dataset: 'services_de', status: 'published', values: { name: 'Webdesign' } });

    // The SAME source on both locale variants — auto-suffix picks the right dataset.
    const listSource = '<ul>{{#each dataset.services}}<li>{{ name }}</li>{{/each}}</ul>';
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: listSource });
    await proj.putContent('page', 'home-de', { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root, source: listSource });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    expect((await client.get(`/sites/${slug}/index.html`)).body).toContain('<li>Web Design</li>'); // base
    const de = (await client.get(`/sites/${slug}/de/index.html`)).body;
    expect(de).toContain('<li>Webdesign</li>'); // resolved services_de
    expect(de).not.toContain('Web Design');
  });

  it('resolves a {{sw-form}} embed to the <id>-<locale> form variant on an INHERIT-mode page (shared code, localized form)', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    const form = {
      fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
      successMessage: 'Thanks!', errorMessage: 'Oops.', recipient: 'leads@acme.test', mode: 'globalSmtp', hcaptcha: false,
    };
    await proj.putContent('form', 'contact', { ...form, id: 'contact', name: 'Contact', submitLabel: 'Send' });
    await proj.putContent('form', 'contact-de', { ...form, id: 'contact-de', name: 'Kontakt', submitLabel: 'Absenden' });
    await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Contact us', root, translationGroup: 'home',
      source: '<section>{{sw-form "contact"}}</section>',
    });
    // INHERIT mode: the German variant carries NO source/template — it renders the owner's code,
    // and the embed pass localizes the form via page.locale (the dataset suffix convention).
    await proj.putContent('page', 'home-de', {
      id: 'home-de', path: 'de', parent: 'home', title: 'Kontakt', locale: 'de', translationGroup: 'home', root,
    });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const en = (await client.get(`/sites/${slug}/index.html`)).body;
    expect(en).toContain('data-sw-endpoint="/f/' + projectId + '/contact"');
    expect(en).toContain('>Send</button>');
    const de = (await client.get(`/sites/${slug}/de/index.html`)).body;
    expect(de).toContain('data-sw-endpoint="/f/' + projectId + '/contact-de"');
    expect(de).toContain('>Absenden</button>');
  });

  it('exposes {{ page.locale }} and {{#each page.translations}} for a language switcher', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    const switcher = '<p>{{ page.locale }}</p><ul>{{#each page.translations}}<a href="{{sw-url path}}">{{ locale }}</a>{{/each}}</ul>';
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: switcher });
    await proj.putContent('page', 'home-de', { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root, source: switcher });
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const en = (await client.get(`/sites/${slug}/index.html`)).body;
    expect(en).toContain('<p>en</p>');
    expect(en).toContain('>en</a>');
    expect(en).toContain('>de</a>'); // links to the German variant
    const de = (await client.get(`/sites/${slug}/de/index.html`)).body;
    expect(de).toContain('<p>de</p>');
  });

  it('rejects a publish where two pages resolve to the same URL', async () => {
    const proj = client.project(projectId);
    await proj.putContent('page', 'a', { id: 'a', path: 'x', title: 'A', root, source: '<p>a</p>' });
    await proj.putContent('page', 'b', { id: 'b', path: 'x', title: 'B', root, source: '<p>b</p>' });
    const res = await client.post(`${proj.base}/publish`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/collision|duplicate/i);
  });
});

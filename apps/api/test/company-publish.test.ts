import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: corporate identity (the company.* namespace) stored in the
// settings singleton must flow through publish into auto schema.org JSON-LD and
// the favicon of the exported site — closing the gap the publish-portability
// suite surfaced (renderer supported it; there was no data source/wiring).

const home = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi', level: 1 } }] },
};

describe('company → schema.org + favicon on publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'classcar';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-company-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-company-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('ClassCar', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function putSettings(company: Record<string, unknown> | undefined) {
    const proj = client.project(projectId);
    const payload = {
      brand: { name: 'ClassCar', colors: { primary: '#e11' } },
      ...(company ? { company } : {}),
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect((await proj.putContent('settings', 'settings', payload)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
  }

  async function publishAndFetchHome(): Promise<string> {
    const pub = await client.post(`${client.project(projectId).base}/publish`);
    expect(pub.statusCode).toBe(200);
    const res = await client.get(`/sites/${slug}/index.html`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('emits schema.org Organization JSON-LD from company data, and a favicon from company.icon', async () => {
    await putSettings({
      businessType: 'Organization',
      legalName: 'ClassCar Hire CC',
      telephone: '+264-81-660-0188',
      email: 'info@classcar.com.na',
      icon: '/brand/icon.png',
      address: { locality: 'Windhoek', region: 'Khomas', country: 'NA' },
      geo: { latitude: '-22.5', longitude: '17.0' },
      social: ['https://facebook.com/classcar'],
    });
    const html = await publishAndFetchHome();

    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"name":"ClassCar Hire CC"');
    expect(html).toContain('"telephone":"+264-81-660-0188"');
    expect(html).toContain('"addressLocality":"Windhoek"');
    expect(html).toContain('"sameAs":["https://facebook.com/classcar"]');
    // favicon comes from company.icon, rebased relative to the home page root.
    expect(html).toContain('rel="icon" href="brand/icon.png"');
  });

  it('omits schema.org JSON-LD when no company is set', async () => {
    await putSettings(undefined);
    const html = await publishAndFetchHome();
    expect(html).not.toContain('application/ld+json');
  });

  it('omits schema.org JSON-LD when businessType is "disabled" (any case)', async () => {
    await putSettings({ businessType: 'DISABLED', legalName: 'ClassCar Hire CC' });
    const html = await publishAndFetchHome();
    expect(html).not.toContain('application/ld+json');
  });

  it('upgrades a legacy {brand,company} settings payload to a unified identity on store (format v2 migration)', async () => {
    const proj = client.project(projectId);
    const legacy = {
      brand: { name: 'ClassCar', colors: { primary: '#e11' }, logo: { favicon: '/fav.ico', light: '/light.svg' } },
      company: { legalName: 'ClassCar Hire CC', icon: '/brand/icon.png', social: ['https://x.com/cc'] },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect((await proj.putContent('settings', 'settings', legacy)).statusCode).toBe(200);
    const item = ((await proj.getContent('settings', 'settings')).json() as { item: Record<string, unknown> }).item;
    // The split brand/company keys are gone; everything lands in one identity record.
    expect(item.brand).toBeUndefined();
    expect(item.company).toBeUndefined();
    expect(item.identity).toMatchObject({
      name: 'ClassCar', // from brand.name
      legalName: 'ClassCar Hire CC', // from company
      icon: '/brand/icon.png', // company.icon
      favicon: '/fav.ico', // brand.logo.favicon
      logoLight: '/light.svg', // brand.logo.light
      colors: { primary: '#e11' }, // brand tokens
      social: [{ link: 'https://x.com/cc', name: 'X', icon: 'brand:x' }], // string[] migrated to objects
    });
  });

  it('falls back to company.image for og:image, and a page image overrides it', async () => {
    await putSettings({ legalName: 'ClassCar', image: '/brand/og.png' });
    expect(await publishAndFetchHome()).toContain('property="og:image" content="brand/og.png"');

    // A page-level image takes precedence over the company image.
    const withPageOg = { ...home, image: '/page/og.png' };
    expect((await client.project(projectId).putContent('page', 'home', withPageOg)).statusCode).toBe(200);
    const html = await publishAndFetchHome();
    expect(html).toContain('property="og:image" content="page/og.png"');
    // Assert on the og:image META specifically: company.image still legitimately
    // appears in the schema.org JSON-LD `image` field, so a bare-substring check
    // would be a false negative.
    expect(html).not.toContain('property="og:image" content="brand/og.png"');
  });

  it('preserves company across an import → export round-trip', async () => {
    const proj = client.project(projectId);
    const company = { legalName: 'Imported Co', businessType: 'LocalBusiness', social: ['https://x.io/co'] };
    const imp = await proj.importBundle({
      project: { identity: { name: 'B', colors: {}, ...company }, settings: { defaultLocale: 'en', locales: ['en'] } },
      pages: [home],
    });
    expect(imp.statusCode).toBe(200);
    const exp = await proj.exportBundle();
    expect(exp.statusCode).toBe(200);
    expect((exp.json() as { project: { identity: unknown } }).project.identity).toMatchObject({
      legalName: 'Imported Co',
      businessType: 'LocalBusiness',
      social: [{ link: 'https://x.io/co', name: 'X', icon: 'globe' }], // string[] migrated (x.io is an unknown host)
    });
  });

  it('substitutes {{ company.* }} / {{ website.* }} / {{ page.* }} variables in published text', async () => {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      brand: { name: 'ClassCar', colors: { primary: '#e11' } },
      company: { legalName: 'ClassCar Hire CC' },
      // head is a raw blob exposed only to the <head> — NOT via a variable.
      website: { siteUrl: 'https://classcar.example', head: '<meta name="x" content="head-only" />' },
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    await proj.putContent('page', 'home', {
      id: 'home',
      path: '',
      title: 'Welcome',
      root: {
        id: 'r',
        type: 'Section',
        children: [
          { id: 'h', type: 'Heading', props: { text: '© {{ company.legalName }} — {{ page.title }}', level: 2 } },
          { id: 't', type: 'RichText', props: { text: 'Visit {{ website.siteUrl }} · {{ company.unknown }} · {{ website.head }}' } },
        ],
      },
    });
    const html = await publishAndFetchHome();
    expect(html).toContain('© ClassCar Hire CC — Welcome'); // company + page vars
    expect(html).toContain('Visit https://classcar.example'); // website.siteUrl (the public field)
    expect(html).toContain('{{ company.unknown }}'); // unknown var left literal, not blanked
    // `website.*` exposes ONLY siteUrl: the raw head blob is not reachable as a
    // variable — the placeholder stays literal in the RichText body.
    const body = html.slice(html.indexOf('<body'));
    expect(body).toContain('{{ website.head }}'); // not substituted in the body
    expect(body).not.toContain('head-only'); // the raw blob never reaches page text
  });
});

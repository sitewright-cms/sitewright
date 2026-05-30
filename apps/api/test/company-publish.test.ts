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
  path: '/',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi', level: 1 } }] },
};

describe('company → schema.org + favicon on publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-company-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-company-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('ClassCar', 'classcar');
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
    const res = await client.get(`/sites/${projectId}/index.html`);
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

  it('omits schema.org JSON-LD when businessType is "disabled"', async () => {
    await putSettings({ businessType: 'disabled', legalName: 'ClassCar Hire CC' });
    const html = await publishAndFetchHome();
    expect(html).not.toContain('application/ld+json');
  });
});

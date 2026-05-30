import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: project-wide website settings (the website.* namespace) — critical
// CSS + custom head/footer HTML — stored in the settings singleton must flow
// through publish into the exported document head/body.

const home = {
  id: 'home',
  path: '/',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi', level: 1 } }] },
};

describe('website settings → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-website-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-website-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('ClassCar', 'classcar');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function putSettings(website: Record<string, unknown> | undefined) {
    const proj = client.project(projectId);
    const payload = {
      brand: { name: 'ClassCar', colors: { primary: '#e11' } },
      ...(website ? { website } : {}),
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

  it('inlines critical CSS and injects custom head/footer into the exported site', async () => {
    await putSettings({
      criticalCss: '.hero{color:#e11}',
      customHead: '<!-- plausible-analytics -->',
      customFooter: '<script id="cf">/*footer*/</script>',
    });
    const html = await publishAndFetchHome();

    expect(html).toContain('<style>.hero{color:#e11}</style>');
    expect(html).toContain('<!-- plausible-analytics -->');
    expect(html).toContain('<script id="cf">/*footer*/</script>');
    // critical CSS sits in <head>; footer sits before </body>
    expect(html.indexOf('.hero{color:#e11}')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('id="cf"')).toBeGreaterThan(html.indexOf('</head>'));
  });

  it('omits the optional website injections when not configured', async () => {
    await putSettings(undefined);
    const html = await publishAndFetchHome();
    expect(html).not.toContain('plausible-analytics');
    expect(html).not.toContain('<style>.hero');
  });

  it('preserves website settings across an import → export round-trip', async () => {
    const proj = client.project(projectId);
    const website = { criticalCss: '.x{}', customHead: '<meta name="x">', customFooter: '<b>f</b>' };
    const imp = await proj.importBundle({
      project: { brand: { name: 'B', colors: {} }, website, settings: { defaultLocale: 'en', locales: ['en'] } },
      pages: [home],
    });
    expect(imp.statusCode).toBe(200);
    const exp = await proj.exportBundle();
    expect(exp.statusCode).toBe(200);
    expect((exp.json() as { project: { website: unknown } }).project.website).toEqual(website);
  });
});

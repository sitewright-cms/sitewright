import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: reusable page layouts (templates). A page references a template;
// at publish the template's tree wraps the page, with the page content injected
// at the template's Outlet. Templates may themselves use partials.

function templatePage(templateId: string) {
  return {
    id: 'home',
    path: '/',
    title: 'Home',
    template: templateId,
    root: { id: 'pr', type: 'Section', children: [{ id: 'ph', type: 'Heading', props: { text: 'Page Body', level: 1 } }] },
  };
}

describe('templates → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-tmpl-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-tmpl-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function publishHome(): Promise<string> {
    const pub = await client.post(`${client.project(projectId).base}/publish`);
    expect(pub.statusCode).toBe(200);
    const res = await client.get(`/sites/${projectId}/index.html`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('wraps the page content in the template layout (Outlet replaced, order preserved)', async () => {
    const proj = client.project(projectId);
    const template = {
      id: 'main',
      name: 'Main Layout',
      root: {
        id: 'lay',
        type: 'Section',
        children: [
          { id: 'lh', type: 'Heading', props: { text: 'LAYOUT HEADER', level: 2 } },
          { id: 'out', type: 'Outlet' },
          { id: 'lf', type: 'Heading', props: { text: 'LAYOUT FOOTER', level: 2 } },
        ],
      },
    };
    expect((await proj.putContent('template', 'main', template)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', templatePage('main'))).statusCode).toBe(200);

    const html = await publishHome();
    expect(html).toContain('LAYOUT HEADER');
    expect(html).toContain('Page Body');
    expect(html).toContain('LAYOUT FOOTER');
    expect(html.indexOf('LAYOUT HEADER')).toBeLessThan(html.indexOf('Page Body'));
    expect(html.indexOf('Page Body')).toBeLessThan(html.indexOf('LAYOUT FOOTER'));
  });

  it('expands a partial used inside a template', async () => {
    const proj = client.project(projectId);
    expect(
      (await proj.putContent('partial', 'cta', { id: 'cta', name: 'CTA', root: { id: 'cr', type: 'Heading', props: { text: 'SHARED CTA', level: 3 } } })).statusCode,
    ).toBe(200);
    const template = {
      id: 'main',
      name: 'Main',
      root: { id: 'lay', type: 'Section', children: [{ id: 'pref', type: 'Section', partialRef: 'cta' }, { id: 'out', type: 'Outlet' }] },
    };
    expect((await proj.putContent('template', 'main', template)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', templatePage('main'))).statusCode).toBe(200);

    const html = await publishHome();
    expect(html).toContain('SHARED CTA');
    expect(html).toContain('Page Body');
  });

  it('rejects publishing a page with an unknown template (409)', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', templatePage('ghost'))).statusCode).toBe(200);
    const pub = await client.post(`${proj.base}/publish`);
    expect(pub.statusCode).toBe(409);
  });

  it('rejects importing a bundle whose page references an unknown template (409 unknown_template)', async () => {
    const res = await client.project(projectId).importBundle({ pages: [templatePage('ghost')] });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('unknown_template');
  });

  it('rejects importing duplicate template ids (409 duplicate_template_id)', async () => {
    const t1 = { id: 'dup', name: 'A', root: { id: 'a', type: 'Section', children: [{ id: 'o', type: 'Outlet' }] } };
    const t2 = { id: 'dup', name: 'B', root: { id: 'b', type: 'Section', children: [{ id: 'o2', type: 'Outlet' }] } };
    const res = await client.project(projectId).importBundle({ templates: [t1, t2] });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('duplicate_template_id');
  });

  it('rejects importing a template that references an unknown partial (409 unknown_partial)', async () => {
    const template = { id: 'main', name: 'Main', root: { id: 'lay', type: 'Section', children: [{ id: 'p', type: 'Section', partialRef: 'ghost' }, { id: 'o', type: 'Outlet' }] } };
    const res = await client.project(projectId).importBundle({ templates: [template] });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('unknown_partial'); // proves validateProject now checks template trees
  });

  it('round-trips templates through import → export', async () => {
    const proj = client.project(projectId);
    const template = { id: 'main', name: 'Main', root: { id: 'lay', type: 'Section', children: [{ id: 'out', type: 'Outlet' }] } };
    expect((await proj.importBundle({ templates: [template], pages: [templatePage('main')] })).statusCode).toBe(200);
    const exp = await proj.exportBundle();
    expect(exp.statusCode).toBe(200);
    expect((exp.json() as { templates: unknown[] }).templates).toContainEqual(template);
  });
});

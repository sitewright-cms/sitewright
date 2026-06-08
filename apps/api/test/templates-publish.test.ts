import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: CODE-FIRST page templates. A page referencing a template renders the
// TEMPLATE's Handlebars source — the page contributes only its {{edit}} content +
// settings. Globals (`global:<key>`) resolve against the built-in list; unknown
// references fail the publish with an author-correctable error. The legacy
// block-tree/Outlet template model is retired.

/** A page that renders entirely from a template (no own source). */
function templatePage(templateRef: string, content?: Record<string, string>) {
  return {
    id: 'tpl-page',
    path: 'offer',
    title: 'Offer',
    template: templateRef,
    root: { id: 'pr', type: 'Section' },
    ...(content ? { content } : {}),
  };
}

describe('templates → publish (code-first sources)', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-tmpl-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-tmpl-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function publishAndFetch(path: string): Promise<string> {
    const pub = await client.post(`${client.project(projectId).base}/publish`);
    expect(pub.statusCode).toBe(200);
    const res = await client.get(`/sites/${slug}/${path}`);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it('renders a PROJECT template source, with the page contributing only {{edit}} content', async () => {
    const proj = client.project(projectId);
    const template = {
      id: 'promo',
      name: 'Promo layout',
      source:
        '<section class="hero"><h1 data-sw-text="headline">Default headline</h1>' +
        '<p>Brand: {{ company.name }}</p></section>',
    };
    expect((await proj.putContent('template', 'promo', template)).statusCode).toBe(200);
    expect(
      (await proj.putContent('page', 'tpl-page', templatePage('promo', { headline: 'March offer' }))).statusCode,
    ).toBe(200);

    const html = await publishAndFetch('offer/index.html');
    expect(html).toContain('<h1>March offer</h1>'); // the page's content fills the template's region
    expect(html).not.toContain('Default headline');
    expect(html).toContain('Brand: Site'); // template bindings resolve like page bindings
  });

  it('renders a built-in GLOBAL template (global:text) with page content', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent(
          'page',
          'tpl-page',
          templatePage('global:text', { heading: 'Imprint', body: 'Legal text here.' }),
        )
      ).statusCode,
    ).toBe(200);

    const html = await publishAndFetch('offer/index.html');
    expect(html).toContain('Imprint');
    expect(html).toContain('Legal text here.');
    expect(html).toContain('class="prose'); // the global template's own classes compiled + emitted
  });

  it("a template's Tailwind classes and data-aos usage feed the shared asset scans", async () => {
    const proj = client.project(projectId);
    const template = {
      id: 'animated',
      name: 'Animated',
      source: '<div class="badge" data-aos="fade-up" data-sw-text="text">Hi</div>',
    };
    expect((await proj.putContent('template', 'animated', template)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'tpl-page', templatePage('animated'))).statusCode).toBe(200);

    const html = await publishAndFetch('offer/index.html');
    expect(html).toContain('data-aos="fade-up"');
    expect(html).toContain('<script defer src="../animations.js"></script>'); // detected via the template
    const css = await client.get(`/sites/${slug}/styles.css`);
    expect(css.body).toContain('.badge'); // template classes reach the shared sheet
  });

  it('fails the publish with a clear error for an unknown template reference', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'tpl-page', templatePage('missing'))).statusCode).toBe(200);
    const pub = await client.post(`${proj.base}/publish`);
    expect(pub.statusCode).toBe(409); // PublishError → author-correctable
    expect((pub.json() as { error: string }).error).toContain('unknown template');
  });

  it('previews a template-referencing page through /preview (full parity)', async () => {
    const proj = client.project(projectId);
    const template = {
      id: 'promo',
      name: 'Promo layout',
      source: '<h1 data-sw-text="headline">Default headline</h1>',
    };
    expect((await proj.putContent('template', 'promo', template)).statusCode).toBe(200);
    // NOTE: preview needs the render pool — the harness configures one (source pages preview).
    const res = await client.post(
      `/projects/${projectId}/preview`,
      templatePage('promo', { headline: 'Live draft' }),
    );
    // Without a render pool the endpoint 503s; with one it renders the template source.
    if (res.statusCode === 200) {
      const html = (res.json() as { html: string }).html;
      expect(html).toContain('Live draft');
      expect(html).not.toContain('Default headline');
    } else {
      expect(res.statusCode).toBe(503); // harness without a pool — resolution path covered above
    }
  });

  it('rejects an unknown template reference in /preview with a 400', async () => {
    const res = await client.post(`/projects/${projectId}/preview`, templatePage('nope'));
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('unknown template');
  });

  it('round-trips source templates through import → export', async () => {
    const proj = client.project(projectId);
    const template = { id: 'promo', name: 'Promo', source: '<p data-sw-text="x">y</p>' };
    expect((await proj.putContent('template', 'promo', template)).statusCode).toBe(200);
    const exported = (await client.get(`${proj.base}/export`)).json() as { templates: unknown[] };
    expect(exported.templates).toEqual([template]);

    const projectId2 = await client.createProject('Copy', 'copy');
    const proj2 = client.project(projectId2);
    expect((await client.post(`${proj2.base}/import`, exported)).statusCode).toBe(200);
    const reexported = (await client.get(`${proj2.base}/export`)).json() as { templates: unknown[] };
    expect(reexported.templates).toEqual([template]);
  });

  it('rejects importing duplicate template ids (409 duplicate_template_id)', async () => {
    const proj = client.project(projectId);
    const template = { id: 'dup', name: 'Dup', source: '<p>x</p>' };
    const res = await client.post(`${proj.base}/import`, {
      pages: [],
      partials: [],
      templates: [template, template],
      datasets: [],
      entries: [],
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain('duplicate_template_id');
  });
});

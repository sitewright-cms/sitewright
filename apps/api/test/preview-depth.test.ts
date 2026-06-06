import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entry } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

// Depth coverage for the live editor PREVIEW endpoint at the HTTP layer.
//
// EXTENDS apps/api/test/preview-api.test.ts (which already covers: basic full
// document render, 401 anon, 403 cross-tenant, 400 invalid page, hostile-content
// escaping, brand var + draft inclusion in a single case). This suite fills the
// gaps WITHOUT repeating those exact assertions:
//   - the draft INCLUSION *difference* vs a real published build (preview shows a
//     draft entry; the published /sites artifact omits it) — proving BOTH sides;
//   - preview reflecting the CURRENT SAVED page (PUT then preview again);
//   - brand sourced from the SETTINGS singleton (vs the project) end-to-end;
//   - a richer themed-document assertion (doctype + :root brand var + escaped
//     content together);
//   - hostile content escaping for a *saved-then-previewed* heading;
//   - cross-tenant 403 AND anonymous 401 in the harness-driven style.
//
// Uses the shared harness. `publishRoot` is supplied so the draft-difference case
// can publish + read the public /sites/<projectId>/ artifact (mirrors
// publish-api.test.ts / collection-routing.test.ts).

let harness: Harness;
let publishRoot: string;
let client: TestClient;
let project: ProjectClient;
let base: string;
const slug = 'preview-depth-site';

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-preview-depth-'));
  harness = await makeHarness({ publishRoot });
  client = await harness.signup();
  const projectId = await client.createProject('Site', slug);
  project = client.project(projectId);
  base = project.base;
});

afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
});

/** POSTs a page tree to the preview endpoint for this client's project. */
function preview(payload: unknown) {
  return client.post(`${base}/preview`, payload);
}

/** Reads the `{ html }` body from a successful preview response. */
function previewHtml(res: { json: () => unknown }): string {
  return (res.json() as { html: string }).html;
}

const savedHomePage = {
  id: 'home',
  path: '',
  title: 'Home',
  root: {
    id: 'r',
    type: 'Section',
    children: [{ id: 'h', type: 'Heading', props: { text: 'Original Heading', level: 1 } }],
  },
};

describe('preview endpoint — depth', () => {
  it('renders a full themed HTML document: doctype, brand :root var, and escaped content together', async () => {
    // Brand lives in the settings singleton (see case below); set a recognizable color.
    await project.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#0a0b0c' } },
      settings: {},
    });

    const res = await preview({
      id: 'p',
      path: 'p',
      title: 'Themed & "Quoted" Title',
      root: {
        id: 'r',
        type: 'Section',
        children: [{ id: 'h', type: 'Heading', props: { text: 'A & B < C', level: 2 } }],
      },
    });

    expect(res.statusCode).toBe(200);
    const html = previewHtml(res);
    // Full, self-contained themed document.
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<style>');
    // Brand :root CSS var compiled from the settings singleton.
    expect(html).toContain(':root {');
    expect(html).toContain('--sw-color-primary: #0a0b0c;');
    // Page content is HTML-escaped (safe for the sandboxed iframe).
    expect(html).toContain('A &amp; B &lt; C');
    expect(html).not.toContain('A & B < C');
    // The <title> escapes HTML-text-significant chars (& < >). Quotes are LEFT
    // literal — title is element text, not an attribute (escapeHtml, not escapeAttr).
    expect(html).toContain('<title>Themed &amp; "Quoted" Title</title>');
  });

  it('DRAFT difference: preview shows a draft list entry, but the published artifact omits it', async () => {
    // A dataset with one PUBLISHED and one DRAFT entry.
    await project.putContent('dataset', 'posts', {
      id: 'posts',
      name: 'Posts',
      slug: 'posts',
      fields: [{ name: 'title', type: 'text', required: true }],
    });
    const published: Entry = {
      id: 'post-pub',
      dataset: 'posts',
      status: 'published',
      values: { title: 'Published Post' },
    } as Entry;
    const draft: Entry = {
      id: 'post-draft',
      dataset: 'posts',
      status: 'draft',
      values: { title: 'Draft Post' },
    } as Entry;
    await project.putContent('entry', published.id, published);
    await project.putContent('entry', draft.id, draft);

    // A home page whose Grid list-binds the posts dataset and renders each title.
    const listPage = {
      id: 'home',
      path: '',
      title: 'Blog',
      root: {
        id: 'r',
        type: 'Grid',
        binding: { dataset: 'posts', mode: 'list' },
        children: [{ id: 'c', type: 'Heading', props: { textField: 'title' } }],
      },
    };

    // --- PREVIEW SIDE: includeDrafts === true → BOTH entries appear. ---
    const res = await preview(listPage);
    expect(res.statusCode).toBe(200);
    const previewDoc = previewHtml(res);
    expect(previewDoc).toContain('Published Post');
    expect(previewDoc).toContain('Draft Post'); // draft IS shown in preview

    // --- PUBLISHED SIDE: same project, same page → draft EXCLUDED. ---
    // Save the page so the publish build picks it up, then publish + serve.
    await project.putContent('page', listPage.id, listPage);
    const pub = await client.post(`${base}/publish`);
    expect(pub.statusCode).toBe(200);

    const served = await harness.app.inject({
      method: 'GET',
      url: `/sites/${slug}/`,
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toContain('text/html');
    expect(served.body).toContain('Published Post');
    expect(served.body).not.toContain('Draft Post'); // draft OMITTED from the published build
  });

  it('reflects the CURRENT saved page: edit via PUT, preview again, see the change', async () => {
    // Save an initial page, preview it (in-flight tree == saved tree).
    await project.putContent('page', savedHomePage.id, savedHomePage);
    const first = await preview(savedHomePage);
    expect(first.statusCode).toBe(200);
    expect(previewHtml(first)).toContain('Original Heading');

    // Edit the page content via PUT, then preview the NEW saved tree.
    const editedPage = {
      ...savedHomePage,
      root: {
        id: 'r',
        type: 'Section',
        children: [{ id: 'h', type: 'Heading', props: { text: 'Edited Heading', level: 1 } }],
      },
    };
    const put = await project.putContent('page', editedPage.id, editedPage);
    expect(put.statusCode).toBe(200);

    const second = await preview(editedPage);
    expect(second.statusCode).toBe(200);
    const html = previewHtml(second);
    expect(html).toContain('Edited Heading');
    expect(html).not.toContain('Original Heading'); // the previous content is gone
  });

  it('uses the brand from the settings singleton (set via PUT settings → preview shows the color var)', async () => {
    const page = {
      id: 'p',
      path: 'p',
      title: 'P',
      root: { id: 'r', type: 'Section', children: [] },
    };

    // A new project is seeded with a DEFAULT blue brand, so the preview already carries
    // a primary var (the default), but not our custom color yet.
    const before = await preview(page);
    expect(before.statusCode).toBe(200);
    expect(previewHtml(before)).not.toContain('--sw-color-primary: #123456;');

    // PUT the settings singleton with a brand primary color.
    const setRes = await project.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#123456' } },
      settings: {},
    });
    expect(setRes.statusCode).toBe(200);

    // After: the preview document carries the brand color var from settings.
    const after = await preview(page);
    expect(after.statusCode).toBe(200);
    expect(previewHtml(after)).toContain('--sw-color-primary: #123456;');

    // Update the brand again → preview re-themes from the single source of truth.
    await project.putContent('settings', 'settings', {
      brand: { name: 'Acme', colors: { primary: '#abc123' } },
      settings: {},
    });
    const updated = await preview(page);
    expect(previewHtml(updated)).toContain('--sw-color-primary: #abc123;');
    expect(previewHtml(updated)).not.toContain('--sw-color-primary: #123456;');
  });

  it('escapes hostile content in a SAVED page when previewed (safe for the sandboxed iframe)', async () => {
    const hostilePage = {
      id: 'home',
      path: '',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Section',
        children: [
          {
            id: 'h',
            type: 'Heading',
            props: { text: '<script>alert(document.cookie)</script>', level: 1 },
          },
        ],
      },
    };
    // Persist it (round-trips through content storage), then preview.
    await project.putContent('page', hostilePage.id, hostilePage);

    const res = await preview(hostilePage);
    expect(res.statusCode).toBe(200);
    const html = previewHtml(res);
    // The raw <script> must NOT survive into the markup.
    expect(html).not.toContain('<script>alert(document.cookie)</script>');
    // It is rendered as escaped, inert text inside the heading.
    expect(html).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
  });

  it('cross-tenant: tenant B cannot preview tenant A’s project (403/404); anonymous → 401', async () => {
    const page = {
      id: 'p',
      path: 'p',
      title: 'P',
      root: { id: 'r', type: 'Section', children: [] },
    };

    // A second, isolated tenant via the shared harness.
    const tenantB = await harness.signup();
    const crossTenant = await tenantB.post(`${base}/preview`, page);
    // resolveProject -> tenantContext rejects non-membership with 403; a project not
    // in the org would surface as 404. Accept either denial — never a 200.
    expect([403, 404]).toContain(crossTenant.statusCode);

    // Anonymous (no session cookie) → 401.
    const anon = await harness.app.inject({
      method: 'POST',
      url: `${base}/preview`,
      payload: page,
    });
    expect(anon.statusCode).toBe(401);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: an Icon block inlines its Lucide SVG into the published page
// (only the used icon ships — no icon-font download).

describe('icon block → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-icon-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-icon-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('inlines the icon SVG into the exported HTML', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Section',
        children: [{ id: 'i', type: 'Icon', props: { name: 'phone', size: 20, label: 'Call us' } }],
      },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const res = await client.get(`/sites/${slug}/index.html`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg data-sw-block="Icon"');
    expect(res.body).toContain('width="20"');
    expect(res.body).toContain('role="img"');
    expect(res.body).toContain('aria-label="Call us"');
    expect(res.body).toContain('stroke="currentColor"');
  });

  it('inlines a brand/social icon (simple-icons) into the exported HTML', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Footer',
        children: [
          { id: 'gh', type: 'Icon', props: { name: 'brand:github' } },
          { id: 'ig', type: 'Icon', props: { name: 'brand:instagram', brandColor: true } },
        ],
      },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const res = await client.get(`/sites/${slug}/index.html`);
    expect(res.statusCode).toBe(200);
    // GitHub icon: fill-based, themeable (currentColor), titled for a11y.
    expect(res.body).toContain('aria-label="GitHub"');
    expect(res.body).toContain('fill="currentColor"');
    expect(res.body).toContain('<path d="M12 .297'); // the real GitHub path
    // Instagram with brandColor uses the official hex; no icon-font request.
    expect(res.body).toContain('aria-label="Instagram"');
    expect(res.body).toMatch(/fill="#[0-9a-f]{6}"/);
    expect(res.body).not.toContain('stroke="currentColor"'); // brand icons aren't stroke-based
  });
});

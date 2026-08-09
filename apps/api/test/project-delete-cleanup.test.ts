import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: deleting a project removes its on-disk published site + media
// directories (no DB-level cascade for files — see ProjectRepository.remove +
// the best-effort cleanup in the delete route). Closes the MEDIUM/HIGH-for-SaaS
// orphaned-artifacts finding from the project-delete-cascade review.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWDELCLEANUPBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content, tail]),
  };
}

const page = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi', level: 1 } }] },
};

describe('project delete — on-disk cleanup', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-del-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-del-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    // An instance admin (can both create a project and run the permanent reap).
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('retains on-disk dirs on SOFT-delete, then removes them on the permanent REAP', async () => {
    const proj = client.project(projectId);

    // Publish a site (creates publishRoot/<slug>/) ...
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(200);

    // ... and upload media (creates mediaRoot/<slug>/<assetId>/).
    const up = await client.inject({ method: 'POST', url: `${proj.base}/media`, ...multipart('a.png', 'image/png', PNG_1X1) });
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: { id: string; url: string } }).item;
    expect((await client.get(asset.url)).statusCode).toBe(200);

    // Positive proof: both directories exist on disk (published site AND media, both keyed by slug).
    expect(existsSync(join(publishRoot, slug))).toBe(true);
    expect(existsSync(join(mediaRoot, slug))).toBe(true);

    // SOFT-delete: the page goes offline (404) but the on-disk dirs are RETAINED so it can be restored.
    expect((await client.del(`/projects/${projectId}`)).statusCode).toBe(204);
    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(404);
    expect(existsSync(join(publishRoot, slug))).toBe(true);
    expect(existsSync(join(mediaRoot, slug))).toBe(true);

    // Permanent REAP (admin): NOW the directories are removed from disk (not merely 404'd)...
    expect((await client.del(`/admin/deleted-projects/${projectId}`)).statusCode).toBe(204);
    expect(existsSync(join(publishRoot, slug))).toBe(false);
    expect(existsSync(join(mediaRoot, slug))).toBe(false);
    // ... and the served URLs 404.
    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(404);
    expect((await client.get(asset.url)).statusCode).toBe(404);
  });
});

// A SLUG RENAME is the third path that strands built output, and the one that was missed. Media moves
// with the project and the old media dir is dropped; the published site used to be left behind under a
// slug nothing points at any more — unreachable (serving resolves the project's CURRENT slug) but not
// harmless: a full, unserved copy of a customer's site sitting on disk, one per rename, forever.
// Measured on a real instance: 46 published directories, 4 actually served, 2 outliving their projects.
describe('slug rename — on-disk cleanup', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-ren-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-ren-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Site', 'before');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('drops the OLD slug’s built output instead of stranding it', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect(existsSync(join(publishRoot, 'before'))).toBe(true);
    expect((await client.get('/sites/before/index.html')).statusCode).toBe(200);

    const renamed = await client.inject({
      method: 'PATCH',
      url: `/projects/${projectId}`,
      payload: { slug: 'after' },
    });
    expect(renamed.statusCode).toBe(200);

    // The stale directory is GONE — not merely unreachable.
    expect(existsSync(join(publishRoot, 'before'))).toBe(false);
    expect((await client.get('/sites/before/index.html')).statusCode).toBe(404);
    // …and the new slug serves nothing until it is republished, which is honest: the build is derived,
    // and republishing is what regenerates it. Silently reviving stale bytes under a new name would be
    // worse than a 404.
    expect(existsSync(join(publishRoot, 'after'))).toBe(false);
    expect((await client.get('/sites/after/index.html')).statusCode).toBe(404);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect((await client.get('/sites/after/index.html')).statusCode).toBe(200);
  });

  it('leaves the built output alone when only the NAME changes', async () => {
    // Renaming the display name must not cost the site — only a SLUG change moves what is keyed by slug.
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    const renamed = await client.inject({ method: 'PATCH', url: `/projects/${projectId}`, payload: { name: 'New Name' } });
    expect(renamed.statusCode).toBe(200);
    expect(existsSync(join(publishRoot, 'before'))).toBe(true);
    expect((await client.get('/sites/before/index.html')).statusCode).toBe(200);
  });
});

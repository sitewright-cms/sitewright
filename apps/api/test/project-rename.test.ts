import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: PATCH /projects/:id renames a project's NAME and/or SLUG. A slug change rewrites every
// `/media/<slug>/…` reference in content AND moves the on-disk media dir, so nothing 404s.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);
function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWRENAMEBOUNDARY';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]) };
}

describe('PATCH /projects/:id — rename name + slug', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let mediaRoot: string;

  beforeEach(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-rename-media-'));
    harness = await makeHarness({ mediaRoot });
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Site', 'site');
  });
  afterEach(async () => {
    await harness.close();
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('renames the slug: rewrites content media refs, moves the media dir, and updates the row', async () => {
    const proj = client.project(projectId);
    // A page whose source references media under the current slug.
    const page = { id: 'home', path: '', title: 'Home', source: '<section><img src="/media/site/abc/a.png" alt="x" loading="lazy"></section>' };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    // Upload media → creates mediaRoot/site/<assetId>/.
    const up = await client.inject({ method: 'POST', url: `${proj.base}/media`, ...multipart('a.png', 'image/png', PNG_1X1) });
    expect(up.statusCode).toBe(201);
    expect(existsSync(join(mediaRoot, 'site'))).toBe(true);

    const res = await client.inject({ method: 'PATCH', url: `/projects/${projectId}`, payload: { name: 'Renamed', slug: 'renamed' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().project).toMatchObject({ id: projectId, name: 'Renamed', slug: 'renamed' });

    // Content ref rewritten site → renamed.
    const got = await proj.getContent('page', 'home');
    expect(got.json().item.source).toContain('/media/renamed/abc/a.png');
    expect(got.json().item.source).not.toContain('/media/site/');
    // Media dir moved.
    expect(existsSync(join(mediaRoot, 'renamed'))).toBe(true);
    expect(existsSync(join(mediaRoot, 'site'))).toBe(false);
    // Row updated (re-fetch).
    expect((await client.get(`/projects/${projectId}`)).json().project.slug).toBe('renamed');
  });

  it('renames the NAME only (no slug change) and syncs identity.name', async () => {
    const proj = client.project(projectId);
    const res = await client.inject({ method: 'PATCH', url: `/projects/${projectId}`, payload: { name: 'New Name' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().project).toMatchObject({ name: 'New Name', slug: 'site' });
    expect((await proj.getContent('settings', 'settings')).json().item.identity.name).toBe('New Name');
  });

  it('rejects a slug already taken by another project (409, no changes)', async () => {
    await client.createProject('Other', 'taken');
    const res = await client.inject({ method: 'PATCH', url: `/projects/${projectId}`, payload: { slug: 'taken' } });
    expect(res.statusCode).toBe(409);
    expect((await client.get(`/projects/${projectId}`)).json().project.slug).toBe('site');
  });

  it('rejects a slug held by a SOFT-DELETED project with the finer, actionable message', async () => {
    const goneId = await client.createProject('Gone', 'gone');
    expect((await client.inject({ method: 'DELETE', url: `/projects/${goneId}` })).statusCode).toBe(204); // soft-delete keeps the slug
    const res = await client.inject({ method: 'PATCH', url: `/projects/${projectId}`, payload: { slug: 'gone' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/deleted project is holding this slug/);
    expect((await client.get(`/projects/${projectId}`)).json().project.slug).toBe('site');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { content as contentTable } from '../src/db/schema.js';

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

  it('renames despite LEGACY orphaned entries, and migrates their media refs too', async () => {
    const proj = client.project(projectId);
    // Plant an orphan directly: an entry under a dataset scope that does not exist. The product can no
    // longer create one (see no-orphan-entries.test.ts), but databases in the field already hold them —
    // one project had 336 — so a rename must still migrate them rather than choke. Re-putting such a row
    // through the AUTHORING path throws ("references unknown dataset"), which is precisely what used to
    // abort a project rename half-way, after settings + pages were committed to the new slug.
    const now = new Date();
    await harness.db.insert(contentTable).values({
      id: 'legacy-orphan-row',
      projectId,
      kind: 'entry',
      entityId: 'row1',
      scope: 'ghost_dataset',
      data: { id: 'row1', dataset: 'ghost_dataset', values: { img: '/media/site/abc/a.png' } },
      createdAt: now,
      updatedAt: now,
    });

    const res = await client.inject({ method: 'PATCH', url: `/projects/${projectId}`, payload: { slug: 'renamed' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.slug).toBe('renamed');
    // The orphan's media reference migrated as well: the rewrite covers every row of the project, not
    // an allow-list of kinds, and does not re-validate fields it is not touching.
    const got = await client.get(`${proj.base}/content/entry/row1?dataset=ghost_dataset`);
    expect(got.statusCode).toBe(200);
    expect(got.json().item.values.img).toBe('/media/renamed/abc/a.png');
  });

  it('a REJECTED rename leaves the project completely intact — slug AND media references', async () => {
    const proj = client.project(projectId);
    const source = '<img src="/media/site/abc/a.png" alt="x">';
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', source });
    await proj.putContent('settings', 'settings', {
      identity: { name: 'Site', logo: '/media/site/abc/a.png' },
      settings: { locale: 'en' },
    });
    await client.createProject('Other', 'taken');

    const res = await client.inject({ method: 'PATCH', url: `/projects/${projectId}`, payload: { slug: 'taken' } });
    expect(res.statusCode).toBe(409);

    // The invariant that matters: a failed rename must not leave content pointing at a slug the project
    // does not have. Before the fix the rewrite ran BEFORE the row flip, so a late failure stranded
    // pages + settings on the new slug and every image 404ed.
    expect((await client.get(`/projects/${projectId}`)).json().project.slug).toBe('site');
    expect((await proj.getContent('page', 'home')).json().item.source).toBe(source);
    expect((await proj.getContent('settings', 'settings')).json().item.identity.logo).toBe('/media/site/abc/a.png');
    // …and no stray media directory is left behind for the slug that was never claimed.
    expect(existsSync(join(mediaRoot, 'taken'))).toBe(false);
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

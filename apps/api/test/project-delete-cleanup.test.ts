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
  path: '/',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi', level: 1 } }] },
};

describe('project delete — on-disk cleanup', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-del-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-del-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('removes the published-site and media directories when the project is deleted', async () => {
    const proj = client.project(projectId);

    // Publish a site (creates publishRoot/<projectId>/) ...
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${projectId}/index.html`)).statusCode).toBe(200);

    // ... and upload media (creates mediaRoot/<projectId>/<assetId>/).
    const up = await client.inject({ method: 'POST', url: `${proj.base}/media`, ...multipart('a.png', 'image/png', PNG_1X1) });
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: { id: string; url: string } }).item;
    expect((await client.get(asset.url)).statusCode).toBe(200);

    // Positive proof: both directories exist on disk before delete.
    expect(existsSync(join(publishRoot, projectId))).toBe(true);
    expect(existsSync(join(mediaRoot, projectId))).toBe(true);

    // Delete the project.
    expect((await client.del(`/orgs/${client.orgId}/projects/${projectId}`)).statusCode).toBe(204);

    // The on-disk directories are gone (not merely 404 at the HTTP layer)...
    expect(existsSync(join(publishRoot, projectId))).toBe(false);
    expect(existsSync(join(mediaRoot, projectId))).toBe(false);
    // ... and the served URLs 404.
    expect((await client.get(`/sites/${projectId}/index.html`)).statusCode).toBe(404);
    expect((await client.get(asset.url)).statusCode).toBe(404);
  });
});

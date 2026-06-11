import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

// A tiny but valid 1x1 PNG — enough for the sharp pipeline to decode and optimize
// (avoids a direct `sharp` dependency in the API package just for tests).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-media-api-'));
  app = await createApp({ db: await makeTestDb(), mediaRoot });
  await app.ready();
});
afterEach(async () => {
  await rm(mediaRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, slug = 'site') {
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'Pw-secret-1' },
  });
  const t = token(reg);
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId, slug };
}

function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWTESTBOUNDARY';
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

describe('media API', () => {
  it('uploads → optimizes → lists → serves → deletes an image', async () => {
    const { t, projectId, slug } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    const up = await app.inject({
      method: 'POST',
      url: `${base}/media`,
      cookies,
      ...multipart('red.png', 'image/png', PNG_1X1),
    });
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: { id: string; url: string; variants: unknown[] } }).item;
    expect(asset.variants.length).toBeGreaterThan(0);
    // The public URL is keyed by the project's SLUG (not its UUID) + the asset id.
    expect(asset.url).toMatch(/^\/media\/site\/[\w-]+\/[\w-]+\.jpg$/);
    expect(asset.url.startsWith(`/media/${slug}/${asset.id}/`)).toBe(true);
    // …and the on-disk mount mirrors that URL exactly: `<mediaRoot>/<slug>/<assetId>/` (NOT the UUID).
    expect(existsSync(join(mediaRoot, slug, asset.id))).toBe(true);
    expect(existsSync(join(mediaRoot, projectId))).toBe(false);

    const list = await app.inject({ method: 'GET', url: `${base}/media`, cookies });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);

    // The served binary is publicly fetchable (no auth) and is an image.
    const served = await app.inject({ method: 'GET', url: asset.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.rawPayload.length).toBeGreaterThan(0);

    const del = await app.inject({ method: 'DELETE', url: `${base}/media/${asset.id}`, cookies });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: asset.url });
    expect(after.statusCode).toBe(404);
  });

  it('rejects writing media via the generic content endpoint (must use /media)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/media/forged`,
      cookies: { sw_session: t },
      payload: {
        id: 'forged',
        filename: 'x.png',
        format: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
        variants: [],
        fallback: 'x-1.jpg',
        url: '/media/other-project/forged/x-1.jpg',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('stores a non-image upload as a downloadable file asset (attachment + nosniff)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    const up = await app.inject({
      method: 'POST',
      url: `${base}/media`,
      cookies,
      ...multipart('notes.txt', 'text/plain', Buffer.from('this is not an image')),
    });
    expect(up.statusCode).toBe(201);
    const asset = (up.json() as { item: { kind: string; url: string; storedName: string; contentType: string; bytes: number } }).item;
    expect(asset.kind).toBe('file');
    expect(asset.contentType).toBe('text/plain');
    expect(asset.url).toMatch(/^\/media\/[\w-]+\/[\w-]+\/file\/notes\.txt$/);

    // Served download-only: octet-stream + attachment + nosniff (never inline on this origin).
    const served = await app.inject({ method: 'GET', url: asset.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('application/octet-stream');
    expect(served.headers['content-disposition']).toContain('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.rawPayload.toString()).toBe('this is not an image');
  });

  it('files an upload under a virtual folder (and rejects an unsafe folder)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    const ok = await app.inject({
      method: 'POST',
      url: `${base}/media?folder=${encodeURIComponent('Docs/2026')}`,
      cookies,
      ...multipart('brochure.pdf', 'application/pdf', Buffer.from('%PDF-1.4 fake')),
    });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { item: { folder: string } }).item.folder).toBe('Docs/2026');

    const bad = await app.inject({
      method: 'POST',
      url: `${base}/media?folder=${encodeURIComponent('../escape')}`,
      cookies,
      ...multipart('red.png', 'image/png', PNG_1X1),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('requires authentication to upload', async () => {
    const { projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media`,
      ...multipart('red.png', 'image/png', PNG_1X1),
    });
    expect(res.statusCode).toBe(401);
  });

  it('forbids uploading to / listing another tenant’s project', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    const upload = await app.inject({
      method: 'POST',
      url: `/projects/${a.projectId}/media`,
      cookies: { sw_session: b.t },
      ...multipart('red.png', 'image/png', PNG_1X1),
    });
    expect(upload.statusCode).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/media`,
      cookies: { sw_session: b.t },
    });
    expect(list.statusCode).toBe(403);
  });
});

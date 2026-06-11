import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

// A tiny but valid 1x1 PNG — enough for the sharp pipeline to decode and optimize.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-importurl-'));
  app = await createApp({ db: await makeTestDb(), mediaRoot });
  await app.ready();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup(email = 'importer@e2e.test', slug = 'site') {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'Pw-secret-1' } });
  const t = token(reg);
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}
const fetchReturning = (body: Buffer, contentType: string, contentLength?: number) =>
  vi.fn(async () => {
    const headers: Record<string, string> = { 'content-type': contentType };
    if (contentLength !== undefined) headers['content-length'] = String(contentLength);
    return new Response(body, { headers });
  });

describe('POST /projects/:projectId/media/import-url', () => {
  it('downloads + self-hosts a remote IMAGE as an optimized media asset', async () => {
    vi.stubGlobal('fetch', fetchReturning(PNG_1X1, 'image/png'));
    const { t, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/import-url`,
      cookies: { sw_session: t },
      payload: { url: 'https://cdn.example.com/photo.png' },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item.kind).toBe('image');
    expect(item.filename).toBe('photo.png');
    expect(item.url.startsWith('/media/site/')).toBe(true); // media keyed by slug ('site'), not project id
  });

  it('stores a non-image download as a file asset', async () => {
    vi.stubGlobal('fetch', fetchReturning(Buffer.from('%PDF-1.4 ...'), 'application/pdf'));
    const { t, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/import-url`,
      cookies: { sw_session: t },
      payload: { url: 'https://cdn.example.com/doc.pdf', folder: 'Docs' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().item).toMatchObject({ kind: 'file', folder: 'Docs', contentType: 'application/pdf' });
  });

  it('rejects a private-host URL (SSRF guard) without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { t, projectId } = await setup();
    for (const url of ['https://127.0.0.1/x.png', 'https://localhost/x.png', 'http://cdn.example.com/x.png']) {
      const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url } });
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an SVG download (consistent with the upload route)', async () => {
    vi.stubGlobal('fetch', fetchReturning(Buffer.from('<svg/>'), 'image/svg+xml'));
    const { t, projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url: 'https://cdn.example.com/x.svg' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/SVG/);
  });

  it('rejects an over-cap download with 413 (content-length), matching the upload route', async () => {
    vi.stubGlobal('fetch', fetchReturning(PNG_1X1, 'image/png', 20 * 1024 * 1024));
    const { t, projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url: 'https://cdn.example.com/big.png' } });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatch(/size limit/);
  });

  it('is 403 for a cross-tenant request (importer not a member of the other project)', async () => {
    vi.stubGlobal('fetch', fetchReturning(PNG_1X1, 'image/png'));
    const a = await setup('owner-a@e2e.test', 'site-a');
    const b = await setup('owner-b@e2e.test', 'site-b');
    // user B's session against user A's project → blocked before any fetch.
    const res = await app.inject({ method: 'POST', url: `/projects/${a.projectId}/media/import-url`, cookies: { sw_session: b.t }, payload: { url: 'https://cdn.example.com/x.png' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects when the remote responds non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const { t, projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url: 'https://cdn.example.com/missing.png' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/download failed/);
  });

  it('rejects a corrupt image (createMediaAsset → MediaValidationError)', async () => {
    // content-type says image but the bytes aren't a decodable image → the sharp pipeline rejects it.
    vi.stubGlobal('fetch', fetchReturning(Buffer.from('not really a png'), 'image/png'));
    const { t, projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url: 'https://cdn.example.com/broken.png' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a download whose fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const { t, projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url: 'https://cdn.example.com/x.png' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/could not fetch/);
  });

  it('rejects an invalid body (missing/!url)', async () => {
    const { t, projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url: 'not-a-url' } });
    expect(res.statusCode).toBe(400);
  });

  it('requires auth (401 without a session)', async () => {
    const { projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, payload: { url: 'https://cdn.example.com/x.png' } });
    expect(res.statusCode).toBe(401);
  });
});

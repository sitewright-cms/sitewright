import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// A tiny but valid 1x1 PNG (decodable by sharp).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#0a7"/></svg>';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-flat-serve-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup(email: string, slug = 'site') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id, slug };
}
function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWTESTBOUNDARY';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]) };
}
async function upload(projectId: string, t: string, filename: string, mime: string, content: Buffer) {
  const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media`, cookies: { sw_session: t }, ...multipart(filename, mime, content) });
  return res.json() as { item: { id: string; url: string; kind: string } };
}

describe('flat media delivery route (/media/<slug>/<id>-<name>)', () => {
  it('serves an uploaded IMAGE: flat URL + responsive thumbnail / original', async () => {
    const { t, projectId } = await setup('img@flat.test');
    const { item } = await upload(projectId, t, 'photo.png', 'image/png', PNG_1X1);
    expect(item.url).toMatch(/^\/media\/site\/[0-9A-Za-z]{6}-photo\.(png|webp)$/); // flat, one segment

    // Bare fetch → the default (xl) WebP thumbnail.
    const xl = await app.inject({ method: 'GET', url: item.url });
    expect(xl.statusCode).toBe(200);
    expect(xl.headers['content-type']).toBe('image/webp');
    // ?size=sm → still a WebP thumbnail; ?size=original → the retained original (png).
    expect((await app.inject({ method: 'GET', url: `${item.url}?size=sm` })).headers['content-type']).toBe('image/webp');
    const orig = await app.inject({ method: 'GET', url: `${item.url}?size=original` });
    expect(orig.statusCode).toBe(200);
    expect(orig.headers['content-type']).toMatch(/^image\/png/);
  });

  it('SECURITY: a raw-uploaded .js (kind:file) is served DOWNLOAD-ONLY, never inline JS', async () => {
    const { t, projectId } = await setup('js@flat.test');
    const { item } = await upload(projectId, t, 'evil.js', 'text/javascript', Buffer.from('window.pwned = 1'));
    expect(item.kind).toBe('file');
    expect(item.url).toMatch(/^\/media\/site\/[0-9A-Za-z]{6}-evil\.js$/);

    const served = await app.inject({ method: 'GET', url: item.url });
    expect(served.statusCode).toBe(200);
    // Dispatched on the stored kind:'file' — NOT the .js extension → octet-stream + attachment.
    expect(served.headers['content-type']).toBe('application/octet-stream');
    expect(served.headers['content-disposition']).toContain('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-type']).not.toContain('javascript');
  });

  it('a raw-uploaded PDF (kind:file) is served INLINE application/pdf under a frame-safe CSP', async () => {
    const { t, projectId } = await setup('pdf@flat.test');
    const { item } = await upload(projectId, t, 'brochure.pdf', 'application/pdf', Buffer.from('%PDF-1.4 fake'));
    const served = await app.inject({ method: 'GET', url: item.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('application/pdf');
    expect(served.headers['content-disposition']).toBeUndefined(); // inline, not an attachment
    expect(served.headers['content-security-policy']).toMatch(/frame-ancestors/);
  });

  it('an uploaded SVG (kind:image) is served INLINE under a locked-down CSP + revalidating ETag (304)', async () => {
    const { t, projectId } = await setup('svg@flat.test');
    const { item } = await upload(projectId, t, 'logo.svg', 'image/svg+xml', Buffer.from(SVG));
    expect(item.url).toMatch(/-logo\.svg$/);
    const served = await app.inject({ method: 'GET', url: item.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(served.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(served.headers['cache-control']).toBe('no-cache');
    const etag = served.headers.etag as string;
    expect(etag).toBeTruthy();
    // A conditional re-request with the same validator → 304 Not Modified.
    const revalidated = await app.inject({ method: 'GET', url: item.url, headers: { 'if-none-match': etag } });
    expect(revalidated.statusCode).toBe(304);
  });

  it('a SHORT (flat) id is rejected on the legacy 3-/4-segment routes (no extension-dispatch bypass)', async () => {
    const { t, projectId, slug } = await setup('legacy@flat.test');
    const { item } = await upload(projectId, t, 'photo.png', 'image/png', PNG_1X1);
    const [id, name] = [item.url.split('/').pop()!.split('-')[0]!, item.url.split('-').slice(1).join('-')];
    // Crafting the legacy 3-seg / 4-seg URL for a flat (short-id) asset must 404 — it can only be served
    // by the kind-dispatching flat route, never the extension-dispatching legacy routes.
    expect((await app.inject({ method: 'GET', url: `/media/${slug}/${id}/${name}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/media/${slug}/${id}/file/${name}` })).statusCode).toBe(404);
  });

  it('404s malformed flat paths (no id-hyphen, non-short id, unknown asset)', async () => {
    const { t, projectId, slug } = await setup('x@flat.test');
    await upload(projectId, t, 'photo.png', 'image/png', PNG_1X1); // ensure the project dir exists
    // No hyphen → not a flat media file.
    expect((await app.inject({ method: 'GET', url: `/media/${slug}/nodash.png` })).statusCode).toBe(404);
    // The id token before the hyphen is not a 6-char base62 id.
    expect((await app.inject({ method: 'GET', url: `/media/${slug}/toolongid-x.png` })).statusCode).toBe(404);
    // Well-formed short id, but no such asset.
    expect((await app.inject({ method: 'GET', url: `/media/${slug}/zzZZ99-photo.png` })).statusCode).toBe(404);
  });
});

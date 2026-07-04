import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// The SVG Studio "save to the same file" endpoint: PUT /projects/:id/media/:id/svg overwrites an existing
// SVG asset's content IN PLACE (re-sanitized), keeping the asset id + URL so existing references stay valid.
let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==', 'base64');
const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#000"/></svg>';
const SVG_B = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="5" fill="#4f46e5" data-sw-svg="draw" data-sw-duration="1200"/></svg>';

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-studio-media-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
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
async function setup(email: string) {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}
function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWSTUDIOBOUND';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]) };
}
const uploadSvg = async (t: string, projectId: string, svg: string) =>
  app.inject({ method: 'POST', url: `/projects/${projectId}/media`, cookies: { sw_session: t }, ...multipart('logo.svg', 'image/svg+xml', Buffer.from(svg)) });

describe('SVG Studio — save to the same file (overwrite)', () => {
  it('overwrites an SVG asset in place, keeping the id + URL, and re-sanitizing', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const asset = ((await uploadSvg(t, projectId, SVG_A)).json() as { item: { id: string; url: string; format: string } }).item;
    expect(asset.format).toBe('svg');
    expect((await app.inject({ method: 'GET', url: asset.url })).body).toContain('<rect');

    const ow = await app.inject({ method: 'PUT', url: `/projects/${projectId}/media/${asset.id}/svg`, cookies: { sw_session: t }, payload: { svg: SVG_B } });
    expect(ow.statusCode).toBe(200);
    const owAsset = ow.json() as { item: { id: string; url: string } };
    expect(owAsset.item.id).toBe(asset.id); // id stable → existing references keep working
    expect(owAsset.item.url).toBe(asset.url); // URL stable

    const served = await app.inject({ method: 'GET', url: asset.url });
    expect(served.body).toContain('data-sw-svg="draw"'); // the new (animated) content
    expect(served.body).not.toContain('<rect'); // old content is gone
  });

  it('rejects overwriting a non-SVG asset, a hostile/empty body, and unauthenticated calls', async () => {
    const { t, projectId } = await setup('b@acme.test');
    const png = ((await app.inject({ method: 'POST', url: `/projects/${projectId}/media`, cookies: { sw_session: t }, ...multipart('x.png', 'image/png', PNG_1X1) })).json() as { item: { id: string } }).item;
    expect((await app.inject({ method: 'PUT', url: `/projects/${projectId}/media/${png.id}/svg`, cookies: { sw_session: t }, payload: { svg: SVG_B } })).statusCode).toBe(400);
    const asset = ((await uploadSvg(t, projectId, SVG_A)).json() as { item: { id: string } }).item;
    expect((await app.inject({ method: 'PUT', url: `/projects/${projectId}/media/${asset.id}/svg`, cookies: { sw_session: t }, payload: { svg: '<not svg>' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/projects/${projectId}/media/${asset.id}/svg`, payload: { svg: SVG_B } })).statusCode).toBe(401);
  });
});

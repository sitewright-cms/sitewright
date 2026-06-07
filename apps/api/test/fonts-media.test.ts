import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-fontmedia-'));
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
async function setup(email = 'fonts@e2e.test', slug = 'site') {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'pw-secret-1' } });
  const t = token(reg);
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}
/** A single-file multipart body. */
function multipart(bytes: Buffer, filename = 'font.woff2', contentType = 'font/woff2') {
  const boundary = '----swfontmedia';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  return { payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const woff2Bytes = (s = 'x') => Buffer.concat([Buffer.from('wOF2'), Buffer.from(s)]);

describe('fonts as media assets', () => {
  it('POST /media with a font (magic bytes) creates a kind:font asset', async () => {
    const { t, projectId } = await setup();
    const { payload, headers } = multipart(woff2Bytes(), 'Boombox.woff2');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media?family=Boombox&weight=700&style=italic&fallback=serif&folder=Brand`,
      cookies: { sw_session: t },
      headers,
      payload,
    });
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item).toMatchObject({ kind: 'font', family: 'Boombox', fallback: 'serif', source: 'local', folder: 'Brand' });
    expect(item.files).toEqual([{ weight: 700, style: 'italic', format: 'woff2', file: '700-italic.woff2' }]);
    expect(item.url).toBe(`/media/${projectId}/${item.id}/700-italic.woff2`);

    // It appears in the media library (filterable to fonts) + serves INLINE with CORS.
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } });
    expect((list.json().items as Array<{ kind: string }>).some((a) => a.kind === 'font')).toBe(true);
    const serve = await app.inject({ method: 'GET', url: `/media/${projectId}/${item.id}/700-italic.woff2` });
    expect(serve.statusCode).toBe(200);
    expect(serve.headers['content-type']).toBe('font/woff2');
    expect(serve.headers['x-content-type-options']).toBe('nosniff');
    expect(serve.headers['access-control-allow-origin']).toBe('*');
    expect(serve.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('POST /media with a font but no metadata uses sensible defaults (family from filename, 400)', async () => {
    const { t, projectId } = await setup();
    const { payload, headers } = multipart(woff2Bytes(), 'My-Font.woff2');
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media`, cookies: { sw_session: t }, headers, payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().item).toMatchObject({ kind: 'font', family: 'My-Font', source: 'local', files: [{ weight: 400, style: 'normal', format: 'woff2' }] });
  });

  it('POST /fonts/select downloads a Google family → a kind:font asset (self-hosted, never Google)', async () => {
    const css = `/* latin */
@font-face { font-family:'Inter'; font-weight:400; src:url(https://fonts.gstatic.com/s/inter/400.woff2) format('woff2'); }`;
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('css2') ? new Response(css, { headers: { 'content-type': 'text/css' } }) : new Response(Buffer.from('INTER400'), { headers: { 'content-type': 'font/woff2' } }),
    ));
    const { t, projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/fonts/select`, cookies: { sw_session: t }, payload: { family: 'Inter', weights: [400] } });
    expect(res.statusCode).toBe(200);
    const item = res.json().item;
    expect(item).toMatchObject({ kind: 'font', family: 'Inter', source: 'google', files: [{ weight: 400, format: 'woff2', file: '400.woff2' }] });
    // The downloaded woff2 is self-hosted: serve it from the media route.
    const serve = await app.inject({ method: 'GET', url: `/media/${projectId}/${item.id}/400.woff2` });
    expect(serve.statusCode).toBe(200);
    expect(serve.rawPayload.toString()).toBe('INTER400');
  });

  it('POST /fonts/select is 400 for an unknown family, 403 for a non-writer (cross-tenant)', async () => {
    const { projectId } = await setup('owner-a@e2e.test', 'site-a');
    const a = await app.inject({ method: 'POST', url: `/projects/${projectId}/fonts/select`, payload: { family: 'Inter', weights: [400] } });
    expect(a.statusCode).toBe(401); // no session
    const { t, projectId: pB } = await setup('owner-b@e2e.test', 'site-b');
    const cross = await app.inject({ method: 'POST', url: `/projects/${projectId}/fonts/select`, cookies: { sw_session: t }, payload: { family: 'Inter', weights: [400] } });
    expect(cross.statusCode).toBe(403); // user B not a member of A's project
    const unknown = await app.inject({ method: 'POST', url: `/projects/${pB}/fonts/select`, cookies: { sw_session: t }, payload: { family: 'Not A Font', weights: [400] } });
    expect(unknown.statusCode).toBe(400); // unknown family (own project)
  });

  it('POST /media rejects a CSS-breaking font family name with 400', async () => {
    const { t, projectId } = await setup();
    const { payload, headers } = multipart(woff2Bytes(), 'font.woff2');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media?family=${encodeURIComponent('Evil"}')}&weight=400`,
      cookies: { sw_session: t },
      headers,
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /media rejects an oversized font with 413', async () => {
    const { t, projectId } = await setup();
    const big = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(5 * 1024 * 1024 + 16)]);
    const { payload, headers } = multipart(big, 'big.woff2');
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media?family=Big&weight=400`, cookies: { sw_session: t }, headers, payload });
    expect(res.statusCode).toBe(413);
  });
});

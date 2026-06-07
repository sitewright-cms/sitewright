import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FontStore } from '../src/fonts/store.js';
import { registerFontRoutes } from '../src/http/font-routes.js';
import type { ProjectContext } from '../src/repo/context.js';

let googleRoot: string;
let projectRoot: string;
let googleStore: FontStore;
let projectStore: FontStore;

async function buildApp(opts: { writer?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  // `fields: 0` mirrors production — font metadata rides as query params, only the file is multipart.
  await app.register(multipart, { limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 0 } });
  const ctx = { userId: 'u1', projectId: 'p1', role: 'owner' } as unknown as ProjectContext;
  registerFontRoutes(app, {
    resolveProject: async () => ({ ctx, project: { id: 'p1' } }),
    isWriter: () => opts.writer ?? true,
    fontStore: googleStore,
    projectFontStore: () => projectStore,
    rl: (max) => ({ rateLimit: { max, timeWindow: '1 minute' } }),
  });
  await app.ready();
  return app;
}

/** A single-file multipart body (the only multipart part; metadata travels as query params). */
function multipartFile(bytes: Buffer, filename = 'font.woff2', contentType = 'font/woff2') {
  const boundary = '----swfonttest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, bytes, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
/** Bytes whose magic identifies the given font format (the rest is irrelevant to detection). */
const woff2Bytes = (s = 'x') => Buffer.concat([Buffer.from('wOF2'), Buffer.from(s)]);
const ttfBytes = (s = 'x') => Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from(s)]);

function fontFetchMock() {
  return vi.fn(async (url: string) =>
    url.includes('googleapis.com/css2')
      ? new Response(
          `/* latin */
@font-face { font-family:'Playfair Display'; font-style:normal; font-weight:700; src:url(https://fonts.gstatic.com/s/playfairdisplay/v37/x-700.woff2) format('woff2'); }`,
          { headers: { 'content-type': 'text/css' } },
        )
      : new Response(Buffer.from('WOFF2-BYTES'), { headers: { 'content-type': 'font/woff2' } }),
  );
}

describe('font routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    googleRoot = await mkdtemp(join(tmpdir(), 'sw-fontg-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'sw-fontp-'));
    googleStore = new FontStore(googleRoot);
    projectStore = new FontStore(projectRoot);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app?.close();
    await rm(googleRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('POST select downloads + self-hosts and returns the (files) record', async () => {
    vi.stubGlobal('fetch', fontFetchMock());
    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Playfair Display', weights: [700] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().font).toEqual({
      id: 'playfair-display',
      family: 'Playfair Display',
      fallback: 'serif',
      source: 'google',
      files: [{ weight: 700, style: 'normal', format: 'woff2', file: '700.woff2' }],
    });
    expect(await googleStore.has('playfair-display', '700.woff2')).toBe(true);
  });

  it('POST select is 403 for a non-writer', async () => {
    app = await buildApp({ writer: false });
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Inter', weights: [400] } });
    expect(res.statusCode).toBe(403);
  });

  it('POST select is 400 on an invalid body', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: '', weights: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('POST select is 400 (FontFetchError) for an unknown family', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Not A Real Font', weights: [400] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown font family/);
  });

  it('POST select rethrows a non-FontFetchError (→ 500), not masking it as a 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Playfair Display', weights: [700] } });
    expect(res.statusCode).toBe(500);
  });

  it('POST upload stores a valid font (magic bytes) in the PROJECT store and returns a local record', async () => {
    app = await buildApp();
    const { payload, headers } = multipartFile(ttfBytes(), 'Boombox.ttf', 'font/ttf');
    const res = await app.inject({
      method: 'POST',
      url: '/projects/p1/fonts/upload?family=Boombox&weight=700&style=italic&fallback=sans-serif',
      headers,
      payload,
    });
    expect(res.statusCode).toBe(200);
    const font = res.json().font;
    expect(font).toMatchObject({ family: 'Boombox', fallback: 'sans-serif', source: 'local' });
    expect(font.id).toMatch(/^up-[0-9a-f]+$/);
    expect(font.files).toEqual([{ weight: 700, style: 'italic', format: 'ttf', file: '700-italic.ttf' }]);
    expect(await projectStore.has(font.id, '700-italic.ttf')).toBe(true);
  });

  it('POST upload is 400 for a non-font payload (magic-byte mismatch, ignores the .ttf extension)', async () => {
    app = await buildApp();
    const { payload, headers } = multipartFile(Buffer.from('<html>not a font</html>'), 'evil.ttf', 'font/ttf');
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/upload?family=Evil&weight=400', headers, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unrecognized font/);
  });

  it('POST upload is 400 for invalid metadata (off-scale weight)', async () => {
    app = await buildApp();
    const { payload, headers } = multipartFile(woff2Bytes());
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/upload?family=Boombox&weight=450', headers, payload });
    expect(res.statusCode).toBe(400);
  });

  it('POST upload is 413 (not 400) for a valid font over the size cap', async () => {
    app = await buildApp();
    // > 5 MiB FONT cap but < the 6 MiB multipart cap → reaches the route's own size guard.
    const big = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(5 * 1024 * 1024 + 16)]);
    const { payload, headers } = multipartFile(big);
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/upload?family=Big&weight=400', headers, payload });
    expect(res.statusCode).toBe(413);
  });

  it('POST upload is 403 for a non-writer', async () => {
    app = await buildApp({ writer: false });
    const { payload, headers } = multipartFile(woff2Bytes());
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/upload?family=Boombox&weight=400', headers, payload });
    expect(res.statusCode).toBe(403);
  });

  it('GET project serve returns a stored local font inline (nosniff + CORS + correct type)', async () => {
    await projectStore.write('up-ab12cd34', '700.ttf', Buffer.from('TTF'));
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/projects/p1/fonts/up-ab12cd34/700.ttf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('font/ttf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.rawPayload.toString()).toBe('TTF');
  });

  it('GET project serve falls back to the instance google cache for a google font', async () => {
    await googleStore.write('playfair-display', '700.woff2', Buffer.from('GFONT'));
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/projects/p1/fonts/playfair-display/700.woff2' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('font/woff2');
    expect(res.rawPayload.toString()).toBe('GFONT');
  });

  it('GET project serve is 404 for a bad segment / missing file', async () => {
    app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/projects/p1/fonts/up-x/evil.exe' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/projects/p1/fonts/up-x/900.ttf' })).statusCode).toBe(404);
  });

  it('GET (back-compat instance route) serves a cached woff2 inline', async () => {
    await googleStore.write('playfair-display', '700.woff2', Buffer.from('WOFF2'));
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/fonts/playfair-display/700.woff2' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('font/woff2');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.toString()).toBe('WOFF2');
  });

  it('GET (back-compat instance route) is 404 for a bad file name / uncached weight', async () => {
    app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/fonts/playfair-display/evil.ttf' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/fonts/playfair-display/900.woff2' })).statusCode).toBe(404);
  });
});

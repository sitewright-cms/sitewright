import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FontStore } from '../src/fonts/store.js';
import { registerFontRoutes } from '../src/http/font-routes.js';
import type { ProjectContext } from '../src/repo/context.js';

function buildApp(store: FontStore, opts: { writer?: boolean } = {}): FastifyInstance {
  const app = Fastify();
  const ctx = { userId: 'u1', projectId: 'p1', role: 'owner' } as unknown as ProjectContext;
  registerFontRoutes(app, {
    resolveProject: async () => ({ ctx, project: { id: 'p1' } }),
    isWriter: () => opts.writer ?? true,
    fontStore: store,
    rl: (max) => ({ rateLimit: { max, timeWindow: '1 minute' } }),
  });
  return app;
}

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
  let root: string;
  let store: FontStore;
  let app: FastifyInstance;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-fontrt-'));
    store = new FontStore(root);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST select downloads + self-hosts and returns the record', async () => {
    vi.stubGlobal('fetch', fontFetchMock());
    app = buildApp(store);
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Playfair Display', weights: [700] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().font).toEqual({ id: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weights: [700] });
    expect(await store.has('playfair-display', '700.woff2')).toBe(true);
  });

  it('POST select is 403 for a non-writer', async () => {
    app = buildApp(store, { writer: false });
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Inter', weights: [400] } });
    expect(res.statusCode).toBe(403);
  });

  it('POST select is 400 on an invalid body', async () => {
    app = buildApp(store);
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: '', weights: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('POST select is 400 (FontFetchError) for an unknown family', async () => {
    app = buildApp(store);
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Not A Real Font', weights: [400] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown font family/);
  });

  it('POST select rethrows a non-FontFetchError (→ 500), not masking it as a 400', async () => {
    // A generic (non-FontFetchError) failure inside the fetch must surface as a server error.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    app = buildApp(store);
    const res = await app.inject({ method: 'POST', url: '/projects/p1/fonts/select', payload: { family: 'Playfair Display', weights: [700] } });
    expect(res.statusCode).toBe(500);
  });

  it('GET serves a cached woff2 inline with nosniff + CORS + immutable cache', async () => {
    await store.write('playfair-display', '700.woff2', Buffer.from('WOFF2'));
    app = buildApp(store);
    const res = await app.inject({ method: 'GET', url: '/fonts/playfair-display/700.woff2' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('font/woff2');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.toString()).toBe('WOFF2');
  });

  it('GET is 404 for a bad file name', async () => {
    app = buildApp(store);
    const res = await app.inject({ method: 'GET', url: '/fonts/playfair-display/evil.ttf' });
    expect(res.statusCode).toBe(404);
  });

  it('GET is 404 for an uncached weight', async () => {
    app = buildApp(store);
    const res = await app.inject({ method: 'GET', url: '/fonts/playfair-display/900.woff2' });
    expect(res.statusCode).toBe(404);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;
let dist: string;

/**
 * A stale tab asks for the PREVIOUS build's chunk after a redeploy. Answering that with the SPA shell
 * hands the browser 200 + text/html where it expects a JS module, so `import()` rejects on a MIME error
 * and every lazily-loaded surface dies inside an editor that otherwise still works.
 */
beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), 'sw-editor-dist-'));
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>editor</title>');
  await writeFile(join(dist, 'assets', 'index-CURRENT.js'), 'export const a = 1;\n');
  app = await createApp({ db: await makeTestDb(), editorDist: dist });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(dist, { recursive: true, force: true });
});

describe('the SPA fallback and build assets', () => {
  it('404s a build asset that is not on disk instead of serving the shell', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/catalog-icons-OLDHASH.js' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type'] ?? '').not.toContain('text/html');
  });

  it('404s it with the query string a module request carries', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/chunk-GONE.js?v=123' });
    expect(res.statusCode).toBe(404);
  });

  it('still serves an asset that DOES exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-CURRENT.js' });
    expect(res.statusCode).toBe(200);
  });

  it('still serves the shell for a client-side route', async () => {
    // Not `/projects/…` — that prefix is a real API path and never reaches the shell fallback.
    const res = await app.inject({ method: 'GET', url: '/some-client-route' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

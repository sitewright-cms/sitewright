import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

/**
 * Exercises the single-container SPA serving (@fastify/static at prefix '/'), which no other test
 * covers because it only activates when `editorDist` is set. Also pins the path-traversal safety
 * that the @fastify/static major bump hardens: an encoded `../` escape must not read outside root.
 */
describe('SPA serving (@fastify/static + SPA fallback)', () => {
  let dir: string;
  let dist: string;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spa-'));
    dist = join(dir, 'editor');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>Sitewright</title><div id=app>SPA</div>');
    await writeFile(join(dist, 'assets', 'app.js'), 'console.log("editor bundle");');
    // A secret OUTSIDE the served root — a traversal must never reach it.
    await writeFile(join(dir, 'secret.txt'), 'TOP-SECRET');
    // A dotfile INSIDE the root — `dotfiles: 'deny'` must keep it unservable.
    await writeFile(join(dist, '.env'), 'API_SECRET=hunter2');

    app = await createApp({ db: await makeTestDb(), editorDist: dist });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the SPA index at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id=app');
  });

  it('serves a static asset', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('editor bundle');
  });

  it('falls back to index.html for an unknown client-side route (SPA refresh)', async () => {
    // A non-API GET path (the editor is a state/query-driven SPA; `/projects` is now an
    // API prefix, so use a path that does not collide with the flat API surface).
    const res = await app.inject({ method: 'GET', url: '/dashboard/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id=app'); // index.html, not a 404
  });

  it('does not leak files outside the served root via encoded path traversal', async () => {
    const vectors = [
      '/../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/%252e%252e/secret.txt', // double-encoded dot
      '/..%5csecret.txt', // backslash separator
      '/assets/%00../../secret.txt', // null byte
    ];
    for (const url of vectors) {
      const res = await app.inject({ method: 'GET', url });
      // The secret is never leaked; any 200 must be the SPA fallback (index.html), not the file.
      expect(res.body).not.toContain('TOP-SECRET');
      if (res.statusCode === 200) expect(res.body).toContain('id=app');
    }
  });

  it('never serves a dotfile under the root (dotfiles: deny)', async () => {
    const res = await app.inject({ method: 'GET', url: '/.env' });
    expect(res.body).not.toContain('hunter2');
    if (res.statusCode === 200) expect(res.body).toContain('id=app'); // SPA fallback, not the dotfile
  });
});

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
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-importjs-'));
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

function htmlUpload(html: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----swimportjs';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="page.html"\r\nContent-Type: text/html\r\n\r\n`);
  return { payload: Buffer.concat([head, Buffer.from(html), Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('website import — JS hosting (end to end through the app)', () => {
  it('self-hosts an inline <script> as a served .js and links it from website.scripts', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'js@e2e.test', password: 'Pw-secret-1' } });
    const t = token(reg);
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;

    const html = '<html><head><title>Home</title></head><body><main><h1>Home</h1></main><script>window.__imported__ = 42;</script></body></html>';
    const { payload, headers } = htmlUpload(html);
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/import/upload/stream`, cookies: { sw_session: t }, payload, headers });
    expect(res.payload).toContain('event: done');

    // The bundle's website.scripts links the self-hosted script…
    const exp = await app.inject({ method: 'GET', url: `/projects/${projectId}/export`, cookies: { sw_session: t } });
    const scripts: string = ((exp.json() as { project: { website?: { scripts?: string } } }).project.website?.scripts) ?? '';
    const url = scripts.match(/\/media\/[\w-]+\/[\w-]+\/script\.js/)?.[0];
    expect(url).toBeTruthy(); // a self-hosted /media/.../script.js ref

    // …and that URL serves the inline JS inline as text/javascript (so the page's <script src> runs).
    const js = await app.inject({ method: 'GET', url: url!, cookies: { sw_session: t } });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['x-content-type-options']).toBe('nosniff');
    expect(js.body).toContain('window.__imported__ = 42;');
  });
});

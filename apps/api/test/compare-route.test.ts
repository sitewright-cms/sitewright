import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { SourceRefStore } from '../src/render/source-ref.js';

// The compare ROUTE lives in the preview-site block (only registered when `previewRoot` is passed).
// Mock ONLY the browser capture so the route's own branches run without a real Chromium; the pure
// compareTargets logic stays real (covered separately in compare.test.ts).
vi.mock('../src/render/compare.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, captureUrlShots: vi.fn(async () => ({ fullhd: { base64: 'AAA', mimeType: 'image/jpeg', width: 1920, height: 1080 } })) };
});

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let previewRoot: string;
let sourceRefRoot: string;
beforeEach(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-cmp-'));
  sourceRefRoot = await mkdtemp(join(tmpdir(), 'sw-ref-'));
  db = await makeTestDb();
  app = await createApp({ db, previewRoot, sourceRefRoot, cookieSecret: 'cmp-test-secret' });
  await app.ready();
});
afterEach(async () => {
  await rm(previewRoot, { recursive: true, force: true });
  await rm(sourceRefRoot, { recursive: true, force: true });
});

function tok(r: { cookies: Array<{ name: string; value: string }> }): string {
  const t = r.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup() {
  await registerAccount(db, 'd@a.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = tok(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'd@a.test', password: 'Pw-secret-1' } }));
  const pid = ((await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'C', slug: 'cmp' } })).json() as { project: { id: string } }).project.id;
  return { t, pid };
}
const putPage = (pid: string, t: string, page: object) =>
  app.inject({ method: 'PUT', url: `/projects/${pid}/content/page/${(page as { id: string }).id}`, cookies: { sw_session: t }, payload: page });

describe('GET /projects/:id/compare/:pageId', () => {
  it('404s for a missing page', async () => {
    const { t, pid } = await setup();
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/compare/nope`, cookies: { sw_session: t } })).statusCode).toBe(404);
  });

  it('400s when the page has no import source', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' });
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/compare/home`, cookies: { sw_session: t } })).statusCode).toBe(400);
  });

  it('returns build + source for an imported page (with viewport filter)', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'about', path: 'about', title: 'About', source: '<h1>About</h1>', data: { swImport: { sourceUrl: 'https://example.com/about', rewritten: false } } });
    const r = await app.inject({ method: 'GET', url: `/projects/${pid}/compare/about?viewports=fullhd`, cookies: { sw_session: t } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { sourceUrl: string; route: string; build: Record<string, unknown>; source: Record<string, unknown> };
    expect(body.sourceUrl).toBe('https://example.com/about');
    expect(body.route).toBe('about');
    expect(body.build).toHaveProperty('fullhd');
    expect(body.source).toHaveProperty('fullhd');
  });

  it('serves the SOURCE from the import-time cache when present (no live re-render)', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>', data: { swImport: { sourceUrl: 'https://example.com/', rewritten: false } } });
    const store = new SourceRefStore(sourceRefRoot);
    await store.put('cmp', 'home', { sourceUrl: 'https://example.com/', capturedAt: 1_700_000_000_000, shots: { fullhd: { base64: 'Q0FDSEVE', mimeType: 'image/jpeg', width: 1920, height: 2000 } } });
    const r = await app.inject({ method: 'GET', url: `/projects/${pid}/compare/home?viewports=fullhd`, cookies: { sw_session: t } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { sourceFrom: string; capturedAt: number; source: Record<string, { base64: string }>; build: Record<string, { base64: string }> };
    expect(body.sourceFrom).toBe('cache');
    expect(body.capturedAt).toBe(1_700_000_000_000);
    expect(body.source.fullhd!.base64).toBe('Q0FDSEVE'); // from cache, not the mocked live render
    expect(body.build.fullhd!.base64).toBe('AAA'); // build is still rendered live (mock)
  });

  it('refresh=1 bypasses the cache and re-snapshots the live source', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>', data: { swImport: { sourceUrl: 'https://example.com/', rewritten: false } } });
    const store = new SourceRefStore(sourceRefRoot);
    await store.put('cmp', 'home', { sourceUrl: 'https://example.com/', capturedAt: 1_700_000_000_000, shots: { fullhd: { base64: 'Q0FDSEVE', mimeType: 'image/jpeg', width: 1920, height: 2000 } } });
    const r = await app.inject({ method: 'GET', url: `/projects/${pid}/compare/home?viewports=fullhd&refresh=1`, cookies: { sw_session: t } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { sourceFrom: string; source: Record<string, { base64: string }> };
    expect(body.sourceFrom).toBe('live');
    expect(body.source.fullhd!.base64).toBe('AAA'); // freshly rendered (mock), not the stale cache
    // …and the refresh overwrote the stored reference with the fresh snapshot.
    expect((await store.get('cmp', 'home'))!.shots.fullhd!.base64).toBe('AAA');
  });
});

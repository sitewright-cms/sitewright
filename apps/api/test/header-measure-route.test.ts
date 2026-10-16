import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { measureHeaderAt } from '../src/render/compare.js';

// Mock ONLY the browser-driving measurement; the route's page resolution, refusals and the pure report
// stay real (the report is covered directly in header-measure.test.ts).
vi.mock('../src/render/compare.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    measureHeaderAt: vi.fn(async (_url: string, widths: readonly number[]) =>
      widths.map((width) => ({ width, position: 'fixed', bar: width < 1024 ? 96 : 150, token: width < 1024 ? 72 : 76, spacerPad: null })),
    ),
  };
});

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let previewRoot: string;
beforeEach(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-hm-'));
  db = await makeTestDb();
  app = await createApp({ db, previewRoot, cookieSecret: 'hm-test-secret' });
  await app.ready();
});
afterEach(async () => {
  vi.mocked(measureHeaderAt).mockClear();
  await rm(previewRoot, { recursive: true, force: true });
});

function tok(r: { cookies: Array<{ name: string; value: string }> }): string {
  const t = r.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup() {
  await registerAccount(db, 'h@a.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = tok(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'h@a.test', password: 'Pw-secret-1' } }));
  const pid = ((await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'H', slug: 'hm' } })).json() as { project: { id: string } }).project.id;
  return { t, pid };
}
const putPage = (pid: string, t: string, page: object) =>
  app.inject({ method: 'PUT', url: `/projects/${pid}/content/page/${(page as { id: string }).id}`, cookies: { sw_session: t }, payload: page });
const measure = (pid: string, t: string, id: string) => app.inject({ method: 'GET', url: `/projects/${pid}/header-measure/${id}`, cookies: { sw_session: t } });

describe('GET /projects/:id/header-measure/:pageId', () => {
  it('measures any published page — no import source needed — and returns the exact fix', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', status: 'published', source: '<h1>Hi</h1>' });
    await putPage(pid, t, { id: 'about', path: 'about', parent: 'home', title: 'About', status: 'published', source: '<p>a</p>' });
    const r = await measure(pid, t, 'about');
    expect(r.statusCode).toBe(200);
    const body = r.json() as { route: string; widths: number[]; rows: Array<{ verdict: string }>; css: string; advice: string[] };
    expect(body.route).toBe('/about/');
    expect(body.widths).toEqual([390, 640, 768, 1024, 1280, 1536]);
    expect(body.rows.every((row) => row.verdict === 'too-small')).toBe(true);
    expect(body.css).toBe(':root{--sw-header-h:96px}\n@media (min-width:1024px){:root{--sw-header-h:150px}}');
    // It measured the page's DRAFT-SITE address on loopback, at the Tailwind breakpoints.
    const [url, widths] = vi.mocked(measureHeaderAt).mock.calls[0]!;
    expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/preview-site/${pid}/[^/]+/about/$`));
    expect(widths).toEqual([390, 640, 768, 1024, 1280, 1536]);
    // The HOME page is the site root — its address ends at the signature, never in a stray segment.
    expect((await measure(pid, t, 'home')).statusCode).toBe(200);
    const [homeUrl] = vi.mocked(measureHeaderAt).mock.calls[1]!;
    expect(homeUrl).toMatch(new RegExp(`/preview-site/${pid}/[^/]+/$`));
  });

  it('refuses a draft (not on the draft site) and a menu placeholder, and 404s an unknown page', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', status: 'published', source: '<h1>Hi</h1>' });
    await putPage(pid, t, { id: 'wip', path: 'wip', parent: 'home', title: 'WIP', status: 'draft', source: '<p>w</p>' });
    await putPage(pid, t, { id: 'shop', path: '', parent: 'home', title: 'Shop', kind: 'link', link: { target: 'https://shop.example.com' } });
    const draft = await measure(pid, t, 'wip');
    expect(draft.statusCode).toBe(409);
    expect((draft.json() as { error: string }).error).toMatch(/draft/);
    expect((await measure(pid, t, 'shop')).statusCode).toBe(400);
    expect((await measure(pid, t, 'nope')).statusCode).toBe(404);
    expect(measureHeaderAt).not.toHaveBeenCalled();
  });

  it('a renderer failure is a 503 that never echoes the internal address', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', status: 'published', source: '<h1>Hi</h1>' });
    vi.mocked(measureHeaderAt).mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4321/preview-site/x'));
    const r = await measure(pid, t, 'home');
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('127.0.0.1');
  });
});

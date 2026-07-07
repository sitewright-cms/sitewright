import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// Mock ONLY the browser element-capture so the route's own branches + the pure scoreFidelity run without a
// real Chromium. `mode:'pinned'` = the ORIGINAL source, `mode:'loopback'` = the agent's BUILD.
vi.mock('../src/render/compare.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  const el = (o: object) => ({ role: 'button', tag: 'a', text: '', region: 'header', x: 0, y: 10, w: 100, h: 40, font: 'secondary-font', size: '14px', weight: '400', color: 'rgb(2,139,192)', bg: 'rgba(0, 0, 0, 0)', bgImage: 'none', shadow: 'none', transform: 'none', radius: '5px', ...o });
  return {
    ...actual,
    captureUrlElements: vi.fn(async (_url: string, opts: { mode: string }) =>
      opts.mode === 'pinned'
        ? { items: [el({ text: 'Web Design', transform: 'matrix(1, 0, -0.466308, 1, 0, 0)' })], meta: { position: 'fixed', ripple: 8, modalTriggers: 3 } } // ORIGINAL: 25° skew, pinned, ripple, modals
        : { items: [el({ text: 'Web Design', transform: 'matrix(1, 0, -0.267949, 1, 0, 0)' })], meta: { position: 'static', ripple: 0, modalTriggers: 0 } }, // BUILD: 15° skew, none of the above
    ),
    captureUrlRegions: vi.fn(async (_url: string, opts: { mode: string; regions?: Record<string, string> }) =>
      Object.fromEntries(Object.keys(opts.regions ?? { header: 1, footer: 1 }).map((name) => [name, { base64: opts.mode === 'pinned' ? 'U1JD' : 'QlVJTEQ', mimeType: 'image/webp', width: 3840, height: 200 }])),
    ),
  };
});

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let previewRoot: string;
beforeEach(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-fid-'));
  db = await makeTestDb();
  app = await createApp({ db, previewRoot, cookieSecret: 'fid-test-secret' });
  await app.ready();
});
afterEach(async () => { await rm(previewRoot, { recursive: true, force: true }); });

function tok(r: { cookies: Array<{ name: string; value: string }> }): string {
  const t = r.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup() {
  await registerAccount(db, 'd@a.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = tok(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'd@a.test', password: 'Pw-secret-1' } }));
  const pid = ((await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'F', slug: 'fid' } })).json() as { project: { id: string } }).project.id;
  return { t, pid };
}
const putPage = (pid: string, t: string, page: object) =>
  app.inject({ method: 'PUT', url: `/projects/${pid}/content/page/${(page as { id: string }).id}`, cookies: { sw_session: t }, payload: page });

describe('GET /projects/:id/fidelity/:pageId', () => {
  it('404s for a missing page', async () => {
    const { t, pid } = await setup();
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/fidelity/nope`, cookies: { sw_session: t } })).statusCode).toBe(404);
  });

  it('400s when the page has no import source', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' });
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/fidelity/home`, cookies: { sw_session: t } })).statusCode).toBe(400);
  });

  it('returns a measured FAIL with the chrome + meta diffs the gate now catches', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'about', path: 'about', title: 'About', source: '<h1>About</h1>', data: { swImport: { sourceUrl: 'https://example.com/about', rewritten: false } } });
    const r = await app.inject({ method: 'GET', url: `/projects/${pid}/fidelity/about`, cookies: { sw_session: t } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { sourceUrl: string; route: string; pass: boolean; chrome: { styleOff: number; metaOff: number }; diffs: { chrome: string[]; meta: string[] } };
    expect(body.sourceUrl).toBe('https://example.com/about');
    expect(body.route).toBe('about');
    expect(body.pass).toBe(false);
    expect(body.chrome.styleOff).toBeGreaterThanOrEqual(1); // the 25°→15° skew
    expect(body.chrome.metaOff).toBe(3); // not pinned + missing ripple + missing modals
    expect(body.diffs.meta.join(' ')).toMatch(/ripple:MISSING/);
  });
});

describe('GET /projects/:id/compare-regions/:pageId', () => {
  it('404s for a missing page', async () => {
    const { t, pid } = await setup();
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/compare-regions/nope`, cookies: { sw_session: t } })).statusCode).toBe(404);
  });

  it('400s when the page has no import source', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' });
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/compare-regions/home`, cookies: { sw_session: t } })).statusCode).toBe(400);
  });

  it('returns build+source high-res crops per region (default header+footer)', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'about', path: 'about', title: 'About', source: '<h1>About</h1>', data: { swImport: { sourceUrl: 'https://example.com/about', rewritten: false } } });
    const r = await app.inject({ method: 'GET', url: `/projects/${pid}/compare-regions/about`, cookies: { sw_session: t } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { regions: Record<string, { build?: { base64: string; mimeType: string }; source?: { base64: string } }> };
    expect(Object.keys(body.regions).sort()).toEqual(['footer', 'header']);
    expect(body.regions.header!.build!.mimeType).toBe('image/webp');
    expect(body.regions.header!.build!.base64).toBe('QlVJTEQ'); // loopback = build
    expect(body.regions.header!.source!.base64).toBe('U1JD'); // pinned = source
  });

  it('limits to the requested regions (drops unknowns)', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'about', path: 'about', title: 'About', source: '<h1>About</h1>', data: { swImport: { sourceUrl: 'https://example.com/about', rewritten: false } } });
    const r = await app.inject({ method: 'GET', url: `/projects/${pid}/compare-regions/about?regions=header,bogus`, cookies: { sw_session: t } });
    expect(r.statusCode).toBe(200);
    expect(Object.keys((r.json() as { regions: object }).regions)).toEqual(['header']);
  });
});

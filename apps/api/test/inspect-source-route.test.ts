// inspect_source is the read-only MEASUREMENT projection of the existing render machinery: the only way to
// get NUMBERS (computed styles / rects) or SETTLED markup out of the live original, which the import guide
// repeatedly instructs the agent to do but previously shipped no tool for.
//
// The browser-driving half (captureUrlInspect) needs real Chromium and is covered by the deploy-time e2e
// check like every other capture in compare.ts — so it is MOCKED here and the route's own contract (guards,
// validation, arg plumbing, response shape) is what gets asserted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { INSPECT_DEFAULT_STYLES, INSPECT_LIMITS } from '../src/render/inspect-probe.js';
import { abortOnClose } from '../src/http/app.js';

// vi.mock is hoisted above module-scope consts, so the spy has to be created inside vi.hoisted. Typed via
// the generic (not via named-but-unused params) so `.mock.calls` stays type-safe.
type InspectOpts = { mode: string; selectors: string[]; styles?: string[]; html?: boolean; viewport?: string };
type InspectFn = (url: string, opts: InspectOpts) => Promise<{
  title: string;
  viewport: { width: number; height: number };
  documentHeight: number;
  results: Array<{ selector: string; count: number; nodes: unknown[] }>;
}>;
const { captureUrlInspect } = vi.hoisted(() => ({
  captureUrlInspect: vi.fn<InspectFn>(async () => ({
    title: 'Original',
    viewport: { width: 1440, height: 900 },
    documentHeight: 4200,
    results: [{ selector: '#main-nav a', count: 7, nodes: [{ tag: 'a', rect: { x: 294.4, y: 8, width: 82.7, height: 42.8, pageY: 8 }, styles: { 'font-size': '16px' } }] }],
  })),
}));
vi.mock('../src/render/compare.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, captureUrlInspect };
});

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let previewRoot: string;

beforeEach(async () => {
  captureUrlInspect.mockClear();
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-inspect-'));
  db = await makeTestDb();
  app = await createApp({ db, previewRoot, cookieSecret: 'inspect-test-secret' });
  await app.ready();
});
afterEach(async () => {
  await rm(previewRoot, { recursive: true, force: true });
});

function tok(r: { cookies: Array<{ name: string; value: string }> }): string {
  const t = r.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
let seq = 0;
async function setup() {
  const email = `dev${seq++}@a.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = tok(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: `insp${seq}` } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}
const putPage = (t: string, projectId: string, page: Record<string, unknown> & { id: string }) =>
  app.inject({ method: 'PUT', url: `/projects/${projectId}/content/page/${page.id}`, cookies: { sw_session: t }, payload: page });
const inspect = (t: string, projectId: string, pageId: string, payload: object) =>
  app.inject({ method: 'POST', url: `/projects/${projectId}/inspect-source/${pageId}`, cookies: { sw_session: t }, payload });

const imported = { id: 'home', path: '', title: 'Home', data: { swImport: { sourceUrl: 'https://example.test/' } } };

describe('inspect_source route', () => {
  it('measures the LIVE ORIGINAL by default and echoes the viewport the numbers are true at', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, imported);
    const res = await inspect(t, projectId, 'home', { selectors: ['#main-nav a'] });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { side: string; url: string; sourceUrl: string; viewport: { width: number }; results: unknown[] };
    expect(body.side).toBe('source');
    expect(body.url).toBe('https://example.test/');
    expect(body.viewport.width).toBe(1440);
    expect(body.results).toHaveLength(1);
    // the pinned (SSRF-guarded) network path is what an EXTERNAL original must be fetched through
    expect(captureUrlInspect.mock.calls[0]![1]).toMatchObject({ mode: 'pinned', selectors: ['#main-nav a'] });
  });

  it("side:'build' measures the agent's own clone through the loopback path instead", async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, imported);
    const res = await inspect(t, projectId, 'home', { selectors: ['h1'], side: 'build' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { side: string }).side).toBe('build');
    expect(captureUrlInspect.mock.calls[0]![1]).toMatchObject({ mode: 'loopback' });
    expect(String(captureUrlInspect.mock.calls[0]![0])).toContain('/preview-site/');
  });

  it('passes through styles/html/viewport and caps the selector count', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, imported);
    const many = Array.from({ length: INSPECT_LIMITS.maxSelectors + 5 }, (_, i) => `.s${i}`);
    const res = await inspect(t, projectId, 'home', { selectors: many, styles: ['backdrop-filter'], html: true, viewport: 'mobile' });
    expect(res.statusCode).toBe(200);
    const opts = captureUrlInspect.mock.calls[0]![1];
    expect(opts.selectors).toHaveLength(INSPECT_LIMITS.maxSelectors); // excess dropped, not rejected
    expect(opts.styles).toEqual(['backdrop-filter']);
    expect(opts.html).toBe(true);
    expect(opts.viewport).toBe('mobile');
  });

  it('caps the styles list server-side too (the route is reachable without the MCP schema)', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, imported);
    const many = Array.from({ length: INSPECT_LIMITS.maxStyles + 10 }, (_, i) => `--p${i}`);
    expect((await inspect(t, projectId, 'home', { selectors: ['h1'], styles: many })).statusCode).toBe(200);
    expect(captureUrlInspect.mock.calls[0]![1].styles).toHaveLength(INSPECT_LIMITS.maxStyles);
  });

  it('ignores an unknown viewport rather than failing the call', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, imported);
    expect((await inspect(t, projectId, 'home', { selectors: ['h1'], viewport: 'gigantic' })).statusCode).toBe(200);
    expect(captureUrlInspect.mock.calls[0]![1].viewport).toBeUndefined();
  });

  it('rejects a call with no usable selectors, naming what is required', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, imported);
    for (const payload of [{}, { selectors: [] }, { selectors: 'not-an-array' }, { selectors: ['', '   '] }]) {
      const res = await inspect(t, projectId, 'home', payload);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toMatch(/selectors is required/i);
    }
    expect(captureUrlInspect).not.toHaveBeenCalled(); // never burns a render slot on a bad call
  });

  it('404s for an unknown page and 400s for a page that was never imported', async () => {
    const { t, projectId } = await setup();
    expect((await inspect(t, projectId, 'ghost', { selectors: ['h1'] })).statusCode).toBe(404);
    await putPage(t, projectId, { id: 'hand', path: 'hand', title: 'Hand-authored' });
    const res = await inspect(t, projectId, 'hand', { selectors: ['h1'] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/no imported source/i);
    expect(captureUrlInspect).not.toHaveBeenCalled();
  });

  it('requires an authenticated member', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, imported);
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/inspect-source/home`, payload: { selectors: ['h1'] } });
    expect(res.statusCode).toBe(401);
    expect(captureUrlInspect).not.toHaveBeenCalled();
  });
});

describe('inspect probe contract', () => {
  it('caps every unbounded dimension so one call cannot return an unbounded payload', () => {
    expect(INSPECT_LIMITS.maxSelectors).toBeGreaterThan(0);
    expect(INSPECT_LIMITS.maxSelectors).toBeLessThanOrEqual(50);
    expect(INSPECT_LIMITS.maxNodesPerSelector).toBeGreaterThan(0);
    expect(INSPECT_LIMITS.maxNodesPerSelector).toBeLessThanOrEqual(20);
    expect(INSPECT_LIMITS.maxHtmlChars).toBeLessThanOrEqual(20_000);
    expect(INSPECT_LIMITS.maxTextChars).toBeLessThanOrEqual(2_000);
  });

  it('measures the properties a faithful port actually has to match', () => {
    // Guards against someone trimming the default set and silently making the tool useless for the
    // defects it exists to catch (wrong face, wrong scale, wrong spacing, missing gradient/shadow/skew).
    for (const prop of ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-image', 'padding', 'border-radius', 'box-shadow', 'transform']) {
      expect(INSPECT_DEFAULT_STYLES as readonly string[]).toContain(prop);
    }
  });
});

describe('abortOnClose', () => {
  it('aborts the render when the client disconnects', () => {
    // A browser render is expensive; if the requester has gone away the slot must be released rather than
    // held for a response nobody will read.
    let onClose: (() => void) | undefined;
    const controller = abortOnClose({ raw: { on: (_e, cb) => (onClose = cb) } });
    expect(controller.signal.aborted).toBe(false);
    onClose?.();
    expect(controller.signal.aborted).toBe(true);
  });
});

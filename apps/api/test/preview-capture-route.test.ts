import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ScreenshotModule from '../src/render/screenshot.js';
import { createApp, previewCaptureRequest } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RenderPool } from '../src/render/render-pool.js';
import { makeTestDb } from './helpers.js';

/**
 * Which capture contract a preview request gets. `segment` / `shotSelector` on the query is the
 * SEGMENTED one (`captures`, `captureNotes`); a request with neither is an older MCP client and keeps
 * the one-image-per-viewport `screenshots` it always got. The two browser calls are replaced, so this
 * pins the routing and the response shape; what the captures look like is pinned elsewhere.
 */

const seams = vi.hoisted(() => ({
  legacy: vi.fn(),
  segmented: vi.fn(),
}));

vi.mock('../src/render/screenshot.js', async (importOriginal) => {
  const orig = await importOriginal<typeof ScreenshotModule>();
  return { ...orig, captureScreenshots: seams.legacy, capturePreview: seams.segmented };
});

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
let app: FastifyInstance;
let base: string;
let cookie: string;
let projectId: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'sw-preview-capture-'));
  const db = await makeTestDb();
  app = await createApp({ db, mediaRoot: join(base, 'media'), renderPool: new RenderPool({ size: 1, workerPath }) });
  await app.ready();
  await registerAccount(db, 'cap@e2e.test', 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'cap@e2e.test', password: 'Pw-secret-1' } });
  cookie = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'Cap', slug: 'cap' } });
  projectId = (proj.json() as { project: { id: string } }).project.id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  seams.legacy.mockReset();
  seams.segmented.mockReset();
});

const preview = (query: string) =>
  app.inject({ method: 'POST', url: `/projects/${projectId}/preview?screenshot=1${query}`, cookies: { sw_session: cookie }, payload: { id: 'home' } });

const capture = {
  viewport: 'fullhd',
  kind: 'page',
  base64: 'AAAA',
  mimeType: 'image/jpeg',
  width: 960,
  height: 1354,
  scale: 0.5,
  segments: [{ index: 3, top: 5416, bottom: 8124 }],
  segmentCount: 4,
  totalHeight: 9450,
};

describe('POST /preview?screenshot=1 — capture contract', () => {
  it('a request WITHOUT segment is an older client: one `screenshots` image per viewport, no captures', async () => {
    seams.legacy.mockResolvedValue({ fullhd: { base64: 'AAAA', mimeType: 'image/jpeg', width: 1920, height: 9450 } });
    const res = await preview('&viewports=fullhd');
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.screenshots).toEqual({ fullhd: { base64: 'AAAA', mimeType: 'image/jpeg', width: 1920, height: 9450 } });
    expect(body.captures).toBeUndefined();
    expect(seams.segmented).not.toHaveBeenCalled();
    expect(seams.legacy.mock.calls[0]![1]).toMatchObject({ viewports: ['fullhd'], scale: 0.5 });
  });

  it('★ `segment` (+ `shotSelector`) gets the segmented captures and the notes, forwarded as asked', async () => {
    seams.segmented.mockResolvedValue({ captures: [capture], notes: [{ viewport: 'mobile', message: 'there is no segment 3: …' }] });
    const res = await preview(`&segment=3&shotSelector=${encodeURIComponent('section.pricing')}`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.captures).toEqual([capture]);
    expect(body.captureNotes).toEqual([{ viewport: 'mobile', message: 'there is no segment 3: …' }]);
    expect(body.screenshots).toBeUndefined();
    expect(seams.legacy).not.toHaveBeenCalled();
    // The default viewports (desktop + mobile) at the preview's half scale.
    expect(seams.segmented.mock.calls[0]![1]).toMatchObject({ request: { segment: 3, selector: 'section.pricing' }, viewports: ['fullhd', 'mobile'], scale: 0.5 });
  });

  it('no notes → no captureNotes key', async () => {
    seams.segmented.mockResolvedValue({ captures: [capture], notes: [] });
    const body = (await preview('&segment=1')).json() as Record<string, unknown>;
    expect('captureNotes' in body).toBe(false);
  });

  it('an over-long shotSelector is refused up front, as a permanent failure, without rendering', async () => {
    const res = await preview(`&segment=1&shotSelector=${'a'.repeat(201)}`);
    const body = res.json() as { screenshotsUnavailable?: { reason: string; retryable: boolean; message: string } };
    expect(body.screenshotsUnavailable).toMatchObject({ reason: 'failed', retryable: false });
    expect(body.screenshotsUnavailable?.message).toMatch(/200 characters/);
    expect(seams.segmented).not.toHaveBeenCalled();
  });
});

describe('previewCaptureRequest', () => {
  it('opts in on either parameter, and reads a bad segment as the first', () => {
    expect(previewCaptureRequest(undefined)).toBeUndefined();
    expect(previewCaptureRequest({})).toBeUndefined();
    expect(previewCaptureRequest({ shotSelector: '   ' })).toBeUndefined();
    expect(previewCaptureRequest({ segment: '2' })).toEqual({ segment: 2 });
    expect(previewCaptureRequest({ shotSelector: ' main ' })).toEqual({ segment: 1, selector: 'main' });
    for (const bad of ['0', '-1', 'abc', '1.5', '']) expect(previewCaptureRequest({ segment: bad }), bad).toEqual({ segment: 1 });
    expect(previewCaptureRequest({ segment: '99999' })).toEqual({ segment: 1000 });
  });
});

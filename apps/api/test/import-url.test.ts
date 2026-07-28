import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { pinnedFetchDetailed, type PinnedResult } from '../src/import/pinned-fetch.js';

// A tiny but valid 1x1 PNG — enough for the sharp pipeline to decode and optimize.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let db: Database;
let mediaRoot: string;

/**
 * The route's outbound is `pinnedFetchDetailed` (connect-pinned, SSRF-validated) — NOT global `fetch`,
 * which is exactly the point: pinning bypasses `fetch` so a hostname cannot resolve public-then-private
 * between the guard and the connection. So these tests inject the fetcher rather than stubbing a global.
 * The guard itself (which addresses are refused, per redirect hop) is unit-tested in pinned-fetch.test.ts;
 * here we pin down how the route MAPS each outcome to a status + message.
 */
type Fetcher = typeof pinnedFetchDetailed;
const fetcherReturning = (result: PinnedResult): Fetcher => vi.fn(async () => result) as unknown as Fetcher;
const ok = (body: Buffer, contentType: string): PinnedResult => ({
  ok: true,
  status: 200,
  contentType,
  bytes: new Uint8Array(body),
});

async function makeApp(importUrlFetch: Fetcher): Promise<void> {
  app = await createApp({ db, mediaRoot, importUrlFetch });
  await app.ready();
}

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-importurl-'));
  db = await makeTestDb();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (app) await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup(email = 'importer@e2e.test', slug = 'site') {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}
const post = (projectId: string, t: string, url: string) =>
  app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, cookies: { sw_session: t }, payload: { url } });

describe('POST /projects/:projectId/media/import-url', () => {
  it('downloads + self-hosts a remote IMAGE as an optimized media asset', async () => {
    await makeApp(fetcherReturning(ok(PNG_1X1, 'image/png')));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/photo.png');
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item.kind).toBe('image');
    expect(item.filename).toBe('photo.png');
    expect(item.url.startsWith('/media/site/')).toBe(true); // media keyed by slug ('site'), not project id
  });

  it('stores a non-image download as a file asset', async () => {
    await makeApp(fetcherReturning(ok(Buffer.from('%PDF-1.4 ...'), 'application/pdf')));
    const { t, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/import-url`,
      cookies: { sw_session: t },
      payload: { url: 'https://cdn.example.com/doc.pdf', folder: 'Docs' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().item).toMatchObject({ kind: 'file', folder: 'Docs', contentType: 'application/pdf' });
  });

  it('rejects an obviously private / non-https URL up front, without any outbound call', async () => {
    const fetchMock = vi.fn();
    await makeApp(fetchMock as unknown as Fetcher);
    const { t, projectId } = await setup();
    for (const url of ['https://127.0.0.1/x.png', 'https://localhost/x.png', 'http://cdn.example.com/x.png']) {
      const res = await post(projectId, t, url);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // THE regression guard for the DNS-rebinding SSRF: a hostname that LOOKS public passes the cheap
  // string pre-filter, so the binding guard has to be the pinned fetcher resolving it. Drive the REAL
  // pinnedFetchDetailed with an injected resolver — no network, real guard.
  it('rejects a public-looking hostname whose DNS resolves into private space (rebinding SSRF)', async () => {
    const resolve = async () => [{ address: '10.0.0.5', family: 4 }];
    const spy = vi.fn((url: string) => pinnedFetchDetailed(url, { resolve }));
    await makeApp(spy as unknown as Fetcher);
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://images.cdn-that-resolves-internal.example/logo.png');
    expect(spy).toHaveBeenCalled(); // it got past the string pre-filter, as expected
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/non-public/);
    // The error must not disclose the resolved internal address (no internal-DNS oracle).
    expect(res.json().error).not.toMatch(/10\.0\.0\.5/);
  });

  it('imports normally when every resolved address is public', async () => {
    const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
    // Real guard (passes), stubbed transport for the single hop.
    const fetcher = (url: string) =>
      pinnedFetchDetailed(url, { resolve, _fetchOnce: async () => ({ status: 200, contentType: 'image/png', bytes: new Uint8Array(PNG_1X1) }) });
    await makeApp(fetcher as unknown as Fetcher);
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/photo.png');
    expect(res.statusCode).toBe(201);
    expect(res.json().item.kind).toBe('image');
  });

  it('maps a blocked redirect target to 400 (non-public)', async () => {
    await makeApp(fetcherReturning({ ok: false, reason: 'blocked' }));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/evil-redir.png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/non-public/);
  });

  it('rejects a redirect LOOP / too many hops', async () => {
    await makeApp(fetcherReturning({ ok: false, reason: 'redirects' }));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/loop.png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/too many redirects/);
  });

  it('preserves an SVG download as a sanitized vector image (consistent with the upload route)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>';
    await makeApp(fetcherReturning(ok(Buffer.from(svg), 'image/svg+xml')));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/x.svg');
    expect(res.statusCode).toBe(201);
    expect(res.json().item.format).toBe('svg');
    expect(res.json().item.url).toMatch(/\.svg$/);
  });

  it('rejects a malformed SVG download (nothing usable after sanitization) with 400', async () => {
    await makeApp(fetcherReturning(ok(Buffer.from('not an svg'), 'image/svg+xml')));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/x.svg');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/SVG/);
  });

  it('rejects an over-cap download with 413 (the fetcher enforces the byte cap)', async () => {
    await makeApp(fetcherReturning({ ok: false, reason: 'oversize' }));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/big.png');
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatch(/size limit/);
  });

  it('is 403 for a cross-tenant request (importer not a member of the other project)', async () => {
    await makeApp(fetcherReturning(ok(PNG_1X1, 'image/png')));
    const a = await setup('owner-a@e2e.test', 'site-a');
    const b = await setup('owner-b@e2e.test', 'site-b');
    // user B's session against user A's project → blocked before any fetch.
    const res = await post(a.projectId, b.t, 'https://cdn.example.com/x.png');
    expect(res.statusCode).toBe(403);
  });

  it('rejects when the remote responds non-OK', async () => {
    await makeApp(fetcherReturning({ ok: false, reason: 'status', status: 404 }));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/missing.png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/download failed \(404\)/);
  });

  it('rejects a corrupt image (createMediaAsset → MediaValidationError)', async () => {
    // content-type says image but the bytes aren't a decodable image → the sharp pipeline rejects it.
    await makeApp(fetcherReturning(ok(Buffer.from('not really a png'), 'image/png')));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/broken.png');
    expect(res.statusCode).toBe(400);
  });

  it('maps a transport failure to 400', async () => {
    await makeApp(fetcherReturning({ ok: false, reason: 'network' }));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/x.png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/could not fetch/);
  });

  it('maps an UNEXPECTED throw from the fetcher to 400, never a 500', async () => {
    await makeApp((async () => { throw new TypeError('network down'); }) as unknown as Fetcher);
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'https://cdn.example.com/x.png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/could not fetch/);
  });

  // `timeoutMs` in the pinned fetcher is a per-socket INACTIVITY timeout, so it alone would let a server
  // trickle bytes and hold a worker open past the budget. The route must also pass an AbortSignal (its
  // hard whole-operation deadline) and both caps — assert them so a refactor can't quietly drop one.
  it('passes the byte cap, redirect budget AND an abort signal (hard deadline) to the fetcher', async () => {
    let seen: Record<string, unknown> | undefined;
    const spy = (async (_url: string, opts: Record<string, unknown>) => {
      seen = opts;
      return ok(PNG_1X1, 'image/png');
    }) as unknown as Fetcher;
    await makeApp(spy);
    const { t, projectId } = await setup();
    expect((await post(projectId, t, 'https://cdn.example.com/photo.png')).statusCode).toBe(201);
    expect(seen?.maxBytes).toBe(15 * 1024 * 1024);
    expect(seen?.maxRedirects).toBe(4);
    expect(seen?.timeoutMs).toBe(10_000);
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect((seen?.signal as AbortSignal).aborted).toBe(false); // armed, not already spent
  });

  it('rejects an invalid body (missing/!url)', async () => {
    await makeApp(fetcherReturning(ok(PNG_1X1, 'image/png')));
    const { t, projectId } = await setup();
    const res = await post(projectId, t, 'not-a-url');
    expect(res.statusCode).toBe(400);
  });

  it('requires auth (401 without a session)', async () => {
    await makeApp(fetcherReturning(ok(PNG_1X1, 'image/png')));
    const { projectId } = await setup();
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/media/import-url`, payload: { url: 'https://cdn.example.com/x.png' } });
    expect(res.statusCode).toBe(401);
  });
});

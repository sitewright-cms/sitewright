import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestDb } from './helpers.js';
import { registerAccount } from '../src/repo/accounts.js';
import { createApp } from '../src/http/app.js';

/**
 * The MEDIA INGRESS routes belong on the agent lane.
 *
 * `rlAgent` exists so an API key — the agent-fleet lane — gets `AGENT_RL_MAX` on the hot-loop routes,
 * because a lower cap there "would just move the wall inward and surface as a TOOL failure instead of a
 * clean, retry-able 429". Every authoring route opted in. The media ingress routes did not: their caps
 * came from the blanket Phase-F rate-limit sweep, where 30 and 20 are shared tiers rather than anything
 * measured about images.
 *
 * ★ Measured on a deployed 768 MB container: 120 concurrent 1600x1067 uploads stored 30 and refused 90
 * with HTTP 429 — in 0.6 seconds, at a peak of 327 MB and ZERO memory-reclaim events. The per-minute
 * counter was the only thing that stopped it; the resource it stands in for was a third spent. A clone
 * importing 2,000-3,400 images paid ~100-170 minutes to that counter alone.
 *
 * What actually bounds this work is purpose-built and unchanged here: the optimize gate (3 concurrent,
 * per-tenant fair), the memory ledger (12 MB reserved per encode, refusing with a retryable 503), the
 * 15 MB image cap, and — for the amplifier path — the large-import gate.
 */

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  db = await makeTestDb();
  // ★ Without a mediaRoot the media routes are never registered and every probe 404s with NO
  // rate-limit headers at all — which reads as "the cap is missing" rather than "the route is".
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-rl-media-'));
  app = await createApp({ db, mediaRoot });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

const sessionCookie = (res: LightMyRequestResponse): string =>
  /sw_session=([^;]+)/.exec(String(res.headers['set-cookie'] ?? ''))?.[1] ?? '';

/** A project owner with a verified API key for it. */
async function setup(): Promise<{ cookie: string; base: string; token: string }> {
  await registerAccount(db, 'owner@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@acme.test', password: 'Pw-secret-1' } });
  const cookie = sessionCookie(login);
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'Site', slug: 'site' } });
  const base = `/projects/${(proj.json() as { project: { id: string } }).project.id}`;
  const key = await app.inject({
    method: 'POST',
    url: `${base}/api-keys`,
    cookies: { sw_session: cookie },
    payload: { name: 'agent', role: 'owner', expiresInDays: 1, capabilities: ['content:read', 'content:write'] },
  });
  expect(key.statusCode, key.body).toBe(201);
  const token = (key.json() as { token: string }).token;
  // ★ WARM the key. The cap is chosen in an onRequest hook, which cannot afford a DB round trip, so
  // `isVerifiedApiKey` reads a cache of hashes that earlier requests already authenticated. A key's
  // FIRST call therefore rides the base cap and only later ones lift — by design, and worth knowing:
  // an agent's very first media call is not the one that gets the lane.
  const warm = await app.inject({ method: 'GET', url: `${base}/content/page`, headers: { authorization: `Bearer ${token}` } });
  expect(warm.statusCode, 'the warm-up call must authenticate').toBe(200);
  return { cookie, base, token };
}

/** The cap the limiter reports for a route — cheaper and more exact than firing hundreds of requests. */
const capFor = (res: LightMyRequestResponse): number => Number(res.headers['x-ratelimit-limit']);

/** Every route by which media ENTERS a project. */
const INGRESS = [
  { what: 'multipart upload', method: 'POST' as const, path: '/media', browser: 30 },
  { what: 'import_image (import-url)', method: 'POST' as const, path: '/media/import-url', browser: 20 },
  { what: 'upload ticket', method: 'POST' as const, path: '/media/upload-ticket', browser: 30 },
];

describe('media ingress rides the agent lane', () => {
  it('★ a key\'s FIRST call rides the base cap — the lift needs a verified hash in hand', async () => {
    // Not a wart to work around: the ceiling is picked before authentication runs, so it can only
    // consult keys some earlier request already proved. Pinned so nobody "fixes" the warm-up away and
    // then wonders why a fresh agent's first import 429s at 30.
    await registerAccount(db, 'fresh@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'fresh@acme.test', password: 'Pw-secret-1' } });
    const cookie = sessionCookie(login);
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'Fresh', slug: 'fresh' } });
    const base = `/projects/${(proj.json() as { project: { id: string } }).project.id}`;
    const key = await app.inject({
      method: 'POST', url: `${base}/api-keys`, cookies: { sw_session: cookie },
      payload: { name: 'agent', role: 'owner', expiresInDays: 1, capabilities: ['content:read', 'content:write'] },
    });
    const token = (key.json() as { token: string }).token;

    const first = await app.inject({ method: 'POST', url: `${base}/media`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(capFor(first)).toBe(30);
    const second = await app.inject({ method: 'POST', url: `${base}/media`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(capFor(second), 'the same key lifts once it has been seen').toBe(600);
  });

  it('★ gives a VERIFIED api key the agent cap on every ingress route', async () => {
    const { base, token } = await setup();
    for (const route of INGRESS) {
      const res = await app.inject({
        method: route.method,
        url: `${base}${route.path}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(capFor(res), `${route.what} must lift for an agent`).toBe(600);
    }
  });

  it('leaves the BROWSER cap exactly where it was — the lift is for api keys only', async () => {
    const { base, cookie } = await setup();
    for (const route of INGRESS) {
      const res = await app.inject({ method: route.method, url: `${base}${route.path}`, cookies: { sw_session: cookie }, payload: {} });
      expect(capFor(res), `${route.what} must not change for a session`).toBe(route.browser);
    }
  });

  it('★ never lifts for a caller who merely CLAIMS to hold a key', async () => {
    // The lift is gated on a VERIFIED key, not on the presence of a bearer — otherwise the cheapest
    // possible forgery would buy 600/min on the routes that fetch from third parties.
    const { base } = await setup();
    const forged = { authorization: 'Bearer swk_0000000000000000000000000000000000000000000000000000000000000000' };
    for (const route of INGRESS) {
      const res = await app.inject({ method: route.method, url: `${base}${route.path}`, headers: forged, payload: {} });
      expect(capFor(res), `${route.what} must not lift for a forged bearer`).toBe(route.browser);
    }
  });

  it('does NOT leak the lift into `rl()` itself — a neighbouring media route keeps its own cap', async () => {
    // The sharpest probe against a tier-wide accident: media/folders sits at rl(60) and must stay there.
    const { base, token } = await setup();
    const res = await app.inject({ method: 'POST', url: `${base}/media/folders`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(capFor(res)).toBe(60);
  });
});

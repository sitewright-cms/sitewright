import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await createApp({ db: await makeTestDb() });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('rate limiting', () => {
  it('429s after the per-route auth limit is exceeded', async () => {
    // The /auth/login route is capped at 10/min per key (IP here, no session).
    const codes: number[] = [];
    for (let i = 0; i < 13; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever' },
      });
      codes.push(res.statusCode);
    }
    // The first 10 are processed (401 — bad creds), then the limiter kicks in.
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes[codes.length - 1]).toBe(429);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
  });

  it('sets rate-limit headers on a normal response', async () => {
    // A route under the GLOBAL limiter carries the headers. (/health is deliberately rate-limit-EXEMPT —
    // a zero-cost liveness probe from an LB/orchestrator must never be throttled into a false "down".)
    const res = await app.inject({ method: 'GET', url: '/version' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('exempts /health but gives /ready its own generous bucket (not the global one, not fully exempt)', async () => {
    // /health: zero-cost literal ⇒ fully exempt (no limiter headers).
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-ratelimit-limit']).toBeUndefined();

    // /ready: does real DB I/O ⇒ a dedicated 60/min bucket so it can't be an unauthenticated DB amplifier.
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.headers['x-ratelimit-limit']).toBe('60');
  });

  // A preview page view fans out into MANY asset sub-requests. If the static-asset + signed-preview routes
  // shared the global 200/min bucket, that fan-out would exhaust it and 429 the HTML document itself
  // (a blank preview until reload). Each of these routes must have its OWN, higher, isolated bucket.
  it('serves >200 /media asset requests without 429 (isolated bucket, above the global cap)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 220; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/media/none/none/font-${i}.woff2` });
      codes.push(res.statusCode);
    }
    // On the shared global 200/min cap, requests 201+ would be 429. The isolated MEDIA_ASSET_RL_MAX bucket
    // lets them all through to the handler (404 — the asset doesn't exist), never rate-limited.
    expect(codes.some((c) => c === 429)).toBe(false);
    expect(codes.slice(200).every((c) => c === 404)).toBe(true);
  });

  it('serves >200 signed-preview asset requests without 429 (isolated bucket)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 220; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/preview-site/none/none/asset-${i}.css` });
      codes.push(res.statusCode);
    }
    // Bad sig → deterministic 404; asserting it confirms the route is actually hit (not silently misrouted)
    // and that the isolated PREVIEW_SITE_RL_MAX bucket never 429s under the fan-out.
    expect(codes.some((c) => c === 429)).toBe(false);
    expect(codes.every((c) => c === 404)).toBe(true);
  });
});

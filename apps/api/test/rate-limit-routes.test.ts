import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

/**
 * PER-ROUTE rate-limit coverage at the HTTP layer.
 *
 * This suite EXTENDS apps/api/test/rate-limit.test.ts (which covers the GLOBAL
 * cap of 200/min) by exercising the stricter per-route caps declared in
 * apps/api/src/http/app.ts via `config: rl(max)` — `rl` being
 * `(max) => ({ rateLimit: { max, timeWindow: '1 minute' } })`.
 *
 * Caps confirmed from source (apps/api/src/http/app.ts):
 *   - POST /auth/register .......................... rl(10)
 *   - POST /auth/login ............................. rl(10)
 *   - DELETE /orgs/:orgId/projects/:id ............. rl(20)   <-- newly added
 *   - POST .../media ............................... rl(30)
 *   - POST .../publish, .../publish/deploy, .../import . rl(20)
 *   - POST .../preview ............................. rl(120)
 *
 * KEYING / SCOPING (verified against @fastify/rate-limit@10.3.0 source):
 *   The limiter is registered with `keyGenerator: (req) => sessionToken(req) ?? req.ip`.
 *   In tests `req.ip` is constant (127.0.0.1) and the auth routes carry no
 *   session, so every request to a given route shares ONE key. Crucially, each
 *   route that declares an object `config.rateLimit` gets its OWN store via
 *   `store.child(...)` (a fresh `LocalStore` / LRU map) — see index.js L147 and
 *   store/LocalStore.js. Therefore per-route counters are INDEPENDENT of one
 *   another AND of the global bucket, even when the resolved key is identical.
 *   Case 2 asserts that independence directly.
 *
 * DETERMINISM: the window is '1 minute'. Each test fires its requests in a tight
 * synchronous-await loop with no sleeps, so they all fall inside one window —
 * no wall-clock dependence. A fresh app (fresh in-memory LRU stores) is built
 * per test via `beforeEach`, so counters never bleed across tests.
 */

const LOGIN_CAP = 10;
const REGISTER_CAP = 10;
const PROJECT_DELETE_CAP = 20;

// Mirrors apps/api/test/rate-limit.test.ts setup exactly: a bare app over a
// fresh migrated temp DB. Used for the auth-route cases (no session needed).
let app: FastifyInstance;
let harness: Harness;

beforeEach(async () => {
  app = await createApp({ db: await makeTestDb() });
  await app.ready();
  // Separate harness instance (its own app + DB) for the authenticated
  // DELETE-route case. Kept distinct so the auth-route apps stay session-free,
  // matching how the global suite drives /auth/login.
  harness = await makeHarness();
});

/** Fires `count` POSTs at `url` with a fixed payload; returns the status codes. */
async function fireBurst(
  instance: FastifyInstance,
  url: string,
  payload: Record<string, unknown>,
  count: number,
): Promise<number[]> {
  const codes: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await instance.inject({ method: 'POST', url, payload });
    codes.push(res.statusCode);
  }
  return codes;
}

describe('per-route rate limiting', () => {
  it('429s a route once its per-route cap is exceeded (POST /auth/login, rl(10))', async () => {
    // Fire cap + 1 requests within one window. Bad creds => 401 pre-cap; the
    // over-cap request is short-circuited by the limiter => 429.
    const codes = await fireBurst(
      app,
      '/auth/login',
      { email: 'nobody@example.com', password: 'whatever' },
      LOGIN_CAP + 1,
    );

    // First `cap` requests reach the handler (401, not rate-limited).
    expect(codes.slice(0, LOGIN_CAP).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(0, LOGIN_CAP).every((c) => c === 401)).toBe(true);
    // The (cap+1)th is rejected by the per-route limiter.
    expect(codes[LOGIN_CAP]).toBe(429);
  });

  it('keeps per-route counters INDEPENDENT across routes (exhausting /auth/login does not 429 /auth/register)', async () => {
    // Exhaust the /auth/login bucket (cap+1 => last one 429).
    const loginCodes = await fireBurst(
      app,
      '/auth/login',
      { email: 'nobody@example.com', password: 'whatever' },
      LOGIN_CAP + 1,
    );
    expect(loginCodes[LOGIN_CAP]).toBe(429);

    // A DIFFERENT route (/auth/register) shares the same key (constant IP, no
    // session) but has its own child store. One register call must NOT be 429.
    // Use a unique email so it succeeds (201) rather than conflicting (409) —
    // either way the load-bearing assertion is "not 429".
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: `indep-${randomUUID()}@test.local`,
        password: 'pw-secret-1',
        orgName: `Org ${randomUUID().slice(0, 8)}`,
      },
    });
    expect(reg.statusCode).not.toBe(429);
    expect(reg.statusCode).toBe(201);

    // And /auth/register can be driven all the way to its own independent cap,
    // proving its counter started fresh (was not pre-consumed by the login burst).
    // We already used 1 register slot above, so fire the remaining cap, then 1 over.
    const more = await fireBurst(
      app,
      '/auth/register',
      // Reuse a colliding payload: pre-cap these return 409 (conflict) or 201;
      // the only assertion that matters is the cap boundary below.
      { email: `dup-${randomUUID()}@test.local`, password: 'pw-secret-1', orgName: 'Dup Org' },
      REGISTER_CAP, // 1 already consumed + this many => crosses the cap on the last
    );
    // We've now issued 1 + REGISTER_CAP = cap+1 register requests total. The
    // final one must be the route's own 429 — confirming an independent counter.
    expect(more[more.length - 1]).toBe(429);
    // Sanity: at least one earlier register request was processed (not 429),
    // i.e. the register bucket was not already exhausted by the login burst.
    expect(more.slice(0, REGISTER_CAP - 1).some((c) => c !== 429)).toBe(true);
  });

  it('enforces rl(20) on DELETE /orgs/:orgId/projects/:id (over-cap => 429)', async () => {
    const client: TestClient = await harness.signup();
    // Hit a non-existent project id under the user's own org. The rate-limit
    // hook runs at `onRequest` (before the handler), so each request is counted
    // regardless of the 404 the handler would otherwise produce. Using a single
    // fixed missing id keeps every pre-cap response a uniform 404.
    const missingId = `proj-${randomUUID()}`;
    const url = `/orgs/${client.orgId}/projects/${missingId}`;

    const codes: number[] = [];
    for (let i = 0; i < PROJECT_DELETE_CAP + 1; i += 1) {
      const res = await client.del(url);
      codes.push(res.statusCode);
    }

    // Pre-cap: authenticated + authorized, but project missing => 404, never 429.
    expect(codes.slice(0, PROJECT_DELETE_CAP).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(0, PROJECT_DELETE_CAP).every((c) => c === 404)).toBe(true);
    // Over-cap request is rejected by the per-route limiter.
    expect(codes[PROJECT_DELETE_CAP]).toBe(429);
  });
});

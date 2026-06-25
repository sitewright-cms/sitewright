import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { createInvite } from '../src/repo/invites.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

/**
 * Rate-limit / brute-force coverage at the HTTP layer.
 *
 * Auth rate-limiting after the env-slimming refactor:
 *   - /auth/login + /auth/login/totp: a per-IP FAILED-attempt throttle (admin `authMaxFailures`, default
 *     10) — only failed credential checks count, a successful login never consumes the budget. Over → 429.
 *   - /auth/register: only the GLOBAL 200/min limiter (so the E2E harness can register freely).
 *   - The OTHER credential-verifying / sensitive auth routes (account password/email, MFA, passkey,
 *     OIDC) keep a fixed per-route `rl(20)` all-requests cap.
 *   - DELETE /projects = its own rl(20), unaffected.
 *
 * Each test builds a fresh app (fresh in-memory throttle + limiter stores) so counters never bleed.
 */

const LOGIN_FAIL_CAP = 10; // DEFAULT_AUTH_MAX_FAILURES
const PROJECT_DELETE_CAP = 20;

let app: FastifyInstance;
let db: Database;
let harness: Harness;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db });
  await app.ready();
  harness = await makeHarness();
});

async function fireBurst(instance: FastifyInstance, url: string, payload: Record<string, unknown>, count: number): Promise<number[]> {
  const codes: number[] = [];
  for (let i = 0; i < count; i += 1) codes.push((await instance.inject({ method: 'POST', url, payload })).statusCode);
  return codes;
}

describe('login failed-attempt throttle', () => {
  it('429s after the failed-login cap; the first `cap` bad attempts are 401', async () => {
    const codes = await fireBurst(app, '/auth/login', { email: 'nobody@example.com', password: 'whatever' }, LOGIN_FAIL_CAP + 1);
    expect(codes.slice(0, LOGIN_FAIL_CAP).every((c) => c === 401)).toBe(true);
    expect(codes[LOGIN_FAIL_CAP]).toBe(429);
  });

  it('a SUCCESSFUL login never consumes the budget (can log in many times past the cap)', async () => {
    // Seed the account directly (the register route is invite-only) so we can burst-login it.
    const email = `ok-${randomUUID()}@test.local`;
    await registerAccount(db, email, 'Pw-secret-1');
    const codes = await fireBurst(app, '/auth/login', { email, password: 'Pw-secret-1' }, LOGIN_FAIL_CAP + 5);
    expect(codes.every((c) => c === 200)).toBe(true); // never 429 — successes don't count
  });

  it('exhausting the login throttle does NOT block /auth/register (register is not on the throttle)', async () => {
    // Mint a pending invite so the email may register at all (registration is invite-only); the point
    // here is the THROTTLE, not the gate — an exhausted login throttle must not bleed into register.
    const inviterId = (await registerAccount(db, `inviter-${randomUUID()}@test.local`, 'Pw-secret-1', { platformRole: 'admin' })).userId;
    const invitedEmail = `r-${randomUUID()}@test.local`;
    await createInvite(db, inviterId, { email: invitedEmail, role: 'developer' });

    const loginCodes = await fireBurst(app, '/auth/login', { email: 'nobody@example.com', password: 'whatever' }, LOGIN_FAIL_CAP + 1);
    expect(loginCodes[LOGIN_FAIL_CAP]).toBe(429);
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: invitedEmail, password: 'Pw-secret-1' } });
    expect(reg.statusCode).toBe(201); // not 429 — register only sees the global 200/min limiter
  });

  it('respects the admin authMaxFailures setting (lowering it tightens the throttle, no restart)', async () => {
    const adb = await makeTestDb();
    const a = await createApp({ db: adb });
    await a.ready();
    // Seed an instance admin directly (register is invite-only) and log in, then lower the cap to 2.
    await registerAccount(adb, 'admin@x.test', 'Pw-secret-1', { platformRole: 'admin' });
    const login = await a.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@x.test', password: 'Pw-secret-1' } });
    const cookie = login.cookies.find((c) => c.name === 'sw_session')!.value;
    expect((await a.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: cookie }, payload: { authMaxFailures: 2 } })).statusCode).toBe(200);

    const codes = await fireBurst(a, '/auth/login', { email: 'nobody@x.test', password: 'whatever' }, 3);
    expect(codes.slice(0, 2).every((c) => c === 401)).toBe(true);
    expect(codes[2]).toBe(429); // tightened to 2 failures
    await a.close();
  });

  it('still enforces rl(20) on DELETE /projects/:id (a route with its own per-route cap)', async () => {
    const client: TestClient = await harness.signup();
    const url = `/projects/proj-${randomUUID()}`;
    const codes: number[] = [];
    for (let i = 0; i < PROJECT_DELETE_CAP + 1; i += 1) codes.push((await client.del(url)).statusCode);
    expect(codes.slice(0, PROJECT_DELETE_CAP).every((c) => c === 403)).toBe(true);
    expect(codes[PROJECT_DELETE_CAP]).toBe(429);
  });
});

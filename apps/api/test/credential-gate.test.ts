import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { MemberTokenRepository } from '../src/repo/member-tokens.js';
import { credentialRequiredBeforeBody, requestCarriesBody } from '../src/http/credential-gate.js';
import { collectRoutes } from './contract-helpers.js';

/**
 * A CREDENTIAL BEFORE THE BODY. The authenticated API asks who is calling inside each handler, after
 * Fastify has read and parsed the body — up to 60 MiB for a message to the on-page agent. A caller with no
 * credential is now refused before that work.
 *
 * The proof used throughout: a MALFORMED JSON body. When the parser runs, it answers 400; when the check
 * runs first, the answer is 401. So "401 for malformed JSON" means the body was never parsed, and "400"
 * with a credential shows the same request does reach the parser.
 */

const MALFORMED = '{"source": "<h1>never parsed'; // unterminated: JSON.parse would throw
const JSON_HEADERS = { 'content-type': 'application/json' };
const ZERO_KEY = `swk_${'0'.repeat(64)}`;
const ZERO_MEMBER = `swm_${'0'.repeat(64)}`;

describe('credentialRequiredBeforeBody', () => {
  it('covers writes under /projects, /admin, /account and /invites', () => {
    expect(credentialRequiredBeforeBody('POST', '/projects')).toBe(true);
    expect(credentialRequiredBeforeBody('PUT', '/projects/:projectId/content/:kind/:entityId')).toBe(true);
    expect(credentialRequiredBeforeBody('POST', '/projects/:projectId/agent/messages')).toBe(true);
    expect(credentialRequiredBeforeBody('PATCH', '/admin/settings')).toBe(true);
    expect(credentialRequiredBeforeBody('DELETE', '/account/passkeys/:id')).toBe(true);
    expect(credentialRequiredBeforeBody('DELETE', '/invites/:id')).toBe(true);
    expect(credentialRequiredBeforeBody('POST', '/invites/accept')).toBe(true); // the invitee signs in first
  });

  it('leaves reads, unknown routes and the public write routes alone', () => {
    expect(credentialRequiredBeforeBody('GET', '/projects/:projectId/pages')).toBe(false);
    expect(credentialRequiredBeforeBody('HEAD', '/projects')).toBe(false);
    expect(credentialRequiredBeforeBody('POST', undefined)).toBe(false);
    expect(credentialRequiredBeforeBody('POST', '/f/:projectId/:formId')).toBe(false);
    expect(credentialRequiredBeforeBody('POST', '/auth/login')).toBe(false);
    // A prefix is a whole path segment: a route that merely STARTS with the letters is not covered.
    expect(credentialRequiredBeforeBody('POST', '/projectsx')).toBe(false);
    expect(credentialRequiredBeforeBody('POST', '/administer')).toBe(false);
  });
});

describe('requestCarriesBody', () => {
  it('a declared length above zero, or a chunked transfer', () => {
    expect(requestCarriesBody({ 'content-length': '12' })).toBe(true);
    expect(requestCarriesBody({ 'transfer-encoding': 'chunked' })).toBe(true);
    expect(requestCarriesBody({ 'content-length': '0' })).toBe(false);
    expect(requestCarriesBody({})).toBe(false);
  });
});

// Every write route the app registers must be PLACED: it needs a credential before its body (the gate), it
// checks its own credential before its body, or it is public. A new route fails this test until someone has
// decided which, rather than slipping in on whichever side the prefix happens to put it. An AUTHENTICATED
// route outside the gate's prefixes belongs in neither list below: widen the prefixes in credential-gate.ts.
const OWN_CHECK: Record<string, string> = {
  'POST /mcp': 'its bearer, before the body (mcp-routes authenticateFirst), answering with the OAuth challenge',
  'PUT /media-upload/:token': 'the upload ticket, before the body (uploadTickets.has)',
};
const PUBLIC_WRITES: Record<string, string> = {
  'POST /a/:projectId': 'statistics beacon (anonymous, 1 KB)',
  'POST /auth/login': 'sign-in',
  'POST /auth/login/totp': 'sign-in, second step',
  'POST /auth/logout': 'must work with an expired session',
  'POST /auth/passkey/options': 'sign-in',
  'POST /auth/passkey/verify': 'sign-in',
  'POST /auth/register': 'invite-only sign-up',
  'POST /b/:projectId/:offeringId': 'public booking',
  'POST /b/:projectId/_booking/:reference/cancel': 'public booking',
  'POST /b/:projectId/_booking/:reference/pay': 'public booking',
  'POST /f/:projectId/:formId': 'public form',
  'POST /f/:projectId/:formId/preview': 'public form',
  'DELETE /mcp': '405',
  'POST /oauth/authorize': 'consent form; signs in or renders a page',
  'POST /oauth/device': 'device verification form',
  'POST /oauth/device_authorization': 'OAuth, public',
  'POST /oauth/register': 'OAuth dynamic client registration, public',
  'POST /oauth/token': 'OAuth, public',
  'POST /pay/:projectId/:channelKey': 'public checkout',
  'POST /pay/:projectId/webhook/:gatewayId': 'payment provider webhook, signature-checked',
};

describe('every write route is placed', () => {
  it('needs a credential before its body, checks its own, or is a listed public route', async () => {
    const routes = collectRoutes();
    const root = await mkdtemp(join(tmpdir(), 'sw-gate-inventory-'));
    try {
      // The contract test's production-shaped app (contract-http.test.ts): the routes behind an option
      // (media, publish, preview, and everything that stores a secret) are registered too.
      const inventoryApp = await createApp({
        db: await makeTestDb(),
        onRoute: routes.onRoute,
        mediaRoot: join(root, 'media'),
        publishRoot: join(root, 'sites'),
        previewRoot: join(root, 'preview'),
        dataDir: root,
        encryptionKey: randomBytes(32),
      });
      await inventoryApp.ready();
      const writes = routes.inventory().filter((r) => !/^(?:GET|HEAD|OPTIONS) /.test(r));
      // Presence guard: the production-shaped app registers well over a hundred writes, the 60 MiB one among them.
      expect(writes.length).toBeGreaterThan(150);
      expect(writes).toContain('POST /projects/:projectId/agent/messages');
      const unplaced = writes.filter((r) => {
        const [method, url] = r.split(' ') as [string, string];
        return !credentialRequiredBeforeBody(method, url) && !(r in OWN_CHECK) && !(r in PUBLIC_WRITES);
      });
      expect(unplaced, 'gate it (credential-gate.ts), or list it with what protects it instead').toEqual([]);
      // …and the lists hold no route that no longer exists, or that the gate covers anyway.
      for (const r of [...Object.keys(OWN_CHECK), ...Object.keys(PUBLIC_WRITES)]) {
        expect(writes, `${r} is listed but not registered`).toContain(r);
        const [method, url] = r.split(' ') as [string, string];
        expect(credentialRequiredBeforeBody(method, url), `${r} is listed but gated`).toBe(false);
      }
      await inventoryApp.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('the server refuses before it parses', () => {
  let app: FastifyInstance;
  let db: Database;
  let cookie: string;
  let projectId: string;
  let staffId: string;

  beforeEach(async () => {
    db = await makeTestDb();
    app = await createApp({ db, encryptionKey: randomBytes(32) });
    await app.ready();
    staffId = (await registerAccount(db, 'gate@e.test', 'Pw-secret-1', { platformRole: 'developer' })).userId;
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'gate@e.test', password: 'Pw-secret-1' } });
    cookie = login.cookies.find((c) => c.name === 'sw_session')!.value;
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'Site', slug: 'gate' } });
    projectId = (proj.json() as { project: { id: string } }).project.id;
  });
  afterEach(async () => {
    await app.close();
  });

  const save = (opts: { cookie?: string; bearer?: string; payload?: string; project?: string } = {}) =>
    app.inject({
      method: 'PUT',
      url: `/projects/${opts.project ?? projectId}/content/page/about`,
      headers: { ...JSON_HEADERS, ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}) },
      ...(opts.cookie ? { cookies: { sw_session: opts.cookie } } : {}),
      ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
    });

  it('★ no credential: 401 before the body is parsed', async () => {
    const res = await save({ payload: MALFORMED });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'authentication required' });
  });

  it('a live session reaches the parser (the same request, now a 400)', async () => {
    const res = await save({ cookie, payload: MALFORMED });
    expect(res.statusCode).toBe(400);
  });

  it('a live project key reaches the parser; a dead one is refused with the route’s own message', async () => {
    const key = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/api-keys`,
      cookies: { sw_session: cookie },
      payload: { name: 'agent', role: 'owner', capabilities: ['content:read', 'content:write'], expiresInDays: 30 },
    });
    expect(key.statusCode).toBe(201);
    const token = (key.json() as { token: string }).token;
    expect((await save({ bearer: token, payload: MALFORMED })).statusCode).toBe(400);

    const dead = await save({ bearer: ZERO_KEY, payload: MALFORMED });
    expect(dead.statusCode).toBe(401);
    expect(dead.json()).toEqual({ error: 'invalid or expired API key' });
    // Not even shaped like ours.
    expect((await save({ bearer: 'not-a-sitewright-token', payload: MALFORMED })).statusCode).toBe(401);
  });

  it('a live member token reaches the parser; a dead one is refused', async () => {
    const { token } = await new MemberTokenRepository(db).create(staffId, {
      name: 'automation',
      capabilities: ['content:read', 'content:write'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    expect((await save({ bearer: token, payload: MALFORMED })).statusCode).toBe(400);
    const dead = await save({ bearer: ZERO_MEMBER, payload: MALFORMED });
    expect(dead.statusCode).toBe(401);
    expect(dead.json()).toEqual({ error: 'invalid or expired API key' });
  });

  it('a request without a body keeps the route’s own answer', async () => {
    // The global library is refused by the route itself (404) before it asks who is calling. With no body
    // the gate stays out of the way, so that is still the answer; with one, the credential comes first.
    expect((await save({ project: '__global__' })).statusCode).toBe(404);
    expect((await save({ project: '__global__', payload: MALFORMED })).statusCode).toBe(401);
  });

  it('a well-formed write with a credential still saves (nothing else changed for real callers)', async () => {
    const res = await save({ cookie, payload: JSON.stringify({ id: 'about', path: 'about', title: 'About', source: '<h1>Hi</h1>' }) });
    expect(res.statusCode, res.body).toBeLessThan(300);
  });

  // The gate is one app-level hook; these show it runs on routes from every prefix and from the route
  // modules registered outside app.ts, not only on the content save above.
  it.each([
    ['POST', () => '/admin/invites'],
    ['PUT', () => '/account/password'],
    ['POST', () => '/invites/accept'],
    ['POST', (p: string) => `/projects/${p}/agent/messages`], // 60 MiB limit
    ['POST', (p: string) => `/projects/${p}/booking/calendars`], // booking-calendar-routes.ts
  ] as const)('%s on another route: 401 without a credential, the parser with one', async (method, url) => {
    const send = (cookies?: Record<string, string>) =>
      app.inject({ method, url: url(projectId), headers: JSON_HEADERS, payload: MALFORMED, ...(cookies ? { cookies } : {}) });
    expect((await send()).statusCode).toBe(401);
    expect((await send({ sw_session: cookie })).statusCode).toBe(400);
  });

  it('identity only: the route still applies its own rules to a caller the gate let through', async () => {
    const key = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/api-keys`,
      cookies: { sw_session: cookie },
      payload: { name: 'agent', role: 'owner', capabilities: ['content:read'], expiresInDays: 30 },
    });
    const token = (key.json() as { token: string }).token;
    const page = JSON.stringify({ id: 'about', path: 'about', title: 'About' });
    // A live session AND a live key: the gate is satisfied by the session, the route refuses the pair.
    const both = await save({ cookie, bearer: token, payload: page });
    expect(both.statusCode).toBe(401);
    expect(both.json()).toEqual({ error: 'supply either a session cookie or a Bearer token, not both' });
    // A key without content:write passes the gate (it is live) and meets the route's capability check.
    expect((await save({ bearer: token, payload: page })).statusCode).toBe(403);
  });

  it('a key revoked while the body is still arriving is refused by the route', async () => {
    const minted = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/api-keys`,
      cookies: { sw_session: cookie },
      payload: { name: 'agent', role: 'owner', capabilities: ['content:read', 'content:write'], expiresInDays: 30 },
    });
    const { token, key } = minted.json() as { token: string; key: { id: string } };
    const body = new PassThrough();
    const pending = app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/page/about`,
      // A streamed body has no length, so it is sent chunked, as a real client would.
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}`, 'transfer-encoding': 'chunked' },
      payload: body,
    });
    body.write('{"id":"about","path":"about",');
    // The body is read only once the gate has let the key through — wait until the first part is taken.
    for (let i = 0; i < 200 && body.readableLength > 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(body.readableLength).toBe(0); // presence guard: the key passed the gate, live
    const revoked = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/api-keys/${key.id}`, cookies: { sw_session: cookie } });
    expect(revoked.statusCode).toBeLessThan(300);
    body.end('"title":"About"}');
    const res = await pending;
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid or expired API key' });
  });

  it('a session that must replace its password passes the gate and meets the forced-change refusal', async () => {
    await registerAccount(db, 'forced@e.test', 'Pw-secret-1', { mustChangePassword: true });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'forced@e.test', password: 'Pw-secret-1' } });
    const forced = login.cookies.find((c) => c.name === 'sw_session')!.value;
    const res = await save({ cookie: forced, payload: JSON.stringify({ id: 'about', path: 'about', title: 'About' }) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'password-change-required' });
  });

  it('public write routes still parse without a credential', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', headers: JSON_HEADERS, payload: MALFORMED });
    expect(res.statusCode).toBe(400);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { addProjectMember } from '../src/repo/accounts.js';
import type { Database } from '../src/db/client.js';

let app: FastifyInstance;
let db: Database;
let publishRoot: string;
const encryptionKey = randomBytes(32);

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-keys-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot, encryptionKey });
  await app.ready();
});
afterEach(async () => {
  await rm(publishRoot, { recursive: true, force: true });
});

function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, slug = 'site') {
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'pw-secret-1' },
  });
  const t = sessionCookie(reg);
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

function createKey(base: string, cookie: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `${base}/api-keys`,
    cookies: { sw_session: cookie },
    // The registering user is the project owner, so they may mint an owner-scoped key.
    payload: { name: 'k', role: 'owner', expiresInDays: 30, ...body },
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('project API keys — management', () => {
  it('creates a key (token returned once, never on list) and lists it redacted', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;

    const created = await createKey(base, t, { capabilities: ['content:read', 'content:write'] });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { token: string; key: { id: string; tokenPrefix: string } };
    expect(body.token.startsWith('swk_')).toBe(true);

    const list = await app.inject({ method: 'GET', url: `${base}/api-keys`, cookies: { sw_session: t } });
    const items = (list.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain(body.token);
    expect(items[0]).not.toHaveProperty('tokenHash');
    expect(items[0]!.tokenPrefix).toBe(body.key.tokenPrefix);
  });

  it('requires a session to manage keys, and lets the owner mint an owner-scoped key', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    // No auth at all → 401 (the member/non-writer role gate is covered in the repo suite).
    expect((await app.inject({ method: 'GET', url: `${base}/api-keys` })).statusCode).toBe(401);
    // The registering user is the org owner, so an owner-scoped key is permitted.
    expect((await createKey(base, t, { role: 'owner', capabilities: ['content:read'] })).statusCode).toBe(201);
  });
});

describe('project API keys — bearer auth + capabilities', () => {
  let seq = 0;
  async function keyWith(caps: string[], role = 'owner') {
    seq += 1;
    // Distinct, instance-unique slug per call so two tenants in one test don't collide.
    const { t, projectId } = await setup(`u${seq}@acme.test`, `site-${seq}`);
    const base = `/projects/${projectId}`;
    const res = await createKey(base, t, { capabilities: caps, role });
    const token = (res.json() as { token: string }).token;
    return { token, base, projectId, t };
  }

  it('authenticates content reads with a content:read token', async () => {
    const { token, base } = await keyWith(['content:read']);
    const res = await app.inject({ method: 'GET', url: `${base}/content/page`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
  });

  it('denies writes to a read-only token but allows them with content:write', async () => {
    const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };

    const ro = await keyWith(['content:read']);
    const denied = await app.inject({
      method: 'PUT',
      url: `${ro.base}/content/page/home`,
      headers: bearer(ro.token),
      payload: page,
    });
    expect(denied.statusCode).toBe(403);

    const rw = await keyWith(['content:read', 'content:write']);
    const ok = await app.inject({
      method: 'PUT',
      url: `${rw.base}/content/page/home`,
      headers: bearer(rw.token),
      payload: page,
    });
    expect(ok.statusCode).toBe(200);
  });

  it('confines a token to its own project (cross-project → 404)', async () => {
    const a = await keyWith(['content:read', 'content:write']);
    // A second project (distinct instance-unique slug); A's token must not reach it.
    const b = await setup('b@globex.test', 'globex-site');
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${b.projectId}/content/page`,
      headers: bearer(a.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it('forbids session-only operations to any token (key management, AI)', async () => {
    const { token, base } = await keyWith(['content:read', 'content:write', 'publish', 'deploy']);
    // A token cannot mint more tokens, even with every capability.
    const mint = await app.inject({
      method: 'POST',
      url: `${base}/api-keys`,
      headers: bearer(token),
      payload: { name: 'x', capabilities: ['content:read'], expiresInDays: 1 },
    });
    expect(mint.statusCode).toBe(403);
    // …nor list them.
    expect((await app.inject({ method: 'GET', url: `${base}/api-keys`, headers: bearer(token) })).statusCode).toBe(403);
  });

  it('rejects publish/deploy without the matching capability', async () => {
    const { token, base } = await keyWith(['content:read', 'content:write']);
    const pub = await app.inject({ method: 'POST', url: `${base}/publish`, headers: bearer(token) });
    expect(pub.statusCode).toBe(403);
    const dep = await app.inject({
      method: 'POST',
      url: `${base}/publish/deploy`,
      headers: bearer(token),
      payload: { protocol: 'sftp', host: 'h', user: 'u', password: 'p' },
    });
    expect(dep.statusCode).toBe(403);
  });

  it('introspects its own scope via GET /api-key/self (no secret leaked)', async () => {
    const { token, projectId, t } = await keyWith(['content:read', 'publish']);
    const res = await app.inject({ method: 'GET', url: '/api-key/self', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projectId,
      role: 'owner',
      capabilities: ['content:read', 'publish'],
      // The effective agent instructions (default here — no admin override) ride along so the bridge
      // can set them without an extra round-trip.
      agentInstructions: expect.any(String),
    });
    // Unauthenticated / unknown token → 401.
    expect((await app.inject({ method: 'GET', url: '/api-key/self' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api-key/self', headers: bearer('swk_nope') })).statusCode,
    ).toBe(401);
    // Ambiguous dual-credential (cookie + bearer) → 401, consistent with project routes.
    expect(
      (await app.inject({ method: 'GET', url: '/api-key/self', headers: bearer(token), cookies: { sw_session: t } }))
        .statusCode,
    ).toBe(401);
  });

  it('rejects an ambiguous request carrying BOTH a session cookie and a bearer token', async () => {
    const { token, base, t } = await keyWith(['content:read']);
    const res = await app.inject({
      method: 'GET',
      url: `${base}/content/page`,
      headers: bearer(token),
      cookies: { sw_session: t },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown or malformed bearer token', async () => {
    const { base } = await keyWith(['content:read']);
    const res = await app.inject({ method: 'GET', url: `${base}/content/page`, headers: bearer('swk_bogus') });
    expect(res.statusCode).toBe(401);
  });

  it('stops working once revoked', async () => {
    const { token, base, t } = await keyWith(['content:read']);
    const list = await app.inject({ method: 'GET', url: `${base}/api-keys`, cookies: { sw_session: t } });
    const keyId = (list.json() as { items: Array<{ id: string }> }).items[0]!.id;
    await app.inject({ method: 'DELETE', url: `${base}/api-keys/${keyId}`, cookies: { sw_session: t } });
    const res = await app.inject({ method: 'GET', url: `${base}/content/page`, headers: bearer(token) });
    expect(res.statusCode).toBe(401);
  });
});

describe('agent connections — list + disconnect', () => {
  it('lists an active PAT as a connection (kind=pat, no secrets) and is session-gated', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const created = await createKey(base, t, { capabilities: ['content:read', 'content:write'] });
    const token = (created.json() as { token: string }).token;

    const res = await app.inject({ method: 'GET', url: `${base}/agent-connections`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'pat', name: 'k', role: 'owner' });
    expect(items[0]).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(items)).not.toContain(token);

    // No session → 401; a bearer token (even all-caps) → 403 (session-only management surface).
    expect((await app.inject({ method: 'GET', url: `${base}/agent-connections` })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: `${base}/agent-connections`, headers: bearer(token) })).statusCode,
    ).toBe(403);
  });

  it('disconnects a PAT connection (it drops off the list and the token stops working)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const token = (
      (await createKey(base, t, { capabilities: ['content:read'] })).json() as { token: string }
    ).token;
    const id = (
      (await app.inject({ method: 'GET', url: `${base}/agent-connections`, cookies: { sw_session: t } })).json() as {
        items: Array<{ id: string }>;
      }
    ).items[0]!.id;

    const del = await app.inject({ method: 'DELETE', url: `${base}/agent-connections/${id}`, cookies: { sw_session: t } });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `${base}/agent-connections`, cookies: { sw_session: t } });
    expect((after.json() as { items: unknown[] }).items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `${base}/content/page`, headers: bearer(token) })).statusCode).toBe(401);
  });

  it('treats an oauth:<userId> disconnect as a project-scoped no-op when there is no such session', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    // Well-formed handle, no matching session → 204 (idempotent), confined to this project.
    const del = await app.inject({
      method: 'DELETE',
      url: `${base}/agent-connections/${encodeURIComponent('oauth:nobody')}`,
      cookies: { sw_session: t },
    });
    expect(del.statusCode).toBe(204);
    // And it's session-gated like the rest of the management surface.
    expect(
      (await app.inject({ method: 'DELETE', url: `${base}/agent-connections/${encodeURIComponent('oauth:nobody')}` }))
        .statusCode,
    ).toBe(401);
  });

  it('forbids a project MEMBER (non-owner) from listing or disconnecting — including the oauth: path', async () => {
    const { projectId } = await setup('owner@acme.test');
    const base = `/projects/${projectId}`;
    // A second user, added as a plain member of the same project.
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'member@acme.test', password: 'pw-secret-1' } });
    const memberCookie = sessionCookie(reg);
    const memberId = (reg.json() as { userId: string }).userId;
    await addProjectMember(db, memberId, projectId, 'member');

    // List → 403 (the route's own owner gate, not just the inner repo throw).
    expect((await app.inject({ method: 'GET', url: `${base}/agent-connections`, cookies: { sw_session: memberCookie } })).statusCode).toBe(403);
    // Disconnect via the oauth: path → 403 (this path bypasses apiKeysRepo.revoke's role check).
    expect(
      (await app.inject({
        method: 'DELETE',
        url: `${base}/agent-connections/${encodeURIComponent(`oauth:${memberId}`)}`,
        cookies: { sw_session: memberCookie },
      })).statusCode,
    ).toBe(403);
  });
});

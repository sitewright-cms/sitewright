import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ApiKeyRepository, MAX_API_KEY_TTL_MS } from '../src/repo/api-keys.js';
import { ForbiddenError, NotFoundError, type ProjectContext } from '../src/repo/context.js';
import { hashApiToken } from '../src/auth/api-keys.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let keys: ApiKeyRepository;
let pctxA: ProjectContext; // owner of project A
let pctxB: ProjectContext; // owner of project B (a different project — isolation is by projectId)
let memberCtxA: ProjectContext; // a 'member' (cannot manage keys) on project A

const future = () => new Date(Date.now() + 1000 * 60 * 60 * 24); // +1 day

beforeEach(async () => {
  db = await makeTestDb();
  keys = new ApiKeyRepository(db);
  const projects = new ProjectRepository(db);

  const a = await registerAccount(db, 'a@acme.test', 'pw-secret-1');
  const b = await registerAccount(db, 'b@globex.test', 'pw-secret-1');
  const projA = await projects.create({ name: 'Site A', slug: 'site-a' });
  const projB = await projects.create({ name: 'Site B', slug: 'site-b' });
  await addProjectMember(db, a.userId, projA.id, 'owner');
  await addProjectMember(db, b.userId, projB.id, 'owner');
  pctxA = { userId: a.userId, projectId: projA.id, role: 'owner' };
  pctxB = { userId: b.userId, projectId: projB.id, role: 'owner' };
  memberCtxA = { ...pctxA, role: 'member' };
});

describe('ApiKeyRepository.create', () => {
  it('returns the raw token once and stores only its hash', async () => {
    const { token, key } = await keys.create(pctxA, {
      name: 'CI',
      role: 'owner',
      capabilities: ['content:read', 'content:write'],
      expiresAt: future(),
    });
    expect(token.startsWith('swk_')).toBe(true);
    expect(key.tokenPrefix.length).toBeGreaterThan(4);
    // The view never carries the secret material.
    expect(JSON.stringify(key)).not.toContain(token);
    expect(key).not.toHaveProperty('tokenHash');
    // What's persisted is the hash — resolvable by the raw token, and the stored
    // prefix matches the token (so the hash, not the token, is the lookup key).
    const resolved = await keys.resolve(token);
    expect(resolved?.projectId).toBe(pctxA.projectId);
    expect(token.startsWith(key.tokenPrefix)).toBe(true);
    expect(hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires a write role (members cannot mint keys)', async () => {
    await expect(
      keys.create(memberCtxA, { name: 'x', role: 'member', capabilities: ['content:read'], expiresAt: future() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('refuses to mint a key above the creator’s own role (no escalation)', async () => {
    // The project role set is now just {owner, member} (no 'admin' project role). A 'member'
    // ranks below 'owner', so a member-scoped caller can never mint an owner-scoped key — this
    // is rejected (the member also fails the write-role gate, so either guard forbids it).
    await expect(
      keys.create(memberCtxA, { name: 'x', role: 'owner', capabilities: ['content:read'], expiresAt: future() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects an unknown capability', async () => {
    await expect(
      keys.create(pctxA, {
        name: 'x',
        role: 'owner',
        capabilities: ['content:read', 'admin:everything' as never],
        expiresAt: future(),
      }),
    ).rejects.toThrow();
  });

  it('rejects an empty capability set', async () => {
    await expect(
      keys.create(pctxA, { name: 'x', role: 'owner', capabilities: [], expiresAt: future() }),
    ).rejects.toThrow();
  });

  it('rejects an expiry in the past or beyond the max TTL', async () => {
    await expect(
      keys.create(pctxA, { name: 'x', role: 'owner', capabilities: ['content:read'], expiresAt: new Date(Date.now() - 1000) }),
    ).rejects.toThrow();
    await expect(
      keys.create(pctxA, {
        name: 'x',
        role: 'owner',
        capabilities: ['content:read'],
        expiresAt: new Date(Date.now() + MAX_API_KEY_TTL_MS + 60_000),
      }),
    ).rejects.toThrow();
  });
});

describe('ApiKeyRepository.list / revoke', () => {
  it('lists keys for the project only (never another project’s), redacted', async () => {
    await keys.create(pctxA, { name: 'A-key', role: 'owner', capabilities: ['content:read'], expiresAt: future() });
    await keys.create(pctxB, { name: 'B-key', role: 'owner', capabilities: ['content:read'], expiresAt: future() });
    const listA = await keys.list(pctxA);
    expect(listA).toHaveLength(1);
    expect(listA[0]!.name).toBe('A-key');
    expect(listA[0]).not.toHaveProperty('tokenHash');
  });

  it('excludes revoked keys from the management list (active keys only)', async () => {
    const { key } = await keys.create(pctxA, {
      name: 'x',
      role: 'owner',
      capabilities: ['content:read'],
      expiresAt: future(),
    });
    expect(await keys.list(pctxA)).toHaveLength(1);
    await keys.revoke(pctxA, key.id);
    expect(await keys.list(pctxA)).toHaveLength(0); // revoked → not listed (still in DB for audit)
  });

  it('revokes a key so it no longer resolves, scoped to the project', async () => {
    const { token, key } = await keys.create(pctxA, {
      name: 'x',
      role: 'owner',
      capabilities: ['content:read'],
      expiresAt: future(),
    });
    expect(await keys.resolve(token)).not.toBeNull();
    // Another project cannot revoke it.
    await expect(keys.revoke(pctxB, key.id)).rejects.toThrow(NotFoundError);
    await keys.revoke(pctxA, key.id);
    expect(await keys.resolve(token)).toBeNull();
  });
});

describe('ApiKeyRepository.resolve', () => {
  it('returns null for unknown, revoked, or expired tokens', async () => {
    expect(await keys.resolve('swk_nope')).toBeNull();
    const { token } = await keys.create(pctxA, {
      name: 'soon',
      role: 'owner',
      capabilities: ['content:read'],
      // Already expired by the time we resolve with a later `now`.
      expiresAt: new Date(Date.now() + 1000),
    });
    expect(await keys.resolve(token, new Date(Date.now() + 5000))).toBeNull();
  });

  it('returns the token’s scope + capabilities and stamps last-used', async () => {
    const { token, key } = await keys.create(pctxA, {
      name: 'x',
      role: 'owner',
      capabilities: ['content:read', 'publish'],
      expiresAt: future(),
    });
    const resolved = await keys.resolve(token);
    expect(resolved).toMatchObject({
      projectId: pctxA.projectId,
      role: 'owner',
      createdBy: pctxA.userId,
    });
    expect(resolved?.capabilities).toEqual(['content:read', 'publish']);
    const after = await keys.list(pctxA);
    expect(after.find((k) => k.id === key.id)?.lastUsedAt).not.toBeNull();
  });
});

describe('ApiKeyRepository.listAgentConnections + revoke', () => {
  it('lists active connections and revoke returns the key source + owner', async () => {
    const { key: k1 } = await keys.create(pctxA, { name: 'a1', role: 'owner', capabilities: ['content:read'], expiresAt: future() });
    const { key: k2 } = await keys.create(pctxA, { name: 'a2', role: 'owner', capabilities: ['content:read'], expiresAt: future() });
    expect((await keys.listAgentConnections(pctxA)).map((c) => c.id).sort()).toEqual([k1.id, k2.id].sort());
    // revoke returns the source + creator (so the route can sever an OAuth refresh chain).
    expect(await keys.revoke(pctxA, k1.id)).toEqual({ source: 'pat', createdBy: pctxA.userId });
    // A revoked key drops out of the active connections list.
    expect((await keys.listAgentConnections(pctxA)).map((c) => c.id)).toEqual([k2.id]);
  });

  it('scopes agent connections to the project', async () => {
    await keys.create(pctxA, { name: 'a', role: 'owner', capabilities: ['content:read'], expiresAt: future() });
    expect(await keys.listAgentConnections(pctxB)).toHaveLength(0);
  });

  it('excludes expired connections (short-lived OAuth access tokens drop off once expired)', async () => {
    await keys.create(pctxA, { name: 'soon', role: 'owner', capabilities: ['content:read'], expiresAt: new Date(Date.now() + 1000) });
    await keys.create(pctxA, { name: 'live', role: 'owner', capabilities: ['content:read'], expiresAt: future() });
    // At a `now` past the short key's expiry, only the still-valid one is listed.
    const listed = await keys.listAgentConnections(pctxA, new Date(Date.now() + 5000));
    expect(listed.map((c) => c.name)).toEqual(['live']);
  });

  it('revoking an already-revoked key throws NotFound (no second OAuth chain-revoke on a double Disconnect)', async () => {
    const { key } = await keys.create(pctxA, { name: 'a', role: 'owner', capabilities: ['content:read'], expiresAt: future() });
    await keys.revoke(pctxA, key.id);
    await expect(keys.revoke(pctxA, key.id)).rejects.toThrow(NotFoundError);
  });

  it('requires a write role to list agent connections', async () => {
    await expect(keys.listAgentConnections(memberCtxA)).rejects.toThrow(ForbiddenError);
  });
});

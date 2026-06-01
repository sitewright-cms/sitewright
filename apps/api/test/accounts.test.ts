import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { memberships } from '../src/db/schema.js';
import {
  getMembership,
  listOrgMembers,
  listOrgsForUser,
  login,
  registerAccount,
  removeOrgMember,
  tenantContext,
} from '../src/repo/accounts.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../src/repo/context.js';
import type { TenantContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
beforeEach(async () => {
  db = await makeTestDb();
});

describe('registerAccount', () => {
  it('creates a user, org, and owner membership', async () => {
    const { userId, orgId } = await registerAccount(db, 'A@Acme.test', 'pw-secret', 'Acme');
    expect(await getMembership(db, userId, orgId)).toBe('owner');
    const orgs = await listOrgsForUser(db, userId);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toBe('Acme');
  });

  it('rejects a duplicate email (case-insensitive)', async () => {
    await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    await expect(registerAccount(db, 'A@ACME.test', 'pw-secret', 'Acme2')).rejects.toThrow(
      ConflictError,
    );
  });

  it('derives a unique org slug when names collide', async () => {
    const a = await registerAccount(db, 'a@x.test', 'pw-secret', 'Acme');
    const b = await registerAccount(db, 'b@x.test', 'pw-secret', 'Acme');
    const slugA = (await listOrgsForUser(db, a.userId))[0]?.slug;
    const slugB = (await listOrgsForUser(db, b.userId))[0]?.slug;
    expect(slugA).toBe('acme');
    expect(slugB).toBe('acme-2');
  });
});

describe('login', () => {
  it('returns the userId for correct credentials', async () => {
    const { userId } = await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    expect(await login(db, 'A@acme.test', 'pw-secret')).toBe(userId);
  });

  it('throws on a wrong password', async () => {
    await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    await expect(login(db, 'a@acme.test', 'wrong')).rejects.toThrow(UnauthorizedError);
  });

  it('throws on an unknown email', async () => {
    await expect(login(db, 'nobody@x.test', 'pw')).rejects.toThrow(UnauthorizedError);
  });
});

describe('tenantContext', () => {
  it('builds a context for a member', async () => {
    const { userId, orgId } = await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    expect(await tenantContext(db, userId, orgId)).toEqual({ userId, orgId, role: 'owner' });
  });

  it('throws Forbidden for a non-member', async () => {
    const a = await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    const b = await registerAccount(db, 'b@globex.test', 'pw-secret', 'Globex');
    await expect(tenantContext(db, a.userId, b.orgId)).rejects.toThrow(ForbiddenError);
  });
});

describe('org membership queries', () => {
  const owner = (userId: string, orgId: string): TenantContext => ({ userId, orgId, role: 'owner' });
  // Materialize an extra org membership the way acceptInvite does (direct insert).
  async function joinOrg(orgId: string, role: 'admin' | 'member', email: string): Promise<string> {
    const u = await registerAccount(db, email, 'pw-secret', `${email} Personal`);
    await db.insert(memberships).values({ id: randomUUID(), userId: u.userId, orgId, role, createdAt: new Date() });
    return u.userId;
  }

  it('lists the org members (owner/admin only) and isolates across orgs', async () => {
    const acme = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    await joinOrg(acme.orgId, 'admin', 'dev@acme.test');
    await registerAccount(db, 'other@globex.test', 'pw-secret', 'Globex');
    const members = await listOrgMembers(db, owner(acme.userId, acme.orgId));
    expect(members.map((m) => m.email).sort()).toEqual(['dev@acme.test', 'owner@acme.test']);
    await expect(
      listOrgMembers(db, { userId: 'x', orgId: acme.orgId, role: 'member' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('removes a member, but never an owner or yourself', async () => {
    const acme = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    const devId = await joinOrg(acme.orgId, 'admin', 'dev@acme.test');
    // Self-removal is refused (the self-check fires before the role check).
    await expect(removeOrgMember(db, owner(acme.userId, acme.orgId), acme.userId)).rejects.toThrow(ForbiddenError);
    // A different manager (admin) cannot remove the protected owner membership.
    const asAdmin: TenantContext = { userId: devId, orgId: acme.orgId, role: 'admin' };
    await expect(removeOrgMember(db, asAdmin, acme.userId)).rejects.toThrow(ForbiddenError);
    // Removing a non-existent membership is a NotFound.
    await expect(removeOrgMember(db, owner(acme.userId, acme.orgId), 'no-such-user')).rejects.toThrow(NotFoundError);
    // A real member is removed.
    await removeOrgMember(db, owner(acme.userId, acme.orgId), devId);
    expect(await getMembership(db, devId, acme.orgId)).toBeNull();
  });
});

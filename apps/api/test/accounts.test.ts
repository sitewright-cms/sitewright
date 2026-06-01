import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import {
  addOrgMember,
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

describe('org member management', () => {
  const owner = (userId: string, orgId: string): TenantContext => ({ userId, orgId, role: 'owner' });

  it('adds a brand-new client as a member and returns a one-time temp password', async () => {
    const { userId, orgId } = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    const { member, tempPassword } = await addOrgMember(db, owner(userId, orgId), 'Client@Acme.test');
    expect(member.role).toBe('member');
    expect(member.email).toBe('client@acme.test');
    expect(typeof tempPassword).toBe('string');
    // The created user can log in with the returned temp password and sees the org as a member.
    const clientId = await login(db, 'client@acme.test', tempPassword!);
    expect(clientId).toBe(member.userId);
    expect(await getMembership(db, member.userId, orgId)).toBe('member');
  });

  it('adds an already-registered user as a member without resetting their password', async () => {
    const acme = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    const bob = await registerAccount(db, 'bob@bob.test', 'bobs-own-pw', 'BobCo');
    const { member, tempPassword } = await addOrgMember(db, owner(acme.userId, acme.orgId), 'bob@bob.test');
    expect(member.userId).toBe(bob.userId);
    expect(tempPassword).toBeUndefined();
    // Bob's existing password is untouched.
    expect(await login(db, 'bob@bob.test', 'bobs-own-pw')).toBe(bob.userId);
    expect(await getMembership(db, bob.userId, acme.orgId)).toBe('member');
  });

  it('rejects adding a user who is already a member', async () => {
    const { userId, orgId } = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    await addOrgMember(db, owner(userId, orgId), 'client@acme.test');
    await expect(addOrgMember(db, owner(userId, orgId), 'client@acme.test')).rejects.toThrow(
      ConflictError,
    );
  });

  it('forbids a member from managing membership (add/list/remove)', async () => {
    const { userId, orgId } = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    const { member } = await addOrgMember(db, owner(userId, orgId), 'client@acme.test');
    const asMember: TenantContext = { userId: member.userId, orgId, role: 'member' };
    await expect(addOrgMember(db, asMember, 'x@acme.test')).rejects.toThrow(ForbiddenError);
    await expect(listOrgMembers(db, asMember)).rejects.toThrow(ForbiddenError);
    await expect(removeOrgMember(db, asMember, userId)).rejects.toThrow(ForbiddenError);
  });

  it('lists the org members (owner + added client) and isolates across orgs', async () => {
    const acme = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    await registerAccount(db, 'other@globex.test', 'pw-secret', 'Globex');
    await addOrgMember(db, owner(acme.userId, acme.orgId), 'client@acme.test');
    const members = await listOrgMembers(db, owner(acme.userId, acme.orgId));
    expect(members.map((m) => m.email).sort()).toEqual(['client@acme.test', 'owner@acme.test']);
  });

  it('removes a member, but never an owner or yourself', async () => {
    const { userId, orgId } = await registerAccount(db, 'owner@acme.test', 'pw-secret', 'Acme');
    const { member } = await addOrgMember(db, owner(userId, orgId), 'client@acme.test');
    // Self-removal is refused (the self-check fires before the role check).
    await expect(removeOrgMember(db, owner(userId, orgId), userId)).rejects.toThrow(ForbiddenError);
    // A different manager (admin) cannot remove the protected owner membership.
    const asAdmin: TenantContext = { userId: member.userId, orgId, role: 'admin' };
    await expect(removeOrgMember(db, asAdmin, userId)).rejects.toThrow(ForbiddenError);
    // Removing a non-existent membership is a NotFound.
    await expect(removeOrgMember(db, owner(userId, orgId), 'no-such-user')).rejects.toThrow(NotFoundError);
    // A real member is removed.
    await removeOrgMember(db, owner(userId, orgId), member.userId);
    expect(await getMembership(db, member.userId, orgId)).toBeNull();
  });
});

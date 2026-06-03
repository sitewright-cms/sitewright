import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { ProjectRepository } from '../src/repo/projects.js';
import {
  addProjectMember,
  getPlatformRole,
  getProjectMembership,
  listPlatformUsers,
  listProjectAccessForUser,
  listProjectMembers,
  login,
  registerAccount,
  removeProjectMember,
  resolveProjectRole,
  setPlatformRole,
} from '../src/repo/accounts.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type ProjectContext,
} from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
beforeEach(async () => {
  db = await makeTestDb();
});

describe('registerAccount', () => {
  it('creates a plain user with no platform role', async () => {
    const { userId } = await registerAccount(db, 'A@Acme.test', 'pw-secret');
    expect(await getPlatformRole(db, userId)).toBeNull();
  });

  it('creates a platform admin when requested', async () => {
    const { userId } = await registerAccount(db, 'admin@acme.test', 'pw-secret', {
      platformRole: 'admin',
    });
    expect(await getPlatformRole(db, userId)).toBe('admin');
  });

  it('rejects a duplicate email (case-insensitive)', async () => {
    await registerAccount(db, 'a@acme.test', 'pw-secret');
    await expect(registerAccount(db, 'A@ACME.test', 'pw-secret')).rejects.toThrow(ConflictError);
  });
});

describe('login', () => {
  it('returns the userId for correct credentials', async () => {
    const { userId } = await registerAccount(db, 'a@acme.test', 'pw-secret');
    expect(await login(db, 'A@acme.test', 'pw-secret')).toBe(userId);
  });

  it('throws on a wrong password', async () => {
    await registerAccount(db, 'a@acme.test', 'pw-secret');
    await expect(login(db, 'a@acme.test', 'wrong')).rejects.toThrow(UnauthorizedError);
  });

  it('throws on an unknown email', async () => {
    await expect(login(db, 'nobody@x.test', 'pw')).rejects.toThrow(UnauthorizedError);
  });
});

describe('project membership resolution', () => {
  it('reports a granted member role and null for a non-member', async () => {
    const { userId } = await registerAccount(db, 'member@acme.test', 'pw-secret');
    const outsider = await registerAccount(db, 'outsider@acme.test', 'pw-secret');
    const project = await new ProjectRepository(db).create({ name: 'Site', slug: 'site' });

    await addProjectMember(db, userId, project.id, 'member');
    expect(await getProjectMembership(db, userId, project.id)).toBe('member');
    expect(await getProjectMembership(db, outsider.userId, project.id)).toBeNull();
  });

  it('resolveProjectRole gives a non-member null and a platform admin owner on any project', async () => {
    const { userId } = await registerAccount(db, 'member@acme.test', 'pw-secret');
    const admin = await registerAccount(db, 'admin@acme.test', 'pw-secret', { platformRole: 'admin' });
    const project = await new ProjectRepository(db).create({ name: 'Site', slug: 'site' });

    // A plain user with no membership cannot reach the project.
    expect(await resolveProjectRole(db, userId, project.id)).toBeNull();
    // After a member grant, the effective role is that membership.
    await addProjectMember(db, userId, project.id, 'member');
    expect(await resolveProjectRole(db, userId, project.id)).toBe('member');
    // A platform admin resolves to owner on ANY project (even one they hold no row for).
    expect(await resolveProjectRole(db, admin.userId, project.id)).toBe('owner');
  });
});

describe('listProjectAccessForUser', () => {
  it('shows a member only their projects, but a platform admin all of them', async () => {
    const { userId } = await registerAccount(db, 'member@acme.test', 'pw-secret');
    const admin = await registerAccount(db, 'admin@acme.test', 'pw-secret', { platformRole: 'admin' });
    const repo = new ProjectRepository(db);
    const a = await repo.create({ name: 'Site A', slug: 'site-a' });
    const b = await repo.create({ name: 'Site B', slug: 'site-b' });

    await addProjectMember(db, userId, a.id, 'member');
    const memberAccess = await listProjectAccessForUser(db, userId);
    expect(memberAccess.map((p) => p.projectId)).toEqual([a.id]);
    expect(memberAccess[0]).toMatchObject({ projectSlug: 'site-a', role: 'member' });

    const adminAccess = await listProjectAccessForUser(db, admin.userId);
    expect(adminAccess.map((p) => p.projectId).sort()).toEqual([a.id, b.id].sort());
    expect(adminAccess.every((p) => p.role === 'owner')).toBe(true);
  });
});

describe('project member management', () => {
  const ownerCtx = (userId: string, projectId: string): ProjectContext => ({
    userId,
    projectId,
    role: 'owner',
  });

  it('lists members for an owner but forbids a non-owner ctx', async () => {
    const owner = await registerAccount(db, 'owner@acme.test', 'pw-secret');
    const member = await registerAccount(db, 'member@acme.test', 'pw-secret');
    const project = await new ProjectRepository(db).create({ name: 'Site', slug: 'site' });
    await addProjectMember(db, owner.userId, project.id, 'owner');
    await addProjectMember(db, member.userId, project.id, 'member');

    const ctx = ownerCtx(owner.userId, project.id);
    expect((await listProjectMembers(db, ctx)).map((m) => m.email).sort()).toEqual([
      'member@acme.test',
      'owner@acme.test',
    ]);

    const memberCtx: ProjectContext = { userId: member.userId, projectId: project.id, role: 'member' };
    await expect(listProjectMembers(db, memberCtx)).rejects.toThrow(ForbiddenError);
  });

  it('removes a member, but never an owner, yourself, or a missing user', async () => {
    const owner = await registerAccount(db, 'owner@acme.test', 'pw-secret');
    const coOwner = await registerAccount(db, 'co-owner@acme.test', 'pw-secret');
    const member = await registerAccount(db, 'member@acme.test', 'pw-secret');
    const project = await new ProjectRepository(db).create({ name: 'Site', slug: 'site' });
    await addProjectMember(db, owner.userId, project.id, 'owner');
    await addProjectMember(db, coOwner.userId, project.id, 'owner');
    await addProjectMember(db, member.userId, project.id, 'member');

    const ctx = ownerCtx(owner.userId, project.id);
    // A non-owner ctx cannot remove anyone.
    const memberCtx: ProjectContext = { userId: member.userId, projectId: project.id, role: 'member' };
    await expect(removeProjectMember(db, memberCtx, owner.userId)).rejects.toThrow(ForbiddenError);
    // Self-removal is refused.
    await expect(removeProjectMember(db, ctx, owner.userId)).rejects.toThrow(ForbiddenError);
    // The protected owner membership cannot be removed.
    await expect(removeProjectMember(db, ctx, coOwner.userId)).rejects.toThrow(ForbiddenError);
    // Removing a non-member is a NotFound.
    await expect(removeProjectMember(db, ctx, 'no-such-user')).rejects.toThrow(NotFoundError);
    // A real member is removed.
    await removeProjectMember(db, ctx, member.userId);
    expect(await getProjectMembership(db, member.userId, project.id)).toBeNull();
  });
});

describe('platform user management', () => {
  it('lists users with their platform role and promotes/demotes', async () => {
    const admin = await registerAccount(db, 'admin@acme.test', 'pw-secret', { platformRole: 'admin' });
    const plain = await registerAccount(db, 'plain@acme.test', 'pw-secret');

    const before = await listPlatformUsers(db);
    expect(before).toHaveLength(2);
    expect(before.find((u) => u.userId === admin.userId)?.platformRole).toBe('admin');
    expect(before.find((u) => u.userId === plain.userId)?.platformRole).toBeNull();

    // Promote the plain user to developer, then demote back to a client.
    await setPlatformRole(db, plain.userId, 'developer');
    expect(await getPlatformRole(db, plain.userId)).toBe('developer');
    await setPlatformRole(db, plain.userId, null);
    expect(await getPlatformRole(db, plain.userId)).toBeNull();

    await expect(setPlatformRole(db, 'no-such-user', 'admin')).rejects.toThrow(NotFoundError);
  });
});

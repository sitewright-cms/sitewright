import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { ProjectRepository } from '../src/repo/projects.js';
import {
  registerAccount,
  getMembership,
  getProjectMembership,
  listProjectAccessForUser,
} from '../src/repo/accounts.js';
import {
  acceptInvite,
  createInvite,
  listInvites,
  listProjectMembers,
  peekInvite,
  removeProjectMember,
  revokeInvite,
} from '../src/repo/invites.js';
import { ConflictError, ForbiddenError, NotFoundError, type TenantContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
const owner = (userId: string, orgId: string): TenantContext => ({ userId, orgId, role: 'owner' });

// A registered agency owner + org + one project, plus a separately-registered "client"
// user that the agency will invite.
async function fixture() {
  const acme = await registerAccount(db, 'owner@acme.test', 'pw-secret-1', 'Acme');
  const projects = new ProjectRepository(db);
  const project = await projects.create(owner(acme.userId, acme.orgId), { name: 'Acme Site', slug: 'acme-site' });
  return { acme, project, ctx: owner(acme.userId, acme.orgId) };
}

beforeEach(async () => {
  db = await makeTestDb();
});

describe('createInvite', () => {
  it('creates a project-scoped client invite (member) and a one-time token', async () => {
    const { project, ctx } = await fixture();
    const { invite, token } = await createInvite(db, ctx, { email: 'Client@Acme.test', role: 'member', projectId: project.id });
    expect(invite.role).toBe('member');
    expect(invite.projectId).toBe(project.id);
    expect(invite.email).toBe('client@acme.test');
    expect(token).toMatch(/^swi_/);
  });

  it('creates an org-level developer invite (admin, no project)', async () => {
    const { ctx } = await fixture();
    const { invite } = await createInvite(db, ctx, { email: 'dev@acme.test', role: 'admin' });
    expect(invite.role).toBe('admin');
    expect(invite.projectId).toBeNull();
  });

  it('rejects owner role, member-without-project, admin-with-project', async () => {
    const { project, ctx } = await fixture();
    await expect(createInvite(db, ctx, { email: 'a@a.co', role: 'owner', projectId: project.id })).rejects.toThrow(ForbiddenError);
    await expect(createInvite(db, ctx, { email: 'a@a.co', role: 'member' })).rejects.toThrow(ConflictError);
    await expect(createInvite(db, ctx, { email: 'a@a.co', role: 'admin', projectId: project.id })).rejects.toThrow(ConflictError);
  });

  it("rejects a client invite targeting another org's project", async () => {
    const { ctx } = await fixture();
    const other = await registerAccount(db, 'other@globex.test', 'pw-secret-1', 'Globex');
    const otherProject = await new ProjectRepository(db).create(owner(other.userId, other.orgId), { name: 'G', slug: 'g' });
    await expect(createInvite(db, ctx, { email: 'a@a.co', role: 'member', projectId: otherProject.id })).rejects.toThrow(NotFoundError);
  });

  it('forbids a member (client) from creating invites', async () => {
    const { project } = await fixture();
    const asMember: TenantContext = { userId: 'x', orgId: 'o', role: 'member' };
    await expect(createInvite(db, asMember, { email: 'a@a.co', role: 'member', projectId: project.id })).rejects.toThrow(ForbiddenError);
  });
});

describe('acceptInvite', () => {
  it('materializes a PROJECT membership for a client invite when the email matches', async () => {
    const { project, ctx } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'client-pw', 'Client Personal');
    const { token } = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });

    const result = await acceptInvite(db, client.userId, token);
    expect(result).toEqual({ orgId: ctx.orgId, projectId: project.id, role: 'member' });
    expect(await getProjectMembership(db, client.userId, project.id)).toBe('member');
    // A client gets NO org-level membership.
    expect(await getMembership(db, client.userId, ctx.orgId)).toBeNull();
    // The dashboard sees only this one project for the client.
    const access = await listProjectAccessForUser(db, client.userId);
    expect(access.map((a) => a.projectId)).toEqual([project.id]);
  });

  it('materializes an ORG membership for a developer invite', async () => {
    const { ctx } = await fixture();
    const dev = await registerAccount(db, 'dev@acme.test', 'dev-pw', 'Dev Personal');
    const { token } = await createInvite(db, ctx, { email: 'dev@acme.test', role: 'admin' });
    const result = await acceptInvite(db, dev.userId, token);
    expect(result.role).toBe('admin');
    expect(await getMembership(db, dev.userId, ctx.orgId)).toBe('admin');
  });

  it('rejects acceptance when the signed-in email differs from the invited email', async () => {
    const { project, ctx } = await fixture();
    const intruder = await registerAccount(db, 'intruder@evil.test', 'pw', 'Evil');
    const { token } = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    await expect(acceptInvite(db, intruder.userId, token)).rejects.toThrow(ForbiddenError);
    expect(await getProjectMembership(db, intruder.userId, project.id)).toBeNull();
  });

  it('rejects an unknown, already-used, or expired token', async () => {
    const { project, ctx } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'pw', 'C');
    await expect(acceptInvite(db, client.userId, 'swi_nope')).rejects.toThrow(NotFoundError);

    const { token } = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    await acceptInvite(db, client.userId, token);
    await expect(acceptInvite(db, client.userId, token)).rejects.toThrow(ConflictError); // already used

    const { token: t2 } = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    const future = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await expect(acceptInvite(db, client.userId, t2, future)).rejects.toThrow(ForbiddenError); // expired
  });

  it('is idempotent if the membership already exists (re-accept a fresh invite)', async () => {
    const { project, ctx } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'pw', 'C');
    const a = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    await acceptInvite(db, client.userId, a.token);
    const b = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    await expect(acceptInvite(db, client.userId, b.token)).resolves.toMatchObject({ projectId: project.id });
    const members = await listProjectMembers(db, ctx, project.id);
    expect(members).toHaveLength(1); // not duplicated
  });
});

describe('peekInvite', () => {
  it('returns the invite context (with a MASKED email) and null for an unknown token', async () => {
    const { project, ctx } = await fixture();
    const { token } = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    const peek = await peekInvite(db, token);
    expect(peek).toMatchObject({ role: 'member', orgName: 'Acme', projectName: 'Acme Site', expired: false, accepted: false });
    // The full email is never disclosed to a token holder; it is masked.
    expect(peek!.email).not.toBe('client@acme.test');
    expect(peek!.email).toMatch(/^c\*+@acme\.test$/);
    expect(await peekInvite(db, 'swi_unknown')).toBeNull();
  });
});

describe('invite hygiene (security review follow-ups)', () => {
  it('supersedes an earlier pending invite to the same recipient + project (single live token)', async () => {
    const { project, ctx } = await fixture();
    const first = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    const second = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    // Only one pending invite remains, and the old token is dead.
    expect(await listInvites(db, ctx, { projectId: project.id })).toHaveLength(1);
    expect(await peekInvite(db, first.token)).toBeNull();
    expect(await peekInvite(db, second.token)).not.toBeNull();
  });

  it('a deleted project drops its client memberships and invites', async () => {
    const { project, ctx } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'pw', 'C');
    const { token } = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    await acceptInvite(db, client.userId, token);
    await createInvite(db, ctx, { email: 'pending@acme.test', role: 'member', projectId: project.id });

    await new ProjectRepository(db).remove(ctx, project.id);
    expect(await getProjectMembership(db, client.userId, project.id)).toBeNull();
    expect(await listProjectAccessForUser(db, client.userId)).toEqual([]);
  });
});

describe('listInvites / revokeInvite', () => {
  it('lists only pending invites, scoped to the org, and revokes them', async () => {
    const { project, ctx } = await fixture();
    const { invite } = await createInvite(db, ctx, { email: 'a@acme.test', role: 'member', projectId: project.id });
    await createInvite(db, ctx, { email: 'dev@acme.test', role: 'admin' });
    expect(await listInvites(db, ctx)).toHaveLength(2);
    expect(await listInvites(db, ctx, { projectId: project.id })).toHaveLength(1);

    await revokeInvite(db, ctx, invite.id);
    expect(await listInvites(db, ctx)).toHaveLength(1);
    await expect(revokeInvite(db, ctx, 'nope')).rejects.toThrow(NotFoundError);
  });

  it('forbids a member from listing or revoking invites', async () => {
    const { project, ctx } = await fixture();
    const { invite } = await createInvite(db, ctx, { email: 'a@acme.test', role: 'member', projectId: project.id });
    const asMember: TenantContext = { userId: 'x', orgId: ctx.orgId, role: 'member' };
    await expect(listInvites(db, asMember)).rejects.toThrow(ForbiddenError);
    await expect(revokeInvite(db, asMember, invite.id)).rejects.toThrow(ForbiddenError);
  });
});

describe('listProjectMembers / removeProjectMember', () => {
  it('lists and removes a project client, scoped to the org', async () => {
    const { project, ctx } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'pw', 'C');
    const { token } = await createInvite(db, ctx, { email: 'client@acme.test', role: 'member', projectId: project.id });
    await acceptInvite(db, client.userId, token);

    expect((await listProjectMembers(db, ctx, project.id)).map((m) => m.email)).toEqual(['client@acme.test']);
    await removeProjectMember(db, ctx, project.id, client.userId);
    expect(await getProjectMembership(db, client.userId, project.id)).toBeNull();
    await expect(removeProjectMember(db, ctx, project.id, client.userId)).rejects.toThrow(NotFoundError);
  });
});

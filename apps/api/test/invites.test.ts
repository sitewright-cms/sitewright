import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { ProjectRepository } from '../src/repo/projects.js';
import {
  registerAccount,
  getPlatformRole,
  getProjectMembership,
  listProjectAccessForUser,
  listProjectMembers,
} from '../src/repo/accounts.js';
import {
  acceptInvite,
  createInvite,
  getInvite,
  listInvites,
  peekInvite,
  revokeInvite,
} from '../src/repo/invites.js';
import { ConflictError, ForbiddenError, NotFoundError, type ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;

// A platform admin (the agency owner) who issues invites, plus one project to invite into.
async function fixture() {
  const admin = await registerAccount(db, 'owner@acme.test', 'Pw-secret-1', { platformRole: 'admin' });
  const project = await new ProjectRepository(db).create({ name: 'Acme Site', slug: 'acme-site' });
  const ownerCtx: ProjectContext = { userId: admin.userId, projectId: project.id, role: 'owner' };
  return { admin, project, ownerCtx };
}

beforeEach(async () => {
  db = await makeTestDb();
});

describe('createInvite', () => {
  it('creates a project-scoped client invite (member) with a one-time token', async () => {
    const { admin, project } = await fixture();
    const { invite, token } = await createInvite(db, admin.userId, {
      email: 'Client@Acme.test',
      role: 'member',
      projectId: project.id,
    });
    expect(invite.role).toBe('member');
    expect(invite.projectId).toBe(project.id);
    expect(invite.email).toBe('client@acme.test');
    expect(token).toMatch(/^swi_/);
  });

  it('creates a platform developer invite (no project)', async () => {
    const { admin } = await fixture();
    const { invite } = await createInvite(db, admin.userId, { email: 'dev@acme.test', role: 'developer' });
    expect(invite.role).toBe('developer');
    expect(invite.projectId).toBeNull();
  });

  it('rejects a project invite with a platform role and a platform invite with a project role', async () => {
    const { admin, project } = await fixture();
    // A project invite must grant owner|member.
    await expect(
      createInvite(db, admin.userId, { email: 'a@a.co', role: 'admin', projectId: project.id }),
    ).rejects.toThrow(ConflictError);
    // A platform invite must grant admin|developer.
    await expect(createInvite(db, admin.userId, { email: 'a@a.co', role: 'member' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('rejects a project invite targeting a non-existent project', async () => {
    const { admin } = await fixture();
    await expect(
      createInvite(db, admin.userId, { email: 'a@a.co', role: 'member', projectId: 'no-such-project' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('acceptInvite', () => {
  it('materializes a PROJECT membership for a client invite when the email matches', async () => {
    const { admin, project } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'client-pw');
    const { token } = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });

    const result = await acceptInvite(db, client.userId, token);
    expect(result).toEqual({ projectId: project.id, role: 'member' });
    expect(await getProjectMembership(db, client.userId, project.id)).toBe('member');
    // A client gets NO platform role.
    expect(await getPlatformRole(db, client.userId)).toBeNull();
    // The dashboard sees only this one project for the client.
    const access = await listProjectAccessForUser(db, client.userId);
    expect(access.map((a) => a.projectId)).toEqual([project.id]);
  });

  it('sets the platform role for a developer invite', async () => {
    const { admin } = await fixture();
    const dev = await registerAccount(db, 'dev@acme.test', 'dev-pw');
    const { token } = await createInvite(db, admin.userId, { email: 'dev@acme.test', role: 'developer' });

    const result = await acceptInvite(db, dev.userId, token);
    expect(result).toEqual({ projectId: null, role: 'developer' });
    expect(await getPlatformRole(db, dev.userId)).toBe('developer');
  });

  it('rejects acceptance when the signed-in email differs from the invited email', async () => {
    const { admin, project } = await fixture();
    const intruder = await registerAccount(db, 'intruder@evil.test', 'pw');
    const { token } = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    await expect(acceptInvite(db, intruder.userId, token)).rejects.toThrow(ForbiddenError);
    expect(await getProjectMembership(db, intruder.userId, project.id)).toBeNull();
  });

  it('rejects an unknown, already-used, or expired token', async () => {
    const { admin, project } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'pw');
    await expect(acceptInvite(db, client.userId, 'swi_nope')).rejects.toThrow(NotFoundError);

    const { token } = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    await acceptInvite(db, client.userId, token);
    await expect(acceptInvite(db, client.userId, token)).rejects.toThrow(ConflictError); // already used

    const { token: t2 } = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    const future = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await expect(acceptInvite(db, client.userId, t2, future)).rejects.toThrow(ForbiddenError); // expired
  });

  it('is idempotent if the membership already exists (re-accept a fresh invite)', async () => {
    const { admin, project, ownerCtx } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'pw');
    const a = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    await acceptInvite(db, client.userId, a.token);
    const b = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    await expect(acceptInvite(db, client.userId, b.token)).resolves.toMatchObject({ projectId: project.id });
    // The owner is the admin (resolves to owner) + the single client member — no duplicate client row.
    const clientRows = (await listProjectMembers(db, ownerCtx)).filter(
      (m) => m.email === 'client@acme.test',
    );
    expect(clientRows).toHaveLength(1);
  });
});

describe('peekInvite', () => {
  it('returns the invite context (with a MASKED email) and null for an unknown token', async () => {
    const { admin, project } = await fixture();
    const { token } = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    const peek = await peekInvite(db, token);
    expect(peek).toMatchObject({ role: 'member', projectName: 'Acme Site', expired: false, accepted: false });
    // The full email is never disclosed to a token holder; it is masked.
    expect(peek!.email).not.toBe('client@acme.test');
    expect(peek!.email).toMatch(/^c\*+@acme\.test$/);
    expect(await peekInvite(db, 'swi_unknown')).toBeNull();
  });
});

describe('invite hygiene (security review follow-ups)', () => {
  it('supersedes an earlier pending invite to the same recipient + project (single live token)', async () => {
    const { admin, project } = await fixture();
    const first = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    const second = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    // Only one pending invite remains, and the old token is dead.
    expect(await listInvites(db, { projectId: project.id })).toHaveLength(1);
    expect(await peekInvite(db, first.token)).toBeNull();
    expect(await peekInvite(db, second.token)).not.toBeNull();
  });

  it('a deleted project drops its client memberships and invites', async () => {
    const { admin, project } = await fixture();
    const client = await registerAccount(db, 'client@acme.test', 'pw');
    const { token } = await createInvite(db, admin.userId, {
      email: 'client@acme.test',
      role: 'member',
      projectId: project.id,
    });
    await acceptInvite(db, client.userId, token);
    await createInvite(db, admin.userId, { email: 'pending@acme.test', role: 'member', projectId: project.id });

    await new ProjectRepository(db).remove(project.id);
    expect(await getProjectMembership(db, client.userId, project.id)).toBeNull();
    expect(await listProjectAccessForUser(db, client.userId)).toEqual([]);
    expect(await listInvites(db, { projectId: project.id })).toEqual([]);
  });
});

describe('listInvites / getInvite / revokeInvite', () => {
  it('scopes invites to project vs platform and revokes them', async () => {
    const { admin, project } = await fixture();
    const { invite } = await createInvite(db, admin.userId, {
      email: 'a@acme.test',
      role: 'member',
      projectId: project.id,
    });
    await createInvite(db, admin.userId, { email: 'dev@acme.test', role: 'developer' });

    // Project-scoped listing sees only the project invite; platform listing sees only the platform invite.
    expect((await listInvites(db, { projectId: project.id })).map((i) => i.email)).toEqual(['a@acme.test']);
    expect((await listInvites(db)).map((i) => i.email)).toEqual(['dev@acme.test']);

    // getInvite reports the scope (projectId) so the route can authorize the revoke.
    expect(await getInvite(db, invite.id)).toEqual({ projectId: project.id });

    await revokeInvite(db, invite.id);
    expect(await listInvites(db, { projectId: project.id })).toEqual([]);
    await expect(revokeInvite(db, 'nope')).rejects.toThrow(NotFoundError);
    expect(await getInvite(db, 'nope')).toBeNull();
  });
});

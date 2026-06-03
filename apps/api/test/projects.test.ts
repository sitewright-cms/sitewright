import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ConflictError, NotFoundError } from '../src/repo/context.js';
import { content, invites, projectMembers } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let repo: ProjectRepository;

beforeEach(async () => {
  db = await makeTestDb();
  repo = new ProjectRepository(db);
});

describe('ProjectRepository — CRUD', () => {
  it('creates a project and reads it back by id and by slug', async () => {
    const created = await repo.create({ name: 'Site A', slug: 'site-a' });
    expect(created).toMatchObject({ name: 'Site A', slug: 'site-a' });
    expect((await repo.get(created.id)).slug).toBe('site-a');
    expect((await repo.getBySlug('site-a')).id).toBe(created.id);
  });

  it('throws NotFound for an unknown id or slug', async () => {
    await expect(repo.get('no-such-id')).rejects.toThrow(NotFoundError);
    await expect(repo.getBySlug('no-such-slug')).rejects.toThrow(NotFoundError);
  });
});

describe('ProjectRepository — instance-wide slug uniqueness', () => {
  it('rejects a duplicate slug across the whole instance', async () => {
    await repo.create({ name: 'Site', slug: 'shared-slug' });
    // There is one platform: a slug is unique instance-wide, regardless of who owns the project.
    await expect(repo.create({ name: 'Dup', slug: 'shared-slug' })).rejects.toThrow(ConflictError);
  });
});

describe('ProjectRepository — remove cascades dependents', () => {
  it('deletes the project and its content, memberships, and invites', async () => {
    const project = await repo.create({ name: 'Site', slug: 'site' });
    const member = await registerAccount(db, 'member@acme.test', 'pw-secret');
    await addProjectMember(db, member.userId, project.id, 'member');
    await db.insert(content).values({
      id: 'c1',
      projectId: project.id,
      kind: 'page',
      entityId: 'home',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(invites).values({
      id: 'i1',
      projectId: project.id,
      email: 'pending@acme.test',
      role: 'member',
      tokenHash: 'hash',
      invitedBy: member.userId,
      expiresAt: new Date(Date.now() + 1000),
      acceptedAt: null,
      acceptedBy: null,
      createdAt: new Date(),
    });

    await repo.remove(project.id);

    await expect(repo.get(project.id)).rejects.toThrow(NotFoundError);
    expect(await db.select().from(content).where(eq(content.projectId, project.id))).toHaveLength(0);
    expect(
      await db.select().from(projectMembers).where(eq(projectMembers.projectId, project.id)),
    ).toHaveLength(0);
    expect(await db.select().from(invites).where(eq(invites.projectId, project.id))).toHaveLength(0);
  });

  it('throws NotFound when removing an unknown project', async () => {
    await expect(repo.remove('no-such-id')).rejects.toThrow(NotFoundError);
  });
});

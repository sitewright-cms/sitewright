import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, tenantContext } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ConflictError, NotFoundError, type TenantContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let repo: ProjectRepository;
let ctxA: TenantContext;
let ctxB: TenantContext;

beforeEach(async () => {
  db = await makeTestDb();
  repo = new ProjectRepository(db);
  const a = await registerAccount(db, 'a@acme.test', 'pw-aaaaaa', 'Acme');
  const b = await registerAccount(db, 'b@globex.test', 'pw-bbbbbb', 'Globex');
  ctxA = await tenantContext(db, a.userId, a.orgId);
  ctxB = await tenantContext(db, b.userId, b.orgId);
});

describe('ProjectRepository — tenant isolation', () => {
  it('lists only the caller org’s projects', async () => {
    await repo.create(ctxA, { name: 'Site A', slug: 'site-a' });
    await repo.create(ctxB, { name: 'Site B', slug: 'site-b' });
    expect((await repo.list(ctxA)).map((p) => p.slug)).toEqual(['site-a']);
    expect((await repo.list(ctxB)).map((p) => p.slug)).toEqual(['site-b']);
  });

  it('forbids org B from reading org A’s project (NotFound, no leak)', async () => {
    const a = await repo.create(ctxA, { name: 'Secret', slug: 'secret' });
    expect((await repo.get(ctxA, a.id)).slug).toBe('secret');
    await expect(repo.get(ctxB, a.id)).rejects.toThrow(NotFoundError);
  });

  it('forbids org B from deleting org A’s project', async () => {
    const a = await repo.create(ctxA, { name: 'Secret', slug: 'secret' });
    await expect(repo.remove(ctxB, a.id)).rejects.toThrow(NotFoundError);
    expect((await repo.list(ctxA)).length).toBe(1); // still there
    await repo.remove(ctxA, a.id); // owner can delete
    expect((await repo.list(ctxA)).length).toBe(0);
  });

  it('enforces unique slug within an org but allows the same slug across orgs', async () => {
    await repo.create(ctxA, { name: 'Site', slug: 'shared-slug' });
    await expect(repo.create(ctxA, { name: 'Dup', slug: 'shared-slug' })).rejects.toThrow(
      ConflictError,
    );
    // same slug is fine in a different org (isolation)
    await expect(repo.create(ctxB, { name: 'Site', slug: 'shared-slug' })).resolves.toBeDefined();
  });
});

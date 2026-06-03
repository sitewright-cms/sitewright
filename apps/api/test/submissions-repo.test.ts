import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { SubmissionRepository } from '../src/repo/submissions.js';
import { projects } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let repo: SubmissionRepository;
let projectA: string;
let projectB: string;

async function makeProject(db: Database): Promise<string> {
  const projectId = randomUUID();
  const now = new Date();
  // Slug is now instance-unique (no org); derive a unique one per project.
  await db.insert(projects).values({ id: projectId, name: 'P', slug: `p-${projectId.slice(0, 8)}`, createdAt: now });
  return projectId;
}

beforeEach(async () => {
  db = await makeTestDb();
  repo = new SubmissionRepository(db);
  projectA = await makeProject(db);
  projectB = await makeProject(db);
});

describe('SubmissionRepository', () => {
  it('stores and reads back a text-only submission', async () => {
    const sub = await repo.create(projectA, 'contact', { email: 'a@b.co', message: 'hi' });
    expect(sub.formId).toBe('contact');
    expect(sub.fields).toEqual({ email: 'a@b.co', message: 'hi' });
    const got = await repo.get(projectA, sub.id);
    expect(got?.fields.message).toBe('hi');
  });

  it('lists newest-first with a total count, filterable by form', async () => {
    await repo.create(projectA, 'contact', { n: '1' });
    await repo.create(projectA, 'contact', { n: '2' });
    await repo.create(projectA, 'newsletter', { n: '3' });
    const all = await repo.list(projectA);
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(3);
    const contact = await repo.list(projectA, { formId: 'contact' });
    expect(contact.total).toBe(2);
    expect(contact.items.every((s) => s.formId === 'contact')).toBe(true);
  });

  it('paginates via limit/offset', async () => {
    for (let i = 0; i < 5; i += 1) await repo.create(projectA, 'contact', { n: String(i) });
    const page = await repo.list(projectA, { limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it('isolates submissions by project (B cannot see A)', async () => {
    const a = await repo.create(projectA, 'contact', { x: '1' });
    expect((await repo.list(projectB)).total).toBe(0);
    expect(await repo.get(projectB, a.id)).toBeNull();
    expect(await repo.remove(projectB, a.id)).toBe(false); // cross-project delete is a no-op
    expect(await repo.get(projectA, a.id)).not.toBeNull(); // untouched
  });

  it('removes a submission and reports whether it existed', async () => {
    const a = await repo.create(projectA, 'contact', { x: '1' });
    expect(await repo.remove(projectA, a.id)).toBe(true);
    expect(await repo.get(projectA, a.id)).toBeNull();
    expect(await repo.remove(projectA, a.id)).toBe(false);
  });
});

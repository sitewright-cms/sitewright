import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { RevisionsRepository, type RevisionsOptions } from '../src/repo/revisions.js';
import type { ProjectContext } from '../src/repo/context.js';

const page = (title: string) => ({ id: 'home', path: '', title });
const titleOf = (data: unknown): string | undefined => (data as { title?: string })?.title;

async function setup(opts?: RevisionsOptions) {
  const db = await makeTestDb();
  const revs = new RevisionsRepository(db, opts);
  const content = new ContentRepository(db, undefined, revs);
  const a = await registerAccount(db, 'a@acme.test', 'Pw-secret-1');
  const proj = await new ProjectRepository(db).create({ name: 'Site A', slug: 'site-a' });
  await addProjectMember(db, a.userId, proj.id, 'owner');
  const ctx: ProjectContext = { userId: a.userId, projectId: proj.id, role: 'owner', actor: 'user' };
  return { revs, content, ctx };
}

describe('RevisionsRepository', () => {
  it('records a revision per save and lists newest-first', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await content.put(ctx, 'page', 'home', page('A'));
    await content.put(ctx, 'page', 'home', page('B'));
    const list = await revs.list(ctx, 'page', 'home');
    expect(list.length).toBe(2);
    expect(list[0]!.op).toBe('put');
    expect(titleOf((await revs.get(ctx, list[0]!.id))?.data)).toBe('B'); // newest first
  });

  it('coalesces same-author edits within the window into one revision (keeps the latest)', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 60_000 });
    await content.put(ctx, 'page', 'home', page('A'));
    await content.put(ctx, 'page', 'home', page('B'));
    const list = await revs.list(ctx, 'page', 'home');
    expect(list.length).toBe(1);
    expect(titleOf((await revs.get(ctx, list[0]!.id))?.data)).toBe('B');
  });

  it('does NOT coalesce across different actors (human vs agent)', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 60_000 });
    await content.put(ctx, 'page', 'home', page('A'));
    await content.put({ ...ctx, actor: 'agent' }, 'page', 'home', page('B'));
    const list = await revs.list(ctx, 'page', 'home');
    expect(list.length).toBe(2);
    expect(list[0]!.actor).toBe('agent');
  });

  it('caps history per entity, pruning the oldest', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0, maxPerEntity: 3 });
    for (const t of ['A', 'B', 'C', 'D', 'E']) await content.put(ctx, 'page', 'home', page(t));
    const list = await revs.list(ctx, 'page', 'home');
    expect(list.length).toBe(3);
    expect(titleOf((await revs.get(ctx, list[0]!.id))?.data)).toBe('E'); // newest retained
  });

  it('writes a delete tombstone carrying the state at deletion', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await content.put(ctx, 'page', 'home', page('A'));
    await content.remove(ctx, 'page', 'home');
    const list = await revs.list(ctx, 'page', 'home');
    expect(list[0]!.op).toBe('delete');
    expect(titleOf((await revs.get(ctx, list[0]!.id))?.data)).toBe('A');
  });

  it('restore re-writes content + adds a restore revision, non-destructively', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await content.put(ctx, 'page', 'home', page('A'));
    const v1 = (await revs.list(ctx, 'page', 'home'))[0]!;
    await content.put(ctx, 'page', 'home', page('B'));
    // What the restore route does: re-put the old snapshot tagged as a restore.
    const snapshot = (await revs.get(ctx, v1.id))!.data;
    await content.put(ctx, 'page', 'home', snapshot, { op: 'restore', note: 'Restored from earlier' });
    expect(titleOf(await content.get(ctx, 'page', 'home'))).toBe('A'); // content reverted
    const list = await revs.list(ctx, 'page', 'home');
    expect(list[0]!.op).toBe('restore');
    expect(list.length).toBe(3); // A, B, and the restore — B is still recoverable
  });

  it('does not version excluded kinds (media)', async () => {
    const { revs, ctx } = await setup({ coalesceWindowMs: 0 });
    await revs.record(ctx, 'media', 'asset1', { id: 'asset1' }, 'put');
    expect(await revs.list(ctx, 'media', 'asset1')).toHaveLength(0);
  });

  it('listProject feeds across entities with labels (title/name/id) + kind/before filters', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await content.put(ctx, 'page', 'home', page('A'));
    await content.put(ctx, 'template', 'hero', { id: 'hero', name: 'Hero', source: '<section>x</section>' });
    const all = await revs.listProject(ctx, { limit: 50 });
    expect(all.length).toBe(2);
    expect(all.map((r) => r.kind).sort()).toEqual(['page', 'template']);
    expect(all.find((r) => r.kind === 'template')!.label).toBe('Hero'); // from name
    expect(all.find((r) => r.kind === 'page')!.label).toBe('A'); // from title
    expect((await revs.listProject(ctx, { kind: 'template' })).every((r) => r.kind === 'template')).toBe(true);
    const newest = all[0]!;
    const older = await revs.listProject(ctx, { before: newest.revisionAt });
    expect(older.every((r) => r.revisionAt < newest.revisionAt)).toBe(true);
  });

  it('sweepOld drops revisions past the retention window', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0, retentionDays: 90 });
    await content.put(ctx, 'page', 'home', page('A'));
    expect((await revs.list(ctx, 'page', 'home')).length).toBe(1);
    await revs.sweepOld(new Date(Date.now() + 91 * 24 * 60 * 60 * 1000));
    expect((await revs.list(ctx, 'page', 'home')).length).toBe(0);
  });
});

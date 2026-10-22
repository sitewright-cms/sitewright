import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { RevisionsRepository, type FeedCursor, type RevisionsOptions } from '../src/repo/revisions.js';
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

  it('keeps entry revision history PER-DATASET (same id in two datasets → separate histories)', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    // The owning datasets must exist first — an entry put against an unknown dataset 409s now.
    const fields = [{ name: 'title', type: 'text' }];
    await content.put(ctx, 'dataset', 'posts', { id: 'posts', name: 'Posts', slug: 'posts', fields });
    await content.put(ctx, 'dataset', 'news', { id: 'news', name: 'News', slug: 'news', fields });
    // The same entry id 'intro' lives in two datasets — each edited independently.
    await content.put(ctx, 'entry', 'intro', { id: 'intro', dataset: 'posts', status: 'published', values: { title: 'P1' } });
    await content.put(ctx, 'entry', 'intro', { id: 'intro', dataset: 'posts', status: 'published', values: { title: 'P2' } });
    await content.put(ctx, 'entry', 'intro', { id: 'intro', dataset: 'news', status: 'published', values: { title: 'N1' } });
    // History is keyed by (dataset, id): posts/intro has 2 revisions, news/intro 1; a scopeless list finds neither.
    expect(await revs.list(ctx, 'entry', 'intro', 'posts')).toHaveLength(2);
    expect(await revs.list(ctx, 'entry', 'intro', 'news')).toHaveLength(1);
    expect(await revs.list(ctx, 'entry', 'intro')).toHaveLength(0);
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
    await revs.record(ctx, 'media', 'asset1', '', { id: 'asset1' }, 'put');
    expect(await revs.list(ctx, 'media', 'asset1')).toHaveLength(0);
  });

  it('a live policy provider drives the coalesce window (admin setting, no restart)', async () => {
    let windowMs = 60_000;
    const { revs, content, ctx } = await setup({ policy: async () => ({ coalesceWindowMs: windowMs }) });
    await content.put(ctx, 'page', 'home', page('A'));
    await content.put(ctx, 'page', 'home', page('B'));
    expect((await revs.list(ctx, 'page', 'home')).length).toBe(1); // coalesced (60s window)
    windowMs = 0; // admin turns coalescing off
    await content.put(ctx, 'page', 'home', page('C'));
    expect((await revs.list(ctx, 'page', 'home')).length).toBe(2); // distinct now
  });

  it('defaults to NO coalescing (window 0) — every save is its own revision', async () => {
    const { revs, content, ctx } = await setup(); // no opts → default coalesce 0
    await content.put(ctx, 'page', 'home', page('A'));
    await content.put(ctx, 'page', 'home', page('B'));
    expect((await revs.list(ctx, 'page', 'home')).length).toBe(2);
  });

  it('listProject feeds across entities with labels (title/name/id) + kind filter + a keyset cursor', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await content.put(ctx, 'page', 'home', page('A'));
    await content.put(ctx, 'template', 'hero', { id: 'hero', name: 'Hero', source: '<section>x</section>' });
    const all = (await revs.listProject(ctx, { limit: 50 })).items;
    expect(all.length).toBe(2);
    expect(all.map((r) => r.kind).sort()).toEqual(['page', 'template']);
    expect(all.find((r) => r.kind === 'template')!.label).toBe('Hero'); // from name
    expect(all.find((r) => r.kind === 'page')!.label).toBe('A'); // from title
    expect((await revs.listProject(ctx, { kind: 'template' })).items.every((r) => r.kind === 'template')).toBe(true);
    const first = await revs.listProject(ctx, { limit: 1 });
    expect(first.items.map((r) => r.id)).toEqual([all[0]!.id]);
    expect(first.next).toEqual({ at: all[0]!.revisionAt, id: all[0]!.id });
    const rest = await revs.listProject(ctx, { limit: 1, after: first.next! });
    expect(rest.items.map((r) => r.id)).toEqual([all[1]!.id]);
    expect(rest.next).toBeNull(); // the last page says so — no extra empty request
  });

  it('sweepOld drops revisions past the retention window', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0, retentionDays: 90 });
    await content.put(ctx, 'page', 'home', page('A'));
    expect((await revs.list(ctx, 'page', 'home')).length).toBe(1);
    await revs.sweepOld(new Date(Date.now() + 91 * 24 * 60 * 60 * 1000));
    expect((await revs.list(ctx, 'page', 'home')).length).toBe(0);
  });
});

// The feed orders by time, and two quick writes can land in the SAME millisecond. These tests drive a
// fake clock so "newest first" means what the assertion says; the tie test freezes it on purpose.
describe('RevisionsRepository — create/update ops, name search and keyset paging', () => {
  let clock = Date.UTC(2026, 9, 1, 12);
  const tick = async (): Promise<void> => {
    clock += 1000;
    vi.setSystemTime(clock);
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records CREATE for the write that makes an entity, PUT for updates, CREATE again after a delete', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await tick();
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'A' });
    await tick();
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'B' });
    await tick();
    await content.remove(ctx, 'page', 'about');
    await tick();
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'C' });
    const ops = (await revs.list(ctx, 'page', 'about')).map((r) => r.op);
    expect(ops).toEqual(['create', 'delete', 'put', 'create']); // newest first
  });

  it('a restore stays RESTORE even when it recreates a deleted entity', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await tick();
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'A' });
    await tick();
    await content.remove(ctx, 'page', 'about');
    const tombstone = (await revs.list(ctx, 'page', 'about'))[0]!;
    await tick();
    await content.put(ctx, 'page', 'about', (await revs.get(ctx, tombstone.id))!.data, { op: 'restore' });
    expect((await revs.list(ctx, 'page', 'about'))[0]!.op).toBe('restore');
  });

  it('coalescing folds a quick follow-up edit INTO the create row, which stays a create', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 60_000 });
    await tick();
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'A' });
    await tick();
    await content.put(ctx, 'page', 'about', { id: 'about', path: 'about', title: 'B' });
    const list = await revs.list(ctx, 'page', 'about');
    expect(list.map((r) => r.op)).toEqual(['create']);
    expect(titleOf((await revs.get(ctx, list[0]!.id))?.data)).toBe('B');
  });

  it('listProject searches the row NAME (literal % and _), combined with kind/op filters', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    await tick();
    await content.put(ctx, 'page', 'p1', { id: 'p1', path: 'p1', title: 'Alpha landing' });
    await tick();
    await content.put(ctx, 'page', 'p1', { id: 'p1', path: 'p1', title: 'Alpha landing' });
    await tick();
    await content.put(ctx, 'page', 'p2', { id: 'p2', path: 'p2', title: 'Beta 100% off' });
    await tick();
    await content.put(ctx, 'template', 'alpha-t', { id: 'alpha-t', name: 'ALPHA hero', source: '<section>x</section>' });
    const names = async (q: Parameters<typeof revs.listProject>[1]) =>
      (await revs.listProject(ctx, q)).items.map((r) => `${r.kind}:${r.op}:${r.label}`);
    // Case-insensitive, across kinds.
    expect(await names({ q: 'alpha' })).toEqual(['template:create:ALPHA hero', 'page:put:Alpha landing', 'page:create:Alpha landing']);
    expect(await names({ q: 'alpha', kind: 'page' })).toEqual(['page:put:Alpha landing', 'page:create:Alpha landing']);
    expect(await names({ q: 'alpha', kind: 'page', op: 'create' })).toEqual(['page:create:Alpha landing']);
    expect(await names({ q: 'alpha', op: 'put' })).toEqual(['page:put:Alpha landing']);
    // LIKE wildcards are literal: "%" matches only a title containing "%", "_" matches no title here.
    expect(await names({ q: '100%' })).toEqual(['page:create:Beta 100% off']);
    expect(await names({ q: '%' })).toEqual(['page:create:Beta 100% off']);
    expect(await names({ q: '_' })).toEqual([]);
  });

  it('pages through rows that TIE on the timestamp — each exactly once, ordered by id', async () => {
    // Frozen clock: every revision below shares one revisionAt, the case a time-only cursor got wrong.
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    for (let i = 0; i < 7; i += 1) await content.put(ctx, 'page', `p${i}`, { id: `p${i}`, path: `p${i}`, title: `Tie ${i}` });
    const all = (await revs.listProject(ctx, { limit: 100 })).items;
    expect(new Set(all.map((r) => r.revisionAt.getTime())).size).toBe(1);
    const seen: string[] = [];
    let after: FeedCursor | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await revs.listProject(ctx, { limit: 3, ...(after ? { after } : {}) });
      seen.push(...page.items.map((r) => r.id));
      if (!page.next) break;
      after = page.next;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual(all.map((r) => r.id));
    expect(seen).toEqual([...seen].sort().reverse()); // the tie-break is the id, descending
  });

  it('a page fetched AFTER new history arrived continues where the last one ended (no repeats, no gaps)', async () => {
    const { revs, content, ctx } = await setup({ coalesceWindowMs: 0 });
    for (let i = 0; i < 5; i += 1) {
      await tick();
      await content.put(ctx, 'page', `old${i}`, { id: `old${i}`, path: `old${i}`, title: `Old ${i}` });
    }
    const first = await revs.listProject(ctx, { limit: 2 });
    for (let i = 0; i < 3; i += 1) {
      await tick();
      await content.put(ctx, 'page', `new${i}`, { id: `new${i}`, path: `new${i}`, title: `New ${i}` });
    }
    const second = await revs.listProject(ctx, { limit: 10, after: first.next! });
    expect([...first.items, ...second.items].map((r) => r.label)).toEqual(['Old 4', 'Old 3', 'Old 2', 'Old 1', 'Old 0']);
  });
});

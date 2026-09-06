import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository, VersionConflictError } from '../src/repo/content.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let content: ContentRepository;
let ctx: ProjectContext;

beforeEach(async () => {
  db = await makeTestDb();
  content = new ContentRepository(db);
  const a = await registerAccount(db, 'race@acme.test', 'Pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'A', slug: 'race' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
});

const page = (title: string) => ({ id: 'home', path: '', title, source: `<div>${title}</div>` });

/**
 * The compare and the write must be ATOMIC. Done as two separate awaits they are a check-then-act
 * race: both writers read V0, both pass the check, and the loser's write is silently discarded — the
 * lost update this whole feature exists to prevent. These tests race genuinely concurrent writes
 * rather than sequential ones, which is the only way to observe it.
 */
describe('optimistic concurrency under genuine concurrency', () => {
  it('lets exactly ONE of two writers racing on the same base version win', async () => {
    await content.put(ctx, 'page', 'home', page('original'));
    const v0 = await content.versionOf(ctx, 'page', 'home');
    if (!v0) throw new Error('no base version');

    // Both start from v0 and are dispatched without awaiting in between — they interleave.
    const results = await Promise.allSettled([
      content.put(ctx, 'page', 'home', page('writer-A'), { expectedVersion: v0 }),
      content.put(ctx, 'page', 'home', page('writer-B'), { expectedVersion: v0 }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);

    // The survivor is whichever one won — and the stored row is ITS value, not a torn mix.
    const stored = (await content.get(ctx, 'page', 'home')) as { title: string };
    expect(['writer-A', 'writer-B']).toContain(stored.title);
    expect((won[0] as PromiseFulfilledResult<{ title: string }>).value.title).toBe(stored.title);
  });

  it('holds under a wider burst — N racers on one base version yield exactly one winner', async () => {
    await content.put(ctx, 'page', 'home', page('base'));
    const v0 = await content.versionOf(ctx, 'page', 'home');
    if (!v0) throw new Error('no base version');

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => content.put(ctx, 'page', 'home', page(`w${i}`), { expectedVersion: v0 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(7);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);
    }
  });

  it('an UNGUARDED concurrent write still lands — the guard is opt-in, and only the guarded writer is protected', async () => {
    await content.put(ctx, 'page', 'home', page('original'));
    const v0 = await content.versionOf(ctx, 'page', 'home');
    if (!v0) throw new Error('no base version');
    // A write with no expectedVersion (an agent today) races a guarded one. Whoever lands second wins
    // if unguarded; the guarded one refuses if it lost. Either way the guarded writer NEVER silently
    // overwrites — that is the property under test.
    const [guarded] = await Promise.allSettled([
      content.put(ctx, 'page', 'home', page('guarded'), { expectedVersion: v0 }),
      content.put(ctx, 'page', 'home', page('unguarded')),
    ]);
    const stored = (await content.get(ctx, 'page', 'home')) as { title: string };
    if (guarded.status === 'rejected') {
      expect(guarded.reason).toBeInstanceOf(VersionConflictError);
      expect(stored.title).toBe('unguarded'); // the guarded write correctly refused rather than clobbering
    } else {
      expect(['guarded', 'unguarded']).toContain(stored.title);
    }
  });
});

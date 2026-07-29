import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { ConflictError, type ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

// An ORPHANED entry — one whose `dataset` slug no longer exists — is not merely stale: an entry is only
// ever reachable THROUGH its dataset (its row `scope` is the dataset slug), so an orphan is invisible to
// every list, the editor, publish and export. It cannot be seen, fixed or deleted through the product.
// One project accumulated 336 of them before anyone noticed.
//
// This suite is the standing guard for that invariant. It enumerates EVERY path that can write or move an
// entry row and asserts each one leaves zero orphans. A new path that can strand an entry should fail
// here. Keep the enumeration honest: if you add a way to write entries, add it below.

let db: Database;
let content: ContentRepository;
let ctx: ProjectContext;
let project: { id: string; name: string; slug: string };

const dataset = (slug: string) => ({ id: slug, name: slug, slug, fields: [{ name: 'title', type: 'text' }] });
const entry = (id: string, ds: string) => ({ id, dataset: ds, values: { title: id } });

/** Entries whose owning dataset is gone — the thing that must always be zero. */
async function orphanCount(): Promise<number> {
  const slugs = new Set(((await content.list(ctx, 'dataset')) as Array<{ slug: string }>).map((d) => d.slug));
  const entries = (await content.list(ctx, 'entry')) as Array<{ dataset: string }>;
  return entries.filter((e) => !slugs.has(e.dataset)).length;
}

/** Rows physically present under a dataset scope, whether or not anything can reach them. */
async function rowsInScope(scope: string): Promise<number> {
  const rows = (await db.all(
    sql`select count(*) as n from content where project_id = ${ctx.projectId} and kind = 'entry' and scope = ${scope} and deleted_at is null`,
  )) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

beforeEach(async () => {
  db = await makeTestDb();
  content = new ContentRepository(db);
  const projects = new ProjectRepository(db);
  const a = await registerAccount(db, 'owner@acme.test', 'Pw-secret-1');
  project = await projects.create({ name: 'P', slug: 'p' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
});

describe('no path can create an invisible orphan entry', () => {
  it('put: refuses an entry whose dataset does not exist', async () => {
    await expect(content.put(ctx, 'entry', 'e1', entry('e1', 'ghost'))).rejects.toThrow(ConflictError);
    expect(await orphanCount()).toBe(0);
  });

  it('importBundle: refuses a bundle whose entries reference a missing dataset', async () => {
    await expect(
      content.importBundle(ctx, project, { pages: [], datasets: [dataset('items')], entries: [entry('e1', 'ghost')] }),
    ).rejects.toThrow(ConflictError);
    expect(await orphanCount()).toBe(0);
  });

  it('dataset delete: cascades its entries instead of stranding them', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));
    await content.remove(ctx, 'dataset', 'items');
    expect(await orphanCount()).toBe(0);
    expect(await rowsInScope('items')).toBe(0);
  });

  it('dataset rename WITH cascade: entries follow', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));
    await content.renameDataset(ctx, 'items', 'features', { cascade: true });
    expect(await orphanCount()).toBe(0);
    expect(await rowsInScope('items')).toBe(0);
    expect(await rowsInScope('features')).toBe(1);
  });

  it('dataset rename WITHOUT cascade: entries STILL follow — this is the hole that stranded 336 rows', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));
    await content.put(ctx, 'entry', 'e2', entry('e2', 'items'));
    await content.renameDataset(ctx, 'items', 'features', { cascade: false });
    expect(await orphanCount()).toBe(0);
    // Not just unreachable-by-query — no row is physically left behind under the old scope.
    expect(await rowsInScope('items')).toBe(0);
    expect(await rowsInScope('features')).toBe(2);
  });

  it('repeated no-cascade renames stay clean (the exact sequence that produced items2…items16)', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    for (const id of ['e1', 'e2', 'e3']) await content.put(ctx, 'entry', id, entry(id, 'items'));
    let slug = 'items';
    for (const next of ['items2', 'items3', 'items4', 'items5']) {
      await content.renameDataset(ctx, 'items', next, { cascade: false });
      expect(await rowsInScope(slug)).toBe(0);
      slug = next;
    }
    expect(await orphanCount()).toBe(0);
    expect(await rowsInScope('items5')).toBe(3);
    expect((await content.list(ctx, 'entry')) as unknown[]).toHaveLength(3);
  });
});

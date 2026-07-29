import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { RevisionsRepository } from '../src/repo/revisions.js';
import { checkProjectIntegrity } from '../src/repo/integrity.js';
import { content as contentTable, contentRevisions } from '../src/db/schema.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let content: ContentRepository;
let revisions: RevisionsRepository;
let ctx: ProjectContext;

const dataset = (slug: string) => ({ id: slug, name: slug, slug, fields: [{ name: 'title', type: 'text' }] });
const entry = (id: string, ds: string, title = id) => ({ id, dataset: ds, values: { title } });

/** Plant a row the product itself refuses to create — legacy/corrupt data the check must still surface. */
async function plantRow(projectId: string, entityId: string, scope: string, declaredDataset: string) {
  const now = new Date();
  await db.insert(contentTable).values({
    id: `planted-${entityId}-${scope}`,
    projectId,
    kind: 'entry',
    entityId,
    scope,
    data: { id: entityId, dataset: declaredDataset, values: { title: entityId } },
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  db = await makeTestDb();
  revisions = new RevisionsRepository(db, { policy: () => Promise.resolve({}) });
  content = new ContentRepository(db, undefined, revisions);
  const projects = new ProjectRepository(db);
  const a = await registerAccount(db, 'owner@acme.test', 'Pw-secret-1');
  const project = await projects.create({ name: 'P', slug: 'p' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
});

describe('entry history survives a dataset rename', () => {
  it('moves the revisions with the rows (they used to be stranded on the old slug)', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items', 'v1'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items', 'v2'));
    expect(await revisions.list(ctx, 'entry', 'e1', 'items')).toHaveLength(2);

    await content.renameDataset(ctx, 'items', 'features', { cascade: true });

    // The History panel asks by the CURRENT slug. Before the fix this was 0 and the past looked erased.
    expect(await revisions.list(ctx, 'entry', 'e1', 'features')).toHaveLength(2);
    // …and nothing is left behind under the old slug.
    expect(await revisions.list(ctx, 'entry', 'e1', 'items')).toHaveLength(0);
  });

  it('moves history on a no-cascade rename too, and carries DELETE tombstones so a restore still works', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'gone', entry('gone', 'items'));
    await content.remove(ctx, 'entry', 'gone', 'items'); // tombstoned under 'items'
    await content.put(ctx, 'entry', 'kept', entry('kept', 'items'));

    await content.renameDataset(ctx, 'items', 'features', { cascade: false });

    expect(await revisions.list(ctx, 'entry', 'kept', 'features')).toHaveLength(1);
    // The tombstone moved as well — otherwise an entry deleted before the rename could never be
    // restored, because its history would sit under a slug nothing resolves any more.
    const tomb = await revisions.list(ctx, 'entry', 'gone', 'features');
    expect(tomb.map((r) => r.op)).toContain('delete');
  });

  it('leaves other datasets\' history alone', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'dataset', 'other', dataset('other'));
    await content.put(ctx, 'entry', 'a', entry('a', 'items'));
    await content.put(ctx, 'entry', 'b', entry('b', 'other'));

    await content.renameDataset(ctx, 'items', 'features', { cascade: true });

    expect(await revisions.list(ctx, 'entry', 'b', 'other')).toHaveLength(1);
  });
});

describe('checkProjectIntegrity', () => {
  it('reports a clean project as ok, with what it examined', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));

    const report = await checkProjectIntegrity(db, ctx.projectId);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    // A clean report must be distinguishable from an empty one.
    expect(report.checked).toMatchObject({ datasets: 1, entries: 1 });
  });

  it('finds orphaned entries and groups them by the dataset they name', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'live', entry('live', 'items'));
    await plantRow(ctx.projectId, 'g1', 'ghost', 'ghost');
    await plantRow(ctx.projectId, 'g2', 'ghost', 'ghost');
    await plantRow(ctx.projectId, 'g3', 'phantom', 'phantom');

    const report = await checkProjectIntegrity(db, ctx.projectId);
    expect(report.ok).toBe(false);
    const orphans = report.issues.filter((i) => i.code === 'orphan_entry');
    // Grouped, biggest first, with a bounded sample — not one issue per row.
    expect(orphans.map((i) => [i.dataset, i.count])).toEqual([
      ['ghost', 2],
      ['phantom', 1],
    ]);
    expect(orphans[0]!.sample).toEqual(['g1', 'g2']);
    expect(orphans[0]!.detail).toContain('does not exist');
  });

  it('finds a row stored under a scope that disagrees with its own dataset field', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await plantRow(ctx.projectId, 'weird', 'items', 'other_slug');

    const report = await checkProjectIntegrity(db, ctx.projectId);
    expect(report.issues.some((i) => i.code === 'entry_scope_mismatch' && i.sample.includes('weird'))).toBe(true);
  });

  it('finds entry history stranded under a dataset that no longer exists', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));
    // Simulate the pre-fix state directly: history left behind on a slug nothing resolves.
    await db.update(contentRevisions).set({ scope: 'vanished' });

    const report = await checkProjectIntegrity(db, ctx.projectId);
    const stranded = report.issues.find((i) => i.code === 'orphan_entry_history');
    expect(stranded).toMatchObject({ dataset: 'vanished', count: 1 });
    expect(stranded!.detail).toContain('cannot be listed or restored');
  });

  // Reuses this file's DB + project rather than booting a second harness: the api suite runs highly
  // parallel and is timing-sensitive, so an extra app boot is real pressure for no extra coverage.
  it('is served at GET /projects/:id/integrity', async () => {
    const app = await createApp({ db });
    try {
      await app.ready();
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@acme.test', password: 'Pw-secret-1' } });
      const sw_session = login.cookies.find((c) => c.name === 'sw_session')!.value;

      await content.put(ctx, 'dataset', 'items', dataset('items'));
      const clean = await app.inject({ method: 'GET', url: `/projects/${ctx.projectId}/integrity`, cookies: { sw_session } });
      expect(clean.statusCode).toBe(200);
      expect(clean.json()).toMatchObject({ ok: true, issues: [] });

      await plantRow(ctx.projectId, 'x1', 'ghost', 'ghost');
      const dirty = await app.inject({ method: 'GET', url: `/projects/${ctx.projectId}/integrity`, cookies: { sw_session } });
      expect(dirty.json().ok).toBe(false);
      expect(dirty.json().issues[0]).toMatchObject({ code: 'orphan_entry', dataset: 'ghost', count: 1 });
    } finally {
      await app.close();
    }
  });

  it('REPORTS ONLY — it never removes or repairs the rows it finds', async () => {
    await plantRow(ctx.projectId, 'g1', 'ghost', 'ghost');
    const countRows = async () =>
      (await db.select({ entityId: contentTable.entityId }).from(contentTable).where(eq(contentTable.projectId, ctx.projectId))).length;

    const before = await countRows();
    await checkProjectIntegrity(db, ctx.projectId);
    await checkProjectIntegrity(db, ctx.projectId); // idempotent, still non-destructive
    expect(await countRows()).toBe(before);
  });
});

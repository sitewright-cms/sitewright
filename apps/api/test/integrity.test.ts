import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import { RevisionsRepository } from '../src/repo/revisions.js';
import { ProjectDomainRepository } from '../src/repo/project-domains.js';
import { checkProjectIntegrity, checkDatabaseIntegrity, runIntegrityAction, INTEGRITY_CHECK_COUNT } from '../src/repo/integrity.js';
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
    expect(orphans.map((i) => [i.subject, i.count])).toEqual([
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
    expect(stranded).toMatchObject({ subject: 'vanished', count: 1 });
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
      expect(dirty.json().issues[0]).toMatchObject({ code: 'orphan_entry', subject: 'ghost', count: 1 });
    } finally {
      await app.close();
    }
  });

  it('sweeps the whole database and reports what each check examined', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    const steps: string[] = [];
    const report = await checkDatabaseIntegrity(db, (p) => steps.push(`${p.step}/${p.total} ${p.label}`));

    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(INTEGRITY_CHECK_COUNT);
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true);
    // Progress is emitted once per check, in order — the modal's progress bar depends on it.
    expect(steps).toHaveLength(INTEGRITY_CHECK_COUNT);
    expect(steps[0]).toContain(`1/${INTEGRITY_CHECK_COUNT}`);
    // SQLite's own structural check runs, and the sweep counts real projects.
    expect(report.checks.find((c) => c.id === 'sqlite')?.status).toBe('ok');
    expect(report.projectsScanned).toBe(1);
  });

  it('detects broken page/template/translation references', async () => {
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home' });
    await content.put(ctx, 'page', 'child', { id: 'child', path: 'c', title: 'C', parent: 'ghost_parent' });
    await content.put(ctx, 'page', 'tpl', { id: 'tpl', path: 't', title: 'T', template: 'ghost_template' });
    await content.put(ctx, 'translation', 'home__de', { id: 'home__de', pageId: 'ghost_page', locale: 'de', title: 'S' });

    const codes = (await checkDatabaseIntegrity(db)).issues.map((i) => i.code);
    expect(codes).toContain('missing_page_parent');
    expect(codes).toContain('missing_page_template');
    expect(codes).toContain('orphan_translation');
  });

  it('does not flag a `global:` template as missing', async () => {
    await content.put(ctx, 'page', 'g', { id: 'g', path: 'g', title: 'G', template: 'global:blog' });
    const codes = (await checkDatabaseIntegrity(db)).issues.map((i) => i.code);
    expect(codes).not.toContain('missing_page_template');
  });

  it('reports a soft-deleted project as INFO — it is by design, but it holds the slug', async () => {
    const projects = new ProjectRepository(db);
    const gone = await projects.create({ name: 'Gone', slug: 'gone' });
    await projects.softDelete(gone.id, ctx.userId);
    const issue = (await checkDatabaseIntegrity(db)).issues.find((i) => i.code === 'deleted_project_holding_slug');
    expect(issue).toMatchObject({ severity: 'info', count: 1 });
    expect(issue!.sample).toContain('gone');
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

describe('runIntegrityAction (opt-in repairs)', () => {
  /** The production shape: entries pointing at a dataset that no longer exists, plus their history. */
  async function makeOrphans() {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));
    await content.put(ctx, 'entry', 'e2', entry('e2', 'items'));
    // Drop the dataset row directly, leaving its entries + history behind — the legacy state.
    await db.delete(contentTable).where(and(eq(contentTable.projectId, ctx.projectId), eq(contentTable.kind, 'dataset')));
  }

  it('recreate_dataset heals BOTH the entries and their stranded history', async () => {
    await makeOrphans();
    let codes = (await checkDatabaseIntegrity(db)).issues.map((i) => i.code);
    expect(codes).toContain('orphan_entry');
    expect(codes).toContain('orphan_entry_history');

    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'recreate_dataset', projectId: ctx.projectId, subject: 'items' });
    expect(res.changed).toBe(2);

    // One action, both classes resolved — entries and revisions are keyed by the same slug.
    codes = (await checkDatabaseIntegrity(db)).issues.map((i) => i.code);
    expect(codes).not.toContain('orphan_entry');
    expect(codes).not.toContain('orphan_entry_history');
    // Fields were inferred from what the orphans actually carry, so the editor can show them.
    expect(await content.get(ctx, 'dataset', 'items')).toMatchObject({ slug: 'items', fields: [{ name: 'title' }] });
    expect((await content.list(ctx, 'entry')) as unknown[]).toHaveLength(2);
  });

  it('recreate_dataset refuses when the dataset already exists', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'recreate_dataset', projectId: ctx.projectId, subject: 'items' }),
    ).rejects.toThrow(/already exists/);
  });

  it('re-derives the target set at execution — a stale report cannot drive a repair', async () => {
    await makeOrphans();
    // The operator's report says "items has orphans", but the state moved on: they are gone.
    await content.remove(ctx, 'entry', 'e1', 'items');
    await content.remove(ctx, 'entry', 'e2', 'items');
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'recreate_dataset', projectId: ctx.projectId, subject: 'items' }),
    ).rejects.toThrow(/no orphaned entries remain/);
  });

  it('reassign_entries moves the rows AND their history to the chosen dataset', async () => {
    await makeOrphans();
    await content.put(ctx, 'dataset', 'target', dataset('target'));
    const res = await runIntegrityAction(db, content, ctx.userId, {
      action: 'reassign_entries', projectId: ctx.projectId, subject: 'items', targetDataset: 'target',
    });
    expect(res.changed).toBe(2);
    expect((await checkDatabaseIntegrity(db)).ok).toBe(true);
    expect(await content.get(ctx, 'entry', 'e1', 'target')).toMatchObject({ dataset: 'target' });
    expect(await revisions.list(ctx, 'entry', 'e1', 'target')).not.toHaveLength(0);
  });

  it('reassign_entries refuses an unknown target', async () => {
    await makeOrphans();
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'reassign_entries', projectId: ctx.projectId, subject: 'items', targetDataset: 'nope' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('fix_entry_scope re-derives scope from the row, and never overwrites a real entry', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'real', entry('real', 'items'));
    await plantRow(ctx.projectId, 'stray', 'wrong_scope', 'items'); // repairable
    await plantRow(ctx.projectId, 'real', 'other_scope', 'items'); // would collide with `real`

    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'fix_entry_scope', projectId: ctx.projectId, subject: '' });
    expect(res.changed).toBe(1);
    expect(res.message).toMatch(/skipped/);
    expect(await content.get(ctx, 'entry', 'stray', 'items')).toMatchObject({ id: 'stray' });
  });

  it('delete_orphan_entries tombstones each row so it stays restorable', async () => {
    await makeOrphans();
    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'delete_orphan_entries', projectId: ctx.projectId, subject: 'items' });
    expect(res.changed).toBe(2);
    expect((await content.list(ctx, 'entry')) as unknown[]).toHaveLength(0);
    // The tombstone is what makes this recoverable — assert it exists rather than trusting the label.
    expect((await revisions.list(ctx, 'entry', 'e1', 'items')).map((r) => r.op)).toContain('delete');
  });

  it('delete_orphan_history removes stranded snapshots, and refuses when the dataset is alive', async () => {
    await makeOrphans();
    await runIntegrityAction(db, content, ctx.userId, { action: 'delete_orphan_entries', projectId: ctx.projectId, subject: 'items' });
    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'delete_orphan_history', projectId: ctx.projectId, subject: 'items' });
    expect(res.changed).toBeGreaterThan(0);
    expect((await checkDatabaseIntegrity(db)).ok).toBe(true);

    await content.put(ctx, 'dataset', 'live', dataset('live'));
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'delete_orphan_history', projectId: ctx.projectId, subject: 'live' }),
    ).rejects.toThrow(/is not stranded/);
  });

  it('refuses to act on a missing or deleted project', async () => {
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'recreate_dataset', projectId: 'nope', subject: 'items' }),
    ).rejects.toThrow(/not found/);
  });
});

describe('a report Fix all can act on', () => {
  it('★ does NOT report the history of a dataset deleted through the product — it is the undo, not damage', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));
    // The product's own delete: the dataset AND its entries are tombstoned under the slug.
    await content.remove(ctx, 'dataset', 'items');

    const report = await checkDatabaseIntegrity(db);
    expect(report.issues.map((i) => i.code)).not.toContain('orphan_entry_history');
    expect(report.ok).toBe(true);
    // …because restoring the dataset makes that history reachable again — which is the whole point of it.
    const tomb = (await revisions.list(ctx, 'dataset', 'items')).find((r) => r.op === 'delete');
    expect(tomb).toBeDefined();
    expect(await revisions.list(ctx, 'entry', 'e1', 'items')).not.toHaveLength(0);
  });

  it('still reports history nothing can bring back, and lets Fix all delete it', async () => {
    await content.put(ctx, 'dataset', 'items', dataset('items'));
    await content.put(ctx, 'entry', 'e1', entry('e1', 'items'));
    await db.update(contentRevisions).set({ scope: 'vanished' }); // no dataset was ever called that
    const issue = (await checkDatabaseIntegrity(db)).issues.find((i) => i.code === 'orphan_entry_history');
    expect(issue?.actions.map((a) => [a.id, a.unattended, a.reversible])).toEqual([['delete_orphan_history', true, false]]);
  });

  it('a soft-deleted project is INFO and leaves the report ok — there is nothing to fix', async () => {
    const projects = new ProjectRepository(db);
    const gone = await projects.create({ name: 'Gone', slug: 'gone' });
    await projects.softDelete(gone.id, ctx.userId);
    const report = await checkDatabaseIntegrity(db);
    expect(report.issues.map((i) => i.severity)).toEqual(['info']);
    expect(report.ok).toBe(true);
  });

  it('offers a repair for broken page, template and translation references', async () => {
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home' });
    await content.put(ctx, 'page', 'child', { id: 'child', path: 'c', title: 'C', parent: 'ghost_parent' });
    await content.put(ctx, 'page', 'tpl', { id: 'tpl', path: 't', title: 'T', template: 'ghost_template' });
    await content.put(ctx, 'translation', 'home__de', { id: 'home__de', pageId: 'ghost_page', locale: 'de', title: 'S' });

    const byCode = new Map((await checkDatabaseIntegrity(db)).issues.map((i) => [i.code, i]));
    expect(byCode.get('missing_page_parent')?.actions.map((a) => a.id)).toEqual(['reparent_pages']);
    expect(byCode.get('orphan_translation')?.actions.map((a) => a.id)).toEqual(['delete_orphan_translations']);
    // A template that was never in History cannot be restored — so nothing is offered, and the detail
    // says what to do instead rather than leaving the operator with a dead end.
    expect(byCode.get('missing_page_template')?.actions).toEqual([]);
    expect(byCode.get('missing_page_template')?.detail).toMatch(/History holds no copy/);
  });
});

describe('runIntegrityAction — the repairs Fix all applies', () => {
  it('reparent_pages hangs pages with a missing parent under the home page, keeping their address', async () => {
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home' });
    await content.put(ctx, 'page', 'a', { id: 'a', path: 'a', title: 'A', parent: 'ghost' });
    await content.put(ctx, 'page', 'b', { id: 'b', path: 'b', title: 'B', parent: 'ghost' });
    await content.put(ctx, 'page', 'other', { id: 'other', path: 'o', title: 'O', parent: 'elsewhere' });

    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'reparent_pages', projectId: ctx.projectId, subject: 'ghost' });
    expect(res.changed).toBe(2);
    expect(await content.get(ctx, 'page', 'a')).toMatchObject({ parent: 'home' });
    expect(await content.get(ctx, 'page', 'b')).toMatchObject({ parent: 'home' });
    // Only the pages under THAT missing parent move — the issue is per subject.
    expect(await content.get(ctx, 'page', 'other')).toMatchObject({ parent: 'elsewhere' });
    const codes = (await checkDatabaseIntegrity(db)).issues.filter((i) => i.subject === 'ghost').map((i) => i.code);
    expect(codes).toEqual([]);
    // Re-derived: nothing points at it any more, so a second run refuses rather than doing anything.
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'reparent_pages', projectId: ctx.projectId, subject: 'ghost' }),
    ).rejects.toThrow(/no pages point at that parent/);
  });

  it('reparent_pages refuses when the parent exists, and leaves a page alone when there is no home', async () => {
    await content.put(ctx, 'page', 'p', { id: 'p', path: 'p', title: 'P', parent: 'ghost' });
    // No home page in this project: there is nothing to hang it on, so it is reported, not invented.
    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'reparent_pages', projectId: ctx.projectId, subject: 'ghost' });
    expect(res.changed).toBe(0);
    expect(res.message).toMatch(/no home page/);
    expect(await content.get(ctx, 'page', 'p')).toMatchObject({ parent: 'ghost' });

    await content.put(ctx, 'page', 'ghost', { id: 'ghost', path: 'g', title: 'G' });
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'reparent_pages', projectId: ctx.projectId, subject: 'ghost' }),
    ).rejects.toThrow(/exists/);
  });

  it('restore_template brings a deleted template back from History, and is offered only when it can', async () => {
    await content.put(ctx, 'template', 'card', { id: 'card', name: 'Card', source: '<article>{{page.title}}</article>' });
    await content.put(ctx, 'page', 'p', { id: 'p', path: 'p', title: 'P', template: 'card' });
    await content.remove(ctx, 'template', 'card');

    const issue = (await checkDatabaseIntegrity(db)).issues.find((i) => i.code === 'missing_page_template');
    expect(issue?.actions.map((a) => [a.id, a.unattended])).toEqual([['restore_template', true]]);

    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'restore_template', projectId: ctx.projectId, subject: 'card' });
    expect(res.message).toMatch(/1 page renders/);
    expect(await content.get(ctx, 'template', 'card')).toMatchObject({ source: '<article>{{page.title}}</article>' });
    expect((await checkDatabaseIntegrity(db)).ok).toBe(true);
    // It is a restore, recorded as one, so History reads the way the operator would expect.
    expect((await revisions.list(ctx, 'template', 'card'))[0]).toMatchObject({ op: 'restore' });

    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'restore_template', projectId: ctx.projectId, subject: 'card' }),
    ).rejects.toThrow(/exists/);
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'restore_template', projectId: ctx.projectId, subject: 'never' }),
    ).rejects.toThrow(/no copy/);
  });

  it('delete_orphan_translations tombstones them, and refuses while the page exists', async () => {
    await content.put(ctx, 'translation', 'gone__de', { id: 'gone__de', pageId: 'gone', locale: 'de', title: 'Weg' });
    await content.put(ctx, 'translation', 'gone__fr', { id: 'gone__fr', pageId: 'gone', locale: 'fr', title: 'Parti' });

    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'delete_orphan_translations', projectId: ctx.projectId, subject: 'gone' });
    expect(res.changed).toBe(2);
    expect((await content.list(ctx, 'translation')) as unknown[]).toHaveLength(0);
    expect((await revisions.list(ctx, 'translation', 'gone__de')).map((r) => r.op)).toContain('delete');

    await content.put(ctx, 'page', 'here', { id: 'here', path: 'h', title: 'H' });
    await content.put(ctx, 'translation', 'here__de', { id: 'here__de', pageId: 'here', locale: 'de', title: 'Hier' });
    await expect(
      runIntegrityAction(db, content, ctx.userId, { action: 'delete_orphan_translations', projectId: ctx.projectId, subject: 'here' }),
    ).rejects.toThrow(/not orphaned/);
  });

  it('release_domains frees the hostnames of deleted projects only — and needs no project', async () => {
    const projects = new ProjectRepository(db);
    const domains = new ProjectDomainRepository(db);
    const gone = await projects.create({ name: 'Gone', slug: 'gone' });
    await domains.claim({ projectId: gone.id, host: 'gone.example.com', createdBy: ctx.userId });
    await domains.claim({ projectId: ctx.projectId, host: 'live.example.com', createdBy: ctx.userId });
    await projects.softDelete(gone.id, ctx.userId);

    const issue = (await checkDatabaseIntegrity(db)).issues.find((i) => i.code === 'domain_on_deleted_project');
    expect(issue?.actions.map((a) => [a.id, a.unattended, a.reversible])).toEqual([['release_domains', true, false]]);

    const res = await runIntegrityAction(db, content, ctx.userId, { action: 'release_domains', subject: 'custom domains' });
    expect(res.changed).toBe(1);
    expect(await domains.findByHost('gone.example.com')).toBeNull();
    expect(await domains.findByHost('live.example.com')).not.toBeNull();
    await expect(runIntegrityAction(db, content, ctx.userId, { action: 'release_domains', subject: 'custom domains' })).rejects.toThrow(
      /no deleted project holds a hostname/,
    );
  });

  it('a project repair without a project is refused', async () => {
    await expect(runIntegrityAction(db, content, ctx.userId, { action: 'reparent_pages', subject: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('POST /admin/integrity/repair-batch', () => {
  async function boot() {
    await registerAccount(db, 'admin@acme.test', 'Pw-secret-1', { platformRole: 'admin' });
    const app = await createApp({ db });
    await app.ready();
    const login = async (email: string) =>
      (await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } })).cookies.find(
        (c) => c.name === 'sw_session',
      )!.value;
    return { app, admin: await login('admin@acme.test'), owner: await login('owner@acme.test') };
  }

  it('applies every repair it is sent, reports each one, and one refusal does not stop the rest', async () => {
    const { app, admin } = await boot();
    try {
      await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home' });
      await content.put(ctx, 'page', 'a', { id: 'a', path: 'a', title: 'A', parent: 'ghost' });
      await content.put(ctx, 'translation', 'gone__de', { id: 'gone__de', pageId: 'gone', locale: 'de', title: 'Weg' });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/integrity/repair-batch',
        cookies: { sw_session: admin },
        payload: {
          repairs: [
            { action: 'reparent_pages', projectId: ctx.projectId, subject: 'ghost' },
            { action: 'recreate_dataset', projectId: ctx.projectId, subject: 'nothing-orphaned' }, // refuses
            { action: 'delete_orphan_translations', projectId: ctx.projectId, subject: 'gone' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const { results } = res.json() as { results: Array<{ action: string; ok: boolean; changed?: number; error?: string }> };
      expect(results.map((r) => [r.action, r.ok])).toEqual([
        ['reparent_pages', true],
        ['recreate_dataset', false],
        ['delete_orphan_translations', true],
      ]);
      // The refusal carries the operator-facing reason, not a generic failure.
      expect(results[1]!.error).toMatch(/no orphaned entries remain/);
      expect((await checkDatabaseIntegrity(db)).ok).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('is admin-only, and refuses an empty or oversized batch', async () => {
    const { app, admin, owner } = await boot();
    try {
      const repairs = [{ action: 'release_domains', subject: 'custom domains' }];
      const asOwner = await app.inject({ method: 'POST', url: '/admin/integrity/repair-batch', cookies: { sw_session: owner }, payload: { repairs } });
      expect(asOwner.statusCode).toBe(403);
      for (const bad of [[], Array.from({ length: 201 }, () => repairs[0])]) {
        const res = await app.inject({ method: 'POST', url: '/admin/integrity/repair-batch', cookies: { sw_session: admin }, payload: { repairs: bad } });
        expect(res.statusCode).toBe(400);
      }
      const unknown = await app.inject({
        method: 'POST',
        url: '/admin/integrity/repair-batch',
        cookies: { sw_session: admin },
        payload: { repairs: [{ action: 'drop_everything', subject: 'x' }] },
      });
      expect(unknown.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

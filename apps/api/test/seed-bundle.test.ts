import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, runMigrations, type Database } from '../src/db/client.js';
import { registerAccount } from '../src/repo/accounts.js';
import { ContentRepository } from '../src/repo/content.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { EXAMPLE_PROJECTS_DIR, listSeedBundles, loadSeedBundle, importSeedBundle } from '../src/seed-bundle.js';
import { content } from '../src/db/schema.js';
import { and, eq } from 'drizzle-orm';

/**
 * THE CI GATE for the committed showcase bundles (apps/api/example_projects/*): the code seed is
 * gone, so nothing else forces the bundles to keep validating against the CURRENT schemas — this
 * suite is what makes a schema change that invalidates a bundle break the build (the pressure the
 * old compile-time TS seed provided). It also regression-covers the orphaned-entry family of bugs
 * that made real projects un-importable.
 */

let db: Database;
let close: () => void;
let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'seed-bundle-'));
  const made = await createDb(`file:${join(work, 't.db')}`);
  db = made.db;
  close = () => made.client.close();
  await runMigrations(db);
});
afterEach(async () => {
  close();
  await rm(work, { recursive: true, force: true });
});

describe('committed showcase bundles', () => {
  it('ships the example bundle', async () => {
    const dirs = await listSeedBundles();
    const names = dirs.map((d) => d.split('/').at(-1));
    expect(names).toContain('example');
  });

  it('every bundle parses against the CURRENT export schemas and imports cleanly (ids preserved)', async () => {
    const { userId } = await registerAccount(db, 'gate@test.local', 'Pw-secret-1', { platformRole: 'admin' });
    for (const dir of await listSeedBundles()) {
      const { manifest, bundle } = await loadSeedBundle(dir); // throws on schema drift → the gate
      expect(manifest.kind).toBe('sitewright-project-export');
      const imported = await importSeedBundle({ db, userId, dir }); // no mediaRoot: content only
      expect(imported.slug).toBe(bundle.project.slug);
      expect(imported.counts.pages).toBe(bundle.pages.length);
      // Spot-check id preservation: every bundle page id exists as a stored page row.
      const repo = new ContentRepository(db);
      const ctx = { userId, projectId: imported.projectId, role: 'owner' as const };
      const pages = (await repo.list(ctx, 'page')) as Array<{ id: string }>;
      expect(new Set(pages.map((p) => p.id))).toEqual(new Set(bundle.pages.map((p) => p.id)));
    }
  });

  it('the example bundle showcases the full content model (multilingual, datasets, forms, media)', async () => {
    const { bundle } = await loadSeedBundle(join(EXAMPLE_PROJECTS_DIR, 'example'));
    expect(bundle.project.settings.locales.length).toBeGreaterThanOrEqual(3);
    expect(bundle.datasets.length).toBeGreaterThan(0);
    expect(bundle.entries.length).toBeGreaterThan(0);
    expect(bundle.forms.length).toBeGreaterThan(0);
    expect(bundle.media.length).toBeGreaterThan(0);
    // Every entry's dataset resolves — the invariant the orphan bugs broke.
    const slugs = new Set(bundle.datasets.map((d) => d.slug));
    for (const entry of bundle.entries) expect(slugs.has(entry.dataset), `entry ${entry.id} → ${entry.dataset}`).toBe(true);
  });
});

describe('orphaned-entry regressions (the "project import fails" bug family)', () => {
  const dataset = { id: 'posts', name: 'Posts', slug: 'posts', fields: [{ name: 'title', type: 'text' }] };
  const entry = (id: string, ds = 'posts') => ({ id, dataset: ds, status: 'published', values: { title: id } });

  async function setup() {
    const { userId } = await registerAccount(db, 'orphan@test.local', 'Pw-secret-1', { platformRole: 'admin' });
    const projects = new ProjectRepository(db);
    const project = await projects.create({ name: 'P', slug: 'p' }, userId);
    const repo = new ContentRepository(db);
    const ctx = { userId, projectId: project.id, role: 'owner' as const };
    return { userId, project, repo, ctx };
  }

  it('deleting a dataset CASCADES its entries (no orphans left behind)', async () => {
    const { repo, ctx } = await setup();
    await repo.put(ctx, 'dataset', 'posts', dataset);
    await repo.put(ctx, 'entry', 'a', entry('a'));
    await repo.put(ctx, 'entry', 'b', entry('b'));
    await repo.remove(ctx, 'dataset', 'posts');
    expect(await repo.list(ctx, 'entry')).toHaveLength(0);
  });

  it('rejects an entry put against an unknown dataset (409) — orphans cannot be minted', async () => {
    const { repo, ctx } = await setup();
    await expect(repo.put(ctx, 'entry', 'stray', entry('stray', 'never_existed'))).rejects.toThrow(/unknown dataset/);
  });

  it('export SKIPS legacy orphaned entries so the bundle stays importable', async () => {
    const { repo, ctx, project } = await setup();
    await repo.put(ctx, 'dataset', 'posts', dataset);
    await repo.put(ctx, 'entry', 'kept', entry('kept'));
    // Simulate a LEGACY orphan (created before the cascade/put guards) via a raw row insert.
    await db.insert(content).values({
      id: 'orphan-row',
      projectId: ctx.projectId,
      kind: 'entry',
      scope: 'ghost',
      entityId: 'stray',
      data: entry('stray', 'ghost'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const bundle = await repo.exportBundle(ctx, project);
    expect(bundle.entries.map((e) => e.id)).toEqual(['kept']);
    // …and the exported bundle round-trips: importing it into a fresh project succeeds.
    const projects = new ProjectRepository(db);
    const p2 = await projects.create({ name: 'P2', slug: 'p2' }, ctx.userId);
    const full = { ...bundle, snippets: [], translations: [], forms: [], media: [], mediaFolders: [] };
    await expect(repo.importBundle({ ...ctx, projectId: p2.id }, p2, full)).resolves.toEqual({ imported: expect.any(Number) });
    // The legacy orphan row itself is untouched in the source project (non-destructive export).
    const raw = await db.select().from(content).where(and(eq(content.projectId, ctx.projectId), eq(content.kind, 'entry')));
    expect(raw).toHaveLength(2);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { content } from '../src/db/schema.js';
import { migrateDatasetSlugsToUnderscore } from '../src/migrate-content.js';
import { ContentRepository } from '../src/repo/content.js';
import { ensureGlobalProject, globalCtx } from '../src/repo/global-library.js';

type ContentKind = 'dataset' | 'entry' | 'page';
let db: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  db = await makeTestDb();
});

/** A valid project to hang legacy content off. */
async function makeProject(): Promise<string> {
  const app = await createApp({ db });
  await registerAccount(db, 'dev@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'dev@acme.test', password: 'Pw-secret-1' } })).cookies.find(
    (c) => c.name === 'sw_session',
  )!.value;
  const pid = ((await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'P', slug: 'p' } })).json() as {
    project: { id: string };
  }).project.id;
  await app.close();
  return pid;
}

// Raw-insert content that the validated repo would now REJECT (hyphenated dataset slugs), simulating
// data written before DatasetSlugSchema was tightened to underscore identifiers. Entries are stored under
// their owning dataset's SCOPE (mirroring ContentRepository) so the rename cascade can re-key them.
async function rawPut(pid: string, kind: ContentKind, entityId: string, data: unknown): Promise<void> {
  const scope = kind === 'entry' ? String((data as { dataset?: string }).dataset ?? '') : '';
  await db.insert(content).values({ id: `raw-${kind}-${entityId}`, projectId: pid, kind, entityId, scope, data, createdAt: new Date(), updatedAt: new Date() });
}
async function rowData(pid: string, kind: ContentKind, entityId: string): Promise<Record<string, unknown>> {
  const [r] = await db
    .select()
    .from(content)
    .where(and(eq(content.projectId, pid), eq(content.kind, kind), eq(content.entityId, entityId)));
  return (r?.data ?? {}) as Record<string, unknown>;
}

describe('migrateDatasetSlugsToUnderscore', () => {
  it('renames legacy hyphenated dataset slugs to underscore, cascading entries + page refs (dotted, bracket, attr)', async () => {
    const pid = await makeProject();
    // A locale twin (services-de) + a multi-word user slug (faq-passengers) — both invalid under the new schema.
    await rawPut(pid, 'dataset', 'services-de', { id: 'services-de', name: 'Services - DE', slug: 'services-de', fields: [] });
    await rawPut(pid, 'dataset', 'faq-passengers', { id: 'faq-passengers', name: 'FAQ', slug: 'faq-passengers', fields: [] });
    await rawPut(pid, 'entry', 'svc-1-de', { id: 'svc-1-de', dataset: 'services-de', values: { title: 'A' } });
    await rawPut(pid, 'entry', 'q-1', { id: 'q-1', dataset: 'faq-passengers', values: { q: 'Q' } });
    // The page references faq-passengers via the legacy bracket form + a picker attr; the base `services` ref stays.
    // (A fresh project already has the empty-slug `home` page, so use a distinct page id here.)
    await rawPut(pid, 'page', 'about', {
      id: 'about',
      path: 'about',
      title: 'About',
      source: '<div>{{#each dataset.services}}{{title}}{{/each}}{{#each dataset.[faq-passengers]}}{{q}}{{/each}}<x data-y="{{sw-control dataset=\'faq-passengers\'}}"></x></div>',
    });

    await migrateDatasetSlugsToUnderscore(db);

    expect((await rowData(pid, 'dataset', 'services-de')).slug).toBe('services_de'); // id stays; slug underscored
    expect((await rowData(pid, 'dataset', 'faq-passengers')).slug).toBe('faq_passengers');
    expect((await rowData(pid, 'entry', 'svc-1-de')).dataset).toBe('services_de');
    expect((await rowData(pid, 'entry', 'q-1')).dataset).toBe('faq_passengers');
    const src = (await rowData(pid, 'page', 'about')).source as string;
    expect(src).toContain('dataset.faq_passengers'); // bracket form normalized to dotted underscore
    expect(src).toContain("dataset='faq_passengers'"); // picker attr rewritten
    expect(src).not.toContain('faq-passengers');
    expect(src).toContain('dataset.services'); // the base (non-suffixed) ref is left alone
  });

  it('migrates a hyphenated dataset BEFORE its hyphenated language copy, so the pair ends up paired again', async () => {
    const pid = await makeProject();
    await new ContentRepository(db).put({ userId: 'x', projectId: pid, role: 'owner' }, 'settings', 'settings', {
      identity: { name: 'P' },
      settings: { locales: ['en', 'de'], defaultLocale: 'en' },
    });
    // Stored copy-first: migrated in that order, the copy would become `faq_list_de` first, and renaming the base
    // to `faq_list` would then be refused — German pages would switch to that existing dataset.
    await rawPut(pid, 'dataset', 'faq-list-de', { id: 'faq-list-de', name: 'FAQ (DE)', slug: 'faq-list-de', fields: [] });
    await rawPut(pid, 'dataset', 'faq-list', { id: 'faq-list', name: 'FAQ', slug: 'faq-list', fields: [] });
    const log: string[] = [];
    await migrateDatasetSlugsToUnderscore(db, (m) => log.push(m));
    expect((await rowData(pid, 'dataset', 'faq-list')).slug).toBe('faq_list');
    expect((await rowData(pid, 'dataset', 'faq-list-de')).slug).toBe('faq_list_de');
    expect(log.filter((m) => m.includes('SKIP'))).toEqual([]);
  });

  it('skips, and logs, a hyphenated dataset whose rename is refused — the rest still migrate', async () => {
    const pid = await makeProject();
    await new ContentRepository(db).put({ userId: 'x', projectId: pid, role: 'owner' }, 'settings', 'settings', {
      identity: { name: 'P' },
      settings: { locales: ['en', 'de'], defaultLocale: 'en' },
    });
    await rawPut(pid, 'dataset', 'team-list', { id: 'team-list', name: 'Team', slug: 'team-list', fields: [] });
    await rawPut(pid, 'dataset', 'team_list_de', { id: 'team_list_de', name: 'Other', slug: 'team_list_de', fields: [] }); // unrelated
    await rawPut(pid, 'dataset', 'faq-x', { id: 'faq-x', name: 'FAQ', slug: 'faq-x', fields: [] });
    const log: string[] = [];
    await migrateDatasetSlugsToUnderscore(db, (m) => log.push(m));
    expect((await rowData(pid, 'dataset', 'team-list')).slug).toBe('team-list');
    expect(log.some((m) => m.includes(`SKIP ${pid}/team-list`) && m.includes('team_list_de'))).toBe(true);
    expect((await rowData(pid, 'dataset', 'faq-x')).slug).toBe('faq_x');
  });

  describe('when renames interact', () => {
    const ctxOf = (pid: string) => ({ userId: 'x', projectId: pid, role: 'owner' as const });
    const withLanguages = (pid: string) =>
      new ContentRepository(db).put(ctxOf(pid), 'settings', 'settings', { identity: { name: 'P' }, settings: { locales: ['en', 'de'], defaultLocale: 'en' } });

    it('leaves a copy the base rename already moved where it went — even under a collision-dodged name', async () => {
      const pid = await makeProject();
      await withLanguages(pid);
      await rawPut(pid, 'dataset', 'faq_list', { id: 'faq_list', name: 'Other', slug: 'faq_list', fields: [] }); // forces `faq_list_x`
      await rawPut(pid, 'dataset', 'faq-list', { id: 'faq-list', name: 'FAQ', slug: 'faq-list', fields: [] });
      await rawPut(pid, 'dataset', 'faq-list_de', { id: 'faq-list_de', name: 'FAQ (DE)', slug: 'faq-list_de', fields: [] });
      const log: string[] = [];
      await migrateDatasetSlugsToUnderscore(db, (m) => log.push(m));
      expect((await rowData(pid, 'dataset', 'faq-list')).slug).toBe('faq_list_x');
      expect((await rowData(pid, 'dataset', 'faq-list_de')).slug).toBe('faq_list_x_de'); // still paired with its base
      expect(log.filter((m) => m.includes(' -> '))).toEqual([`dataset-slug migration: ${pid}/faq-list -> faq_list_x`]);
    });

    it("skips (and logs) a language copy whose base could not be renamed, so the pair can still be migrated together", async () => {
      const pid = await makeProject();
      await withLanguages(pid);
      await rawPut(pid, 'dataset', 'team-list', { id: 'team-list', name: 'Team', slug: 'team-list', fields: [] });
      await rawPut(pid, 'dataset', 'team_list_de', { id: 'team_list_de', name: 'Other', slug: 'team_list_de', fields: [] }); // base refused
      await rawPut(pid, 'dataset', 'team-list-de', { id: 'team-list-de', name: 'Team (DE)', slug: 'team-list-de', fields: [] });
      const log: string[] = [];
      await migrateDatasetSlugsToUnderscore(db, (m) => log.push(m));
      expect((await rowData(pid, 'dataset', 'team-list')).slug).toBe('team-list');
      expect((await rowData(pid, 'dataset', 'team-list-de')).slug).toBe('team-list-de');
      expect(log.some((m) => m.includes(`SKIP ${pid}/team-list-de`) && m.includes('"team-list"'))).toBe(true);
    });

    it('does not hold on to the target of a refused rename — the next dataset may still take that name', async () => {
      const pid = await makeProject();
      await ensureGlobalProject(db);
      // A library template the site uses reads `a-b_c`, so its rename is refused.
      await new ContentRepository(db).put(globalCtx(), 'template', 'lib', { id: 'lib', name: 'Lib', source: '<div>{{#each dataset.a-b_c}}x{{/each}}</div>' });
      await rawPut(pid, 'page', 'about', { id: 'about', path: 'about', title: 'About', template: 'global:lib' });
      await rawPut(pid, 'dataset', 'a-b_c', { id: 'a-b_c', name: 'One', slug: 'a-b_c', fields: [] });
      await rawPut(pid, 'dataset', 'a_b-c', { id: 'a_b-c', name: 'Two', slug: 'a_b-c', fields: [] });
      await migrateDatasetSlugsToUnderscore(db);
      expect((await rowData(pid, 'dataset', 'a-b_c')).slug).toBe('a-b_c');
      expect((await rowData(pid, 'dataset', 'a_b-c')).slug).toBe('a_b_c'); // not `a_b_c_x`
    });
  });

  it('is a cheap no-op once all dataset slugs are underscore identifiers', async () => {
    const pid = await makeProject();
    await rawPut(pid, 'dataset', 'faq_passengers', { id: 'faq_passengers', name: 'FAQ', slug: 'faq_passengers', fields: [] });
    await migrateDatasetSlugsToUnderscore(db);
    expect((await rowData(pid, 'dataset', 'faq_passengers')).slug).toBe('faq_passengers');
  });
});

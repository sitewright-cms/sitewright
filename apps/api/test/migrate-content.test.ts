import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { content } from '../src/db/schema.js';
import { migrateDatasetSlugsToUnderscore } from '../src/migrate-content.js';

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
// data written before DatasetSlugSchema was tightened to underscore identifiers.
async function rawPut(pid: string, kind: ContentKind, entityId: string, data: unknown): Promise<void> {
  await db.insert(content).values({ id: `raw-${kind}-${entityId}`, projectId: pid, kind, entityId, data, createdAt: new Date(), updatedAt: new Date() });
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

  it('is a cheap no-op once all dataset slugs are underscore identifiers', async () => {
    const pid = await makeProject();
    await rawPut(pid, 'dataset', 'faq_passengers', { id: 'faq_passengers', name: 'FAQ', slug: 'faq_passengers', fields: [] });
    await migrateDatasetSlugsToUnderscore(db);
    expect((await rowData(pid, 'dataset', 'faq_passengers')).slug).toBe('faq_passengers');
  });
});

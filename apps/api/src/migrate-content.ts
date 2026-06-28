import type { Dataset } from '@sitewright/schema';
import type { Database } from './db/client.js';
import { projects } from './db/schema.js';
import { ContentRepository } from './repo/content.js';
import { ProjectEventBus } from './events/bus.js';

/** A synthetic actor for system-run content migrations (audit/event attribution). */
const MIGRATION_USER = '__migration__';

/**
 * One-time, idempotent CONTENT migration: dataset slugs are now UNDERSCORE identifiers
 * (`DatasetSlugSchema`) so they stay valid Handlebars paths (`dataset.<slug>`). Older data may still hold
 * HYPHENATED dataset slugs — the per-locale twins (`services-de`) and any user/agent-created multi-word
 * slug (`faq-passengers`, which silently broke its `{{#each}}` loop). For every project, rename each
 * hyphenated dataset slug to its underscore form, CASCADING to entries + page/template sources + reference
 * targets (via `ContentRepository.renameDataset`, which also rewrites the legacy `dataset.[old]` bracket
 * form authors used as a workaround). Idempotent: once no `-` slug remains it is a cheap per-project no-op,
 * so it is safe to run on every boot.
 */
export async function migrateDatasetSlugsToUnderscore(db: Database, log: (m: string) => void = () => {}): Promise<void> {
  const rows = await db.select({ id: projects.id }).from(projects);
  const repo = new ContentRepository(db, new ProjectEventBus());
  let renamed = 0;
  for (const { id: projectId } of rows) {
    const ctx = { userId: MIGRATION_USER, projectId, role: 'owner' as const };
    const datasets = (await repo.list(ctx, 'dataset')) as Dataset[];
    if (!datasets.some((d) => d.slug.includes('-'))) continue; // fast path: nothing to migrate
    const taken = new Set(datasets.map((d) => d.slug));
    for (const ds of datasets) {
      if (!ds.slug.includes('-')) continue;
      let next = ds.slug.replace(/-/g, '_');
      while (next !== ds.slug && taken.has(next)) next = `${next}_x`; // dodge a (rare) collision
      taken.delete(ds.slug);
      taken.add(next);
      try {
        await repo.renameDataset(ctx, ds.id, next, { cascade: true });
        renamed += 1;
        log(`dataset-slug migration: ${projectId}/${ds.slug} -> ${next}`);
      } catch (err) {
        log(`dataset-slug migration: SKIP ${projectId}/${ds.slug} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
  if (renamed > 0) log(`dataset-slug migration: renamed ${renamed} hyphenated slug(s) to underscore`);
}

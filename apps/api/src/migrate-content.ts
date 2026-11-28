import type { Dataset } from '@sitewright/schema';
import { localizedDatasetName } from '@sitewright/core';
import type { Database } from './db/client.js';
import { projects } from './db/schema.js';
import { ContentRepository } from './repo/content.js';
import { NotFoundError, type ProjectContext } from './repo/context.js';
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
 * so it is safe to run on every boot. A slug whose rename the cascade REFUSES is left as it is and logged
 * (`SKIP …`, with the reason) on every boot until someone resolves it.
 */
export async function migrateDatasetSlugsToUnderscore(db: Database, log: (m: string) => void = () => {}): Promise<void> {
  const rows = await db.select({ id: projects.id }).from(projects);
  const repo = new ContentRepository(db, new ProjectEventBus());
  let renamed = 0;
  for (const { id: projectId } of rows) {
    renamed += await migrateProject(repo, { userId: MIGRATION_USER, projectId, role: 'owner' }, log);
  }
  if (renamed > 0) log(`dataset-slug migration: renamed ${renamed} hyphenated slug(s) to underscore`);
}

/** The project's languages, or none when it has no settings row yet. */
async function localesOf(repo: ContentRepository, ctx: ProjectContext): Promise<string[]> {
  try {
    const raw = ((await repo.get(ctx, 'settings', 'settings')) as { settings?: { locales?: unknown } }).settings?.locales;
    return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

/** The dataset's slug NOW — undefined if it is gone. */
async function currentSlug(repo: ContentRepository, ctx: ProjectContext, id: string): Promise<string | undefined> {
  try {
    return ((await repo.get(ctx, 'dataset', id)) as Dataset).slug;
  } catch (err) {
    if (err instanceof NotFoundError) return undefined;
    throw err;
  }
}

/** Whether `slug` is `base`'s copy for one of `locales` — the legacy hyphen form (`faq-list-de`) or today's. */
function isCopyOf(slug: string, base: string, locales: readonly string[]): boolean {
  return locales.some((l) => slug === `${base}-${l.toLowerCase()}` || slug === localizedDatasetName(base, l));
}

async function migrateProject(repo: ContentRepository, ctx: ProjectContext, log: (m: string) => void): Promise<number> {
  const datasets = (await repo.list(ctx, 'dataset')) as Dataset[];
  if (!datasets.some((d) => d.slug.includes('-'))) return 0; // fast path: nothing to migrate
  const locales = await localesOf(repo, ctx);
  const taken = new Set(datasets.map((d) => d.slug));
  const refused: string[] = [];
  let renamed = 0;
  // BASES BEFORE THEIR LANGUAGE COPIES: a copy (`faq-list-de`) is always longer than its base (`faq-list`).
  // Migrated copy-first, the copy would already be `faq_list_de` when the base is renamed to `faq_list`, and
  // the rename refuses that — a "de" page would switch to an existing dataset. A rename that IS refused (a
  // widget reads the slug, a library template uses it, a name is taken) is skipped and logged, never forced.
  for (const { id } of [...datasets].sort((a, b) => a.slug.length - b.slug.length)) {
    // Read the slug AFRESH: renaming a base also renames its copies, so a row listed above may be done already —
    // acting on its stale slug would rename it a second time, away from the name its base gave it.
    const slug = await currentSlug(repo, ctx, id);
    if (slug === undefined || !slug.includes('-')) continue;
    const base = refused.find((r) => isCopyOf(slug, r, locales));
    if (base !== undefined) {
      log(`dataset-slug migration: SKIP ${ctx.projectId}/${slug} (its base "${base}" could not be renamed, and the copy must move with it)`);
      continue;
    }
    let next = slug.replace(/-/g, '_');
    while (taken.has(next)) next = `${next}_x`; // dodge a (rare) collision
    try {
      const res = await repo.renameDataset(ctx, id, next, { cascade: true });
      // Book every slug the rename actually changed — its language copies included. Nothing is reserved before
      // the rename, so a refused one does not keep a later dataset from taking that name.
      for (const c of [{ oldSlug: slug, newSlug: next }, ...res.localeCopiesRenamed]) {
        taken.delete(c.oldSlug);
        taken.add(c.newSlug);
      }
      renamed += 1;
      log(`dataset-slug migration: ${ctx.projectId}/${slug} -> ${next}`);
    } catch (err) {
      refused.push(slug);
      log(`dataset-slug migration: SKIP ${ctx.projectId}/${slug} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return renamed;
}

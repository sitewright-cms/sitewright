import { GLOBAL_SNIPPETS, GLOBAL_TEMPLATES, GLOBAL_TEMPLATE_PREFIX } from '@sitewright/core';
import type { Snippet, Template } from '@sitewright/schema';
import { projects } from '../db/schema.js';
import type { Database } from '../db/client.js';
import type { ContentRepository } from './content.js';
import type { ProjectContext } from './context.js';

/**
 * The reserved, instance-wide scope that holds the EDITABLE global snippet/template library — stored
 * as ordinary `snippet`/`template` content rows under this synthetic project id. The `content.project_id`
 * FK IS enforced, so {@link ensureGlobalProject} seeds a backing `projects` row (its slug `__global__`
 * is SlugSchema-invalid, so no user project can collide with it). Admin-managed; merged into every
 * project's render BELOW the project's own snippets/templates (a project entity of the same name/ref
 * wins). Seeded once from the built-in `GLOBAL_SNIPPETS`/`GLOBAL_TEMPLATES` constants, which thereafter
 * serve only as that seed.
 *
 * Template ids are stored WITHOUT the `global:` prefix (an id must match `IdSchema`, which has no
 * colon); a page still references them as `global:<id>`, and the prefix is re-applied when building
 * the resolver map. The colon-prefixed reference convention is unchanged for existing pages.
 */
export const GLOBAL_SCOPE_ID = '__global__';

/** A {@link ProjectContext} addressing the global-library scope (used for its content CRUD). */
export function globalCtx(userId = 'system'): ProjectContext {
  return { userId, projectId: GLOBAL_SCOPE_ID, role: 'owner' };
}

/** Strip the `global:` prefix from a template reference to get its stored (bare) id. Module-internal:
 *  the only caller is {@link seedGlobalLibrary}. */
const bareTemplateId = (ref: string): string =>
  ref.startsWith(GLOBAL_TEMPLATE_PREFIX) ? ref.slice(GLOBAL_TEMPLATE_PREFIX.length) : ref;

/**
 * Ensures the reserved backing project row exists — `content.project_id` has an enforced FK, so the
 * global library's rows need a real `projects` row. Its slug uses underscores, which `SlugSchema`
 * forbids, so no user-created project can ever collide with it. Idempotent.
 */
export async function ensureGlobalProject(db: Database): Promise<void> {
  await db
    .insert(projects)
    .values({ id: GLOBAL_SCOPE_ID, name: 'Global Library', slug: GLOBAL_SCOPE_ID, createdAt: new Date() })
    .onConflictDoNothing();
}

/**
 * Seeds the global library from the built-in constants — idempotent, and per-kind: it only fills a
 * kind that is currently empty, so an admin who deletes every global snippet doesn't get them
 * re-seeded on the next boot.
 */
export async function seedGlobalLibrary(db: Database, repo: ContentRepository): Promise<void> {
  await ensureGlobalProject(db);
  const ctx = globalCtx();
  if ((await repo.list(ctx, 'snippet')).length === 0) {
    for (const s of GLOBAL_SNIPPETS) await repo.put(ctx, 'snippet', s.name, { id: s.name, name: s.name, source: s.source });
  }
  if ((await repo.list(ctx, 'template')).length === 0) {
    for (const t of GLOBAL_TEMPLATES) {
      const id = bareTemplateId(t.id);
      await repo.put(ctx, 'template', id, { id, name: t.name, source: t.source, ...(t.data ? { data: t.data } : {}) });
    }
  }
}

/** `name → source` for the global snippets — spread FIRST: `{ ...partials, ...projectSnippets }`. */
export async function globalSnippetPartials(repo: ContentRepository): Promise<Record<string, string>> {
  const rows = (await repo.list(globalCtx(), 'snippet')) as Snippet[];
  return Object.fromEntries(rows.map((s) => [s.name, s.source]));
}

/** The global template rows (bare ids). */
export async function listGlobalTemplates(repo: ContentRepository): Promise<Template[]> {
  return (await repo.list(globalCtx(), 'template')) as Template[];
}

/** Resolver map for {@link resolveTemplateSource}, keyed by the FULL `global:<id>` reference. */
export function globalTemplateMap(rows: readonly Template[]): Map<string, Template> {
  return new Map(rows.map((t) => [GLOBAL_TEMPLATE_PREFIX + t.id, t]));
}

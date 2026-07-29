// Database integrity: a read-only sweep that finds rows which EXIST but cannot be REACHED, plus the
// narrow set of repairs that are safe to offer for what it finds.
//
// Why this exists: several ownership links in this schema are MUTABLE STRINGS rather than immutable ids
// — most importantly an entry's owning dataset (`content.scope` holds the dataset SLUG). Every code path
// that could break such a link is closed and guarded by tests, but a code-path guard cannot see drift
// introduced by a hand-edited database, a restored backup, a future migration, or a bug not yet written.
// This inspects the stored rows themselves.
//
// SEPARATION OF POWERS: `checkDatabaseIntegrity` NEVER writes. Repairs live in `runIntegrityAction` and
// only ever run when an operator explicitly asks for one, because "unreachable" is not always
// "unwanted" — rows are often recoverable data somebody wants back, not garbage.

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { content, contentRevisions, projects, type ContentKind } from '../db/schema.js';
import { schemaFor, type ContentRepository } from './content.js';
import { GLOBAL_SCOPE_ID } from './global-library.js';
import { ConflictError, NotFoundError, type ProjectContext } from './context.js';

/** Example ids carried per issue — enough to investigate, bounded so a bad project can't flood the UI. */
const SAMPLE_LIMIT = 10;

export type IntegritySeverity = 'error' | 'warning' | 'info';

export type IntegrityIssueCode =
  | 'sqlite_corruption'
  | 'foreign_key_violation'
  | 'unparseable_content'
  | 'orphan_entry'
  | 'entry_scope_mismatch'
  | 'orphan_entry_history'
  | 'duplicate_dataset_slug'
  | 'missing_page_parent'
  | 'missing_page_template'
  | 'missing_collection_dataset'
  | 'orphan_translation'
  | 'deleted_project_holding_slug';

/** A repair an operator may run. Everything here is opt-in and re-verified at execution time. */
export type IntegrityActionId =
  | 'recreate_dataset'
  | 'reassign_entries'
  | 'fix_entry_scope'
  | 'delete_orphan_entries'
  | 'delete_orphan_history';

export interface IntegrityAction {
  id: IntegrityActionId;
  label: string;
  /** `destructive` actions remove rows — the UI must confirm. Non-destructive ones only add/repair. */
  destructive: boolean;
  /** What it will do, in the operator's terms. */
  detail: string;
}

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  severity: IntegritySeverity;
  /** Null for instance-wide findings (SQLite corruption, FK violations). */
  projectId: string | null;
  projectSlug: string | null;
  /** The grouping key — usually the dataset slug or table the finding is about. */
  subject: string;
  count: number;
  sample: string[];
  detail: string;
  actions: IntegrityAction[];
}

export interface IntegrityCheckResult {
  id: string;
  label: string;
  status: 'ok' | 'issues';
  /** How many rows/objects this check examined — so "clean" is distinguishable from "nothing there". */
  scanned: number;
  issueCount: number;
}

export interface DatabaseIntegrityReport {
  ok: boolean;
  durationMs: number;
  projectsScanned: number;
  checks: IntegrityCheckResult[];
  issues: IntegrityIssue[];
}

export interface IntegrityProgress {
  /** 1-based index of the check now running. */
  step: number;
  total: number;
  label: string;
  /** The project being scanned, when the check is per-project. */
  project?: string;
}

/** The ordered check list — also the progress denominator, so the UI can show real progress. */
const CHECKS: Array<{ id: string; label: string }> = [
  { id: 'sqlite', label: 'SQLite structural integrity' },
  { id: 'foreign_keys', label: 'Foreign-key references' },
  { id: 'content_schema', label: 'Content rows parse against their schema' },
  { id: 'orphan_entries', label: 'Dataset entries reach their dataset' },
  { id: 'entry_scope', label: 'Entry storage scope matches its dataset' },
  { id: 'entry_history', label: 'Entry version history is reachable' },
  { id: 'dataset_slugs', label: 'Dataset slugs are unique' },
  { id: 'page_tree', label: 'Page parents resolve' },
  { id: 'page_templates', label: 'Page templates resolve' },
  { id: 'collection_datasets', label: 'Collection pages reach their dataset' },
  { id: 'translations', label: 'Translations reach their page' },
  { id: 'deleted_projects', label: 'Deleted projects holding slugs' },
];

export const INTEGRITY_CHECK_COUNT = CHECKS.length;

const ACTIONS: Record<IntegrityActionId, IntegrityAction> = {
  recreate_dataset: {
    id: 'recreate_dataset',
    label: 'Recreate the dataset',
    destructive: false,
    detail:
      'Creates a dataset with the missing slug, its fields inferred from the orphaned entries. They become visible in the editor again — and any version history stranded under that slug becomes reachable too, because both are keyed by it. Nothing is guessed: it restores the name the rows already point at. Review and edit the dataset afterwards.',
  },
  reassign_entries: {
    id: 'reassign_entries',
    label: 'Move to an existing dataset',
    destructive: false,
    detail: 'Re-points the orphaned entries at a dataset you choose, moving their rows and history to it.',
  },
  fix_entry_scope: {
    id: 'fix_entry_scope',
    label: 'Repair storage scope',
    destructive: false,
    detail:
      "Re-derives each row's storage scope from its own `dataset` field — the authored intent — so it is reachable by the dataset it claims to belong to. Rows that would collide with an existing entry are reported instead of overwritten.",
  },
  delete_orphan_entries: {
    id: 'delete_orphan_entries',
    label: 'Delete the entries',
    destructive: true,
    detail:
      'Permanently removes the unreachable entry rows. Each one is tombstoned first, so it stays restorable from the History rail. Prefer recreating or reassigning the dataset if the content might still be wanted.',
  },
  delete_orphan_history: {
    id: 'delete_orphan_history',
    label: 'Delete the stranded history',
    destructive: true,
    detail:
      'Removes version snapshots scoped to a dataset that no longer exists. They cannot be listed or restored in this state, and they expire on their own at the retention limit — deleting only reclaims the space sooner.',
  },
};

function group(
  rows: Array<{ subject: string; id: string }>,
  base: Omit<IntegrityIssue, 'subject' | 'count' | 'sample' | 'detail' | 'actions'>,
  detail: (subject: string, count: number) => string,
  actions: IntegrityActionId[] = [],
): IntegrityIssue[] {
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.subject, [...(by.get(r.subject) ?? []), r.id]);
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([subject, ids]) => ({
      ...base,
      subject,
      count: ids.length,
      sample: ids.slice(0, SAMPLE_LIMIT),
      detail: detail(subject, ids.length),
      actions: actions.map((a) => ACTIONS[a]),
    }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** All live (non-deleted) rows of one project, raw — deliberately NOT via ContentRepository.list(),
 *  whose filtering/validation would hide exactly the rows this is looking for. */
async function projectRows(db: Database, projectId: string) {
  return db
    .select({ kind: content.kind, entityId: content.entityId, scope: content.scope, data: content.data })
    .from(content)
    .where(and(eq(content.projectId, projectId), sql`${content.deletedAt} is null`));
}

type Row = Awaited<ReturnType<typeof projectRows>>[number];
const dataOf = <T,>(r: Row) => r.data as T;

/**
 * Sweep the whole database. Pure read — it never writes, and it is safe to run on a live instance.
 * `onProgress` fires once per check so a UI can show real progress rather than a spinner.
 */
export async function checkDatabaseIntegrity(
  db: Database,
  onProgress?: (p: IntegrityProgress) => void,
): Promise<DatabaseIntegrityReport> {
  const startedAt = Date.now();
  const issues: IntegrityIssue[] = [];
  const checks: IntegrityCheckResult[] = [];
  let step = 0;

  const allProjects = (
    await db.select({ id: projects.id, slug: projects.slug, name: projects.name, deletedAt: projects.deletedAt }).from(projects)
  ).map((p) => ({
    ...p,
    // The reserved global-library scope is a real content container and IS swept — hiding rows from an
    // integrity check is exactly the wrong instinct — but an operator should see its NAME, not the
    // `__global__` sentinel, and it must not inflate the "projects scanned" count.
    label: p.id === GLOBAL_SCOPE_ID ? p.name : p.slug,
  }));
  const live = allProjects.filter((p) => !p.deletedAt);

  // Load every project's rows once; each per-project check reads from this.
  const rowsByProject = new Map<string, Row[]>();
  for (const p of allProjects) rowsByProject.set(p.id, await projectRows(db, p.id));

  const record = (id: string, label: string, scanned: number, found: IntegrityIssue[]) => {
    issues.push(...found);
    checks.push({ id, label, scanned, status: found.length ? 'issues' : 'ok', issueCount: found.length });
  };
  const begin = (label: string, project?: string) => {
    step += 1;
    onProgress?.({ step, total: CHECKS.length, label, ...(project ? { project } : {}) });
  };

  // ---- 1. SQLite's own structural check. Corruption here means the FILE is damaged, not the data model.
  begin(CHECKS[0]!.label);
  {
    const rows = (await db.all(sql`PRAGMA integrity_check`)) as Array<Record<string, string>>;
    const messages = rows.map((r) => String(Object.values(r)[0] ?? '')).filter((m) => m && m !== 'ok');
    record(
      'sqlite',
      CHECKS[0]!.label,
      rows.length,
      messages.length
        ? [
            {
              code: 'sqlite_corruption',
              severity: 'error',
              projectId: null,
              projectSlug: null,
              subject: 'database file',
              count: messages.length,
              sample: messages.slice(0, SAMPLE_LIMIT),
              detail:
                'SQLite reports structural damage in the database file. This is not a content problem and cannot be repaired from here — restore the most recent pre-migration snapshot (Storage & backups) and investigate the underlying storage.',
              actions: [],
            },
          ]
        : [],
    );
  }

  // ---- 2. Dangling foreign keys anywhere in the schema. There is no ON DELETE CASCADE here, so a
  // missed cleanup shows up as a row pointing at a parent that is gone.
  begin(CHECKS[1]!.label);
  {
    const violations = (await db.all(sql`PRAGMA foreign_key_check`)) as Array<{ table?: string; rowid?: number; parent?: string }>;
    const found = group(
      violations.map((v) => ({ subject: `${v.table ?? '?'} → ${v.parent ?? '?'}`, id: String(v.rowid ?? '?') })),
      { code: 'foreign_key_violation', severity: 'error', projectId: null, projectSlug: null },
      (subject, n) => `${plural(n, 'row', 'rows')} in ${subject} reference a parent that no longer exists.`,
    );
    record('foreign_keys', CHECKS[1]!.label, violations.length, found);
  }

  // ---- 3. Rows whose stored JSON no longer satisfies its kind's schema: invisible corruption, since
  // the normal read path may throw or silently drop them.
  begin(CHECKS[2]!.label);
  {
    let scanned = 0;
    const bad: Array<{ subject: string; id: string; project: { id: string; slug: string } }> = [];
    for (const p of live) {
      for (const r of rowsByProject.get(p.id) ?? []) {
        scanned += 1;
        if (!schemaFor(r.kind as ContentKind).safeParse(r.data).success) {
          bad.push({ subject: r.kind, id: r.entityId, project: { id: p.id, slug: p.label } });
        }
      }
    }
    const found = [...new Map(bad.map((b) => [b.project.id, b.project])).values()].flatMap((proj) =>
      group(
        bad.filter((b) => b.project.id === proj.id),
        { code: 'unparseable_content', severity: 'error', projectId: proj.id, projectSlug: proj.slug },
        (kind, n) => `${plural(n, 'row', 'rows')} of kind "${kind}" no longer parse against their schema — the editor and publish may fail on them.`,
      ),
    );
    record('content_schema', CHECKS[2]!.label, scanned, found);
  }

  // ---- Per-project relational checks. Each reads the same preloaded rows.
  const perProject = (
    checkIndex: number,
    checkId: string,
    collect: (rows: Row[], p: { id: string; slug: string }) => IntegrityIssue[],
    countScanned: (rows: Row[]) => number,
  ) => {
    const label = CHECKS[checkIndex]!.label;
    begin(label);
    let scanned = 0;
    const found: IntegrityIssue[] = [];
    for (const p of live) {
      const rows = rowsByProject.get(p.id) ?? [];
      scanned += countScanned(rows);
      found.push(...collect(rows, { id: p.id, slug: p.label }));
    }
    record(checkId, label, scanned, found);
  };

  const datasetSlugsOf = (rows: Row[]) =>
    new Set(rows.filter((r) => r.kind === 'dataset').map((r) => String(dataOf<{ slug?: string }>(r).slug ?? '')));
  const entriesOf = (rows: Row[]) => rows.filter((r) => r.kind === 'entry');
  const pagesOf = (rows: Row[]) => rows.filter((r) => r.kind === 'page');

  // ---- 4. Orphaned entries — the headline case.
  perProject(
    3,
    'orphan_entries',
    (rows, p) => {
      const slugs = datasetSlugsOf(rows);
      const orphans = entriesOf(rows)
        .filter((r) => !slugs.has(String(dataOf<{ dataset?: string }>(r).dataset ?? '')))
        .map((r) => ({ subject: String(dataOf<{ dataset?: string }>(r).dataset ?? ''), id: r.entityId }));
      return group(
        orphans,
        { code: 'orphan_entry', severity: 'error', projectId: p.id, projectSlug: p.slug },
        (ds, n) =>
          `${plural(n, 'entry', 'entries')} belong to dataset "${ds}", which does not exist. They are invisible to the editor, to publish and to export, and cannot be edited or deleted through the product.`,
        ['recreate_dataset', 'delete_orphan_entries'],
      );
    },
    (rows) => entriesOf(rows).length,
  );

  // ---- 5. scope vs data.dataset disagreement.
  perProject(
    4,
    'entry_scope',
    (rows, p) =>
      group(
        entriesOf(rows)
          .filter((r) => r.scope !== String(dataOf<{ dataset?: string }>(r).dataset ?? ''))
          .map((r) => ({ subject: `${r.scope} ≠ ${String(dataOf<{ dataset?: string }>(r).dataset ?? '')}`, id: r.entityId })),
        { code: 'entry_scope_mismatch', severity: 'error', projectId: p.id, projectSlug: p.slug },
        (subject, n) => `${plural(n, 'entry is', 'entries are')} stored under a scope that disagrees with their own dataset field (${subject}).`,
        ['fix_entry_scope'],
      ),
    (rows) => entriesOf(rows).length,
  );

  // ---- 6. History stranded under a dead dataset slug.
  begin(CHECKS[5]!.label);
  {
    let scanned = 0;
    const found: IntegrityIssue[] = [];
    for (const p of live) {
      const slugs = datasetSlugsOf(rowsByProject.get(p.id) ?? []);
      const revs = await db
        .select({ entityId: contentRevisions.entityId, scope: contentRevisions.scope })
        .from(contentRevisions)
        .where(and(eq(contentRevisions.projectId, p.id), eq(contentRevisions.kind, 'entry')));
      scanned += revs.length;
      found.push(
        ...group(
          revs.filter((r) => !slugs.has(r.scope)).map((r) => ({ subject: r.scope, id: r.entityId })),
          { code: 'orphan_entry_history', severity: 'warning', projectId: p.id, projectSlug: p.label },
          (ds, n) =>
            `${plural(n, 'version snapshot', 'version snapshots')} are scoped to dataset "${ds}", which does not exist — that history cannot be listed or restored. It expires on its own at the retention limit.`,
          ['delete_orphan_history'],
        ),
      );
    }
    record('entry_history', CHECKS[5]!.label, scanned, found);
  }

  // ---- 7. Duplicate dataset slugs — `{{#each dataset.<slug>}}` would resolve ambiguously.
  perProject(
    6,
    'dataset_slugs',
    (rows, p) => {
      const seen = new Map<string, string[]>();
      for (const r of rows.filter((x) => x.kind === 'dataset')) {
        const slug = String(dataOf<{ slug?: string }>(r).slug ?? '');
        seen.set(slug, [...(seen.get(slug) ?? []), r.entityId]);
      }
      return group(
        [...seen.entries()].filter(([, ids]) => ids.length > 1).flatMap(([slug, ids]) => ids.map((id) => ({ subject: slug, id }))),
        { code: 'duplicate_dataset_slug', severity: 'error', projectId: p.id, projectSlug: p.slug },
        (slug, n) => `${n} datasets share the slug "${slug}" — loops and keyed lookups resolve ambiguously.`,
      );
    },
    (rows) => rows.filter((r) => r.kind === 'dataset').length,
  );

  // ---- 8/9/10. Page tree, templates, collection datasets.
  perProject(
    7,
    'page_tree',
    (rows, p) => {
      const ids = new Set(pagesOf(rows).map((r) => r.entityId));
      return group(
        pagesOf(rows)
          .filter((r) => {
            const parent = dataOf<{ parent?: string }>(r).parent;
            return typeof parent === 'string' && parent !== '' && !ids.has(parent);
          })
          .map((r) => ({ subject: String(dataOf<{ parent?: string }>(r).parent), id: r.entityId })),
        { code: 'missing_page_parent', severity: 'warning', projectId: p.id, projectSlug: p.slug },
        (parent, n) => `${plural(n, 'page', 'pages')} nest under "${parent}", which does not exist — their route cannot be computed correctly.`,
      );
    },
    (rows) => pagesOf(rows).length,
  );

  perProject(
    8,
    'page_templates',
    (rows, p) => {
      const templates = new Set(rows.filter((r) => r.kind === 'template').map((r) => r.entityId));
      return group(
        pagesOf(rows)
          .filter((r) => {
            const t = dataOf<{ template?: string }>(r).template;
            // `global:<key>` templates resolve against the built-in list, not project rows.
            return typeof t === 'string' && t !== '' && !t.startsWith('global:') && !templates.has(t);
          })
          .map((r) => ({ subject: String(dataOf<{ template?: string }>(r).template), id: r.entityId })),
        { code: 'missing_page_template', severity: 'warning', projectId: p.id, projectSlug: p.slug },
        (t, n) => `${plural(n, 'page references', 'pages reference')} template "${t}", which does not exist — those pages fail to render.`,
      );
    },
    (rows) => pagesOf(rows).length,
  );

  perProject(
    9,
    'collection_datasets',
    (rows, p) => {
      const slugs = datasetSlugsOf(rows);
      return group(
        pagesOf(rows)
          .filter((r) => {
            const ds = dataOf<{ collection?: { dataset?: string } }>(r).collection?.dataset;
            return typeof ds === 'string' && ds !== '' && !slugs.has(ds);
          })
          .map((r) => ({ subject: String(dataOf<{ collection?: { dataset?: string } }>(r).collection?.dataset), id: r.entityId })),
        { code: 'missing_collection_dataset', severity: 'error', projectId: p.id, projectSlug: p.slug },
        (ds, n) => `${plural(n, 'collection page', 'collection pages')} expand over dataset "${ds}", which does not exist — publishing them produces no routes.`,
      );
    },
    (rows) => pagesOf(rows).length,
  );

  perProject(
    10,
    'translations',
    (rows, p) => {
      const ids = new Set(pagesOf(rows).map((r) => r.entityId));
      return group(
        rows
          .filter((r) => r.kind === 'translation')
          .filter((r) => {
            const pid = dataOf<{ pageId?: string }>(r).pageId;
            return typeof pid === 'string' && pid !== '' && !ids.has(pid);
          })
          .map((r) => ({ subject: String(dataOf<{ pageId?: string }>(r).pageId), id: r.entityId })),
        { code: 'orphan_translation', severity: 'warning', projectId: p.id, projectSlug: p.slug },
        (pid, n) => `${plural(n, 'translation', 'translations')} target page "${pid}", which does not exist.`,
      );
    },
    (rows) => rows.filter((r) => r.kind === 'translation').length,
  );

  // ---- 12. Soft-deleted projects still holding their slug. Informational, not damage: it is by design
  // (a restore must find the slug intact) but it blocks reusing that slug, which surprises operators.
  begin(CHECKS[11]!.label);
  {
    const held = allProjects.filter((p) => p.deletedAt);
    record(
      'deleted_projects',
      CHECKS[11]!.label,
      allProjects.length,
      held.length
        ? [
            {
              code: 'deleted_project_holding_slug',
              severity: 'info',
              projectId: null,
              projectSlug: null,
              subject: 'deleted projects',
              count: held.length,
              sample: held.slice(0, SAMPLE_LIMIT).map((p) => p.slug),
              detail:
                'These projects are deleted but still reserve their slug so they can be restored. That is intended — but the slug cannot be reused until they are permanently removed from Deleted projects.',
              actions: [],
            },
          ]
        : [],
    );
  }

  return {
    ok: issues.length === 0,
    durationMs: Date.now() - startedAt,
    projectsScanned: live.filter((p) => p.id !== GLOBAL_SCOPE_ID).length,
    checks,
    issues,
  };
}

/** Back-compat single-project report (GET /projects/:id/integrity) — the same findings, filtered. */
export async function checkProjectIntegrity(
  db: Database,
  projectId: string,
): Promise<{ ok: boolean; checked: { datasets: number; entries: number; entryRevisions: number }; issues: IntegrityIssue[] }> {
  const full = await checkDatabaseIntegrity(db);
  const issues = full.issues.filter((i) => i.projectId === projectId);
  const rows = await projectRows(db, projectId);
  const revs = await db
    .select({ id: contentRevisions.id })
    .from(contentRevisions)
    .where(and(eq(contentRevisions.projectId, projectId), eq(contentRevisions.kind, 'entry')));
  return {
    ok: issues.length === 0,
    checked: {
      datasets: datasetSlugCount(rows),
      entries: rows.filter((r) => r.kind === 'entry').length,
      entryRevisions: revs.length,
    },
    issues,
  };
}

function datasetSlugCount(rows: Row[]): number {
  return new Set(rows.filter((r) => r.kind === 'dataset').map((r) => String((r.data as { slug?: string }).slug ?? ''))).size;
}

export interface IntegrityActionInput {
  action: IntegrityActionId;
  projectId: string;
  /** The issue's `subject` — the dataset slug the rows point at. */
  subject: string;
  /** Target dataset slug, for `reassign_entries`. */
  targetDataset?: string;
}

export interface IntegrityActionResult {
  action: IntegrityActionId;
  changed: number;
  message: string;
}

/**
 * Run ONE repair. Every action re-derives its target set from the live database rather than trusting the
 * report it came from — a report can be minutes old, and acting on a stale row set is how a repair
 * becomes damage. Destructive actions go through ContentRepository so each row is tombstoned first and
 * stays restorable from the History rail.
 */
export async function runIntegrityAction(
  db: Database,
  contentRepo: ContentRepository,
  userId: string,
  input: IntegrityActionInput,
): Promise<IntegrityActionResult> {
  const [project] = await db.select({ id: projects.id, deletedAt: projects.deletedAt }).from(projects).where(eq(projects.id, input.projectId));
  if (!project || project.deletedAt) throw new NotFoundError('project not found');
  const ctx: ProjectContext = { userId, projectId: project.id, role: 'owner', actor: 'user' };

  const rows = await projectRows(db, project.id);
  const slugs = new Set(rows.filter((r) => r.kind === 'dataset').map((r) => String((r.data as { slug?: string }).slug ?? '')));
  const orphans = rows
    .filter((r) => r.kind === 'entry')
    .filter((r) => String((r.data as { dataset?: string }).dataset ?? '') === input.subject && !slugs.has(input.subject));

  switch (input.action) {
    case 'recreate_dataset': {
      if (slugs.has(input.subject)) throw new ConflictError(`a dataset with slug "${input.subject}" already exists`);
      if (orphans.length === 0) throw new ConflictError('no orphaned entries remain for that dataset — re-run the check');
      // Infer the shape from what the orphans actually carry. Every field is text so nothing is lost or
      // coerced; the operator refines types in the dataset editor afterwards.
      const fieldNames = new Set<string>();
      for (const o of orphans) for (const k of Object.keys((o.data as { values?: Record<string, unknown> }).values ?? {})) fieldNames.add(k);
      await contentRepo.put(ctx, 'dataset', input.subject, {
        id: input.subject,
        name: input.subject,
        slug: input.subject,
        fields: [...fieldNames].map((name) => ({ name, type: 'text' })),
      });
      return {
        action: input.action,
        changed: orphans.length,
        message: `Recreated dataset "${input.subject}" with ${plural(fieldNames.size, 'field', 'fields')}; ${plural(orphans.length, 'entry is', 'entries are')} reachable again.`,
      };
    }

    case 'reassign_entries': {
      const target = input.targetDataset ?? '';
      if (!slugs.has(target)) throw new ConflictError(`target dataset "${target}" does not exist`);
      if (orphans.length === 0) throw new ConflictError('no orphaned entries remain for that dataset — re-run the check');
      let changed = 0;
      for (const o of orphans) {
        const data = { ...(o.data as Record<string, unknown>), dataset: target };
        await db
          .update(content)
          .set({ data, scope: target, updatedAt: new Date() })
          .where(and(eq(content.projectId, project.id), eq(content.kind, 'entry'), eq(content.entityId, o.entityId), eq(content.scope, o.scope)));
        changed += 1;
      }
      await db
        .update(contentRevisions)
        .set({ scope: target })
        .where(and(eq(contentRevisions.projectId, project.id), eq(contentRevisions.kind, 'entry'), eq(contentRevisions.scope, input.subject)));
      return { action: input.action, changed, message: `Moved ${plural(changed, 'entry', 'entries')} to "${target}" (with their history).` };
    }

    case 'fix_entry_scope': {
      const mismatched = rows
        .filter((r) => r.kind === 'entry')
        .filter((r) => r.scope !== String((r.data as { dataset?: string }).dataset ?? ''));
      let changed = 0;
      const collided: string[] = [];
      for (const m of mismatched) {
        const declared = String((m.data as { dataset?: string }).dataset ?? '');
        // The (project, kind, scope, entityId) key must stay unique — never overwrite a real row.
        const [clash] = await db
          .select({ entityId: content.entityId })
          .from(content)
          .where(and(eq(content.projectId, project.id), eq(content.kind, 'entry'), eq(content.scope, declared), eq(content.entityId, m.entityId)));
        if (clash) {
          collided.push(m.entityId);
          continue;
        }
        await db
          .update(content)
          .set({ scope: declared, updatedAt: new Date() })
          .where(and(eq(content.projectId, project.id), eq(content.kind, 'entry'), eq(content.entityId, m.entityId), eq(content.scope, m.scope)));
        changed += 1;
      }
      return {
        action: input.action,
        changed,
        message: collided.length
          ? `Repaired ${plural(changed, 'row', 'rows')}; ${plural(collided.length, 'row', 'rows')} skipped because an entry with that id already exists in the target dataset (${collided.slice(0, 5).join(', ')}).`
          : `Repaired ${plural(changed, 'row', 'rows')}.`,
      };
    }

    case 'delete_orphan_entries': {
      if (orphans.length === 0) throw new ConflictError('no orphaned entries remain for that dataset — re-run the check');
      let changed = 0;
      for (const o of orphans) {
        // Via the repository so each row is tombstoned BEFORE deletion and stays restorable.
        await contentRepo.remove(ctx, 'entry', o.entityId, o.scope);
        changed += 1;
      }
      return { action: input.action, changed, message: `Deleted ${plural(changed, 'entry', 'entries')} (restorable from History).` };
    }

    case 'delete_orphan_history': {
      if (slugs.has(input.subject)) throw new ConflictError(`dataset "${input.subject}" exists — its history is not stranded`);
      const res = await db.run(
        sql`delete from content_revisions where project_id = ${project.id} and kind = 'entry' and scope = ${input.subject}`,
      );
      const changed = Number((res as { rowsAffected?: number }).rowsAffected ?? 0);
      return { action: input.action, changed, message: `Deleted ${plural(changed, 'stranded snapshot', 'stranded snapshots')}.` };
    }
  }
}

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

import { and, desc, eq, sql } from 'drizzle-orm';
import { GLOBAL_TEMPLATE_PREFIX, hasOwnCode, localeOf, pagePath, withResolvedParent } from '@sitewright/core';
import type { Page } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { content, contentRevisions, projects, type ContentKind } from '../db/schema.js';
import { contentVersion, schemaFor, type ContentRepository } from './content.js';
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
  | 'orphan_translation'
  | 'orphan_locale_variant'
  | 'deleted_project_holding_slug'
  | 'domain_on_deleted_project';

/** A repair an operator may run. Everything here is opt-in and re-verified at execution time. */
export type IntegrityActionId =
  | 'recreate_dataset'
  | 'reassign_entries'
  | 'fix_entry_scope'
  | 'delete_orphan_entries'
  | 'delete_orphan_history'
  | 'reparent_pages'
  | 'restore_template'
  | 'delete_orphan_translations'
  | 'delete_orphan_variants'
  | 'release_domains';

/** Every action id, for request validation. */
export const INTEGRITY_ACTION_IDS = [
  'recreate_dataset',
  'reassign_entries',
  'fix_entry_scope',
  'delete_orphan_entries',
  'delete_orphan_history',
  'reparent_pages',
  'restore_template',
  'delete_orphan_translations',
  'delete_orphan_variants',
  'release_domains',
] as const satisfies readonly IntegrityActionId[];

export interface IntegrityAction {
  id: IntegrityActionId;
  label: string;
  /** `destructive` actions remove rows — the UI must confirm. Non-destructive ones only add/repair. */
  destructive: boolean;
  /**
   * Whether "Fix all issues" may apply this without the operator choosing it. An issue's actions are
   * ALTERNATIVES listed conservative-first, and Fix all takes the first unattended one. False when the
   * action needs an input nobody can default (which dataset to move to), or when a gentler alternative
   * exists for the same issue (deleting entries that "Recreate the dataset" could bring back).
   */
  unattended: boolean;
  /** For a destructive action: whether what it removes can be brought back (from History). */
  reversible: boolean;
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
  { id: 'translations', label: 'Translations reach their page' },
  { id: 'deleted_projects', label: 'Deleted projects holding slugs' },
  { id: 'custom_domains', label: 'Custom domains resolve to a live project' },
  { id: 'locale_variants', label: 'Language variants reach their main page' },
];

export const INTEGRITY_CHECK_COUNT = CHECKS.length;

const ACTIONS: Record<IntegrityActionId, IntegrityAction> = {
  recreate_dataset: {
    id: 'recreate_dataset',
    label: 'Recreate the dataset',
    destructive: false,
    unattended: true,
    reversible: true,
    detail:
      'Creates a dataset with the missing slug, its fields inferred from the orphaned entries. They become visible in the editor again — and any version history stranded under that slug becomes reachable too, because both are keyed by it. Nothing is guessed: it restores the name the rows already point at. Review and edit the dataset afterwards.',
  },
  reassign_entries: {
    id: 'reassign_entries',
    label: 'Move to an existing dataset',
    destructive: false,
    // Needs a target only the operator can name.
    unattended: false,
    reversible: true,
    detail: 'Re-points the orphaned entries at a dataset you choose, moving their rows and history to it.',
  },
  fix_entry_scope: {
    id: 'fix_entry_scope',
    label: 'Repair storage scope',
    destructive: false,
    unattended: true,
    reversible: true,
    detail:
      "Re-derives each row's storage scope from its own `dataset` field — the authored intent — so it is reachable by the dataset it claims to belong to. Rows that would collide with an existing entry are reported instead of overwritten.",
  },
  delete_orphan_entries: {
    id: 'delete_orphan_entries',
    label: 'Delete the entries',
    destructive: true,
    // "Recreate the dataset" brings the same rows back instead; deleting is a choice, never a default.
    unattended: false,
    reversible: true,
    detail:
      'Permanently removes the unreachable entry rows. Each one is tombstoned first, so it stays restorable from the History rail. Prefer recreating or reassigning the dataset if the content might still be wanted.',
  },
  delete_orphan_history: {
    id: 'delete_orphan_history',
    label: 'Delete the stranded history',
    destructive: true,
    // Only ever offered for history no deleted dataset can bring back (see check 6), so nothing that
    // could be restored is lost — and it expires at the retention limit anyway.
    unattended: true,
    reversible: false,
    detail:
      'Removes version snapshots scoped to a dataset that no longer exists. They cannot be listed or restored in this state, and they expire on their own at the retention limit — deleting only reclaims the space sooner.',
  },
  reparent_pages: {
    id: 'reparent_pages',
    label: 'Move under the home page',
    destructive: false,
    unattended: true,
    reversible: true,
    detail:
      "Hangs each page under its language's home page — the main language's pages under the site's home — the same place a new page goes. A main-language page keeps its address: a missing parent already rendered it at the top level.",
  },
  restore_template: {
    id: 'restore_template',
    label: 'Restore the template from History',
    destructive: false,
    unattended: true,
    reversible: true,
    detail: 'Brings the deleted template back from its last saved version in History, so the pages that use it render again.',
  },
  delete_orphan_translations: {
    id: 'delete_orphan_translations',
    label: 'Delete the translations',
    destructive: true,
    // Title overrides for a page that is gone. Each is tombstoned first, so a restored page can get
    // its translated titles back from History too.
    unattended: true,
    reversible: true,
    detail:
      'Removes the translated titles of a page that no longer exists. Each one is tombstoned first, so it stays restorable from the History rail if the page comes back.',
  },
  delete_orphan_variants: {
    id: 'delete_orphan_variants',
    label: 'Delete the variants',
    destructive: true,
    // With no main page they render nothing; deleting the main page now takes them along anyway. Each is
    // tombstoned, so a restored main page can have its variants back from History too.
    unattended: true,
    reversible: true,
    detail:
      'Removes language variants whose main page is gone — with nothing to follow, each renders an empty page. Each is tombstoned first, so it stays restorable from the History rail; pages under a variant move up a level.',
  },
  release_domains: {
    id: 'release_domains',
    label: 'Release the hostnames',
    destructive: true,
    // A deleted project keeps its claims ON PURPOSE — restoring it puts its domains back. Whether it
    // will ever be restored is the operator's call, not a default.
    unattended: false,
    reversible: false,
    detail:
      'Removes the hostname claims of deleted projects, so another project can use them. Restoring such a project later brings it back without its custom domains — add and verify them again in its settings.',
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

/** The project's main language, from its stored settings row (`en` when unreadable). */
function defaultLocaleOfRows(rows: Row[]): string {
  const settings = rows.find((r) => r.kind === 'settings')?.data as { settings?: { defaultLocale?: string } } | undefined;
  return settings?.settings?.defaultLocale ?? 'en';
}

/**
 * Language variants that follow a main page's code (no code of their own) when their group has no
 * main-language page left. The group key is resolved the way the locale tools do (`translationGroup ?? id`),
 * so a main page that never carried the field explicitly still counts as present.
 */
function orphanedVariants(pages: readonly Page[], defaultLocale: string): Page[] {
  const mainGroups = new Set(pages.filter((p) => localeOf(p, defaultLocale) === defaultLocale).map((p) => p.translationGroup ?? p.id));
  return pages.filter(
    (p) => p.translationGroup !== undefined && localeOf(p, defaultLocale) !== defaultLocale && !hasOwnCode(p) && !mainGroups.has(p.translationGroup),
  );
}

/** `<projectId>:<key>` for every DELETE tombstone of `kind` in History, keyed by the given column. */
async function tombstoneKeys(db: Database, kind: ContentKind, key: ReturnType<typeof sql>): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: contentRevisions.projectId, key: sql<string | null>`${key}` })
    .from(contentRevisions)
    // json_valid first: one malformed blob must not fail the whole (read-only) sweep.
    .where(and(eq(contentRevisions.kind, kind), eq(contentRevisions.op, 'delete'), sql`json_valid(${contentRevisions.data})`));
  return new Set(rows.filter((r) => typeof r.key === 'string' && r.key !== '').map((r) => `${r.projectId}:${r.key}`));
}

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
  // What History can still bring back, as `<projectId>:<key>`: the slugs of deleted datasets and the ids
  // of deleted templates. A delete leaves its last state behind as a tombstone, and that decides both
  // whether stranded entry history is really stranded and whether a missing template can be restored.
  const deletedDatasetSlugs = await tombstoneKeys(db, 'dataset', sql`json_extract(${contentRevisions.data}, '$.slug')`);
  // The instance's global library templates (stored without their `global:` prefix).
  const globalTemplateIds = new Set(
    (rowsByProject.get(GLOBAL_SCOPE_ID) ?? []).filter((r) => r.kind === 'template').map((r) => r.entityId),
  );
  const deletedTemplateIds = await tombstoneKeys(db, 'template', sql`${contentRevisions.entityId}`);

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
  //
  // NOT stranded: the history of a dataset somebody DELETED. Deleting a dataset tombstones its entries
  // under its slug, and the dataset's own tombstone sits in History beside them — restore the dataset
  // and every one of those entries is restorable again. That is the undo buffer working, and it expires
  // at the retention limit with everything else. Reporting it made every deleted dataset an "issue"
  // whose only offered fix was to destroy the undo.
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
          revs
            .filter((r) => !slugs.has(r.scope) && !deletedDatasetSlugs.has(`${p.id}:${r.scope}`))
            .map((r) => ({ subject: r.scope, id: r.entityId })),
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

  // ---- 8/9. Page tree, templates.
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
        (parent, n) => `${plural(n, 'page nests', 'pages nest')} under "${parent}", which does not exist — their route cannot be computed correctly.`,
        ['reparent_pages'],
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
            if (typeof t !== 'string' || t === '') return false;
            // A `global:<id>` reference resolves against the instance's global library — its rows, not the
            // built-in constants, which only seed it — so a template deleted there breaks these pages too.
            return t.startsWith(GLOBAL_TEMPLATE_PREFIX) ? !globalTemplateIds.has(t.slice(GLOBAL_TEMPLATE_PREFIX.length)) : !templates.has(t);
          })
          .map((r) => ({ subject: String(dataOf<{ template?: string }>(r).template), id: r.entityId })),
        { code: 'missing_page_template', severity: 'warning', projectId: p.id, projectSlug: p.slug },
        (t, n) =>
          `${plural(n, 'page references', 'pages reference')} template "${t}", which does not exist — those pages fail to render.` +
          (t.startsWith(GLOBAL_TEMPLATE_PREFIX)
            ? ' It is a global library template: recreate it in the global library, or point the pages at another template.'
            : deletedTemplateIds.has(`${p.id}:${t}`)
              ? ''
              : ' History holds no copy of it, so point the pages at another template (or recreate it) in the editor.'),
      ).map((issue) => ({
        ...issue,
        // Only restorable while History still holds the template's last state.
        actions: deletedTemplateIds.has(`${p.id}:${issue.subject}`) ? [ACTIONS.restore_template] : [],
      }));
    },
    (rows) => pagesOf(rows).length,
  );

  perProject(
    9,
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
        (pid, n) => `${plural(n, 'translation targets', 'translations target')} page "${pid}", which does not exist.`,
        ['delete_orphan_translations'],
      );
    },
    (rows) => rows.filter((r) => r.kind === 'translation').length,
  );

  // ---- 11. Soft-deleted projects still holding their slug. Informational, not damage: it is by design
  // (a restore must find the slug intact) but it blocks reusing that slug, which surprises operators.
  begin(CHECKS[10]!.label);
  {
    const held = allProjects.filter((p) => p.deletedAt);
    record(
      'deleted_projects',
      CHECKS[10]!.label,
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

  // ---- 12. Custom domains. A verified host is in the routing map and therefore serving traffic, so a
  // row whose project is soft-deleted is worth naming: the map excludes it (the site 404s), but the
  // claim still holds that hostname against every other project, which looks like a platform bug from
  // the outside. A row with no live project at all would be an FK violation and is caught by check 2.
  begin(CHECKS[11]!.label);
  {
    const domainRows = (await db.all(
      sql`select d.host as host, d.project_id as projectId, d.verified_at as verifiedAt, p.slug as slug, p.deleted_at as deletedAt
          from project_domains d join projects p on p.id = d.project_id`,
    )) as Array<{ host: string; projectId: string; verifiedAt: number | null; slug: string; deletedAt: number | null }>;
    const stranded = domainRows.filter((r) => r.deletedAt !== null);
    // One issue per deleted project, so a release acts on exactly the project the operator saw.
    record(
      'custom_domains',
      CHECKS[11]!.label,
      domainRows.length,
      [...new Set(stranded.map((r) => r.projectId))].map((projectId) => {
        const held = stranded.filter((r) => r.projectId === projectId);
        return {
          code: 'domain_on_deleted_project',
          severity: 'warning',
          projectId,
          projectSlug: held[0]!.slug,
          subject: 'custom domains',
          count: held.length,
          sample: held.slice(0, SAMPLE_LIMIT).map((r) => r.host),
          detail:
            'These hostnames are claimed by a project that is deleted. They are NOT being served (a deleted project 404s), but the claim still reserves each hostname, so no other project can use it until the project is restored or permanently removed. Restoring it brings the domains back with it.',
          actions: [ACTIONS.release_domains],
        } satisfies IntegrityIssue;
      }),
    );
  }

  // ---- 13. Language variants whose main page is gone. A variant that follows its main page's code renders
  // that code; with no main page it renders an EMPTY page. Deleting a main page now takes these along —
  // this finds the ones an earlier API or MCP delete left behind.
  perProject(
    12,
    'locale_variants',
    (rows, p) => {
      const pages = pagesOf(rows).map((r) => r.data as Page);
      return group(
        orphanedVariants(pages, defaultLocaleOfRows(rows)).map((v) => ({ subject: v.translationGroup!, id: v.id })),
        { code: 'orphan_locale_variant', severity: 'warning', projectId: p.id, projectSlug: p.slug },
        (g, n) =>
          `${plural(n, 'language variant follows', 'language variants follow')} the code of main page "${g}", which does not exist — ${n === 1 ? 'it renders' : 'they render'} an empty page.`,
        ['delete_orphan_variants'],
      );
    },
    (rows) => pagesOf(rows).filter((r) => typeof (r.data as Page).locale === 'string').length,
  );

  return {
    // INFO findings are by design (a deleted project keeping its slug) — nothing to fix, so not "not ok".
    ok: issues.every((i) => i.severity === 'info'),
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
  /** The issue's `subject` — what the rows point at (a dataset slug, a page or template id). */
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
  // The one repair that acts on a DELETED project — every other one refuses those below.
  if (input.action === 'release_domains') return releaseDomains(db, input.projectId);
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
      // IRREVERSIBLE, and Fix all may run it — so it re-derives everything the check used to offer it,
      // not just "no live dataset": a stale report, a direct call, or an earlier repair in the same
      // batch that FAILED (a recreate that did not happen) must never get it past these.
      if (slugs.has(input.subject)) throw new ConflictError(`dataset "${input.subject}" exists — its history is not stranded`);
      if (rows.some((r) => r.kind === 'entry' && (r.scope === input.subject || (r.data as { dataset?: string }).dataset === input.subject))) {
        throw new ConflictError(
          `entries are still stored under "${input.subject}" — recreate or reassign them first; their history goes with them`,
        );
      }
      const [deletedDataset] = await db
        .select({ id: contentRevisions.id })
        .from(contentRevisions)
        .where(
          and(
            eq(contentRevisions.projectId, project.id),
            eq(contentRevisions.kind, 'dataset'),
            eq(contentRevisions.op, 'delete'),
            sql`json_extract(${contentRevisions.data}, '$.slug') = ${input.subject}`,
          ),
        )
        .limit(1);
      if (deletedDataset) {
        throw new ConflictError(`dataset "${input.subject}" was deleted and can be restored from History — this history is its undo`);
      }
      const res = await db.run(
        sql`delete from content_revisions where project_id = ${project.id} and kind = 'entry' and scope = ${input.subject}`,
      );
      const changed = Number((res as { rowsAffected?: number }).rowsAffected ?? 0);
      return { action: input.action, changed, message: `Deleted ${plural(changed, 'stranded snapshot', 'stranded snapshots')}.` };
    }

    case 'reparent_pages': {
      const pages = rows.filter((r) => r.kind === 'page').map((r) => r.data as Page);
      if (pages.some((p) => p.id === input.subject)) throw new ConflictError(`page "${input.subject}" exists — re-run the check`);
      const dangling = pages.filter((p) => p.parent === input.subject);
      if (dangling.length === 0) throw new ConflictError('no pages point at that parent any more — re-run the check');
      const settings = rows.find((r) => r.kind === 'settings')?.data as { settings?: { defaultLocale?: string } } | undefined;
      const defaultLocale = settings?.settings?.defaultLocale ?? 'en';
      let changed = 0;
      const homeless: string[] = [];
      const clashing: string[] = [];
      // Routes are computed against the tree AS IT IS BEING REPAIRED, so two pages moved in this run
      // cannot both claim the same address either.
      const byId = new Map(pages.map((p) => [p.id, p]));
      for (const page of dangling) {
        // The same rule a whole-project import applies: an unresolvable parent is replaced by the page's
        // language home, else the root home. Unchanged (by identity) when there is no home to hang it on.
        const fixed = withResolvedParent(page, pages, defaultLocale, { repairDangling: true });
        if (fixed === page) {
          homeless.push(page.id);
          continue;
        }
        // A main-language page keeps its address (a missing parent already rendered it at the top
        // level). A page of another language moves under its language home, so its address CHANGES —
        // and must not land on one another page already has: publish refuses two pages on one route.
        const before = pagePath(page, byId);
        const after = pagePath(fixed, new Map(byId).set(fixed.id, fixed));
        if (after !== before && [...byId.values()].some((o) => o.id !== page.id && pagePath(o, byId) === after)) {
          clashing.push(page.id);
          continue;
        }
        // Refuse rather than overwrite an edit saved since `rows` was read (a VersionConflictError).
        await contentRepo.put(ctx, 'page', page.id, fixed, { expectedVersion: contentVersion(page) });
        byId.set(fixed.id, fixed);
        changed += 1;
      }
      return {
        action: input.action,
        changed,
        message: [
          `Moved ${plural(changed, 'page', 'pages')} under a home page.`,
          homeless.length
            ? `${plural(homeless.length, 'page was', 'pages were')} left as they were because the project has no home page to hang them on (${homeless.slice(0, 5).join(', ')}).`
            : '',
          clashing.length
            ? `${plural(clashing.length, 'page was', 'pages were')} left as they were because the address they would move to is another page's (${clashing.slice(0, 5).join(', ')}).`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      };
    }

    case 'restore_template': {
      if (rows.some((r) => r.kind === 'template' && r.entityId === input.subject)) {
        throw new ConflictError(`template "${input.subject}" exists — re-run the check`);
      }
      const [last] = await db
        .select({ data: contentRevisions.data })
        .from(contentRevisions)
        .where(and(eq(contentRevisions.projectId, project.id), eq(contentRevisions.kind, 'template'), eq(contentRevisions.entityId, input.subject)))
        .orderBy(desc(contentRevisions.revisionAt))
        .limit(1);
      if (!last) throw new ConflictError(`History holds no copy of template "${input.subject}"`);
      await contentRepo.put(ctx, 'template', input.subject, last.data, { op: 'restore', note: 'Restored by a database integrity repair' });
      const users = rows.filter((r) => r.kind === 'page' && (r.data as { template?: string }).template === input.subject).length;
      return {
        action: input.action,
        changed: 1,
        message: `Restored template "${input.subject}"; ${plural(users, 'page renders', 'pages render')} with it again.`,
      };
    }

    case 'delete_orphan_variants': {
      const pages = rows.filter((r) => r.kind === 'page').map((r) => r.data as Page);
      const orphans = orphanedVariants(pages, defaultLocaleOfRows(rows)).filter((v) => v.translationGroup === input.subject);
      if (orphans.length === 0) throw new ConflictError('no variant of that page is orphaned any more — re-run the check');
      // Through the repository, so each is tombstoned and its own children move up like any page delete.
      for (const v of orphans) await contentRepo.remove(ctx, 'page', v.id);
      return {
        action: input.action,
        changed: orphans.length,
        message: `Deleted ${plural(orphans.length, 'language variant', 'language variants')} (restorable from History).`,
      };
    }

    case 'delete_orphan_translations': {
      if (rows.some((r) => r.kind === 'page' && r.entityId === input.subject)) {
        throw new ConflictError(`page "${input.subject}" exists — its translations are not orphaned`);
      }
      const orphans = rows.filter((r) => r.kind === 'translation' && (r.data as { pageId?: string }).pageId === input.subject);
      if (orphans.length === 0) throw new ConflictError('no translations target that page any more — re-run the check');
      for (const o of orphans) await contentRepo.remove(ctx, 'translation', o.entityId);
      return {
        action: input.action,
        changed: orphans.length,
        message: `Deleted ${plural(orphans.length, 'translation', 'translations')} (restorable from History).`,
      };
    }

  }
}

/**
 * Release the hostname claims of ONE deleted project. Re-derived like every repair: the project must
 * still be deleted right now (a restored project's domains are in use again). The routing map already
 * excludes a deleted project, so nothing that is being served changes.
 */
async function releaseDomains(db: Database, projectId: string): Promise<IntegrityActionResult> {
  const [project] = await db.select({ id: projects.id, deletedAt: projects.deletedAt }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw new NotFoundError('project not found');
  if (!project.deletedAt) throw new ConflictError('that project is not deleted — its hostnames are in use');
  const hosts = (await db.all(sql`select host from project_domains where project_id = ${project.id}`)) as Array<{ host: string }>;
  if (hosts.length === 0) throw new ConflictError('that project holds no hostname any more — re-run the check');
  await db.run(sql`delete from project_domains where project_id = ${project.id}`);
  return {
    action: 'release_domains',
    changed: hosts.length,
    message: `Released ${plural(hosts.length, 'hostname', 'hostnames')}: ${hosts.map((h) => h.host).join(', ')}.`,
  };
}

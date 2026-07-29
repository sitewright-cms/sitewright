// Read-only referential-integrity report for a project's content.
//
// This exists because the entry→dataset link is a MUTABLE SLUG (`content.scope`), not the dataset's
// immutable id. Every code path that could break that link is now closed and guarded by
// test/no-orphan-entries.test.ts — but a code-path guard cannot see drift introduced by a hand-edited
// database, a restored backup, a future migration, or a bug not yet written. This check does: it
// inspects the stored rows themselves and says what is unreachable.
//
// It REPORTS. It never writes, deletes or repairs anything — the caller decides what to do, because
// "unreachable" is not always "unwanted": rows can be recoverable data an operator wants to re-home,
// and a rename mid-flight can look identical to corruption for a moment.

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { content, contentRevisions } from '../db/schema.js';

/** How many example ids to carry per issue group — enough to investigate, bounded for a large project. */
const SAMPLE_LIMIT = 10;

export type IntegrityIssueCode =
  /** Entries whose `dataset` slug matches no dataset: invisible to every list, the editor, publish and export. */
  | 'orphan_entry'
  /** A row whose storage `scope` disagrees with its own `data.dataset` — reachable by at most one of them. */
  | 'entry_scope_mismatch'
  /** Version history stranded under a dataset slug that no longer exists; the entity's past is unreachable. */
  | 'orphan_entry_history';

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  /** The dataset slug the affected rows point at (or are scoped under). */
  dataset: string;
  /** How many rows are affected — the full count, not the sample length. */
  count: number;
  /** Up to {@link SAMPLE_LIMIT} affected entity ids, for investigation. */
  sample: string[];
  /** What this means, in the operator's terms. */
  detail: string;
}

export interface IntegrityReport {
  ok: boolean;
  /** What was examined, so a clean report is distinguishable from an empty project. */
  checked: { datasets: number; entries: number; entryRevisions: number };
  issues: IntegrityIssue[];
}

/** Groups affected rows by dataset slug into one issue each, with a bounded id sample. */
function group(
  code: IntegrityIssueCode,
  rows: Array<{ dataset: string; entityId: string }>,
  detail: (dataset: string, count: number) => string,
): IntegrityIssue[] {
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.dataset, [...(by.get(r.dataset) ?? []), r.entityId]);
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([dataset, ids]) => ({
      code,
      dataset,
      count: ids.length,
      sample: ids.slice(0, SAMPLE_LIMIT),
      detail: detail(dataset, ids.length),
    }));
}

/**
 * Inspect one project's stored content for rows that exist but cannot be reached. Pure read.
 *
 * Deliberately reads the RAW rows rather than going through ContentRepository.list(): the whole point
 * is to find rows the normal read path cannot see, so anything that filters or validates on the way out
 * would hide exactly what is being looked for.
 */
export async function checkProjectIntegrity(db: Database, projectId: string): Promise<IntegrityReport> {
  const rows = await db
    .select({ kind: content.kind, entityId: content.entityId, scope: content.scope, data: content.data })
    .from(content)
    .where(and(eq(content.projectId, projectId), isNull(content.deletedAt)));

  const datasetSlugs = new Set(
    rows.filter((r) => r.kind === 'dataset').map((r) => String((r.data as { slug?: string }).slug ?? '')),
  );
  const entries = rows.filter((r) => r.kind === 'entry');

  const orphans: Array<{ dataset: string; entityId: string }> = [];
  const mismatched: Array<{ dataset: string; entityId: string }> = [];
  for (const e of entries) {
    const declared = String((e.data as { dataset?: string }).dataset ?? '');
    if (!datasetSlugs.has(declared)) orphans.push({ dataset: declared, entityId: e.entityId });
    // Independent of the orphan check: a row can name a live dataset yet be STORED under another scope,
    // which makes it unreachable by the very slug it claims to belong to.
    if (e.scope !== declared) mismatched.push({ dataset: `${e.scope} != ${declared}`, entityId: e.entityId });
  }

  const revisionRows = await db
    .select({ entityId: contentRevisions.entityId, scope: contentRevisions.scope })
    .from(contentRevisions)
    .where(and(eq(contentRevisions.projectId, projectId), eq(contentRevisions.kind, 'entry')));
  const strandedHistory = revisionRows
    .filter((r) => !datasetSlugs.has(r.scope))
    .map((r) => ({ dataset: r.scope, entityId: r.entityId }));

  const issues = [
    ...group(
      'orphan_entry',
      orphans,
      (ds, n) => `${n} entr${n === 1 ? 'y' : 'ies'} name dataset "${ds}", which does not exist — they are invisible to the editor, publish and export.`,
    ),
    ...group(
      'entry_scope_mismatch',
      mismatched,
      (ds, n) => `${n} entr${n === 1 ? 'y is' : 'ies are'} stored under a scope that disagrees with their own dataset field (${ds}).`,
    ),
    ...group(
      'orphan_entry_history',
      strandedHistory,
      (ds, n) => `${n} entry revision${n === 1 ? '' : 's'} are scoped to dataset "${ds}", which does not exist — that history cannot be listed or restored.`,
    ),
  ];

  return {
    ok: issues.length === 0,
    checked: { datasets: datasetSlugs.size, entries: entries.length, entryRevisions: revisionRows.length },
    issues,
  };
}

import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { contentRevisions, type ContentKind } from '../db/schema.js';
import type { ProjectContext } from './context.js';

/**
 * Content kinds that get revision history — the user-editable, site-affecting set. Credentials
 * (`deploy_target`, `project_smtp`) are never snapshotted (no secrets in history); media binaries
 * (`media`, `mediafolder`) live on disk and aren't versioned. Matches the MCP `GENERIC_KIND` enum.
 */
export const REVISIONED_KINDS: ReadonlySet<ContentKind> = new Set<ContentKind>([
  'page',
  'template',
  'snippet',
  'translation',
  'dataset',
  'entry',
  'form',
  'settings',
]);

export type RevisionOp = 'put' | 'delete' | 'restore';
export type RevisionActor = 'user' | 'agent';

/** A revision without its (potentially large) `data` blob — for the history list. */
export interface RevisionMeta {
  id: string;
  kind: ContentKind;
  entityId: string;
  op: RevisionOp;
  userId: string;
  actor: RevisionActor;
  note: string | null;
  revisionAt: Date;
}

/** A full revision, including the snapshot `data` (for preview / restore). */
export interface Revision extends RevisionMeta {
  data: unknown;
}

export interface RevisionsOptions {
  /** Collapse a same-author 'put' burst on one entity within this window into the latest row. */
  coalesceWindowMs?: number;
  /** Keep at most this many revisions per entity (oldest pruned on insert). */
  maxPerEntity?: number;
  /** Delete revisions older than this many days (maintenance sweep). */
  retentionDays?: number;
}

const DEFAULT_COALESCE_WINDOW_MS = 3 * 60 * 1000;
const DEFAULT_MAX_PER_ENTITY = 50;
const DEFAULT_RETENTION_DAYS = 90;

const META_COLUMNS = {
  id: contentRevisions.id,
  kind: contentRevisions.kind,
  entityId: contentRevisions.entityId,
  op: contentRevisions.op,
  userId: contentRevisions.userId,
  actor: contentRevisions.actor,
  note: contentRevisions.note,
  revisionAt: contentRevisions.revisionAt,
} as const;

/**
 * Append-only content version history. `record` is called (best-effort) from the content write
 * chokepoints; `list`/`get` back the history UI + MCP tools; `sweepOld` is the retention housekeeping.
 * Every read/write is project-scoped via `ProjectContext`.
 */
export class RevisionsRepository {
  constructor(
    private readonly db: Database,
    private readonly options: RevisionsOptions = {},
  ) {}

  private get coalesceWindowMs(): number {
    return this.options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
  }
  private get maxPerEntity(): number {
    return this.options.maxPerEntity ?? DEFAULT_MAX_PER_ENTITY;
  }

  /**
   * Snapshot one content write. A plain `put` that follows the SAME author's last `put` on this entity
   * within the coalesce window UPDATEs that row (so a typing/autosave burst is one revision) instead of
   * inserting; everything else (a later edit, a different author, a delete, a restore) inserts a new row.
   * Non-revisioned kinds are skipped. The caller treats this as best-effort — it must never throw into a
   * user's save (see ContentRepository).
   */
  async record(
    ctx: ProjectContext,
    kind: ContentKind,
    entityId: string,
    data: unknown,
    op: RevisionOp,
    note?: string,
  ): Promise<void> {
    if (!REVISIONED_KINDS.has(kind)) return;
    const now = new Date();
    const actor: RevisionActor = ctx.actor === 'agent' ? 'agent' : 'user';

    // The read+write isn't transactional: two truly-concurrent saves to one entity could each find no
    // coalescing candidate and both INSERT (two rows instead of one). That's acceptable — history is
    // best-effort and the per-entity cap trims any surplus; we don't pay a transaction on every save.
    if (op === 'put') {
      const [latest] = await this.db
        .select()
        .from(contentRevisions)
        .where(this.entityWhere(ctx.projectId, kind, entityId))
        .orderBy(desc(contentRevisions.revisionAt))
        .limit(1);
      if (
        latest &&
        latest.op === 'put' &&
        latest.userId === ctx.userId &&
        latest.actor === actor &&
        now.getTime() - new Date(latest.revisionAt).getTime() < this.coalesceWindowMs
      ) {
        await this.db
          .update(contentRevisions)
          // Re-assert the project scope on the write (defense-in-depth: `latest.id` was already
          // project-scoped on read). Carry a `note` through if one was supplied.
          .set({ data, revisionAt: now, ...(note !== undefined ? { note } : {}) })
          .where(and(eq(contentRevisions.id, latest.id), eq(contentRevisions.projectId, ctx.projectId)));
        return;
      }
    }

    await this.db.insert(contentRevisions).values({
      id: newId(),
      projectId: ctx.projectId,
      kind,
      entityId,
      data,
      op,
      userId: ctx.userId,
      actor,
      note: note ?? null,
      revisionAt: now,
    });
    await this.prune(ctx.projectId, kind, entityId);
  }

  /** Newest-first metadata for one entity's history (no `data` blobs). */
  async list(ctx: ProjectContext, kind: ContentKind, entityId: string): Promise<RevisionMeta[]> {
    const rows = await this.db
      .select(META_COLUMNS)
      .from(contentRevisions)
      .where(this.entityWhere(ctx.projectId, kind, entityId))
      .orderBy(desc(contentRevisions.revisionAt));
    return rows as RevisionMeta[];
  }

  /** A single revision (incl. `data`), scoped to the caller's project. */
  async get(ctx: ProjectContext, revisionId: string): Promise<Revision | null> {
    const [row] = await this.db
      .select()
      .from(contentRevisions)
      .where(and(eq(contentRevisions.id, revisionId), eq(contentRevisions.projectId, ctx.projectId)))
      .limit(1);
    return row ? (row as Revision) : null;
  }

  /** Housekeeping: drop revisions older than the retention window. */
  async sweepOld(now: Date = new Date()): Promise<void> {
    const days = this.options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    await this.db.delete(contentRevisions).where(lt(contentRevisions.revisionAt, cutoff));
  }

  private entityWhere(projectId: string, kind: ContentKind, entityId: string) {
    return and(
      eq(contentRevisions.projectId, projectId),
      eq(contentRevisions.kind, kind),
      eq(contentRevisions.entityId, entityId),
    );
  }

  /** Keep only the newest `maxPerEntity` rows for an entity. */
  private async prune(projectId: string, kind: ContentKind, entityId: string): Promise<void> {
    const rows = await this.db
      .select({ id: contentRevisions.id })
      .from(contentRevisions)
      .where(this.entityWhere(projectId, kind, entityId))
      .orderBy(desc(contentRevisions.revisionAt));
    const stale = rows.slice(this.maxPerEntity).map((r) => r.id);
    if (stale.length > 0) {
      await this.db.delete(contentRevisions).where(inArray(contentRevisions.id, stale));
    }
  }
}

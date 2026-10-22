import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { newId } from '../id.js';
import type { Database } from '../db/client.js';
import { contentRevisions, type ContentKind } from '../db/schema.js';
import type { ProjectContext } from './context.js';
import { escapeLike } from './sql-like.js';

/**
 * Content kinds that get revision history — the user-editable, site-affecting set. Credentials
 * (`deploy_target`, `project_smtp`, `project_captcha`, `ai_config`) are never snapshotted (no secrets in history); media
 * binaries (`media`, `mediafolder`) live on disk and aren't versioned. Matches the MCP `GENERIC_KIND` enum.
 */
export const REVISIONED_KINDS: ReadonlySet<ContentKind> = new Set<ContentKind>([
  'page',
  'template',
  'snippet',
  'translation',
  'dataset',
  'entry',
  'form',
  'imagemap',
  'settings',
]);

/**
 * What a revision records: `create` (the write that made the entity — no stored row before it), `put`
 * (an update), `delete` (the tombstone, holding the state AT deletion) or `restore`. Rows recorded before
 * `create` existed stay `put`.
 */
export const REVISION_OPS = ['create', 'put', 'delete', 'restore'] as const;
export type RevisionOp = (typeof REVISION_OPS)[number];
export type RevisionActor = 'user' | 'agent';

/** Largest page the project-wide feed returns — the History view asks for 50. */
export const MAX_FEED_PAGE = 100;
const DEFAULT_FEED_PAGE = 50;

/**
 * A position in the project-wide feed: the LAST row a page returned. The feed is ordered by
 * (revisionAt DESC, id DESC), and the id is part of the key because timestamps TIE — a bulk write
 * records many revisions in one millisecond, and a time-only cursor (`revisionAt < t`) skipped every
 * row that shared the boundary row's timestamp.
 */
export interface FeedCursor {
  at: Date;
  id: string;
}

const CURSOR_PATTERN = /^(\d{1,15}):([A-Za-z0-9_-]{1,128})$/;

/** The cursor as an opaque, URL-safe token. Clients pass it back verbatim; they never build one. */
export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(`${cursor.at.getTime()}:${cursor.id}`, 'utf8').toString('base64url');
}

/** The cursor a token stands for, or `null` when it is not one this server issued (a 400, not a guess). */
export function decodeFeedCursor(token: string): FeedCursor | null {
  if (token.length === 0 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const match = CURSOR_PATTERN.exec(Buffer.from(token, 'base64url').toString('utf8'));
  if (!match) return null;
  const ms = Number(match[1]);
  return Number.isSafeInteger(ms) ? { at: new Date(ms), id: match[2]! } : null;
}

export interface ProjectFeedQuery {
  limit?: number;
  kind?: ContentKind;
  op?: RevisionOp;
  /** Case-insensitive substring of the row's NAME — the same `label` the History row shows. */
  q?: string;
  /** Continue strictly AFTER this row (exclusive keyset). Absent = from the newest. */
  after?: FeedCursor;
}

export interface ProjectFeedPage {
  items: ProjectRevisionMeta[];
  /** Where the next page starts, or `null` when this page reached the end of the (filtered) feed. */
  next: FeedCursor | null;
}

/** A revision without its (potentially large) `data` blob — for the history list. */
export interface RevisionMeta {
  id: string;
  kind: ContentKind;
  entityId: string;
  /** Uniqueness scope of the snapshotted entity — the owning dataset slug for an `entry`, else `''`.
   *  Lets a project-wide feed row restore the RIGHT entity when an id repeats across datasets. */
  scope: string;
  op: RevisionOp;
  userId: string;
  actor: RevisionActor;
  note: string | null;
  revisionAt: Date;
}

/** A revision in the project-wide feed — adds a short `label` for the entity (from the snapshot). */
export interface ProjectRevisionMeta extends RevisionMeta {
  label: string;
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
  /**
   * Live policy provider (wired to the admin instance settings) — read on each record/sweep so an admin
   * changing the coalesce window / retention takes effect without a restart. Wins over the static
   * options above; an undefined field falls through to the static option, then the built-in default.
   */
  policy?: () => Promise<{ coalesceWindowMs?: number; retentionDays?: number }>;
}

// Default coalesce window: 0 = every save is its own revision (admins opt into coalescing via settings).
const DEFAULT_COALESCE_WINDOW_MS = 0;
const DEFAULT_MAX_PER_ENTITY = 50;
const DEFAULT_RETENTION_DAYS = 90;

const META_COLUMNS = {
  id: contentRevisions.id,
  kind: contentRevisions.kind,
  entityId: contentRevisions.entityId,
  scope: contentRevisions.scope,
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

  private get maxPerEntity(): number {
    return this.options.maxPerEntity ?? DEFAULT_MAX_PER_ENTITY;
  }

  /** Effective coalesce window + retention: the live policy (admin settings) if wired, else the static
   *  options, else the built-in defaults. Read fresh each call so an admin change applies immediately. */
  private async policyValues(): Promise<{ coalesceWindowMs: number; retentionDays: number }> {
    const p = this.options.policy ? await this.options.policy() : {};
    return {
      coalesceWindowMs: p.coalesceWindowMs ?? this.options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS,
      retentionDays: p.retentionDays ?? this.options.retentionDays ?? DEFAULT_RETENTION_DAYS,
    };
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
    scope: string,
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
    // Only look for a coalescing candidate when coalescing is ON (window > 0) — the default (0) skips it.
    const { coalesceWindowMs } = await this.policyValues();
    // Only an UPDATE coalesces, and into either kind of plain write: a quick tweak right after creating
    // something folds into its `create` row (which stays `create`), exactly as it folded into the
    // creation when that was recorded as a `put`. A `create` itself always inserts.
    if (op === 'put' && coalesceWindowMs > 0) {
      const [latest] = await this.db
        .select()
        .from(contentRevisions)
        .where(this.entityWhere(ctx.projectId, kind, entityId, scope))
        .orderBy(desc(contentRevisions.revisionAt))
        .limit(1);
      if (
        latest &&
        (latest.op === 'put' || latest.op === 'create') &&
        latest.userId === ctx.userId &&
        latest.actor === actor &&
        now.getTime() - new Date(latest.revisionAt).getTime() < coalesceWindowMs
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
      scope,
      data,
      op,
      userId: ctx.userId,
      actor,
      note: note ?? null,
      revisionAt: now,
    });
    await this.prune(ctx.projectId, kind, entityId, scope);
  }

  /**
   * Newest-first metadata for one entity's history (no `data` blobs). `scope` narrows the key — pass the
   * OWNING DATASET SLUG for an `entry` (its history is per-dataset), `''` for project-global kinds.
   */
  async list(ctx: ProjectContext, kind: ContentKind, entityId: string, scope = ''): Promise<RevisionMeta[]> {
    const rows = await this.db
      .select(META_COLUMNS)
      .from(contentRevisions)
      .where(this.entityWhere(ctx.projectId, kind, entityId, scope))
      .orderBy(desc(contentRevisions.revisionAt));
    return rows as RevisionMeta[];
  }

  /**
   * The project-wide activity feed for the History view — across ALL entities, newest first, with a
   * short `label` per row pulled straight from the snapshot (title → name → id) via SQLite json_extract
   * (no blob reaches JS). Optional kind / op / name-search filters, all combined, and KEYSET paging.
   *
   * ★ Keyset, not offset: the feed grows at the TOP while someone scrolls it, so an offset would hand
   * the next page rows it already returned (one per write since) — and a time-only cursor skipped rows
   * that tie on the boundary timestamp. `(revisionAt, id)` is a total order, so every row is returned
   * exactly once however much history arrives meanwhile.
   */
  async listProject(ctx: ProjectContext, opts: ProjectFeedQuery = {}): Promise<ProjectFeedPage> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_FEED_PAGE), 1), MAX_FEED_PAGE);
    // `$.general.name` is how an IMAGE MAP carries its name — without it an imagemap row falls all
    // the way through to its raw id (`map-ixlvc4fa`), which tells a reader nothing about what changed.
    // The entity id is the last resort, so the label is never null and the search sees what the row shows.
    const label = sql<string>`coalesce(json_extract(${contentRevisions.data}, '$.title'), json_extract(${contentRevisions.data}, '$.name'), json_extract(${contentRevisions.data}, '$.general.name'), json_extract(${contentRevisions.data}, '$.id'), ${contentRevisions.entityId})`;
    const conds = [eq(contentRevisions.projectId, ctx.projectId)];
    if (opts.kind) conds.push(eq(contentRevisions.kind, opts.kind));
    if (opts.op) conds.push(eq(contentRevisions.op, opts.op));
    // The NAME search: a substring of the label, bound as a parameter, with LIKE's own wildcards escaped
    // so "100%" means 100%. SQLite's LIKE folds ASCII case itself, so the term is passed as typed — a
    // JS `toLowerCase()` would turn "Über" into "über" and then fail to match the stored "Über".
    if (opts.q) conds.push(sql`${label} LIKE ${`%${escapeLike(opts.q)}%`} ESCAPE '\\'`);
    if (opts.after) {
      const { at, id } = opts.after;
      conds.push(
        or(lt(contentRevisions.revisionAt, at), and(eq(contentRevisions.revisionAt, at), lt(contentRevisions.id, id)))!,
      );
    }
    // One row past the page says whether another page exists, without a COUNT over the whole history.
    const rows = await this.db
      .select({ ...META_COLUMNS, label })
      .from(contentRevisions)
      .where(and(...conds))
      .orderBy(desc(contentRevisions.revisionAt), desc(contentRevisions.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map((r) => ({ ...r, label: (r.label as string | null) ?? r.entityId }) as ProjectRevisionMeta);
    const last = items[items.length - 1];
    return { items, next: rows.length > limit && last ? { at: last.revisionAt, id: last.id } : null };
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

  /**
   * Move an entry history from one dataset scope to another — the history half of a dataset slug rename.
   *
   * Entry revisions are keyed by the owning dataset SLUG (mirroring `content.scope`), so re-scoping the
   * live rows without re-scoping their history silently detached it: the entity moved to the new slug
   * while every snapshot stayed under the old one, and the History panel — which asks by the CURRENT
   * slug — showed an entity with no past. Nothing errored; the versions were simply gone from the UI.
   *
   * Moves EVERY entry revision in the old scope, including `delete` tombstones, so restoring an entry
   * that was deleted before the rename still works (it restores into the renamed dataset). Runs in the
   * caller's transaction so history and content commit together.
   */
  async rescopeEntries(ctx: ProjectContext, oldScope: string, newScope: string, exec?: Database): Promise<void> {
    if (oldScope === newScope) return;
    await (exec ?? this.db)
      .update(contentRevisions)
      .set({ scope: newScope })
      .where(
        and(
          eq(contentRevisions.projectId, ctx.projectId),
          eq(contentRevisions.kind, 'entry'),
          eq(contentRevisions.scope, oldScope),
        ),
      );
  }

  /** Housekeeping: drop revisions older than the retention window. */
  async sweepOld(now: Date = new Date()): Promise<void> {
    const { retentionDays } = await this.policyValues();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    await this.db.delete(contentRevisions).where(lt(contentRevisions.revisionAt, cutoff));
  }

  private entityWhere(projectId: string, kind: ContentKind, entityId: string, scope = '') {
    return and(
      eq(contentRevisions.projectId, projectId),
      eq(contentRevisions.kind, kind),
      eq(contentRevisions.scope, scope),
      eq(contentRevisions.entityId, entityId),
    );
  }

  /** Keep only the newest `maxPerEntity` rows for an entity (within its scope). */
  private async prune(projectId: string, kind: ContentKind, entityId: string, scope = ''): Promise<void> {
    const rows = await this.db
      .select({ id: contentRevisions.id })
      .from(contentRevisions)
      .where(this.entityWhere(projectId, kind, entityId, scope))
      .orderBy(desc(contentRevisions.revisionAt));
    const stale = rows.slice(this.maxPerEntity).map((r) => r.id);
    if (stale.length > 0) {
      await this.db.delete(contentRevisions).where(inArray(contentRevisions.id, stale));
    }
  }
}

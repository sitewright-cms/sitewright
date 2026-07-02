// Content revision history — list an entity's revisions, fetch one (incl. its snapshot), and restore.
// Restore re-writes the live content through ContentRepository.put (so it re-validates, fires the
// change event, marks the site dirty) tagging the new revision as `restore`. List/get gate on
// `content:read`; restore on `content:write` + a writer role. All project-scoped via resolveProject.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { projectMembers, users, type ApiKeyCapability, type ContentKind } from '../db/schema.js';
import type { ContentRepository } from '../repo/content.js';
import { REVISIONED_KINDS, type RevisionsRepository } from '../repo/revisions.js';
import { entryScope } from './content-scope.js';
import type { ProjectContext } from '../repo/context.js';

type RevisionReq = FastifyRequest<{ Params: { projectId: string; kind: string; entityId: string; revisionId?: string } }>;

export interface RevisionsDeps {
  resolveProject: (
    req: RevisionReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; slug: string } }>;
  contentRepo: ContentRepository;
  revisionsRepo: RevisionsRepository;
  /** True when the role may write (owner/member) — defense-in-depth on restore. */
  isWriter: (ctx: ProjectContext) => boolean;
  db: Database;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** A `:kind` that is a real, revisioned content kind — else null (route 404s / filter ignored). */
function revisionedKind(kind: string): ContentKind | null {
  return REVISIONED_KINDS.has(kind as ContentKind) ? (kind as ContentKind) : null;
}

/** Emails for the given userIds, but ONLY for users who are CURRENT members of this project (an
 *  inner-join on project_members) — a former member's email is never disclosed to current readers. */
async function memberEmails(db: Database, projectId: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(projectMembers, eq(projectMembers.userId, users.id))
    .where(and(inArray(users.id, ids), eq(projectMembers.projectId, projectId)));
  for (const u of rows) map.set(u.id, u.email);
  return map;
}

/** The display-author block for a revision row (no email for agents / ex-members). */
function authorOf(r: { userId: string; actor: 'user' | 'agent' }, emailById: Map<string, string>, ctxUserId: string) {
  return {
    userId: r.userId,
    email: r.actor === 'agent' ? null : (emailById.get(r.userId) ?? null),
    isYou: r.actor === 'user' && r.userId === ctxUserId,
  };
}

export function registerRevisionRoutes(app: FastifyInstance, deps: RevisionsDeps): void {
  const { resolveProject, contentRepo, revisionsRepo, isWriter, db, rl } = deps;
  const base = '/projects/:projectId/content/:kind/:entityId/revisions';

  // PROJECT-WIDE activity feed (the History view): all revisions across every entity, newest first,
  // with a short label per row + the entity kind/id (so a row can restore + link to its entity). Optional
  // `kind` / `op` filters + a `before` (ISO revisionAt) cursor; `nextBefore` paginates. content:read.
  app.get<{ Params: { projectId: string }; Querystring: { kind?: string; op?: string; limit?: string; before?: string } }>(
    '/projects/:projectId/revisions',
    { config: rl(120) },
    async (req, reply) => {
      // resolveProject only reads req.params.projectId (+ auth headers/cookies) — safe to widen.
      const { ctx } = await resolveProject(req as unknown as RevisionReq, 'content:read');
      const q = req.query;
      const beforeMs = q.before ? Date.parse(q.before) : NaN;
      const items = await revisionsRepo.listProject(ctx, {
        limit: q.limit ? Number(q.limit) : undefined,
        kind: q.kind ? (revisionedKind(q.kind) ?? undefined) : undefined,
        op: q.op === 'put' || q.op === 'delete' || q.op === 'restore' ? q.op : undefined,
        before: Number.isNaN(beforeMs) ? undefined : new Date(beforeMs),
      });
      const emailById = await memberEmails(db, ctx.projectId, items.filter((r) => r.actor === 'user').map((r) => r.userId));
      const rows = items.map((r) => ({
        id: r.id,
        kind: r.kind,
        entityId: r.entityId,
        // The entity's dataset scope ('' for non-entries) so a feed row can restore the RIGHT entry when
        // an id repeats across datasets (the restore route needs it as ?dataset=).
        dataset: r.scope,
        label: r.label,
        op: r.op,
        actor: r.actor,
        note: r.note,
        revisionAt: r.revisionAt,
        author: authorOf(r, emailById, ctx.userId),
      }));
      // Cursor for the next page: only when this page was full (a short page is the end).
      const nextBefore = rows.length > 0 && rows.length === (q.limit ? Number(q.limit) : 50) ? new Date(rows[rows.length - 1]!.revisionAt).toISOString() : null;
      return reply.send({ items: rows, nextBefore });
    },
  );

  // List one entity's revision history (newest first) — metadata only, no snapshot blobs. Resolves each
  // author to an email + an `isYou` flag for display; agent writes show no email (actor: 'agent').
  app.get<{ Params: { projectId: string; kind: string; entityId: string }; Querystring: { dataset?: string } }>(
    base,
    { config: rl(120) },
    async (req, reply) => {
      const kind = revisionedKind(req.params.kind);
      if (!kind) return reply.code(404).send({ error: 'no revision history for this kind' });
      const { ctx } = await resolveProject(req, 'content:read');
      // An `entry`'s history is dataset-scoped (its id is only unique within its dataset) — the owning
      // dataset arrives as a validated `?dataset=` (required, or 400); every other kind is scope `''`.
      const scope = entryScope(kind, req.query.dataset, reply);
      if (scope === undefined) return reply;
      const revisions = await revisionsRepo.list(ctx, kind, req.params.entityId, scope);
      const emailById = await memberEmails(db, ctx.projectId, revisions.filter((r) => r.actor === 'user').map((r) => r.userId));
      return reply.send({
        items: revisions.map((r) => ({
          id: r.id,
          op: r.op,
          actor: r.actor,
          note: r.note,
          revisionAt: r.revisionAt,
          author: authorOf(r, emailById, ctx.userId),
        })),
      });
    },
  );

  // Fetch one revision INCLUDING its snapshot `data` (for preview / diff). 404 if it isn't this entity's.
  app.get<{ Params: { projectId: string; kind: string; entityId: string; revisionId: string } }>(
    `${base}/:revisionId`,
    { config: rl(120) },
    async (req, reply) => {
      const kind = revisionedKind(req.params.kind);
      if (!kind) return reply.code(404).send({ error: 'no revision history for this kind' });
      const { ctx } = await resolveProject(req, 'content:read');
      const rev = await revisionsRepo.get(ctx, req.params.revisionId);
      if (!rev || rev.kind !== kind || rev.entityId !== req.params.entityId) {
        return reply.code(404).send({ error: 'revision not found' });
      }
      return reply.send({ revision: rev });
    },
  );

  // Restore a revision: re-write the entity's content from the snapshot. Non-destructive — the current
  // state stays in history and this creates a fresh `restore` revision. Recreates a deleted entity.
  app.post<{ Params: { projectId: string; kind: string; entityId: string; revisionId: string }; Querystring: { dataset?: string } }>(
    `${base}/:revisionId/restore`,
    { config: rl(60) },
    async (req, reply) => {
      const kind = revisionedKind(req.params.kind);
      if (!kind) return reply.code(404).send({ error: 'no revision history for this kind' });
      const { ctx } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      // An entry id repeats across datasets, so restore carries the owning `?dataset=` (required, or 400)
      // and the revision must belong to THAT dataset — otherwise a feed-sourced revision id could restore
      // a same-id entry in a different dataset than the URL addresses.
      const scope = entryScope(kind, req.query.dataset, reply);
      if (scope === undefined) return reply;
      const rev = await revisionsRepo.get(ctx, req.params.revisionId);
      if (!rev || rev.kind !== kind || rev.entityId !== req.params.entityId || rev.scope !== scope) {
        return reply.code(404).send({ error: 'revision not found' });
      }
      const note = `Restored from ${new Date(rev.revisionAt).toISOString()}`;
      const item = await contentRepo.put(ctx, kind, req.params.entityId, rev.data, { op: 'restore', note });
      return reply.send({ item });
    },
  );
}

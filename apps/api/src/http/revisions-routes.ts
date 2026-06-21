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

/** A path `:kind` that is a real, revisioned content kind — else the route 404s (no info leak). */
function revisionedKind(kind: string): ContentKind | null {
  return REVISIONED_KINDS.has(kind as ContentKind) ? (kind as ContentKind) : null;
}

export function registerRevisionRoutes(app: FastifyInstance, deps: RevisionsDeps): void {
  const { resolveProject, contentRepo, revisionsRepo, isWriter, db, rl } = deps;
  const base = '/projects/:projectId/content/:kind/:entityId/revisions';

  // List one entity's revision history (newest first) — metadata only, no snapshot blobs. Resolves each
  // author to an email + an `isYou` flag for display; agent writes show no email (actor: 'agent').
  app.get<{ Params: { projectId: string; kind: string; entityId: string } }>(
    base,
    { config: rl(120) },
    async (req, reply) => {
      const kind = revisionedKind(req.params.kind);
      if (!kind) return reply.code(404).send({ error: 'no revision history for this kind' });
      const { ctx } = await resolveProject(req, 'content:read');
      const revisions = await revisionsRepo.list(ctx, kind, req.params.entityId);

      // Resolve author emails ONLY for users who are CURRENT members of this project (inner-join on
      // project_members). A former member's email is not disclosed to the project's current readers,
      // even though their old `userId` lingers in history. `db` is taken directly for this one bounded
      // (deduped, ≤ maxPerEntity) lookup — there's no UserRepository batch method to route it through.
      const userIds = [...new Set(revisions.filter((r) => r.actor === 'user').map((r) => r.userId))];
      const emailById = new Map<string, string>();
      if (userIds.length > 0) {
        const rows = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .innerJoin(projectMembers, eq(projectMembers.userId, users.id))
          .where(and(inArray(users.id, userIds), eq(projectMembers.projectId, ctx.projectId)));
        for (const u of rows) emailById.set(u.id, u.email);
      }

      return reply.send({
        items: revisions.map((r) => ({
          id: r.id,
          op: r.op,
          actor: r.actor,
          note: r.note,
          revisionAt: r.revisionAt,
          author: {
            userId: r.userId,
            email: r.actor === 'agent' ? null : (emailById.get(r.userId) ?? null),
            isYou: r.actor === 'user' && r.userId === ctx.userId,
          },
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
  app.post<{ Params: { projectId: string; kind: string; entityId: string; revisionId: string } }>(
    `${base}/:revisionId/restore`,
    { config: rl(60) },
    async (req, reply) => {
      const kind = revisionedKind(req.params.kind);
      if (!kind) return reply.code(404).send({ error: 'no revision history for this kind' });
      const { ctx } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const rev = await revisionsRepo.get(ctx, req.params.revisionId);
      if (!rev || rev.kind !== kind || rev.entityId !== req.params.entityId) {
        return reply.code(404).send({ error: 'revision not found' });
      }
      const note = `Restored from ${new Date(rev.revisionAt).toISOString()}`;
      const item = await contentRepo.put(ctx, kind, req.params.entityId, rev.data, { op: 'restore', note });
      return reply.send({ item });
    },
  );
}

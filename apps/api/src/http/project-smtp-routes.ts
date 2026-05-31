import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SmtpInputSchema, SmtpStoredSchema, maskSmtp, type SmtpStored } from '@sitewright/schema';
import { encryptSecret } from '../crypto/secret.js';
import type { ContentRepository } from '../repo/content.js';
import { NotFoundError, type ProjectContext } from '../repo/context.js';
import { PROJECT_SMTP_ENTITY_ID, type ApiKeyCapability } from '../db/schema.js';

export { PROJECT_SMTP_ENTITY_ID };

type ProjectReq = FastifyRequest<{ Params: { orgId: string; projectId: string } }>;

export interface ProjectSmtpDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  contentRepo: ContentRepository;
  /** Always defined — these routes are registered only inside `if (opts.encryptionKey)` in app.ts. */
  encryptionKey: Buffer;
  isWriter: (ctx: ProjectContext) => boolean;
  /** Optional SSRF guard: throws if the SMTP host is not allowlisted (no-op when unset). */
  assertHostAllowed: (host: string) => void;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** Reads the project's stored SMTP config (or null) via the tenant-scoped repo. */
async function loadStored(contentRepo: ContentRepository, ctx: ProjectContext): Promise<SmtpStored | null> {
  const [row] = await contentRepo.list(ctx, 'project_smtp');
  if (!row) return null;
  // Validate on read (defense-in-depth) — mirrors the mailer's loadProjectSmtp.
  const parsed = SmtpStoredSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/**
 * Per-project SMTP config (for the `userSmtp` form mode). The password is encrypted
 * at rest and never returned — like saved deploy targets. Writer-only (owner/admin):
 * the host/user are infrastructure metadata, not just the secret.
 */
export function registerProjectSmtpRoutes(app: FastifyInstance, deps: ProjectSmtpDeps): void {
  const { resolveProject, contentRepo, encryptionKey, isWriter, assertHostAllowed, rl } = deps;

  app.get<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/smtp',
    { config: rl(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const stored = await loadStored(contentRepo, ctx);
      return reply.send({ smtp: stored ? maskSmtp(stored) : null });
    },
  );

  app.put<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/smtp',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const input = SmtpInputSchema.parse(req.body);
      assertHostAllowed(input.host); // SSRF guard (no-op unless an allowlist is configured)
      const existing = await loadStored(contentRepo, ctx);
      // Encrypt a new password; an omitted password retains the stored one.
      const password = input.password !== undefined ? encryptSecret(input.password, encryptionKey) : existing?.password;
      const stored = SmtpStoredSchema.parse({
        host: input.host,
        port: input.port,
        secure: input.secure,
        fromEmail: input.fromEmail,
        ...(input.user !== undefined ? { user: input.user } : {}),
        ...(input.fromName !== undefined ? { fromName: input.fromName } : {}),
        ...(password !== undefined ? { password } : {}),
      });
      const saved = (await contentRepo.put(ctx, 'project_smtp', PROJECT_SMTP_ENTITY_ID, stored)) as SmtpStored;
      return reply.send({ smtp: maskSmtp(saved) });
    },
  );

  app.delete<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/smtp',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      try {
        await contentRepo.remove(ctx, 'project_smtp', PROJECT_SMTP_ENTITY_ID); // enforces write role
      } catch (err) {
        // Idempotent: deleting an already-absent config is a no-op (the editor saves
        // a DELETE whenever SMTP is left unconfigured).
        if (!(err instanceof NotFoundError)) throw err;
      }
      return reply.code(204).send();
    },
  );
}

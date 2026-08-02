import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SmtpInputSchema, SmtpStoredSchema, maskSmtp, type SmtpStored } from '@sitewright/schema';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';
import { verifySmtpConnection, sendSmtpTestMessage, type TransportConfig } from '../mail/mailer.js';
import { z } from 'zod';
import type { ContentRepository } from '../repo/content.js';
import { NotFoundError, type ProjectContext } from '../repo/context.js';
import { PROJECT_SMTP_ENTITY_ID, type ApiKeyCapability } from '../db/schema.js';

export { PROJECT_SMTP_ENTITY_ID };

/** Body of a send-test request: an optional recipient, validated before it reaches the mailer.
 *  Exported so the instance-scoped route in app.ts shares it — two copies of a validation rule
 *  drift the moment one of them is tightened. */
export const SmtpSendTestBodySchema = z.object({ to: z.string().email().optional() });

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

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
  /** Decides who a test message may go to: agency staff may name an address, everyone else gets
   *  their own account email. Injected so that rule lives in ONE place (app.ts) for both scopes. */
  resolveSmtpTestRecipient: (req: ProjectReq, requested?: string) => Promise<string>;
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
  const { resolveProject, contentRepo, encryptionKey, isWriter, assertHostAllowed, resolveSmtpTestRecipient, rl } = deps;

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/smtp',
    { config: rl(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const stored = await loadStored(contentRepo, ctx);
      return reply.send({ smtp: stored ? maskSmtp(stored) : null });
    },
  );

  app.put<{ Params: { projectId: string } }>(
    '/projects/:projectId/smtp',
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

  // Opens a real session to the configured server and authenticates, sending nothing. Form delivery
  // is best-effort by design — the visitor is thanked either way — so without this an operator has
  // no way to discover that their SMTP is misconfigured except by noticing leads stopped arriving.
  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/smtp/test',
    { config: rl(10) }, // a real outbound connection per call: tighter than the read/write limits
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const stored = await loadStored(contentRepo, ctx);
      if (!stored) return reply.code(404).send({ error: 'no SMTP is configured for this project' });
      assertHostAllowed(stored.host); // the stored host could predate an allowlist being configured
      const config: TransportConfig = { host: stored.host, port: stored.port, secure: stored.secure };
      if (stored.user && stored.password) {
        try {
          config.auth = { user: stored.user, pass: decryptSecret(stored.password, encryptionKey) };
        } catch {
          return reply.send({ ok: false, error: 'The stored password could not be decrypted — re-enter it and save.' });
        }
      }
      return reply.send(await verifySmtpConnection(config));
    },
  );

  // Sends a REAL message through the project's SMTP. A green connection test proves the server
  // accepts our login; it cannot prove the mail arrives, which is what an author actually needs to
  // know before pointing a client's contact form at it.
  app.post<{ Params: { projectId: string }; Body: { to?: string } }>(
    '/projects/:projectId/smtp/send-test',
    { config: rl(5) }, // sends real mail: tighter than the connection test
    async (req, reply) => {
      // SESSION-ONLY, declared rather than accidental: the recipient rule is "the CALLER's own
      // account email", which only means something for an interactive human. Left as
      // `content:write` the route resolved the project happily and then 401'd deep inside recipient
      // resolution, so a valid, fully-privileged API key got "authentication required" — a message
      // that reads like an expired token rather than a deliberate policy.
      const { ctx } = await resolveProject(req, 'session-only');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const parsed = SmtpSendTestBodySchema.parse(req.body ?? {});
      // Throws for a project member naming someone else's address — the rule is enforced server-side.
      const recipient = await resolveSmtpTestRecipient(req, parsed.to);
      const stored = await loadStored(contentRepo, ctx);
      if (!stored) return reply.code(404).send({ error: 'no SMTP is configured for this project' });
      assertHostAllowed(stored.host);
      const config: TransportConfig = { host: stored.host, port: stored.port, secure: stored.secure };
      if (stored.user && stored.password) {
        try {
          config.auth = { user: stored.user, pass: decryptSecret(stored.password, encryptionKey) };
        } catch {
          return reply.send({ ok: false, error: 'The stored password could not be decrypted — re-enter it and save.' });
        }
      }
      const result = await sendSmtpTestMessage(config, {
        to: recipient,
        fromEmail: stored.fromEmail,
        ...(stored.fromName ? { fromName: stored.fromName } : {}),
        origin: 'a project’s mail settings',
      });
      return reply.send({ ...result, to: recipient });
    },
  );

  app.delete<{ Params: { projectId: string } }>(
    '/projects/:projectId/smtp',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:delete');
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

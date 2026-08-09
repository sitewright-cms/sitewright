import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CaptchaInputSchema, CaptchaStoredSchema, maskCaptcha, type CaptchaStored } from '@sitewright/schema';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';
import type { CaptchaVerifier } from '../mail/captcha.js';
import type { ContentRepository } from '../repo/content.js';
import { NotFoundError, type ProjectContext } from '../repo/context.js';
import { and, eq } from 'drizzle-orm';
import { content, PROJECT_CAPTCHA_ENTITY_ID, type ApiKeyCapability } from '../db/schema.js';
import type { Database } from '../db/client.js';

export { PROJECT_CAPTCHA_ENTITY_ID };

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface ProjectCaptchaDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  contentRepo: ContentRepository;
  /** Always defined — registered only inside `if (opts.encryptionKey)` in app.ts. */
  encryptionKey: Buffer;
  isWriter: (ctx: ProjectContext) => boolean;
  captcha: CaptchaVerifier;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** Reads the project's stored captcha config (or null) via the tenant-scoped repo. */
export async function loadProjectCaptcha(contentRepo: ContentRepository, ctx: ProjectContext): Promise<CaptchaStored | null> {
  const [row] = await contentRepo.list(ctx, 'project_captcha');
  if (!row) return null;
  // Validate on read (defense-in-depth), and never throw: a project with an unreadable captcha row
  // must still be able to publish and receive mail — it simply has no captcha.
  const parsed = CaptchaStoredSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/**
 * Per-project captcha configuration — the provider and its credentials, replacing the instance-wide
 * hCaptcha settings. The secret is encrypted at rest and never returned; the SITE key is public by
 * nature (it ships in the published markup) and is returned as-is.
 *
 * Writer-only (owner/admin): the provider choice is site infrastructure, not just a secret.
 */
export function registerProjectCaptchaRoutes(app: FastifyInstance, deps: ProjectCaptchaDeps): void {
  const { resolveProject, contentRepo, encryptionKey, isWriter, captcha, rl } = deps;

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/captcha', { config: rl(60) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const stored = await loadProjectCaptcha(contentRepo, ctx);
    return reply.send({ captcha: stored ? maskCaptcha(stored) : null });
  });

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/captcha', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:write');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const input = CaptchaInputSchema.parse(req.body);
    const existing = await loadProjectCaptcha(contentRepo, ctx);
    // Encrypt a new secret; an omitted secret retains the stored one — but only when the PROVIDER is
    // unchanged. Keys are not portable between vendors (or between reCAPTCHA v2 and v3), so silently
    // keeping the old secret across a provider switch would produce a config that looks complete and
    // rejects every visitor.
    const keepSecret = existing !== null && existing.provider === input.provider;
    const secret = input.secret !== undefined ? encryptSecret(input.secret, encryptionKey) : keepSecret ? existing.secret : undefined;
    const stored = CaptchaStoredSchema.parse({
      provider: input.provider,
      siteKey: input.siteKey,
      ...(secret !== undefined ? { secret } : {}),
      ...(input.minScore !== undefined ? { minScore: input.minScore } : {}),
    });
    const saved = (await contentRepo.put(ctx, 'project_captcha', PROJECT_CAPTCHA_ENTITY_ID, stored)) as CaptchaStored;
    return reply.send({ captcha: maskCaptcha(saved) });
  });

  /**
   * Asks the provider whether the stored SECRET is one it issued. A site key that is merely
   * well-shaped still fails at the visitor if the secret does not match it — which is precisely the
   * failure that reached production before, discovered by a stranger rather than by the author.
   */
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/captcha/test', { config: rl(10) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:write');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const stored = await loadProjectCaptcha(contentRepo, ctx);
    if (!stored) return reply.code(404).send({ error: 'no captcha is configured for this project' });
    if (!stored.secret) return reply.send({ ok: false, error: 'No secret key is stored — forms requiring a captcha will be rejected.' });
    let secret: string;
    try {
      secret = decryptSecret(stored.secret, encryptionKey);
    } catch {
      return reply.send({ ok: false, error: 'The stored secret could not be decrypted — re-enter it and save.' });
    }
    return reply.send(await captcha.testCredentials(stored.provider, secret));
  });

  app.delete<{ Params: { projectId: string } }>('/projects/:projectId/captcha', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:delete');
    try {
      await contentRepo.remove(ctx, 'project_captcha', PROJECT_CAPTCHA_ENTITY_ID); // enforces write role
    } catch (err) {
      // Idempotent: deleting an already-absent config is a no-op (the editor saves a DELETE whenever
      // the captcha section is left unconfigured).
      if (!(err instanceof NotFoundError)) throw err;
    }
    return reply.code(204).send();
  });
}

/**
 * Reads a project's stored captcha config server-side, with NO tenant context — the submission
 * endpoint and the publish path are not acting for a logged-in user. Mirrors `loadProjectSmtp`.
 */
export async function loadProjectCaptchaById(db: Database, projectId: string): Promise<CaptchaStored | null> {
  const [row] = await db
    .select()
    .from(content)
    .where(and(eq(content.projectId, projectId), eq(content.kind, 'project_captcha'), eq(content.entityId, PROJECT_CAPTCHA_ENTITY_ID)));
  if (!row) return null;
  const parsed = CaptchaStoredSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

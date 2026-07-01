import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AiConfigInputSchema, AiConfigSchema, maskAiConfig, AI_CONFIG_ID, type AiConfig } from '@sitewright/schema';
import { encryptSecret } from '../crypto/secret.js';
import type { ContentRepository } from '../repo/content.js';
import { NotFoundError, type ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface AiConfigDeps {
  resolveProject: (req: ProjectReq, access: ApiKeyCapability | 'session-only') => Promise<{ ctx: ProjectContext }>;
  contentRepo: ContentRepository;
  /** Always defined — these routes are registered only inside `if (opts.encryptionKey)` in app.ts. */
  encryptionKey: Buffer;
  isWriter: (ctx: ProjectContext) => boolean;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** Reads the project's stored AI config (or null) via the tenant-scoped repo. */
async function loadStored(contentRepo: ContentRepository, ctx: ProjectContext): Promise<AiConfig | null> {
  const [row] = await contentRepo.list(ctx, 'ai_config');
  if (!row) return null;
  const parsed = AiConfigSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/**
 * Per-project "bring your own agent" AI config. The API key is encrypted at rest (a dedicated content
 * kind, never returned by generic reads) and collapses to a `hasKey` flag on read. Writer-only
 * (owner/member): the provider/model are project config, not just the secret. When enabled + keyed, it
 * OVERRIDES the platform-wide instance config for this project (see resolveAiProvider).
 */
export function registerAiConfigRoutes(app: FastifyInstance, deps: AiConfigDeps): void {
  const { resolveProject, contentRepo, encryptionKey, isWriter, rl } = deps;

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/ai-config', { config: rl(60) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const stored = await loadStored(contentRepo, ctx);
    return reply.send({ aiConfig: stored ? maskAiConfig(stored) : null });
  });

  app.put<{ Params: { projectId: string } }>('/projects/:projectId/ai-config', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:write');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const input = AiConfigInputSchema.parse(req.body);
    const existing = await loadStored(contentRepo, ctx);
    // Encrypt a new key; an omitted key retains the stored one (secret-preserve idiom).
    const secret = input.apiKey !== undefined ? encryptSecret(input.apiKey, encryptionKey) : existing?.secret;
    const stored = AiConfigSchema.parse({
      id: AI_CONFIG_ID,
      enabled: input.enabled,
      provider: input.provider,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.monthlyTokenLimit !== undefined ? { monthlyTokenLimit: input.monthlyTokenLimit } : {}),
      ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
      ...(secret !== undefined ? { secret } : {}),
    });
    const saved = (await contentRepo.put(ctx, 'ai_config', AI_CONFIG_ID, stored)) as AiConfig;
    return reply.send({ aiConfig: maskAiConfig(saved) });
  });

  app.delete<{ Params: { projectId: string } }>('/projects/:projectId/ai-config', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:delete');
    try {
      await contentRepo.remove(ctx, 'ai_config', AI_CONFIG_ID);
    } catch (err) {
      // Idempotent: deleting an already-absent config is a no-op.
      if (!(err instanceof NotFoundError)) throw err;
    }
    return reply.code(204).send();
  });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AiConfigInputSchema, AiConfigSchema, AiProviderKindSchema, AiBaseUrlSchema, maskAiConfig, AI_CONFIG_ID, type AiConfig } from '@sitewright/schema';
import { z } from 'zod';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';
import { testAiProvider } from '../ai/connectivity.js';
import type { ContentRepository } from '../repo/content.js';
import { NotFoundError, type ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

/** Body for a connectivity check — the current form values; a blank key falls back to the stored one. */
export const AiTestBodySchema = z.object({
  provider: AiProviderKindSchema,
  model: z.string().min(1).max(120).optional(),
  baseUrl: AiBaseUrlSchema.optional(),
  apiKey: z.string().min(1).max(1024).optional(),
});

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface AiConfigDeps {
  resolveProject: (req: ProjectReq, access: ApiKeyCapability | 'session-only') => Promise<{ ctx: ProjectContext }>;
  contentRepo: ContentRepository;
  /** Always defined — these routes are registered only inside `if (opts.encryptionKey)` in app.ts. */
  encryptionKey: Buffer;
  isWriter: (ctx: ProjectContext) => boolean;
  /** Agency staff: an admin or a developer. Only they switch the project onto the platform's assistant. */
  isStaff: (userId: string) => Promise<boolean>;
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
  const { resolveProject, contentRepo, encryptionKey, isWriter, isStaff, rl } = deps;

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/ai-config', { config: rl(60) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:read');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const stored = await loadStored(contentRepo, ctx);
    // Whether THIS caller may flip "Use Built-In Agent" (staff, in a session) — so the editor shows the switch
    // live or locked without knowing the rule itself.
    const canSetBuiltIn = ctx.actor !== 'agent' && (await isStaff(ctx.userId));
    return reply.send({ aiConfig: stored ? maskAiConfig(stored) : null, canSetBuiltIn });
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
      // Staff-only, and set through its own route: a save of the project's own agent carries it over.
      ...(existing?.useBuiltIn ? { useBuiltIn: true } : {}),
    });
    const saved = (await contentRepo.put(ctx, 'ai_config', AI_CONFIG_ID, stored)) as AiConfig;
    return reply.send({ aiConfig: maskAiConfig(saved) });
  });

  // Verify connectivity + model for this project's BYO provider. Tests the just-typed key if present,
  // else the stored one. Writer-only; heavily rate-limited (it makes an outbound provider call).
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/ai-config/test', { config: rl(10) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'session-only');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const input = AiTestBodySchema.parse(req.body);
    const existing = await loadStored(contentRepo, ctx);
    const apiKey = input.apiKey ?? (existing?.secret ? decryptSecret(existing.secret, encryptionKey) : undefined);
    if (!apiKey) return reply.send({ ok: false, model: input.model ?? '', error: 'Enter an API key to test.' });
    return reply.send(await testAiProvider({ provider: input.provider, apiKey, model: input.model, baseUrl: input.baseUrl }));
  });

  app.delete<{ Params: { projectId: string } }>('/projects/:projectId/ai-config', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:delete');
    // Removing the project's OWN agent must not take away the platform agent staff switched on for it.
    const existing = await loadStored(contentRepo, ctx);
    if (existing?.useBuiltIn) {
      await contentRepo.put(ctx, 'ai_config', AI_CONFIG_ID, AiConfigSchema.parse({ id: AI_CONFIG_ID, useBuiltIn: true }));
      return reply.code(204).send();
    }
    try {
      await contentRepo.remove(ctx, 'ai_config', AI_CONFIG_ID);
    } catch (err) {
      // Idempotent: deleting an already-absent config is a no-op.
      if (!(err instanceof NotFoundError)) throw err;
    }
    return reply.code(204).send();
  });

  // "Use Built-In Agent" — agency staff only, in an interactive session: it puts the operator's key to work on
  // this project for everyone on it, which is the agency's decision to make, never a client's or a token's.
  app.put<{ Params: { projectId: string } }>('/projects/:projectId/ai-config/built-in', { config: rl(30) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'session-only');
    if (!(await isStaff(ctx.userId))) {
      return reply.code(403).send({ error: 'only agency staff (an admin or a developer) can switch the built-in agent on or off' });
    }
    const body = req.body as { useBuiltIn?: unknown } | undefined;
    if (typeof body?.useBuiltIn !== 'boolean') return reply.code(400).send({ error: 'useBuiltIn is true or false' });
    const base = (await loadStored(contentRepo, ctx)) ?? AiConfigSchema.parse({ id: AI_CONFIG_ID });
    // Off is stored as absent, like every other optional field.
    const stored = AiConfigSchema.parse({ ...base, useBuiltIn: body.useBuiltIn ? true : undefined });
    const saved = (await contentRepo.put(ctx, 'ai_config', AI_CONFIG_ID, stored)) as AiConfig;
    return reply.send({ aiConfig: maskAiConfig(saved) });
  });
}

import { z } from 'zod';
import { EncryptedSecretSchema } from './deploy-target.js';
import { targetsPrivateHost } from './primitives.js';

/**
 * The provider kind for the AI assistant:
 *  - `anthropic` — native Anthropic Messages API.
 *  - `openrouter` — OpenRouter (fixed `https://openrouter.ai/api/v1`); a first-class shortcut for the
 *    OpenAI-compatible adapter that also enables OpenRouter's attribution headers + prompt caching.
 *  - `openai` — ANY other OpenAI-compatible `/chat/completions` endpoint via a custom baseUrl
 *    (OpenAI, Groq, Together, Mistral, Gemini-compat, a local server, …).
 */
export const AiProviderKindSchema = z.enum(['anthropic', 'openai', 'openrouter']);
export type AiProviderKind = z.infer<typeof AiProviderKindSchema>;

/** OpenRouter's fixed OpenAI-compatible endpoint (used when `provider === 'openrouter'`). */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * An OpenAI-compatible base URL, guarded against private/loopback hosts (SSRF): the server POSTs the
 * conversation payload here and streams back any error detail, so a UI/DB-configured endpoint must be
 * PUBLIC. A local/internal LLM endpoint is reachable only via the operator-trusted `SW_AI_BASE_URL`
 * env (set at deploy), never via a project writer's or admin's stored config.
 */
export const AiBaseUrlSchema = z
  .string()
  .url()
  .max(512)
  .refine((u) => !targetsPrivateHost(u), 'baseUrl must be a public host (use SW_AI_BASE_URL env for a local/internal endpoint)');

/**
 * Per-turn output-token ceiling for the on-page agent. Bounded so a single model turn can hold a
 * full page's worth of HTML (a `put_page` call) without truncating mid-tool-call, yet stays within
 * real model limits. Absent → the server's built-in default. Raise toward the configured model's
 * actual max output tokens.
 */
export const MaxOutputTokensSchema = z.number().int().min(1024).max(32000);

/**
 * Reject a `baseUrl` when the provider is `openrouter` (its endpoint is fixed to {@link
 * OPENROUTER_BASE_URL}, so a stored baseUrl would be silently ignored). Shared by both the per-project
 * and instance AI input schemas so the write boundary rejects the no-op combination with a clear
 * message instead of persisting dead config. Applied to INPUT schemas only — stored/read schemas stay
 * lenient so an older row never fails to parse.
 */
export function rejectOpenrouterBaseUrl(
  v: { provider?: string; baseUrl?: string },
  ctx: z.RefinementCtx,
): void {
  if (v.provider === 'openrouter' && v.baseUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseUrl'],
      message: 'baseUrl is ignored for the OpenRouter provider (its endpoint is fixed) — remove it, or choose the OpenAI-compatible provider.',
    });
  }
}

/** The fixed entity id of a project's AI-config singleton (content kind `ai_config`). */
export const AI_CONFIG_ID = 'ai-config';

/**
 * A project's OWN AI assistant configuration — "bring your own agent". Stored form: the API key is an
 * encrypted-at-rest envelope (or absent). It is a dedicated content kind (a singleton per project),
 * managed via dedicated routes so the encrypted secret is never returned by generic content reads.
 * When enabled + keyed, it OVERRIDES the platform-wide instance config for that project.
 */
export const AiConfigSchema = z.object({
  id: z.literal(AI_CONFIG_ID).default(AI_CONFIG_ID),
  enabled: z.boolean().default(false),
  provider: AiProviderKindSchema.default('anthropic'),
  model: z.string().min(1).max(120).optional(),
  /** OpenAI-compatible base URL (only meaningful when provider = 'openai'). */
  baseUrl: AiBaseUrlSchema.optional(),
  secret: EncryptedSecretSchema.optional(),
  /** Per-project monthly token cap override (0/absent → fall back to the instance default). */
  monthlyTokenLimit: z.number().int().min(0).optional(),
  /** Per-turn output-token ceiling override (absent → instance/default). */
  maxOutputTokens: MaxOutputTokensSchema.optional(),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

/**
 * The PUT body: a plaintext `apiKey` (OPTIONAL — omit to keep the stored one), the rest as on the
 * stored shape. Mirrors the deploy-target / SMTP secret-preserve idiom.
 */
export const AiConfigInputSchema = z
  .object({
    enabled: z.boolean().default(false),
    provider: AiProviderKindSchema.default('anthropic'),
    model: z.string().min(1).max(120).optional(),
    baseUrl: AiBaseUrlSchema.optional(),
    apiKey: z.string().min(1).max(1024).optional(),
    monthlyTokenLimit: z.number().int().min(0).optional(),
    maxOutputTokens: MaxOutputTokensSchema.optional(),
  })
  .superRefine(rejectOpenrouterBaseUrl);
export type AiConfigInput = z.infer<typeof AiConfigInputSchema>;

/** The masked read view — the key collapses to a presence flag; the secret is never returned. */
export type AiConfigView = Omit<AiConfig, 'secret'> & { hasKey: boolean };

/** Masks a stored per-project AI config to its public view. */
export function maskAiConfig(config: AiConfig): AiConfigView {
  const { secret, ...rest } = config;
  return { ...rest, hasKey: secret !== undefined };
}

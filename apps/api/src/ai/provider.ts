/** Token usage reported by a provider for one completion. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCompleteRequest {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
}

export interface AiCompletion {
  text: string;
  model: string;
  usage: AiUsage;
}

/**
 * Pluggable AI completion provider (the seam that decouples the app from any
 * vendor). The online editing path calls this; it's metered + quota-gated by the
 * caller. Default impl is {@link AnthropicProvider}; tests inject a fake.
 */
export interface AiProvider {
  complete(req: AiCompleteRequest): Promise<AiCompletion>;
}

/**
 * Raised when an upstream provider returns a non-success status. Carries the
 * upstream status so the HTTP layer can distinguish a transient upstream issue
 * (429/5xx → 502/503, retryable) from a real server fault (opaque 500).
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

type FetchLike = typeof fetch;

// Haiku by default — cheap/fast for the bulk in-editor ops (model tiering); the
// caller may request a larger model per operation.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Anthropic Messages API provider over `fetch` (no SDK dependency — keeps the
 * single-container image lean and the audit surface small). `fetchImpl` is
 * injectable so the request shape + response parsing are unit-testable offline.
 */
export class AnthropicProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = DEFAULT_MODEL,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly url: string = ANTHROPIC_URL,
  ) {}

  async complete(req: AiCompleteRequest): Promise<AiCompletion> {
    const model = req.model ?? this.defaultModel;
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 1024,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.prompt }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AiProviderError(`AI provider error ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }
    const data = (await res.json()) as {
      content?: ReadonlyArray<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    return {
      text,
      model,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }
}

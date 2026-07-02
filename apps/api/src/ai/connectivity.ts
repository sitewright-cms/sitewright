import { buildAgentProvider, type AiProviderSpec } from './build-provider.js';

/** The outcome of a credential/connectivity check for an AI provider. */
export interface AiTestResult {
  ok: boolean;
  /** The model the check ran against (echoed back so the UI can confirm the selection). */
  model: string;
  /** Present on failure — the provider's error (auth, unknown model, unreachable endpoint, …). */
  error?: string;
}

/** How long a connectivity probe may run before it's aborted. */
const TEST_TIMEOUT_MS = 12_000;

/**
 * Verify an AI provider spec by running the SMALLEST possible real turn against it: one short user
 * message, no tools, a 1-token cap. If the stream yields without throwing, the key authenticated and
 * the model is valid (both adapters throw {@link AiProviderError} on a non-2xx response, e.g. a 401
 * auth error or a 404 unknown model). Bounded by a timeout so a hung endpoint can't wedge the request.
 *
 * `fetchImpl` is injectable so the request shape is unit-testable offline (mirrors the adapters).
 */
export async function testAiProvider(spec: AiProviderSpec, fetchImpl?: typeof fetch): Promise<AiTestResult> {
  const provider = buildAgentProvider(spec, fetchImpl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    for await (const ev of provider.runTurn({
      system: 'Connectivity check.',
      messages: [{ role: 'user', content: 'ping' }],
      tools: [],
      maxTokens: 1,
      signal: controller.signal,
    })) {
      // Consume the stream — a fatal auth/model/endpoint error throws before or at the first chunk.
      void ev;
    }
    return { ok: true, model: provider.model };
  } catch (err) {
    const message =
      controller.signal.aborted && !(err instanceof Error && /provider error/i.test(err.message))
        ? 'the provider did not respond in time'
        : err instanceof Error
          ? err.message
          : 'connection failed';
    return { ok: false, model: provider.model, error: message };
  } finally {
    clearTimeout(timer);
  }
}

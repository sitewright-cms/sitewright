import type { AgentProvider } from './agent-provider.js';
import { AnthropicAgentProvider } from './anthropic-agent.js';
import { OpenAiAgentProvider } from './openai-agent.js';

/** A resolved provider spec (decrypted key + model/endpoint) from env, instance, or per-project config. */
export interface AiProviderSpec {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Build the streaming, tool-using agent provider for a spec — the single place that maps a
 * `{provider, key, model, baseUrl}` to the right adapter. Anthropic Messages by default; any
 * OpenAI-compatible endpoint when `provider === 'openai'`.
 */
export function buildAgentProvider(spec: AiProviderSpec, fetchImpl?: typeof fetch): AgentProvider {
  return spec.provider === 'openai'
    ? new OpenAiAgentProvider(spec.apiKey, spec.model, spec.baseUrl, fetchImpl)
    : new AnthropicAgentProvider(spec.apiKey, spec.model, fetchImpl);
}

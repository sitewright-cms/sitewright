import { OPENROUTER_BASE_URL, type AiProviderKind } from '@sitewright/schema';
import type { AgentProvider } from './agent-provider.js';
import { AnthropicAgentProvider } from './anthropic-agent.js';
import { OpenAiAgentProvider } from './openai-agent.js';

/** A resolved provider spec (decrypted key + model/endpoint) from env, instance, or per-project config. */
export interface AiProviderSpec {
  provider: AiProviderKind;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Build the streaming, tool-using agent provider for a spec — the single place that maps a
 * `{provider, key, model, baseUrl}` to the right adapter. `anthropic` → native Anthropic Messages;
 * `openrouter` → the OpenAI adapter pinned to OpenRouter's endpoint (its attribution headers + prompt
 * caching light up automatically); `openai` → the OpenAI adapter against `spec.baseUrl`.
 */
export function buildAgentProvider(spec: AiProviderSpec, fetchImpl?: typeof fetch): AgentProvider {
  if (spec.provider === 'anthropic') return new AnthropicAgentProvider(spec.apiKey, spec.model, fetchImpl);
  const baseUrl = spec.provider === 'openrouter' ? OPENROUTER_BASE_URL : spec.baseUrl;
  return new OpenAiAgentProvider(spec.apiKey, spec.model, baseUrl, fetchImpl);
}

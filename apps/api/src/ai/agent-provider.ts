import type { AiUsage } from './provider.js';

/** A JSON Schema object (the tool input contract, as emitted by the MCP registry). */
export type JsonSchema = Record<string, unknown>;

/** One tool the agent may call, named + described + JSON-Schema-typed. */
export interface AgentToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface TextPart {
  type: 'text';
  text: string;
}
export interface ToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
/** The assistant turn is an ordered mix of prose and tool invocations. */
export type AssistantPart = TextPart | ToolUsePart;

export interface ToolResultTextPart {
  type: 'text';
  text: string;
}
export interface ToolResultImagePart {
  type: 'image';
  data: string; // base64
  mimeType: string;
}
export type ToolResultPart = ToolResultTextPart | ToolResultImagePart;

/**
 * Provider-neutral conversation model. This is the seam that hides the biggest
 * Anthropic↔OpenAI divergence (single-array tool_use/tool_result blocks vs a
 * separate `tool` role). The loop only ever builds/reads these; each adapter
 * translates on the way out.
 */
export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; parts: AssistantPart[] }
  | { role: 'tool'; toolCallId: string; name: string; content: ToolResultPart[]; isError?: boolean };

export type AgentStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other';

/** Streamed, provider-neutral events for one model turn. */
export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'stop'; reason: AgentStopReason };

export interface AgentTurnRequest {
  system: string;
  messages: AgentMessage[];
  tools: AgentToolDef[];
  /** Operator-pinned; never client-supplied. Falls back to the provider default. */
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Pluggable, streaming, tool-using AI provider (the universal seam). Two built-in
 * adapters implement it — {@link AnthropicAgentProvider} and {@link OpenAiAgentProvider}.
 * Metered + quota-gated by the caller; `fetchImpl` is injectable so both the request
 * shape and the streaming parse are unit-testable offline.
 */
export interface AgentProvider {
  readonly model: string;
  runTurn(req: AgentTurnRequest): AsyncIterable<AgentStreamEvent>;
}

import { AiProviderError, type AiUsage } from './provider.js';
import type {
  AgentMessage,
  AgentProvider,
  AgentStopReason,
  AgentStreamEvent,
  AgentToolDef,
  AgentTurnRequest,
} from './agent-provider.js';
import { parseSseStream } from './sse-parse.js';

type FetchLike = typeof fetch;

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Anthropic Messages API adapter (streaming tool-use) for the on-page agent. Raw
 * `fetch`, no SDK — matches {@link AnthropicProvider}. Translates the neutral
 * {@link AgentMessage} model to Anthropic content blocks and normalizes the
 * streamed events back to {@link AgentStreamEvent}s.
 */
export class AnthropicAgentProvider implements AgentProvider {
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string = DEFAULT_MODEL,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly url: string = ANTHROPIC_URL,
  ) {
    this.model = model;
  }

  async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentStreamEvent> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model ?? this.model,
        max_tokens: req.maxTokens ?? 8192,
        stream: true,
        // PROMPT CACHING: the system prompt + the (large, always-identical) tool schemas are resent on
        // EVERY turn of the loop (up to 25 per user message). Two ephemeral cache breakpoints — one on
        // the last tool, one on the system block — let Anthropic reuse that prefix (tool-defs cache
        // across ALL messages; system caches within a loop / for same-page follow-ups), cutting input
        // cost + latency. (Prompt caching is GA; no beta header needed. OpenAI-compat caches server-side.)
        system: cacheableSystem(req.system),
        tools: withToolCache(req.tools.map(toAnthropicTool)),
        messages: toAnthropicMessages(req.messages),
      }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new AiProviderError(`AI provider error ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }

    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    let stop: AgentStopReason = 'other';
    // Accumulate the JSON for each in-flight tool_use block, keyed by stream index.
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

    for await (const ev of parseSseStream(res.body, req.signal)) {
      if (!ev.data || ev.data === '[DONE]') continue;
      let msg: AnthropicStreamMessage;
      try {
        msg = JSON.parse(ev.data) as AnthropicStreamMessage;
      } catch {
        continue;
      }
      switch (msg.type) {
        case 'message_start':
          usage.inputTokens = msg.message?.usage?.input_tokens ?? 0;
          break;
        case 'content_block_start':
          if (msg.content_block?.type === 'tool_use' && msg.index != null) {
            toolBlocks.set(msg.index, { id: msg.content_block.id ?? '', name: msg.content_block.name ?? '', json: '' });
          }
          break;
        case 'content_block_delta':
          if (msg.delta?.type === 'text_delta' && msg.delta.text) {
            yield { type: 'text_delta', text: msg.delta.text };
          } else if (msg.delta?.type === 'input_json_delta' && msg.index != null) {
            const b = toolBlocks.get(msg.index);
            if (b) b.json += msg.delta.partial_json ?? '';
          }
          break;
        case 'content_block_stop': {
          if (msg.index == null) break;
          const b = toolBlocks.get(msg.index);
          if (b) {
            toolBlocks.delete(msg.index);
            yield { type: 'tool_call', id: b.id, name: b.name, input: safeJson(b.json) };
          }
          break;
        }
        case 'message_delta':
          if (msg.usage?.output_tokens != null) usage.outputTokens = msg.usage.output_tokens;
          if (msg.delta?.stop_reason) stop = mapStop(msg.delta.stop_reason);
          break;
        case 'message_stop':
          break;
        default:
          break;
      }
    }

    yield { type: 'usage', usage };
    yield { type: 'stop', reason: stop };
  }
}

function toAnthropicTool(def: AgentToolDef): Record<string, unknown> {
  return { name: def.name, description: def.description, input_schema: def.parameters };
}

/** The `ephemeral` cache breakpoint marker (5-minute TTL, GA prompt caching). */
const CACHE_CONTROL = { type: 'ephemeral' as const };

/**
 * System prompt as a cacheable content block. An ephemeral breakpoint here caches the whole prefix up
 * to and including the system prompt (tools + system) — reused across a loop's turns and for
 * follow-up messages on the same page. Empty system → omit (nothing to cache).
 */
function cacheableSystem(system: string): Array<Record<string, unknown>> | undefined {
  return system ? [{ type: 'text', text: system, cache_control: CACHE_CONTROL }] : undefined;
}

/**
 * Mark the LAST tool with a cache breakpoint so the entire (large, always-identical) tool-schema block
 * is cached and reused on every request — including across user messages, since the tool set never
 * changes within a conversation. Returns a NEW array (no mutation of the caller's tools).
 */
function withToolCache(tools: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (tools.length === 0) return tools;
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: CACHE_CONTROL } : t));
}

/** Neutral → Anthropic: merge consecutive tool results into one user message. */
function toAnthropicMessages(messages: AgentMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let pendingToolResults: Array<Record<string, unknown>> | null = null;
  const flush = (): void => {
    if (pendingToolResults) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = null;
    }
  };
  for (const m of messages) {
    if (m.role === 'tool') {
      const content = m.content.map((p) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } },
      );
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content, ...(m.isError ? { is_error: true } : {}) };
      (pendingToolResults ??= []).push(block);
      continue;
    }
    flush();
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else {
      out.push({
        role: 'assistant',
        content: m.parts.map((p) =>
          p.type === 'text' ? { type: 'text', text: p.text } : { type: 'tool_use', id: p.id, name: p.name, input: p.input },
        ),
      });
    }
  }
  flush();
  return out;
}

function mapStop(reason: string): AgentStopReason {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'end_turn';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'other';
}

function safeJson(json: string): unknown {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

interface AnthropicStreamMessage {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
}

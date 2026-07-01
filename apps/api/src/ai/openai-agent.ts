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

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * OpenAI-compatible `/chat/completions` adapter (streaming function-calling). Works
 * with any endpoint that speaks the OpenAI wire format — OpenAI, OpenRouter, Groq,
 * Together, Mistral, a local llama.cpp server, or Gemini's compat endpoint — via a
 * configurable `baseURL` + `model`. Raw `fetch`, no SDK.
 *
 * Divergence handled here vs Anthropic: a separate `tool` role (not tool_result
 * content blocks), tool-call fragments keyed by `.index`, usage only in the trailing
 * chunk (needs `stream_options.include_usage`; falls back to 0 when a server omits it),
 * and no image support in a `tool` message (screenshots are replaced with a text note).
 */
export class OpenAiAgentProvider implements AgentProvider {
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string = DEFAULT_MODEL,
    private readonly baseURL: string = 'https://api.openai.com/v1',
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.model = model;
  }

  async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentStreamEvent> {
    const url = `${this.baseURL.replace(/\/$/, '')}/chat/completions`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model ?? this.model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: req.maxTokens ?? 8192,
        tools: req.tools.map(toOpenAiTool),
        messages: toOpenAiMessages(req.system, req.messages),
      }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new AiProviderError(`AI provider error ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }

    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    let stop: AgentStopReason = 'other';
    // Tool-call fragments keyed by `.index` (streamed piecemeal across chunks).
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const ev of parseSseStream(res.body, req.signal)) {
      if (!ev.data || ev.data === '[DONE]') continue;
      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(ev.data) as OpenAiChunk;
      } catch {
        continue;
      }
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
        usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) yield { type: 'text_delta', text: choice.delta.content };
      for (const tc of choice.delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = toolCalls.get(idx) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolCalls.set(idx, cur);
      }
      if (choice.finish_reason) {
        if (choice.finish_reason === 'tool_calls') {
          for (const c of [...toolCalls.values()]) {
            yield { type: 'tool_call', id: c.id || `call_${c.name}`, name: c.name, input: safeJson(c.args) };
          }
          stop = 'tool_use';
        } else if (choice.finish_reason === 'length') {
          stop = 'max_tokens';
        } else {
          stop = 'end_turn';
        }
      }
    }

    yield { type: 'usage', usage };
    yield { type: 'stop', reason: stop };
  }
}

function toOpenAiTool(def: AgentToolDef): Record<string, unknown> {
  return { type: 'function', function: { name: def.name, description: def.description, parameters: def.parameters } };
}

/** Neutral → OpenAI chat messages (system first; tool results as `tool` role). */
function toOpenAiMessages(system: string, messages: AgentMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.attachments?.length) {
        const images = m.attachments.filter((a) => a.kind === 'image');
        const docs = m.attachments.filter((a) => a.kind === 'document');
        // The OpenAI chat message accepts images via `image_url` (data URL). A PDF `document` can't
        // ride this path, so note it as text rather than dropping it silently.
        const text = docs.length ? `${m.content}\n[${docs.length} document attachment(s) not supported by this provider]` : m.content;
        const parts: Array<Record<string, unknown>> = [{ type: 'text', text }];
        for (const a of images) parts.push({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${a.data}` } });
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant') {
      const text = m.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join('');
      const toolCalls = m.parts
        .filter((p): p is { type: 'tool_use'; id: string; name: string; input: unknown } => p.type === 'tool_use')
        .map((p) => ({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) } }));
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // tool: flatten to text; note (not embed) any images the OpenAI tool role can't carry.
      const content = m.content
        .map((p) => (p.type === 'text' ? p.text : `[image omitted — ${p.mimeType}]`))
        .join('\n');
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content });
    }
  }
  return out;
}

function safeJson(json: string): unknown {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

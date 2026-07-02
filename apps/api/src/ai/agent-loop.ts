import type { AgentMessage, AgentProvider, AgentStopReason, AgentToolDef, AssistantPart, ToolResultPart } from './agent-provider.js';
import type { AiUsage } from './provider.js';
import type { McpToolBridge } from './tool-bridge.js';

/** Provider-neutral events emitted while one user message is being handled. */
export type LoopEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'done'; message: string }
  | { type: 'error'; code: LoopErrorCode; message: string };

export type LoopErrorCode = 'provider' | 'quota' | 'tool' | 'max_iterations' | 'max_tokens' | 'aborted';

export interface LoopOptions {
  provider: AgentProvider;
  bridge: McpToolBridge;
  system: string;
  tools: AgentToolDef[];
  /** Full transcript including the new user message. */
  messages: AgentMessage[];
  maxIterations?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Per-turn metering hook: record usage; THROW to stop the loop (quota exceeded). */
  onUsage?: (usage: AiUsage) => Promise<void> | void;
}

export interface LoopResult {
  state: 'done' | 'error';
  /** The updated transcript, to seed the next turn of the conversation. */
  messages: AgentMessage[];
}

/**
 * The agentic tool-use loop. Streams the model's turn; if it emitted tool calls, runs
 * them through the MCP bridge and loops with the results appended; if it stopped with
 * ZERO tool calls, that hands control back to the user (`done`) — a question and a
 * completion look identical here by design, so both close the turn and the next user
 * message resumes the conversation. Metering runs per-turn so a breach halts before the
 * next turn (≤ one turn of overshoot). Bounded by `maxIterations` and `signal`.
 */
export async function* runAgentLoop(opts: LoopOptions): AsyncGenerator<LoopEvent, LoopResult> {
  const messages = [...opts.messages];
  const maxIterations = opts.maxIterations ?? 25;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (opts.signal?.aborted) return { state: 'error', messages };
    // Consistent rollback point: if we abort partway through this turn's tool calls, we return the
    // transcript from BEFORE the turn — never an assistant `tool_use` turn with only some `tool_result`s
    // filled in (Anthropic rejects an unmatched tool_use on the next request).
    const historyBeforeTurn = messages.slice();

    let text = '';
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: AgentStopReason = 'other';

    try {
      for await (const ev of opts.provider.runTurn({
        system: opts.system,
        messages,
        tools: opts.tools,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
      })) {
        if (ev.type === 'text_delta') {
          text += ev.text;
          yield { type: 'text', delta: ev.text };
        } else if (ev.type === 'tool_call') {
          toolCalls.push({ id: ev.id, name: ev.name, input: ev.input });
        } else if (ev.type === 'usage') {
          usage = ev.usage;
        } else if (ev.type === 'stop') {
          stopReason = ev.reason;
        }
      }
    } catch (err) {
      yield { type: 'error', code: 'provider', message: errMsg(err) };
      return { state: 'error', messages };
    }

    // Record the assistant turn (text then tool_use) so the next request has full context.
    const parts: AssistantPart[] = [];
    if (text) parts.push({ type: 'text', text });
    for (const c of toolCalls) parts.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
    if (parts.length) messages.push({ role: 'assistant', parts });

    // Meter per turn — record, and stop if the hook signals the cap was hit.
    try {
      await opts.onUsage?.(usage);
    } catch (err) {
      yield { type: 'error', code: 'quota', message: errMsg(err) };
      return { state: 'error', messages };
    }
    yield { type: 'usage', usage };

    if (toolCalls.length === 0) {
      // The model produced NO (completed) tool call this turn. Two very different reasons look
      // identical at the API surface, so disambiguate on the stop reason:
      //   • max_tokens → the turn was CUT OFF at the model's output limit — very likely mid tool
      //     call while streaming a large edit (e.g. a whole page's HTML), so the call never
      //     completed and was dropped. Silently reporting "done" here is what made large edits
      //     appear to do nothing ("Waiting for you"). Surface it as an actionable error instead.
      //   • otherwise → a genuine completion or a question back to the user; hand control back.
      if (stopReason === 'max_tokens') {
        yield {
          type: 'error',
          code: 'max_tokens',
          message:
            'The response hit the model’s output-token limit before it could finish the edit. ' +
            'Ask for a smaller change (e.g. one section at a time), or raise the assistant’s output-token limit in settings.',
        };
        return { state: 'error', messages };
      }
      yield { type: 'done', message: text };
      return { state: 'done', messages };
    }

    for (const call of toolCalls) {
      if (opts.signal?.aborted) return { state: 'error', messages: historyBeforeTurn };
      yield { type: 'tool', id: call.id, name: call.name, input: call.input };
      try {
        const result = await opts.bridge.callTool(call.name, call.input);
        // Before recording a FRESH screenshot result, drop images from all EARLIER tool results — a
        // stale render (preview_page / compare_to_source) never needs resending once the model has seen
        // it + acted, yet the whole transcript is resent every turn. Keeps only the LATEST render's
        // images, so a design-iteration loop doesn't accumulate megabytes of screenshots. Fidelity is
        // preserved: the newest comparison always survives + the agent re-renders when it wants to look.
        if (result.content.some((p) => p.type === 'image')) dropStaleScreenshots(messages);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result.content, isError: result.isError });
        yield { type: 'tool_result', id: call.id, name: call.name, ok: !result.isError, summary: summarize(result.content) };
      } catch (err) {
        // Feed the failure back to the model as an error result so it can recover next turn.
        const message = errMsg(err);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: [{ type: 'text', text: message }], isError: true });
        yield { type: 'tool_result', id: call.id, name: call.name, ok: false, summary: message };
      }
    }
  }

  yield { type: 'error', code: 'max_iterations', message: 'Reached the step limit for one message — send “continue” to keep going.' };
  return { state: 'error', messages };
}

/** Placeholder swapped in for a pruned screenshot (the tool_use still needs a matching result). */
const STALE_SHOT_NOTE = '[earlier screenshot omitted from history — call preview_page / compare_to_source again to see the current render]';

/** Strip image blocks from every EARLIER tool result (keeping their text), so only the newest render's
 *  screenshots ride along in the resent transcript. Mutates the loop-local messages array in place. */
function dropStaleScreenshots(messages: AgentMessage[]): void {
  for (const m of messages) {
    if (m.role !== 'tool' || !m.content.some((p) => p.type === 'image')) continue;
    m.content = m.content.map((p): ToolResultPart => (p.type === 'image' ? { type: 'text', text: STALE_SHOT_NOTE } : p));
  }
}

function summarize(content: ToolResultPart[]): string {
  const text = content
    .map((p) => (p.type === 'text' ? p.text : `[image ${p.mimeType}]`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

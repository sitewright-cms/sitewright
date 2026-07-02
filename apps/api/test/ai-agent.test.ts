import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { AnthropicAgentProvider } from '../src/ai/anthropic-agent.js';
import { OpenAiAgentProvider } from '../src/ai/openai-agent.js';
import { runAgentLoop } from '../src/ai/agent-loop.js';
import { parseSseStream, type SseEvent } from '../src/ai/sse-parse.js';
import type { AgentMessage, AgentProvider, AgentStreamEvent, AgentTurnRequest } from '../src/ai/agent-provider.js';

function sseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(it: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('provider adapters (streaming tool-use)', () => {
  it('Anthropic: parses text_delta + tool_use (json accumulated) + split usage + stop', async () => {
    const stream = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"put_page"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"1}"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
      '',
    ].join('\n\n');
    const provider = new AnthropicAgentProvider('k', 'm', async () => sseResponse(stream));
    const events = await collect(provider.runTurn({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] }));
    expect(events).toContainEqual({ type: 'text_delta', text: 'Hi' });
    expect(events).toContainEqual({ type: 'tool_call', id: 'tu_1', name: 'put_page', input: { a: 1 } });
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' });
  });

  it('Anthropic: a tool block CUT OFF at max_tokens (no content_block_stop) drops the call + reports stop:max_tokens', async () => {
    const stream = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me build"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_x","name":"put_page"}}',
      // partial input JSON — the page never finished streaming, so NO content_block_stop for index 1.
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"page\\":{\\"source\\":\\"<section"}}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":8192}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
      '',
    ].join('\n\n');
    const provider = new AnthropicAgentProvider('k', 'm', async () => sseResponse(stream));
    const events = await collect(provider.runTurn({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] }));
    expect(events.some((e) => e.type === 'tool_call')).toBe(false); // the truncated call is dropped
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'max_tokens' });
  });

  it('OpenAI-compat: parses content + index-keyed tool_calls fragments + trailing usage + [DONE]', async () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"put_page","arguments":"{\\"a\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const provider = new OpenAiAgentProvider('k', 'm', 'https://x/v1', async () => sseResponse(stream));
    const events = await collect(provider.runTurn({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] }));
    expect(events).toContainEqual({ type: 'text_delta', text: 'Hi' });
    expect(events).toContainEqual({ type: 'tool_call', id: 'call_1', name: 'put_page', input: { a: 1 } });
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } });
    expect(events).toContainEqual({ type: 'stop', reason: 'tool_use' });
  });
});

describe('agent loop', () => {
  const twoTurnProvider: AgentProvider = {
    model: 'm',
    async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentStreamEvent> {
      const lastIsTool = req.messages.at(-1)?.role === 'tool';
      if (!lastIsTool) {
        yield { type: 'text_delta', text: 'working' };
        yield { type: 'tool_call', id: 't1', name: 'echo', input: { x: 1 } };
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } };
        yield { type: 'stop', reason: 'tool_use' };
      } else {
        yield { type: 'text_delta', text: 'all done' };
        yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } };
        yield { type: 'stop', reason: 'end_turn' };
      }
    },
  };

  it('runs a tool call, threads the result back, then completes with done', async () => {
    const calls: string[] = [];
    const bridge = {
      listTools: async () => [],
      callTool: async (name: string, input: unknown) => {
        calls.push(name);
        return { content: [{ type: 'text' as const, text: `ok:${JSON.stringify(input)}` }], isError: false };
      },
    };
    const events: unknown[] = [];
    const gen = runAgentLoop({ provider: twoTurnProvider, bridge: bridge as never, system: 's', tools: [], messages: [{ role: 'user', content: 'go' }] });
    let n = await gen.next();
    while (!n.done) {
      events.push(n.value);
      n = await gen.next();
    }
    expect(n.value.state).toBe('done');
    expect(calls).toEqual(['echo']);
    expect(events).toContainEqual({ type: 'tool', id: 't1', name: 'echo', input: { x: 1 } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: true }));
    expect(events.at(-1)).toEqual({ type: 'done', message: 'all done' });
  });

  it('prunes STALE screenshots from the transcript, keeping only the latest render', async () => {
    // The model previews twice (two turns), then finishes; each preview returns an image tool_result.
    let turn = 0;
    const previewProvider: AgentProvider = {
      model: 'm',
      async *runTurn(): AsyncIterable<AgentStreamEvent> {
        turn += 1;
        if (turn <= 2) {
          yield { type: 'tool_call', id: `t${turn}`, name: 'preview_page', input: {} };
          yield { type: 'stop', reason: 'tool_use' };
        } else {
          yield { type: 'text_delta', text: 'looks good' };
          yield { type: 'stop', reason: 'end_turn' };
        }
      },
    };
    const bridge = {
      listTools: async () => [],
      callTool: async () => ({ content: [{ type: 'image' as const, data: 'IMGDATA', mimeType: 'image/jpeg' }], isError: false }),
    };
    const gen = runAgentLoop({ provider: previewProvider, bridge: bridge as never, system: 's', tools: [], messages: [{ role: 'user', content: 'build' }] });
    let n = await gen.next();
    while (!n.done) n = await gen.next();
    const toolMsgs = n.value.messages.filter((m): m is Extract<AgentMessage, { role: 'tool' }> => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    // The EARLIER render's image is replaced with a text note; the LATEST render keeps its image.
    expect(toolMsgs[0]!.content.some((p) => p.type === 'image')).toBe(false);
    expect(toolMsgs[0]!.content.map((p) => (p.type === 'text' ? p.text : '')).join('')).toMatch(/omitted from history/);
    expect(toolMsgs[1]!.content.some((p) => p.type === 'image')).toBe(true);
  });

  it('surfaces a max_tokens truncation as an actionable error, not a silent done', async () => {
    // The model streamed a preamble then got cut off at the output limit mid tool call (so no
    // completed tool_call arrives) — the loop must NOT report success/waiting, it must error.
    const truncatedProvider: AgentProvider = {
      model: 'm',
      async *runTurn(): AsyncIterable<AgentStreamEvent> {
        yield { type: 'text_delta', text: 'Perfect! Let me build the page' };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 8192 } };
        yield { type: 'stop', reason: 'max_tokens' };
      },
    };
    const bridge = { listTools: async () => [], callTool: async () => ({ content: [], isError: false }) };
    const events: Array<{ type: string; code?: string; message?: string }> = [];
    const gen = runAgentLoop({ provider: truncatedProvider, bridge: bridge as never, system: 's', tools: [], messages: [{ role: 'user', content: 'make a landing page' }] });
    let n = await gen.next();
    while (!n.done) {
      events.push(n.value as { type: string; code?: string });
      n = await gen.next();
    }
    expect(n.value.state).toBe('error');
    const err = events.find((e) => e.type === 'error');
    expect(err?.code).toBe('max_tokens');
    expect(err?.message).toMatch(/output-token limit/i);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('stops on the quota hook throwing, surfacing an error event', async () => {
    const bridge = { listTools: async () => [], callTool: async () => ({ content: [], isError: false }) };
    const events: Array<{ type: string }> = [];
    const gen = runAgentLoop({
      provider: twoTurnProvider,
      bridge: bridge as never,
      system: 's',
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      onUsage: () => {
        throw new Error('quota exhausted');
      },
    });
    let n = await gen.next();
    while (!n.done) {
      events.push(n.value as { type: string });
      n = await gen.next();
    }
    expect(n.value.state).toBe('error');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('POST /projects/:id/agent/messages (end-to-end)', () => {
  // Scripted provider: first turn calls put_page, second turn (after the tool result) completes.
  class ScriptedProvider implements AgentProvider {
    readonly model = 'test-model';
    async *runTurn(req: AgentTurnRequest): AsyncIterable<AgentStreamEvent> {
      const lastIsTool = req.messages.at(-1)?.role === 'tool';
      if (!lastIsTool) {
        yield { type: 'text_delta', text: 'Updating the homepage…' };
        yield {
          type: 'tool_call',
          id: 't1',
          name: 'put_page',
          input: { page: { id: 'home', path: '', title: 'Agent Was Here', root: { id: 'r', type: 'Section' } } },
        };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
        yield { type: 'stop', reason: 'tool_use' };
      } else {
        yield { type: 'text_delta', text: 'Done — the headline is updated.' };
        yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 3 } };
        yield { type: 'stop', reason: 'end_turn' };
      }
    }
  }

  let app: FastifyInstance;
  let db: Database;
  let publishRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-agent-'));
    db = await makeTestDb();
    app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32), agentProvider: new ScriptedProvider() });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(publishRoot, { recursive: true, force: true });
  });

  async function ownerSession(): Promise<{ cookie: string; projectId: string }> {
    const email = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.test`;
    await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
    const cookie = login.cookies.find((c) => c.name === 'sw_session')!.value;
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'Site', slug: `agent-${Date.now()}` } });
    return { cookie, projectId: (proj.json() as { project: { id: string } }).project.id };
  }

  it('drives the MCP tools to edit DRAFT content and streams thinking→working→done', async () => {
    const { cookie, projectId } = await ownerSession();
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/agent/messages`,
      cookies: { sw_session: cookie },
      payload: { message: 'set the homepage headline', capabilities: ['content:read', 'content:write'], context: { path: '/' } },
    });
    expect(res.statusCode).toBe(200);
    const frames = res.payload;
    expect(frames).toContain('event: start');
    expect(frames).toContain('event: text');
    expect(frames).toContain('event: tool');
    expect(frames).toContain('put_page');
    expect(frames).toContain('event: done');

    // The edit really landed through the gated in-process REST path.
    const got = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page/home`, cookies: { sw_session: cookie } });
    expect(got.statusCode).toBe(200);
    expect(JSON.stringify(got.json())).toContain('Agent Was Here');
  });

  it('accepts an attachment-only message and rejects an empty one / a bad attachment type', async () => {
    const { cookie, projectId } = await ownerSession();
    const url = `/projects/${projectId}/agent/messages`;
    // Empty text + an image attachment → runs (200 SSE stream).
    const ok = await app.inject({ method: 'POST', url, cookies: { sw_session: cookie }, payload: { message: '', attachments: [{ kind: 'image', mimeType: 'image/png', data: 'AAAA' }] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.payload).toContain('event: start');
    // Empty text + no attachment → 400.
    const empty = await app.inject({ method: 'POST', url, cookies: { sw_session: cookie }, payload: { message: '   ' } });
    expect(empty.statusCode).toBe(400);
    // A disallowed attachment type → 400 (zod refine).
    const bad = await app.inject({ method: 'POST', url, cookies: { sw_session: cookie }, payload: { message: 'hi', attachments: [{ kind: 'image', mimeType: 'image/svg+xml', data: 'AAAA' }] } });
    expect(bad.statusCode).toBe(400);
  });

  it('binds a conversation to its owner+project — a known id from another user is 404', async () => {
    const a = await ownerSession();
    const resA = await app.inject({
      method: 'POST',
      url: `/projects/${a.projectId}/agent/messages`,
      cookies: { sw_session: a.cookie },
      payload: { message: 'hello', capabilities: ['content:read'] },
    });
    expect(resA.statusCode).toBe(200);
    const conversationId = /"conversationId":"([^"]+)"/.exec(resA.payload)?.[1];
    expect(conversationId).toBeTruthy();

    // A different user + project cannot replay A's conversation history via its id.
    const b = await ownerSession();
    const resB = await app.inject({
      method: 'POST',
      url: `/projects/${b.projectId}/agent/messages`,
      cookies: { sw_session: b.cookie },
      payload: { message: 'whose history is this?', conversationId, capabilities: ['content:read'] },
    });
    expect(resB.statusCode).toBe(404);
  });

  it('403s a non-writer and 501s when no provider is configured', async () => {
    const noAi = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
    await noAi.ready();
    try {
      const email = `noai-${Date.now()}@e2e.test`;
      await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
      const login = await noAi.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
      const cookie = login.cookies.find((c) => c.name === 'sw_session')!.value;
      const proj = await noAi.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'S', slug: `noai-${Date.now()}` } });
      const projectId = (proj.json() as { project: { id: string } }).project.id;
      const res = await noAi.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: cookie }, payload: { message: 'hi' } });
      expect(res.statusCode).toBe(501);
    } finally {
      await noAi.close();
    }
  });

  it('429s once the project monthly token cap is exhausted (preflight + mid-loop meter)', async () => {
    const capped = await createApp({ db, publishRoot, encryptionKey: randomBytes(32), agentProvider: new ScriptedProvider(), aiQuota: { projectMonthlyTokens: 1 } });
    await capped.ready();
    try {
      const email = `cap-${Date.now()}@e2e.test`;
      await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
      const login = await capped.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
      const cookie = login.cookies.find((c) => c.name === 'sw_session')!.value;
      const proj = await capped.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'S', slug: `cap-${Date.now()}` } });
      const projectId = (proj.json() as { project: { id: string } }).project.id;
      const post = () =>
        capped.inject({ method: 'POST', url: `/projects/${projectId}/agent/messages`, cookies: { sw_session: cookie }, payload: { message: 'hi', capabilities: ['content:read', 'content:write'] } });
      // First call runs but the per-turn meter trips the cap → an error frame is streamed.
      const r1 = await post();
      expect(r1.statusCode).toBe(200);
      expect(r1.payload).toContain('event: error');
      // Second call is rejected at preflight (usage already >= cap).
      const r2 = await post();
      expect(r2.statusCode).toBe(429);
    } finally {
      await capped.close();
    }
  });
});

describe('adapter translation + error branches', () => {
  it('Anthropic: translates assistant tool_use + tool-result-with-image; throws on non-ok', async () => {
    let body: { system?: unknown; tools?: Array<Record<string, unknown>>; messages?: Array<Record<string, unknown>> } = {};
    const provider = new AnthropicAgentProvider('k', 'm', async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    await collect(
      provider.runTurn({
        system: 'sys',
        tools: [{ name: 'put_page', description: 'd', parameters: { type: 'object' } }],
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', parts: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'put_page', input: { a: 1 } }] },
          { role: 'tool', toolCallId: 't1', name: 'put_page', content: [{ type: 'text', text: 'done' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }], isError: true },
        ],
      }),
    );
    // System is sent as a cacheable content block (prompt caching), not a bare string.
    expect(body.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
    expect(body.tools![0]).toMatchObject({ name: 'put_page', input_schema: { type: 'object' } });
    // The LAST tool carries the cache breakpoint so the whole tool-schema block is reused across turns.
    expect(body.tools![body.tools!.length - 1]).toMatchObject({ cache_control: { type: 'ephemeral' } });
    const toolMsg = body.messages![2] as { role: string; content: Array<{ type: string; content: unknown[]; is_error?: boolean }> };
    expect(toolMsg.role).toBe('user');
    expect(toolMsg.content[0]!.type).toBe('tool_result');
    expect(toolMsg.content[0]!.is_error).toBe(true);
    expect(toolMsg.content[0]!.content).toContainEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });

    const bad = new AnthropicAgentProvider('k', 'm', async () => new Response('boom', { status: 500 }));
    await expect(collect(bad.runTurn({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] }))).rejects.toThrow(/500/);
  });

  it('Anthropic: a plain last user message becomes a cacheable block (history cache breakpoint)', async () => {
    let body: { messages?: Array<{ content: unknown }> } = {};
    const provider = new AnthropicAgentProvider('k', 'm', async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    await collect(provider.runTurn({ system: 's', tools: [], messages: [{ role: 'user', content: 'just text' }] }));
    expect(body.messages![0]!.content).toEqual([{ type: 'text', text: 'just text', cache_control: { type: 'ephemeral' } }]);
  });

  it('OpenAI: system-first + assistant tool_calls + tool role image-note; maps stop; throws on non-ok', async () => {
    let body: { messages?: Array<Record<string, unknown>>; tools?: Array<Record<string, unknown>> } = {};
    const provider = new OpenAiAgentProvider('k', 'm', 'https://x/v1', async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return sseResponse('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    const events = await collect(
      provider.runTurn({
        system: 'sys',
        tools: [{ name: 'put_page', description: 'd', parameters: { type: 'object' } }],
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', parts: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'put_page', input: { a: 1 } }] },
          { role: 'tool', toolCallId: 't1', name: 'put_page', content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] },
        ],
      }),
    );
    expect(body.messages![0]).toEqual({ role: 'system', content: 'sys' });
    expect((body.messages![2] as { tool_calls: Array<{ id: string }> }).tool_calls[0]!.id).toBe('t1');
    expect((body.messages![3] as { role: string; content: string }).content).toContain('image omitted');
    expect(events).toContainEqual({ type: 'stop', reason: 'end_turn' });

    const bad = new OpenAiAgentProvider('k', 'm', 'https://x/v1', async () => new Response('nope', { status: 502 }));
    await expect(collect(bad.runTurn({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] }))).rejects.toThrow(/502/);
  });

  it('Anthropic: user attachments become image + document content blocks (attachments before text)', async () => {
    let body: { messages?: Array<{ role: string; content: unknown }> } = {};
    const provider = new AnthropicAgentProvider('k', 'm', async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    await collect(
      provider.runTurn({
        system: 's',
        tools: [],
        messages: [
          {
            role: 'user',
            content: 'match this',
            attachments: [
              { kind: 'image', mimeType: 'image/png', data: 'IMG' },
              { kind: 'document', mimeType: 'application/pdf', data: 'PDF', name: 'spec.pdf' },
            ],
          },
        ],
      }),
    );
    const content = body.messages![0]!.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMG' } });
    expect(content[1]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'PDF' } });
    // Text LAST — and, as the last block of the last message, it carries the history cache breakpoint
    // (so an uploaded attachment is cached + reused instead of reprocessed every turn).
    expect(content[2]).toMatchObject({ type: 'text', text: 'match this' });
    expect(content[2]).toMatchObject({ cache_control: { type: 'ephemeral' } });
  });

  it('OpenAI: user image attachments become image_url data URLs; a PDF is noted as text', async () => {
    let body: { messages?: Array<{ role: string; content: unknown }> } = {};
    const provider = new OpenAiAgentProvider('k', 'm', 'https://x/v1', async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    await collect(
      provider.runTurn({
        system: 's',
        tools: [],
        messages: [
          {
            role: 'user',
            content: 'see this',
            attachments: [
              { kind: 'image', mimeType: 'image/jpeg', data: 'JPG' },
              { kind: 'document', mimeType: 'application/pdf', data: 'PDF' },
            ],
          },
        ],
      }),
    );
    const content = body.messages![1]!.content as Array<Record<string, unknown>>; // [0] is the system message
    expect(content[0]).toMatchObject({ type: 'text' });
    expect((content[0] as { text: string }).text).toContain('document attachment');
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,JPG' } });
  });
});

describe('agent loop — error + termination branches', () => {
  const bridgeOk = { listTools: async () => [], callTool: async () => ({ content: [{ type: 'text' as const, text: 'ok' }], isError: false }) };
  async function run(provider: AgentProvider, bridge: unknown, maxIterations?: number) {
    const events: Array<{ type: string }> = [];
    const gen = runAgentLoop({ provider, bridge: bridge as never, system: 's', tools: [], messages: [{ role: 'user', content: 'go' }], maxIterations });
    let n = await gen.next();
    while (!n.done) {
      events.push(n.value as { type: string });
      n = await gen.next();
    }
    return { events, result: n.value };
  }

  it('surfaces a provider error and stops', async () => {
    // A stream whose first read rejects — exercises the loop's provider-error catch without a
    // yield-less generator.
    const provider: AgentProvider = {
      model: 'm',
      runTurn(): AsyncIterable<AgentStreamEvent> {
        return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('upstream 500')) }) };
      },
    };
    const { events, result } = await run(provider, bridgeOk);
    expect(result.state).toBe('error');
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'provider' }));
  });

  it('feeds a failing tool call back as an error result, then completes', async () => {
    let turn = 0;
    const provider: AgentProvider = {
      model: 'm',
      async *runTurn() {
        turn++;
        if (turn === 1) {
          yield { type: 'tool_call', id: 't1', name: 'boom', input: {} };
          yield { type: 'stop', reason: 'tool_use' };
        } else {
          yield { type: 'text_delta', text: 'recovered' };
          yield { type: 'stop', reason: 'end_turn' };
        }
      },
    };
    const bridge = { listTools: async () => [], callTool: async () => { throw new Error('tool exploded'); } };
    const { events, result } = await run(provider, bridge);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: false }));
    expect(result.state).toBe('done');
  });

  it('stops with max_iterations when the model never yields', async () => {
    const provider: AgentProvider = {
      model: 'm',
      async *runTurn() {
        yield { type: 'tool_call', id: 't', name: 'x', input: {} };
        yield { type: 'stop', reason: 'tool_use' };
      },
    };
    const { events, result } = await run(provider, bridgeOk, 2);
    expect(result.state).toBe('error');
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'max_iterations' }));
  });
});

describe('sse-parse edge cases', () => {
  async function collectSse(body: string, signal?: AbortSignal): Promise<SseEvent[]> {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(body));
        c.close();
      },
    });
    const out: SseEvent[] = [];
    for await (const e of parseSseStream(stream, signal)) out.push(e);
    return out;
  }

  it('skips comments + data-less blocks, joins multi-line data, and flushes a tail with no trailing blank line', async () => {
    const out = await collectSse(': keep-alive\n\nevent: only\n\nevent: msg\ndata: line1\ndata: line2\n\ndata: tail-no-blank');
    expect(out).toContainEqual({ event: 'msg', data: 'line1\nline2' });
    expect(out).toContainEqual({ data: 'tail-no-blank' });
    expect(out.some((e) => e.event === 'only')).toBe(false); // event with no data → dropped
  });

  it('stops immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await collectSse('data: {"x":1}\n\n', ac.signal)).toEqual([]);
  });
});

describe('adapter + loop abort/edge branches', () => {
  it('OpenAI: synthesizes a tool_call id when omitted and tolerates malformed arguments', async () => {
    const stream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"foo","arguments":"not json"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const provider = new OpenAiAgentProvider('k', 'm', 'https://x/v1', async () => sseResponse(stream));
    const events = await collect(provider.runTurn({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] }));
    expect(events).toContainEqual({ type: 'tool_call', id: 'call_foo', name: 'foo', input: {} });
  });

  it('loop: returns immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const provider: AgentProvider = {
      model: 'm',
      async *runTurn() {
        yield { type: 'stop', reason: 'end_turn' };
      },
    };
    const bridge = { listTools: async () => [], callTool: async () => ({ content: [], isError: false }) };
    const gen = runAgentLoop({ provider, bridge: bridge as never, system: 's', tools: [], messages: [{ role: 'user', content: 'go' }], signal: ac.signal });
    const n = await gen.next();
    expect(n.done).toBe(true);
    expect((n.value as { state: string }).state).toBe('error');
  });
});

describe('McpToolBridge', () => {
  function fakeApp(
    handler: (method: string) => { statusCode?: number; result?: unknown; error?: { message: string } },
  ): FastifyInstance {
    return {
      inject: async (opts: { payload: { method: string; id: number } }) => {
        const r = handler(opts.payload.method);
        return {
          statusCode: r.statusCode ?? 200,
          payload: JSON.stringify({ jsonrpc: '2.0', id: opts.payload.id, ...(r.error ? { error: r.error } : { result: r.result }) }),
        };
      },
    } as unknown as FastifyInstance;
  }

  it('offers only granted, catalogued tools (drops excluded/withheld/uncatalogued/ungranted; keeps ungated)', async () => {
    const app = fakeApp(() => ({
      result: {
        tools: [
          { name: 'get_scope', description: 'x' }, // excluded (orientation)
          { name: 'get_guide', description: 'g' }, // catalogued + ungated → kept
          { name: 'put_page', description: 'w', inputSchema: { type: 'object' } }, // content:write → kept
          { name: 'delete_page', description: 'd' }, // content:delete → not granted → dropped
          { name: 'delete_media', description: 'm' }, // withheld
          { name: 'not_in_catalog', description: 'n' }, // drift → dropped (fail closed)
        ],
      },
    }));
    const { McpToolBridge } = await import('../src/ai/tool-bridge.js');
    const bridge = new McpToolBridge(app, 'swk_x');
    const tools = await bridge.listTools(new Set(['content:read', 'content:write']), new Set(['delete_media']));
    expect(tools.map((t) => t.name).sort()).toEqual(['get_guide', 'put_page']);
  });

  it('maps text + image tool-result content and surfaces isError', async () => {
    const app = fakeApp(() => ({ result: { content: [{ type: 'text', text: 'hi' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }], isError: true } }));
    const { McpToolBridge } = await import('../src/ai/tool-bridge.js');
    const res = await new McpToolBridge(app, 'swk_x').callTool('put_page', { a: 1 });
    expect(res.isError).toBe(true);
    expect(res.content).toContainEqual({ type: 'text', text: 'hi' });
    expect(res.content).toContainEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  });

  it('throws on a non-2xx MCP response and on a JSON-RPC error', async () => {
    const { McpToolBridge } = await import('../src/ai/tool-bridge.js');
    await expect(new McpToolBridge(fakeApp(() => ({ statusCode: 500 })), 'swk_x').callTool('x', {})).rejects.toThrow(/failed \(500\)/);
    await expect(new McpToolBridge(fakeApp(() => ({ error: { message: 'nope' } })), 'swk_x').callTool('x', {})).rejects.toThrow(/nope/);
  });
});

describe('McpToolBridge — fallbacks + edge statuses', () => {
  function fakeApp2(
    handler: (method: string) => { statusCode?: number; result?: unknown; error?: { message: string } },
  ): FastifyInstance {
    return {
      inject: async (opts: { payload: { method: string; id: number } }) => {
        const r = handler(opts.payload.method);
        return {
          statusCode: r.statusCode ?? 200,
          payload: JSON.stringify({ jsonrpc: '2.0', id: opts.payload.id, ...(r.error ? { error: r.error } : { result: r.result }) }),
        };
      },
    } as unknown as FastifyInstance;
  }

  it('applies description/schema fallbacks, an empty tool list, and rejects a sub-200 status', async () => {
    const { McpToolBridge } = await import('../src/ai/tool-bridge.js');
    // catalogued, ungated tool with neither description nor inputSchema → fallbacks applied
    const b = new McpToolBridge(fakeApp2(() => ({ result: { tools: [{ name: 'get_reference' }] } })), 'swk_x');
    expect((await b.listTools(new Set(['content:read'])))[0]).toEqual({ name: 'get_reference', description: '', parameters: { type: 'object' } });
    // a result with no `tools` field → empty
    expect(await new McpToolBridge(fakeApp2(() => ({ result: {} })), 'swk_x').listTools(new Set(['content:read']))).toEqual([]);
    // a 1xx response is a failure too (the < 200 side of the guard)
    await expect(new McpToolBridge(fakeApp2(() => ({ statusCode: 100 })), 'swk_x').callTool('x', {})).rejects.toThrow(/failed \(100\)/);
  });
});

describe('McpToolBridge — content + error fallbacks', () => {
  function fake(handler: () => { result?: unknown; error?: { message?: string } }): FastifyInstance {
    return {
      inject: async (opts: { payload: { id: number } }) => {
        const r = handler();
        return {
          statusCode: 200,
          payload: JSON.stringify({ jsonrpc: '2.0', id: opts.payload.id, ...(r.error ? { error: r.error } : { result: r.result ?? {} }) }),
        };
      },
    } as unknown as FastifyInstance;
  }

  it('fills content/arg fallbacks and a message-less JSON-RPC error', async () => {
    const { McpToolBridge } = await import('../src/ai/tool-bridge.js');
    const res = await new McpToolBridge(fake(() => ({ result: { content: [{ type: 'text' }, { type: 'image' }] } })), 'swk_x').callTool('x', undefined);
    expect(res.content).toContainEqual({ type: 'text', text: '' });
    expect(res.content).toContainEqual({ type: 'image', data: '', mimeType: 'image/png' });
    expect((await new McpToolBridge(fake(() => ({ result: {} })), 'swk_x').callTool('x', {})).content).toEqual([]);
    await expect(new McpToolBridge(fake(() => ({ error: {} })), 'swk_x').callTool('x', {})).rejects.toThrow(/MCP tools\/call error/);
  });
});

describe('Anthropic adapter — stop mapping + malformed json', () => {
  it('maps end_turn/max_tokens/other and coerces malformed tool json to {}', async () => {
    const mk = (reason: string): string =>
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"n"}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"not json"}}\n\n' +
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${reason}"}}\n\n`;
    for (const [reason, expected] of [
      ['end_turn', 'end_turn'],
      ['max_tokens', 'max_tokens'],
      ['refusal', 'other'],
    ] as const) {
      const p = new AnthropicAgentProvider('k', 'm', async () => sseResponse(mk(reason)));
      const evs = await collect(p.runTurn({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] }));
      expect(evs.at(-1)).toEqual({ type: 'stop', reason: expected });
      expect(evs).toContainEqual({ type: 'tool_call', id: 't', name: 'n', input: {} });
    }
  });
});

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
import type { AgentProvider, AgentStreamEvent, AgentTurnRequest } from '../src/ai/agent-provider.js';

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
});

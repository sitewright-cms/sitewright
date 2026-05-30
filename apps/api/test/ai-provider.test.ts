import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '../src/ai/provider.js';

interface Captured {
  url?: string;
  init?: RequestInit;
}

function fakeFetch(cap: Captured, response: { ok?: boolean; status?: number; body: unknown }): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    cap.url = String(url);
    cap.init = init;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
      text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body)),
    } as Response;
  }) as unknown as typeof fetch;
}

const sentBody = (cap: Captured) => JSON.parse(String(cap.init?.body)) as Record<string, unknown>;

describe('AnthropicProvider', () => {
  it('builds the Messages request and parses text + usage', async () => {
    const cap: Captured = {};
    const provider = new AnthropicProvider(
      'sk-test',
      'claude-haiku-4-5-20251001',
      fakeFetch(cap, {
        body: {
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'thinking', text: 'ignored' },
          ],
          usage: { input_tokens: 12, output_tokens: 5 },
        },
      }),
    );
    const out = await provider.complete({ prompt: 'hi', system: 'sys' });
    expect(out.text).toBe('Hello'); // only text blocks joined
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(out.model).toBe('claude-haiku-4-5-20251001');

    expect(cap.url).toContain('/v1/messages');
    const headers = cap.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const sent = sentBody(cap);
    expect(sent.model).toBe('claude-haiku-4-5-20251001');
    expect(sent.system).toBe('sys');
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(Number(sent.max_tokens)).toBeGreaterThan(0);
  });

  it('honours a per-request model + maxTokens override', async () => {
    const cap: Captured = {};
    const provider = new AnthropicProvider('k', 'default-model', fakeFetch(cap, { body: { content: [], usage: {} } }));
    const out = await provider.complete({ prompt: 'x', model: 'claude-opus-4-8', maxTokens: 256 });
    expect(out.text).toBe(''); // no text blocks
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 }); // missing usage → 0
    const sent = sentBody(cap);
    expect(sent.model).toBe('claude-opus-4-8');
    expect(sent.max_tokens).toBe(256);
  });

  it('throws on a non-ok response (status surfaced)', async () => {
    const provider = new AnthropicProvider('k', undefined, fakeFetch({}, { ok: false, status: 429, body: 'rate limited' }));
    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow(/429/);
  });
});

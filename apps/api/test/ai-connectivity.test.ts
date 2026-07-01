import { describe, it, expect } from 'vitest';
import { testAiProvider } from '../src/ai/connectivity.js';
import { StockService } from '../src/stock/service.js';
import type { StockProvider } from '../src/stock/providers.js';
import type { StockProviderName } from '@sitewright/schema';

function sse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('testAiProvider (AI connectivity probe)', () => {
  it('returns ok + the model when the provider authenticates', async () => {
    const stream = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":1}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
      '',
    ].join('\n\n');
    const fetchImpl = (async () => sse(stream)) as unknown as typeof fetch;
    const r = await testAiProvider({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-4-5' }, fetchImpl);
    expect(r).toEqual({ ok: true, model: 'claude-haiku-4-5' });
  });

  it('returns the provider error on an auth failure (401)', async () => {
    const fetchImpl = (async () =>
      new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 })) as unknown as typeof fetch;
    const r = await testAiProvider({ provider: 'anthropic', apiKey: 'bad', model: 'claude-haiku-4-5' }, fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.model).toBe('claude-haiku-4-5');
    expect(r.error).toMatch(/401|invalid x-api-key/i);
  });
});

/** Minimal stock provider stub — search() succeeds or throws depending on the key. */
function stubProvider(requiresKey: boolean, onSearch: (key: string | null) => void): StockProvider {
  return {
    name: 'unsplash',
    requiresKey,
    search: async (_q: string, _p: number, key: string | null) => {
      onSearch(key);
      return [];
    },
    resolve: async () => null,
  };
}

describe('StockService.testKey', () => {
  const settings = { getStockKey: async () => 'stored-key' };

  it('tests the supplied (unsaved) key over the stored one', async () => {
    let used: string | null = null;
    const svc = new StockService(new Map<StockProviderName, StockProvider>([['unsplash', stubProvider(true, (k) => (used = k))]]), settings);
    expect(await svc.testKey('unsplash', 'typed-key')).toEqual({ ok: true });
    expect(used).toBe('typed-key');
  });

  it('falls back to the stored key when none is supplied', async () => {
    let used: string | null = null;
    const svc = new StockService(new Map<StockProviderName, StockProvider>([['unsplash', stubProvider(true, (k) => (used = k))]]), settings);
    await svc.testKey('unsplash');
    expect(used).toBe('stored-key');
  });

  it('reports the provider error when the key is rejected', async () => {
    const svc = new StockService(
      new Map<StockProviderName, StockProvider>([
        ['unsplash', { name: 'unsplash', requiresKey: true, search: async () => { throw new Error('provider request failed (401)'); }, resolve: async () => null }],
      ]),
      settings,
    );
    const r = await svc.testKey('unsplash', 'bad');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { SitewrightClient, SitewrightApiError, type FetchLike, type Scope } from '../src/client.js';

interface Canned {
  status: number;
  statusText?: string;
  body?: string;
}

function fakeFetch(handler: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Canned) {
  const calls: Array<{ input: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = [];
  const impl: FetchLike = async (input, init) => {
    calls.push({ input, init });
    const r = handler(input, init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.statusText ?? '',
      text: async () => r.body ?? '',
    };
  };
  return { impl, calls };
}

const scope: Scope = { orgId: 'o1', projectId: 'p1', role: 'admin', capabilities: ['content:read', 'content:write'] };

async function introspected(handler: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(handler);
  const client = new SitewrightClient('https://cms.test/', 'swk_tok', fake.impl);
  await client.introspect();
  return { client, calls: fake.calls };
}

describe('SitewrightClient', () => {
  it('introspects with a Bearer header and trims the base URL', async () => {
    const { calls } = await introspected(() => ({ status: 200, body: JSON.stringify(scope) }));
    expect(calls[0]!.input).toBe('https://cms.test/api-key/self'); // trailing slash trimmed, no double //
    expect(calls[0]!.init?.headers?.authorization).toBe('Bearer swk_tok');
    expect(calls[0]!.init?.method).toBe('GET');
  });

  it('builds scoped content paths after introspection', async () => {
    const { client, calls } = await introspected((input) =>
      input.endsWith('/api-key/self') ? { status: 200, body: JSON.stringify(scope) } : { status: 200, body: '{"items":[]}' },
    );
    await client.listContent('page');
    expect(calls[1]!.input).toBe('https://cms.test/orgs/o1/projects/p1/content/page');
  });

  it('PUTs JSON with a content-type and returns the item', async () => {
    const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };
    const { client, calls } = await introspected((input) =>
      input.endsWith('/api-key/self')
        ? { status: 200, body: JSON.stringify(scope) }
        : { status: 200, body: JSON.stringify({ item: page }) },
    );
    const item = await client.putContent('page', 'home', page);
    expect(item).toEqual(page);
    const put = calls[1]!;
    expect(put.input).toBe('https://cms.test/orgs/o1/projects/p1/content/page/home');
    expect(put.init?.method).toBe('PUT');
    expect(put.init?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(put.init!.body!)).toEqual(page);
  });

  it('treats 204 as a void delete', async () => {
    const { client } = await introspected((input) =>
      input.endsWith('/api-key/self') ? { status: 200, body: JSON.stringify(scope) } : { status: 204 },
    );
    await expect(client.deleteContent('page', 'home')).resolves.toBeUndefined();
  });

  it('maps a non-2xx response to SitewrightApiError with the server message', async () => {
    const { client } = await introspected((input) =>
      input.endsWith('/api-key/self')
        ? { status: 200, body: JSON.stringify(scope) }
        : { status: 403, body: JSON.stringify({ error: 'this API key lacks the "content:write" capability' }) },
    );
    await expect(client.putContent('page', 'home', {})).rejects.toMatchObject({
      status: 403,
      message: /content:write/,
    });
    await expect(client.putContent('page', 'home', {})).rejects.toBeInstanceOf(SitewrightApiError);
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    let call = 0;
    const seen: Array<string | undefined> = [];
    const impl: FetchLike = async (input, init) => {
      seen.push(init?.headers?.authorization);
      call += 1;
      if (input.endsWith('/api-key/self')) return { ok: true, status: 200, statusText: 'x', text: async () => JSON.stringify(scope) };
      // First content call 401s; after refresh, succeeds.
      if (call <= 2) return { ok: false, status: 401, statusText: 'x', text: async () => '{"error":"invalid or expired API key"}' };
      return { ok: true, status: 200, statusText: 'x', text: async () => '{"items":[]}' };
    };
    const onUnauthorized = vi.fn(async () => 'swk_fresh');
    const client = new SitewrightClient('https://cms.test', 'swk_old', impl, onUnauthorized);
    await client.introspect();
    await client.listContent('page');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    // The retry used the refreshed token.
    expect(seen[seen.length - 1]).toBe('Bearer swk_fresh');
  });

  it('surfaces the 401 when there is no refresh hook or refresh gives up', async () => {
    const impl: FetchLike = async (input) =>
      input.endsWith('/api-key/self')
        ? { ok: true, status: 200, statusText: 'x', text: async () => JSON.stringify(scope) }
        : { ok: false, status: 401, statusText: 'x', text: async () => '{"error":"expired"}' };
    // No hook → 401 propagates.
    const noHook = new SitewrightClient('https://cms.test', 'swk_old', impl);
    await noHook.introspect();
    await expect(noHook.listContent('page')).rejects.toMatchObject({ status: 401 });
    // Hook returns null (refresh failed) → 401 still propagates (no infinite retry).
    const giveUp = new SitewrightClient('https://cms.test', 'swk_old', impl, async () => null);
    await giveUp.introspect();
    await expect(giveUp.listContent('page')).rejects.toMatchObject({ status: 401 });
  });

  it('refuses scoped calls before introspection', async () => {
    const fake = fakeFetch(() => ({ status: 200, body: '{}' }));
    const client = new SitewrightClient('https://cms.test', 'swk_tok', fake.impl);
    await expect(client.listContent('page')).rejects.toThrow(/introspect/);
  });

  it('reads, previews, publishes and reads publish status on scoped paths', async () => {
    const { client, calls } = await introspected((input) => {
      if (input.endsWith('/api-key/self')) return { status: 200, body: JSON.stringify(scope) };
      if (input.endsWith('/content/page/home')) return { status: 200, body: JSON.stringify({ item: { id: 'home' } }) };
      if (input.endsWith('/preview')) return { status: 200, body: JSON.stringify({ html: '<x>', token: 't' }) };
      if (input.endsWith('/publish')) return { status: 200, body: JSON.stringify({ release: { routes: 2 }, url: '/sites/p1/' }) };
      return { status: 404 };
    });
    expect(await client.getContent('page', 'home')).toEqual({ id: 'home' });
    expect(await client.preview({ id: 'home' })).toEqual({ html: '<x>', token: 't' });
    expect(await client.publish()).toEqual({ release: { routes: 2 }, url: '/sites/p1/' });
    expect(await client.publishStatus()).toEqual({ release: { routes: 2 }, url: '/sites/p1/' });
    expect(calls.map((c) => `${c.init?.method} ${c.input.replace('https://cms.test', '')}`)).toEqual([
      'GET /api-key/self',
      'GET /orgs/o1/projects/p1/content/page/home',
      'POST /orgs/o1/projects/p1/preview',
      'POST /orgs/o1/projects/p1/publish',
      'GET /orgs/o1/projects/p1/publish',
    ]);
  });

  it('builds stock provider/search/import paths and unwraps the imported item', async () => {
    const asset = { id: 'a1', url: '/media/p1/a1/x.jpg' };
    const { client, calls } = await introspected((input) => {
      if (input.endsWith('/api-key/self')) return { status: 200, body: JSON.stringify(scope) };
      if (input.includes('/stock/providers')) return { status: 200, body: JSON.stringify({ providers: [] }) };
      if (input.includes('/stock/search')) return { status: 200, body: JSON.stringify({ provider: 'openverse', page: 1, results: [] }) };
      if (input.includes('/stock/import')) return { status: 201, body: JSON.stringify({ item: asset }) };
      return { status: 404 };
    });
    await client.stockProviders();
    await client.stockSearch('openverse', 'cats & dogs', 2);
    const imported = await client.importStock('openverse', 'ov1', 'a cat');
    expect(imported).toEqual(asset); // unwrapped from { item }
    const paths = calls.map((c) => `${c.init?.method} ${c.input.replace('https://cms.test', '')}`);
    expect(paths[1]).toBe('GET /orgs/o1/projects/p1/stock/providers');
    // query is URL-encoded
    expect(paths[2]).toBe('GET /orgs/o1/projects/p1/stock/search?provider=openverse&q=cats+%26+dogs&page=2');
    expect(paths[3]).toBe('POST /orgs/o1/projects/p1/stock/import');
    expect(JSON.parse(calls[3]!.init!.body!)).toEqual({ provider: 'openverse', id: 'ov1', alt: 'a cat' });
  });

  it('falls back to statusText when the error body is not JSON', async () => {
    const { client } = await introspected((input) =>
      input.endsWith('/api-key/self')
        ? { status: 200, body: JSON.stringify(scope) }
        : { status: 500, statusText: 'Server Error', body: '<html>nope</html>' },
    );
    await expect(client.listContent('page')).rejects.toMatchObject({ status: 500, message: 'Server Error' });
  });

  it('falls back to a numeric message when statusText is empty (HTTP/2) and body is not JSON', async () => {
    const { client } = await introspected((input) =>
      input.endsWith('/api-key/self')
        ? { status: 200, body: JSON.stringify(scope) }
        : { status: 502, statusText: '', body: '' },
    );
    await expect(client.listContent('page')).rejects.toMatchObject({ status: 502, message: 'HTTP 502' });
  });

  it('listSubmissions includes only the provided filters in the query string', async () => {
    const ok = (input: string) =>
      input.endsWith('/api-key/self') ? { status: 200, body: JSON.stringify(scope) } : { status: 200, body: '{"items":[]}' };
    const all = await introspected(ok);
    await all.client.listSubmissions({ formId: 'contact', limit: 10, offset: 5 });
    expect(all.calls.at(-1)!.input).toBe('https://cms.test/orgs/o1/projects/p1/submissions?formId=contact&limit=10&offset=5');

    const none = await introspected(ok);
    await none.client.listSubmissions();
    expect(none.calls.at(-1)!.input).toBe('https://cms.test/orgs/o1/projects/p1/submissions');
  });
});

import { describe, it, expect } from 'vitest';
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

  it('falls back to statusText when the error body is not JSON', async () => {
    const { client } = await introspected((input) =>
      input.endsWith('/api-key/self')
        ? { status: 200, body: JSON.stringify(scope) }
        : { status: 500, statusText: 'Server Error', body: '<html>nope</html>' },
    );
    await expect(client.listContent('page')).rejects.toMatchObject({ status: 500, message: 'Server Error' });
  });
});

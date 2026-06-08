import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer } from '../src/server.js';
import { SitewrightApiError, type Scope, type SitewrightClient } from '../src/client.js';

const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };

function fakeClient(overrides: Partial<Record<keyof SitewrightClient, unknown>> = {}) {
  return {
    listContent: vi.fn(async () => [page]),
    getContent: vi.fn(async () => page),
    putContent: vi.fn(async (_k: string, _id: string, data: unknown) => data),
    deleteContent: vi.fn(async () => undefined),
    preview: vi.fn(async () => ({ html: '<html></html>', token: 'tok' })),
    publish: vi.fn(async () => ({ release: { routes: 1 }, url: '/sites/p/' })),
    publishStatus: vi.fn(async () => ({ release: null })),
    listSubmissions: vi.fn(async () => ({ items: [{ id: 's1', formId: 'contact', fields: { email: 'a@b.co' } }], total: 1 })),
    stockProviders: vi.fn(async () => ({ providers: [{ name: 'openverse', available: true, requiresKey: false }] })),
    stockSearch: vi.fn(async () => ({ provider: 'openverse', page: 1, results: [{ provider: 'openverse', id: 'ov1', author: 'Ann' }] })),
    importStock: vi.fn(async () => ({ id: 'asset1', url: '/media/p/asset1/x.jpg' })),
    ...overrides,
  } as unknown as SitewrightClient & Record<string, ReturnType<typeof vi.fn>>;
}

async function connect(client: SitewrightClient, scope: Scope) {
  const server = createSitewrightMcpServer(client, scope);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'test', version: '0' });
  await mcp.connect(clientTransport);
  return mcp;
}

const readScope: Scope = { projectId: 'p', role: 'member', capabilities: ['content:read'] };
const writeScope: Scope = { projectId: 'p', role: 'admin', capabilities: ['content:read', 'content:write', 'publish'] };

async function toolNames(mcp: Client): Promise<string[]> {
  return (await mcp.listTools()).tools.map((t) => t.name).sort();
}

describe('createSitewrightMcpServer — capability gating', () => {
  it('exposes only read tools for a content:read token', async () => {
    const mcp = await connect(fakeClient(), readScope);
    const names = await toolNames(mcp);
    expect(names).toContain('get_page');
    expect(names).toContain('preview_page');
    expect(names).not.toContain('put_page');
    expect(names).not.toContain('delete_content');
    expect(names).not.toContain('publish_project');
  });

  it('adds write + publish tools when the token carries those capabilities', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const names = await toolNames(mcp);
    expect(names).toContain('put_page');
    expect(names).toContain('delete_page');
    expect(names).toContain('put_content');
    expect(names).toContain('publish_project');
  });

  it('exposes list_submissions to a read-only token', async () => {
    const mcp = await connect(fakeClient(), readScope);
    expect(await toolNames(mcp)).toContain('list_submissions');
  });

  it('exposes stock search/providers to a read token but import only to a write token', async () => {
    const reader = await toolNames(await connect(fakeClient(), readScope));
    expect(reader).toContain('list_stock_providers');
    expect(reader).toContain('search_stock_images');
    expect(reader).not.toContain('import_stock_image');

    const writer = await toolNames(await connect(fakeClient(), writeScope));
    expect(writer).toContain('import_stock_image');
  });
});

describe('createSitewrightMcpServer — stock over MCP', () => {
  it('search_stock_images forwards provider/query/page to the client', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    const res = await mcp.callTool({ name: 'search_stock_images', arguments: { provider: 'openverse', query: 'cats', page: 2 } });
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).stockSearch).toHaveBeenCalledWith('openverse', 'cats', 2);
    expect(res.isError).toBeFalsy();
  });

  it('import_stock_image forwards provider/id/alt and returns the imported asset', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    const res = await mcp.callTool({ name: 'import_stock_image', arguments: { provider: 'openverse', id: 'ov1', alt: 'a cat' } });
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).importStock).toHaveBeenCalledWith('openverse', 'ov1', 'a cat');
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain('asset1');
    expect(res.isError).toBeFalsy();
  });

  it('rejects an unknown stock provider via inputSchema (no client call)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    const res = await mcp.callTool({ name: 'search_stock_images', arguments: { provider: 'bogus', query: 'x' } });
    expect(res.isError).toBe(true);
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).stockSearch).not.toHaveBeenCalled();
  });
});

describe('createSitewrightMcpServer — forms over MCP', () => {
  it('list_submissions forwards filters to the client', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    const res = await mcp.callTool({ name: 'list_submissions', arguments: { formId: 'contact', limit: 10 } });
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).listSubmissions).toHaveBeenCalledWith({
      formId: 'contact',
      limit: 10,
      offset: undefined,
    });
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain('contact');
    expect(res.isError).toBeFalsy();
  });

  it('put_content accepts the form kind (forms are authorable over MCP)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    const formData = {
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email' }],
      recipient: 'sales@acme.com',
    };
    const res = await mcp.callTool({ name: 'put_content', arguments: { kind: 'form', id: 'contact', data: formData } });
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).putContent).toHaveBeenCalledWith('form', 'contact', formData);
    expect(res.isError).toBeFalsy();
  });
});

describe('createSitewrightMcpServer — tool wiring', () => {
  it('get_page forwards to the client and returns the entity as text', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    const res = await mcp.callTool({ name: 'get_page', arguments: { id: 'home' } });
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).getContent).toHaveBeenCalledWith('page', 'home');
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain('"title": "Home"');
    expect(res.isError).toBeFalsy();
  });

  it('put_page writes via the client using page.id', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    const res = await mcp.callTool({ name: 'put_page', arguments: { page } });
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).putContent).toHaveBeenCalledWith('page', 'home', page);
    expect(res.isError).toBeFalsy();
  });

  it('maps an API error to an MCP tool error (isError) rather than throwing', async () => {
    const client = fakeClient({
      putContent: vi.fn(async () => {
        throw new SitewrightApiError(403, 'this API key lacks the "content:write" capability');
      }),
    });
    const mcp = await connect(client, writeScope);
    const res = await mcp.callTool({ name: 'put_page', arguments: { page } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toMatch(/Error 403:.*content:write/);
  });

  it('rejects a put_page whose page fails schema validation (before any client call)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    // Missing required fields (path/title/root) → the SDK validates inputSchema and
    // returns a tool error without ever invoking the handler/client.
    const res = await mcp.callTool({ name: 'put_page', arguments: { page: { id: 'x' } } });
    expect(res.isError).toBe(true);
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).putContent).not.toHaveBeenCalled();
  });
});

describe('createSitewrightMcpServer — agent guidance', () => {
  it('instructions teach the code-first model (page.source + DaisyUI + data-sw-text), not the retired block tree', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const instructions = mcp.getInstructions() ?? '';
    expect(instructions).toMatch(/\bsource\b/);
    expect(instructions).toContain('DaisyUI');
    expect(instructions).toContain('data-sw-text');
    expect(instructions).toMatch(/\{\{\s*company\.name/);
    expect(instructions).toMatch(/no\b[^.]*(JavaScript|script)/i);
    // The retired model must not be advertised.
    expect(instructions).not.toMatch(/block tree/i);
    await mcp.close();
  });

  it('instructions teach scroll-reveal animations via the standard data-aos vocabulary', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const instructions = mcp.getInstructions() ?? '';
    expect(instructions).toContain('data-aos="fade-up"');
    expect(instructions).toContain('data-aos-delay');
    expect(instructions).toContain('data-aos-once');
    // The platform ships its own runtime — agents must NOT add the library themselves.
    expect(instructions).toMatch(/do NOT add the aos\s+package/i);
    expect(instructions).toContain('prefers-reduced-motion');
    await mcp.close();
  });

  it('instructions teach the lazyload, ripple, and icon vocabularies', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const instructions = mcp.getInstructions() ?? '';
    // Lazy-load (vanilla-lazyload vocabulary).
    expect(instructions).toMatch(/data-bg/);
    expect(instructions).toMatch(/class="lazyload"|lazyload/);
    expect(instructions).toMatch(/never add a lazy-load library/i);
    // Ripple (Waves vocabulary).
    expect(instructions).toContain('waves-effect');
    expect(instructions).toContain('waves-light');
    expect(instructions).toMatch(/never add Waves\.js/i);
    // Icons.
    expect(instructions).toContain('{{sw-icon "name"');
    await mcp.close();
  });
});

describe('createSitewrightMcpServer — every tool forwards to the client', () => {
  const calls = (c: SitewrightClient) => c as unknown as Record<string, ReturnType<typeof vi.fn>>;
  const text = (res: Awaited<ReturnType<Client['callTool']>>) =>
    (res.content as Array<{ text: string }>)[0]!.text;

  it('get_scope returns the caller’s scope', async () => {
    const mcp = await connect(fakeClient(), readScope);
    const res = await mcp.callTool({ name: 'get_scope', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('"projectId": "p"');
  });

  it('list_pages forwards to listContent(page)', async () => {
    const client = fakeClient();
    const res = await (await connect(client, readScope)).callTool({ name: 'list_pages', arguments: {} });
    expect(calls(client).listContent).toHaveBeenCalledWith('page');
    expect(res.isError).toBeFalsy();
  });

  it('list_content forwards the requested kind', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({ name: 'list_content', arguments: { kind: 'dataset' } });
    expect(calls(client).listContent).toHaveBeenCalledWith('dataset');
  });

  it('get_content forwards kind + id', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({ name: 'get_content', arguments: { kind: 'dataset', id: 'x' } });
    expect(calls(client).getContent).toHaveBeenCalledWith('dataset', 'x');
  });

  it('preview_page forwards the page to preview', async () => {
    const client = fakeClient();
    const res = await (await connect(client, readScope)).callTool({ name: 'preview_page', arguments: { page } });
    expect(calls(client).preview).toHaveBeenCalledWith(page);
    expect(text(res)).toContain('tok');
  });

  it('get_publish_status forwards to publishStatus', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({ name: 'get_publish_status', arguments: {} });
    expect(calls(client).publishStatus).toHaveBeenCalled();
  });

  it('list_stock_providers forwards to stockProviders', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({ name: 'list_stock_providers', arguments: {} });
    expect(calls(client).stockProviders).toHaveBeenCalled();
  });

  it('delete_page forwards to deleteContent(page, id) and reports the deletion', async () => {
    const client = fakeClient();
    const res = await (await connect(client, writeScope)).callTool({ name: 'delete_page', arguments: { id: 'home' } });
    expect(calls(client).deleteContent).toHaveBeenCalledWith('page', 'home');
    expect(text(res)).toContain('home');
  });

  it('delete_content forwards kind + id and reports the deletion', async () => {
    const client = fakeClient();
    const res = await (await connect(client, writeScope)).callTool({ name: 'delete_content', arguments: { kind: 'dataset', id: 'x' } });
    expect(calls(client).deleteContent).toHaveBeenCalledWith('dataset', 'x');
    expect(text(res)).toContain('dataset/x');
  });

  it('publish_project forwards to publish', async () => {
    const client = fakeClient();
    await (await connect(client, writeScope)).callTool({ name: 'publish_project', arguments: {} });
    expect(calls(client).publish).toHaveBeenCalled();
  });

  it('maps a generic Error (not a SitewrightApiError) to an MCP tool error', async () => {
    const client = fakeClient({ getContent: vi.fn(async () => { throw new Error('boom'); }) });
    const res = await (await connect(client, readScope)).callTool({ name: 'get_page', arguments: { id: 'home' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('Error: boom');
  });

  it('maps a non-Error throw to an "unknown error" tool error', async () => {
    const client = fakeClient({ getContent: vi.fn(async () => { throw 'nope'; }) });
    const res = await (await connect(client, readScope)).callTool({ name: 'get_page', arguments: { id: 'home' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('Error: unknown error');
  });

  it('list_submissions omits absent filters but forwards the ones provided', async () => {
    const none = fakeClient();
    await (await connect(none, readScope)).callTool({ name: 'list_submissions', arguments: {} });
    expect(calls(none).listSubmissions).toHaveBeenCalledWith({ formId: undefined, limit: undefined, offset: undefined });

    const all = fakeClient();
    await (await connect(all, readScope)).callTool({ name: 'list_submissions', arguments: { formId: 'c', limit: 1, offset: 2 } });
    expect(calls(all).listSubmissions).toHaveBeenCalledWith({ formId: 'c', limit: 1, offset: 2 });
  });
});

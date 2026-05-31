import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer } from '../src/server.js';
import { SitewrightApiError, type Scope, type SitewrightClient } from '../src/client.js';

const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };

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

const readScope: Scope = { orgId: 'o', projectId: 'p', role: 'member', capabilities: ['content:read'] };
const writeScope: Scope = { orgId: 'o', projectId: 'p', role: 'admin', capabilities: ['content:read', 'content:write', 'publish'] };

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

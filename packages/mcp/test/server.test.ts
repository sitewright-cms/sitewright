import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer } from '../src/server.js';
import { SitewrightApiError, type Scope, type SitewrightClient } from '../src/client.js';
import type { BridgeAuth } from '../src/auth.js';
import { MCP_TOOL_CATALOG, DEFAULT_AGENT_INSTRUCTIONS } from '@sitewright/schema';

const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } };

const ALL_CAPS: Scope = { projectId: 'p', role: 'admin', capabilities: ['content:read', 'content:write', 'publish'] };

function fakeClient(overrides: Partial<Record<keyof SitewrightClient, unknown>> = {}) {
  return {
    introspect: vi.fn(async () => ALL_CAPS),
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

function fakeAuth(overrides: Partial<BridgeAuth> = {}): BridgeAuth {
  return {
    interactive: true,
    token: async () => 'swk_x',
    forceRefresh: async () => null,
    beginLogin: async () => ({
      verificationUrl: 'https://cms.test/oauth/device',
      userCode: 'WXYZ-1234',
      expiresIn: 600,
      completion: Promise.resolve(),
    }),
    ...overrides,
  };
}

// scope may be null (the bridge boots unauthenticated until the agent runs `login`).
async function connect(client: SitewrightClient, scope: Scope | null, auth: BridgeAuth = fakeAuth()) {
  const server = createSitewrightMcpServer(client, { scope }, auth);
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

const text = (res: Awaited<ReturnType<Client['callTool']>>) => (res.content as Array<{ text: string }>)[0]!.text;
const callsOf = (c: SitewrightClient) => c as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('createSitewrightMcpServer — capability gating (call-time, not tool-hiding)', () => {
  it('advertises the FULL toolset regardless of capability — the API + the per-call gate enforce', async () => {
    const reader = await toolNames(await connect(fakeClient(), readScope));
    expect(reader).toContain('get_page');
    expect(reader).toContain('put_page'); // listed even for a read token…
    expect(reader).toContain('publish_project');
    expect(reader).toContain('login');
  });

  it('a read-only token gets a clear capability error when calling a write tool — and no client call', async () => {
    const client = fakeClient();
    const res = await (await connect(client, readScope)).callTool({ name: 'put_page', arguments: { page } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/content:write/);
    expect(callsOf(client).putContent).not.toHaveBeenCalled();
  });

  it('a write+publish token can call write + publish tools', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    expect((await mcp.callTool({ name: 'put_page', arguments: { page } })).isError).toBeFalsy();
    expect((await mcp.callTool({ name: 'publish_project', arguments: {} })).isError).toBeFalsy();
  });

  it('import_stock_image is gated on content:write; list/search stay read-capable', async () => {
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    expect((await r.callTool({ name: 'list_stock_providers', arguments: {} })).isError).toBeFalsy();
    const imp = await r.callTool({ name: 'import_stock_image', arguments: { provider: 'openverse', id: 'ov1' } });
    expect(imp.isError).toBe(true);
    expect(text(imp)).toMatch(/content:write/);
    expect(callsOf(reader).importStock).not.toHaveBeenCalled();
  });
});

describe('createSitewrightMcpServer — lazy auth', () => {
  it('boots unauthenticated: get_scope reports authenticated:false + a login hint', async () => {
    const res = await (await connect(fakeClient(), null)).callTool({ name: 'get_scope', arguments: {} });
    expect(text(res)).toContain('"authenticated": false');
    expect(text(res)).toMatch(/login/);
  });

  it('a content tool while unauthenticated returns "Not connected" without calling the client', async () => {
    const client = fakeClient();
    const res = await (await connect(client, null)).callTool({ name: 'list_pages', arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/not connected/i);
    expect(callsOf(client).listContent).not.toHaveBeenCalled();
  });

  it('login returns the verification URL + code and a keep-the-tab-open message', async () => {
    const begin = vi.fn(async () => ({ verificationUrl: 'https://cms.test/device', userCode: 'ABCD-1234', expiresIn: 600, completion: Promise.resolve() }));
    const res = await (await connect(fakeClient(), null, fakeAuth({ beginLogin: begin }))).callTool({ name: 'login', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('https://cms.test/device');
    expect(text(res)).toContain('ABCD-1234');
    expect(text(res)).toMatch(/keep that tab open/i);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('a second login while one is pending returns the SAME code (no duplicate grant)', async () => {
    let resolve: () => void = () => {};
    const begin = vi.fn(async () => ({ verificationUrl: 'u', userCode: 'AAAA-1111', expiresIn: 600, completion: new Promise<void>((r) => { resolve = r; }) }));
    const mcp = await connect(fakeClient(), null, fakeAuth({ beginLogin: begin }));
    const first = text(await mcp.callTool({ name: 'login', arguments: {} }));
    const second = text(await mcp.callTool({ name: 'login', arguments: {} }));
    expect(begin).toHaveBeenCalledTimes(1); // de-duplicated — only one device grant
    expect(first).toContain('AAAA-1111');
    expect(second).toContain('AAAA-1111');
    resolve(); // let the pending login settle so it doesn't leak
  });

  it('get_scope reports login_status: failed + last_error after a denied login', async () => {
    const begin = vi.fn(async () => ({ verificationUrl: 'u', userCode: 'c', expiresIn: 600, completion: Promise.reject(new Error('access_denied')) }));
    const mcp = await connect(fakeClient(), null, fakeAuth({ beginLogin: begin }));
    await mcp.callTool({ name: 'login', arguments: {} });
    await new Promise((r) => setTimeout(r, 0)); // let the rejection settle
    const scope = text(await mcp.callTool({ name: 'get_scope', arguments: {} }));
    expect(scope).toContain('"login_status": "failed"');
    expect(scope).toContain('access_denied');
  });

  it('after approval, login re-introspects so the agent becomes connected', async () => {
    const client = fakeClient({ introspect: vi.fn(async () => writeScope) });
    const mcp = await connect(client, null, fakeAuth({ beginLogin: async () => ({ verificationUrl: 'u', userCode: 'c', expiresIn: 600, completion: Promise.resolve() }) }));
    expect(text(await mcp.callTool({ name: 'get_scope', arguments: {} }))).toContain('"authenticated": false');
    await mcp.callTool({ name: 'login', arguments: {} });
    await new Promise((r) => setTimeout(r, 0)); // let the background introspect microtask run
    const after = text(await mcp.callTool({ name: 'get_scope', arguments: {} }));
    expect(after).toContain('"authenticated": true');
    expect(callsOf(client).introspect).toHaveBeenCalled();
  });

  it('switch_project starts a grant and returns a verification URL + a "pick a different project" message', async () => {
    const begin = vi.fn(async () => ({ verificationUrl: 'https://cms.test/dev2', userCode: 'SWCH-0001', expiresIn: 600, completion: Promise.resolve() }));
    const res = await (await connect(fakeClient(), writeScope, fakeAuth({ beginLogin: begin }))).callTool({ name: 'switch_project', arguments: {} });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(text(res)).toContain('"status": "awaiting_approval"');
    expect(text(res)).toContain('https://cms.test/dev2');
    expect(text(res)).toMatch(/pick the project to switch to/i);
  });

  it('login on a non-interactive (static-token) bridge reports that re-auth is unavailable', async () => {
    const res = await (await connect(fakeClient(), writeScope, fakeAuth({ interactive: false }))).callTool({ name: 'login', arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/fixed token/i);
  });
});

describe('createSitewrightMcpServer — catalog + instructions', () => {
  it('a connected token exposes EXACTLY the MCP_TOOL_CATALOG tools (no drift)', async () => {
    const names = await toolNames(await connect(fakeClient(), writeScope));
    expect(names).toEqual([...MCP_TOOL_CATALOG].map((t) => t.name).sort());
  });

  it('serves the admin agent-instructions override when present, else the built-in default', async () => {
    const custom = await connect(fakeClient(), { ...writeScope, agentInstructions: 'CUSTOM AGENT RULES' });
    expect(custom.getInstructions()).toBe('CUSTOM AGENT RULES');
    await custom.close();
    const dflt = await connect(fakeClient(), writeScope);
    expect(dflt.getInstructions()).toBe(DEFAULT_AGENT_INSTRUCTIONS);
    await dflt.close();
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

  it('instructions teach the multilingual INHERITANCE model (variants leave source/template unset)', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const instructions = mcp.getInstructions() ?? '';
    expect(instructions).toMatch(/INHERITANCE/);
    expect(instructions).toMatch(/translationGroup/);
    // The variant follows the default-locale page's code; it does NOT copy the source.
    expect(instructions).toMatch(/follows the DEFAULT-LOCALE page/i);
    expect(instructions).not.toMatch(/copy the `?source`?\)/i);
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

  it('instructions teach that the skeleton owns the semantic landmarks (no <nav>/<main>/<footer>/<aside> in content)', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const instructions = mcp.getInstructions() ?? '';
    expect(instructions).toContain('page-content'); // <main id="page-content">
    expect(instructions).toContain('top-nav'); // <nav id="top-nav">
    expect(instructions).toMatch(/must NOT use <nav>, <main>, <footer>, or\s+<aside>/i);
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

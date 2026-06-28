import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer } from '../src/server.js';
import { SitewrightApiError, type Scope, type SitewrightClient } from '../src/client.js';
import type { BridgeAuth } from '../src/auth.js';
import { MCP_TOOL_CATALOG, DEFAULT_AGENT_INSTRUCTIONS } from '@sitewright/schema';

const page = { id: 'home', path: '', title: 'Home' };

const ALL_CAPS: Scope = { projectId: 'p', role: 'admin', capabilities: ['content:read', 'content:write', 'publish'] };

function fakeClient(overrides: Partial<Record<keyof SitewrightClient, unknown>> = {}) {
  return {
    introspect: vi.fn(async () => ALL_CAPS),
    listContent: vi.fn(async () => [page]),
    getContent: vi.fn(async () => page),
    listRevisions: vi.fn(async () => [{ id: 'rev1', op: 'put', actor: 'user' }]),
    restoreRevision: vi.fn(async () => ({ id: 'home', title: 'Home' })),
    putContent: vi.fn(async (_k: string, _id: string, data: unknown) => data),
    deleteContent: vi.fn(async () => undefined),
    preview: vi.fn(async () => ({ html: '<html></html>', token: 'tok' })),
    compareToSource: vi.fn(async () => ({
      sourceUrl: 'https://orig.test/',
      route: '',
      sourceFrom: 'cache' as const,
      capturedAt: 1_700_000_000_000,
      build: { desktop: { base64: 'QUFB', mimeType: 'image/jpeg', width: 1280, height: 900 } },
      source: { desktop: { base64: 'QkJC', mimeType: 'image/jpeg', width: 1280, height: 900 } },
    })),
    publish: vi.fn(async () => ({ release: { routes: 1 }, url: '/sites/p/' })),
    publishStatus: vi.fn(async () => ({ release: null })),
    listSubmissions: vi.fn(async () => ({ items: [{ id: 's1', formId: 'contact', fields: { email: 'a@b.co' } }], total: 1 })),
    stockProviders: vi.fn(async () => ({ providers: [{ name: 'openverse', available: true, requiresKey: false }] })),
    stockSearch: vi.fn(async () => ({ provider: 'openverse', page: 1, results: [{ provider: 'openverse', id: 'ov1', author: 'Ann' }] })),
    importStock: vi.fn(async () => ({ id: 'asset1', url: '/media/p/asset1/x.jpg' })),
    listMedia: vi.fn(async () => ({ items: [{ id: 'm1', kind: 'image', url: '/media/p/m1/x.webp', alt: '' }] })),
    importImageUrl: vi.fn(async () => ({ id: 'm2', kind: 'image', url: '/media/p/m2/y.webp' })),
    listMediaFolders: vi.fn(async () => ({ items: [{ id: 'f1', path: 'Header Images' }] })),
    createMediaFolder: vi.fn(async () => ({ ok: true })),
    renameMediaFolder: vi.fn(async () => ({ ok: true })),
    updateMedia: vi.fn(async (_id: string, changes: unknown) => ({ id: 'm1', kind: 'image', url: '/media/p/m1/x.webp', ...(changes as object) })),
    deleteMedia: vi.fn(async () => ({ ok: true })),
    renameDataset: vi.fn(async () => ({ oldSlug: 'items', newSlug: 'features', cascaded: true, entriesUpdated: 2, pagesUpdated: 1, templatesUpdated: 0, referencesUpdated: 0 })),
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
// Deletes need the separate content:delete capability — writeScope above deliberately omits it.
const deleteScope: Scope = {
  projectId: 'p',
  role: 'admin',
  capabilities: ['content:read', 'content:write', 'content:delete', 'publish'],
};

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

  it('list_revisions is read-capable; restore_revision needs content:write and forwards', async () => {
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    expect((await r.callTool({ name: 'list_revisions', arguments: { kind: 'page', id: 'home' } })).isError).toBeFalsy();
    expect(callsOf(reader).listRevisions).toHaveBeenCalledWith('page', 'home');
    const denied = await r.callTool({ name: 'restore_revision', arguments: { kind: 'page', id: 'home', revisionId: 'rev1' } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(callsOf(reader).restoreRevision).not.toHaveBeenCalled();

    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    expect((await w.callTool({ name: 'restore_revision', arguments: { kind: 'page', id: 'home', revisionId: 'rev1' } })).isError).toBeFalsy();
    expect(callsOf(writer).restoreRevision).toHaveBeenCalledWith('page', 'home', 'rev1');
  });
});

describe('createSitewrightMcpServer — on-demand guides', () => {
  it('get_guide returns a topic how-to (no auth needed); unknown topic errors with the topic list', async () => {
    const mcp = await connect(fakeClient(), null);
    expect(await toolNames(mcp)).toContain('get_guide');
    // a real topic → the guide prose (distinctive phrase from that section)
    const shop = await mcp.callTool({ name: 'get_guide', arguments: { topic: 'shop' } });
    expect(shop.isError).toBeFalsy();
    expect(text(shop)).toContain('sw-add-to-cart');
    // case-insensitive
    expect(text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'EFFECTS' } }))).toContain('data-aos');
    // unknown topic → an error that lists the valid topics
    const bad = await mcp.callTool({ name: 'get_guide', arguments: { topic: 'nope' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('topics:');
  });

  it('get_reference returns the authoring vocabulary (no auth); a section filters it', async () => {
    const mcp = await connect(fakeClient(), null);
    expect(await toolNames(mcp)).toContain('get_reference');
    const all = JSON.parse(text(await mcp.callTool({ name: 'get_reference', arguments: {} }))) as {
      helpers: Array<{ name: string }>;
      directives: unknown[];
      bindings: unknown[];
      loops: unknown[];
    };
    expect(all.helpers.some((h) => h.name === 'sw-icon')).toBe(true);
    expect(all.directives.length).toBeGreaterThan(0);
    expect(all.bindings.length).toBeGreaterThan(0);
    expect(all.loops.length).toBeGreaterThan(0);
    const helpersOnly = JSON.parse(text(await mcp.callTool({ name: 'get_reference', arguments: { section: 'helpers' } }))) as Record<string, unknown>;
    expect(Object.keys(helpersOnly)).toEqual(['helpers']);
  });
});

describe('createSitewrightMcpServer — snippet authoring (was unreachable)', () => {
  it('snippet is a reachable generic content kind via put_content/get_content', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    const res = await mcp.callTool({
      name: 'put_content',
      arguments: { kind: 'snippet', id: 'cta', data: { id: 'cta', name: 'CTA', source: '<div>x</div>' } },
    });
    expect(res.isError).toBeFalsy();
    expect(callsOf(client).putContent).toHaveBeenCalledWith('snippet', 'cta', expect.anything());
  });
});

describe('createSitewrightMcpServer — media tools', () => {
  it('list_media is content:read; import_image is gated on content:write', async () => {
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    const list = await r.callTool({ name: 'list_media', arguments: {} });
    expect(list.isError).toBeFalsy();
    expect(callsOf(reader).listMedia).toHaveBeenCalled();
    // import_image needs content:write — a read token gets a clear capability error + no client call.
    const imp = await r.callTool({ name: 'import_image', arguments: { url: 'https://example.com/a.jpg' } });
    expect(imp.isError).toBe(true);
    expect(text(imp)).toMatch(/content:write/);
    expect(callsOf(reader).importImageUrl).not.toHaveBeenCalled();
  });

  it('import_image imports a public URL (folder forwarded) with a write token', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'import_image', arguments: { url: 'https://example.com/a.jpg', folder: 'team' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).importImageUrl).toHaveBeenCalledWith('https://example.com/a.jpg', 'team');
  });

  it('compare_to_source returns BUILD + SOURCE image blocks (content:read) + notes the cached source', async () => {
    const c = fakeClient();
    const r = await connect(c, readScope);
    const res = await r.callTool({ name: 'compare_to_source', arguments: { pageId: 'home' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(c).compareToSource).toHaveBeenCalledWith('home', undefined, undefined);
    const blocks = res.content as Array<{ type: string; text?: string }>;
    expect(blocks.filter((b) => b.type === 'image').length).toBe(2); // one build + one source shot
    expect(blocks[0]?.text).toMatch(/reference captured at import time/); // provenance surfaced
  });

  it('compare_to_source forwards refresh:true to re-snapshot the live source', async () => {
    const c = fakeClient();
    const r = await connect(c, readScope);
    await r.callTool({ name: 'compare_to_source', arguments: { pageId: 'home', refresh: true } });
    expect(callsOf(c).compareToSource).toHaveBeenCalledWith('home', undefined, true);
  });

  it('compare_to_source: gates, empty shots, and client errors', async () => {
    // not connected → login hint
    const nc = await connect(fakeClient(), null);
    expect((await nc.callTool({ name: 'compare_to_source', arguments: { pageId: 'home' } })).isError).toBe(true);
    // connected but lacking content:read → capability error
    const noRead = await connect(fakeClient(), { projectId: 'p', role: 'member', capabilities: ['publish'] });
    const r2 = await noRead.callTool({ name: 'compare_to_source', arguments: { pageId: 'home' } });
    expect(r2.isError).toBe(true);
    expect(text(r2)).toMatch(/content:read/);
    // no shots captured → a note, no image blocks
    const emptyC = fakeClient({ compareToSource: vi.fn(async () => ({ sourceUrl: 'x', route: '', build: {}, source: {} })) });
    const r3 = await (await connect(emptyC, readScope)).callTool({ name: 'compare_to_source', arguments: { pageId: 'home' } });
    expect(r3.isError).toBeFalsy();
    expect((r3.content as Array<{ type: string }>).some((b) => b.type === 'image')).toBe(false);
    // client throws → toolError
    const errC = fakeClient({ compareToSource: vi.fn(async () => { throw new SitewrightApiError(500, 'boom'); }) });
    const r4 = await (await connect(errC, readScope)).callTool({ name: 'compare_to_source', arguments: { pageId: 'home' } });
    expect(r4.isError).toBe(true);
  });

  it('list_media_folders is content:read', async () => {
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    const res = await r.callTool({ name: 'list_media_folders', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(callsOf(reader).listMediaFolders).toHaveBeenCalled();
  });

  it('create_media_folder / rename_media_folder / move_media need content:write', async () => {
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    for (const call of [
      { name: 'create_media_folder', arguments: { path: 'About/Gallery' } },
      { name: 'rename_media_folder', arguments: { from: 'About', to: 'Company' } },
      { name: 'move_media', arguments: { id: 'm1', folder: 'Main' } },
    ]) {
      const res = await r.callTool(call);
      expect(res.isError, call.name).toBe(true);
      expect(text(res)).toMatch(/content:write/);
    }
    expect(callsOf(reader).createMediaFolder).not.toHaveBeenCalled();
    expect(callsOf(reader).renameMediaFolder).not.toHaveBeenCalled();
    expect(callsOf(reader).updateMedia).not.toHaveBeenCalled();
  });

  it('create_media_folder + rename_media_folder forward their paths with a write token', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const c = await w.callTool({ name: 'create_media_folder', arguments: { path: 'About/Gallery' } });
    expect(c.isError).toBeFalsy();
    expect(callsOf(writer).createMediaFolder).toHaveBeenCalledWith('About/Gallery');
    const m = await w.callTool({ name: 'rename_media_folder', arguments: { from: 'About', to: 'Company' } });
    expect(m.isError).toBeFalsy();
    expect(callsOf(writer).renameMediaFolder).toHaveBeenCalledWith('About', 'Company');
  });

  it('move_media forwards only the provided changes (folder and/or filename)', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const moved = await w.callTool({ name: 'move_media', arguments: { id: 'm1', folder: 'Main' } });
    expect(moved.isError).toBeFalsy();
    expect(callsOf(writer).updateMedia).toHaveBeenCalledWith('m1', { folder: 'Main' });
    const renamed = await w.callTool({ name: 'move_media', arguments: { id: 'm1', filename: 'logo.svg' } });
    expect(renamed.isError).toBeFalsy();
    expect(callsOf(writer).updateMedia).toHaveBeenCalledWith('m1', { filename: 'logo.svg' });
  });

  it('delete_media needs content:delete (write alone is refused) and forwards the id with the scope', async () => {
    // A write-only token cannot delete media (content:delete is separate, opt-in).
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const refused = await w.callTool({ name: 'delete_media', arguments: { id: 'm1' } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/content:delete/);
    expect(callsOf(writer).deleteMedia).not.toHaveBeenCalled();
    // With content:delete it goes through.
    const deleter = fakeClient();
    const d = await connect(deleter, deleteScope);
    const ok = await d.callTool({ name: 'delete_media', arguments: { id: 'm1' } });
    expect(ok.isError).toBeFalsy();
    expect(callsOf(deleter).deleteMedia).toHaveBeenCalledWith('m1');
  });

  it('rename_dataset forwards (id, slug, cascade=true) with a write token', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'rename_dataset', arguments: { id: 'ds1', slug: 'features' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).renameDataset).toHaveBeenCalledWith('ds1', 'features', true);
    // read-only token is refused
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    expect((await r.callTool({ name: 'rename_dataset', arguments: { id: 'ds1', slug: 'features' } })).isError).toBe(true);
    expect(callsOf(reader).renameDataset).not.toHaveBeenCalled();
  });

  it('move_media errors (no client call) when neither folder nor filename is given', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'move_media', arguments: { id: 'm1' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/at least one/i);
    expect(callsOf(writer).updateMedia).not.toHaveBeenCalled();
  });

  it('move_media rejects an invalid folder segment (schema-validated input)', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'move_media', arguments: { id: 'm1', folder: 'bad/seg!' } });
    expect(res.isError).toBe(true);
    expect(callsOf(writer).updateMedia).not.toHaveBeenCalled();
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
    // Missing required fields (path/title) → the SDK validates inputSchema and
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

  it('the i18n guide teaches the multilingual INHERITANCE model (variants leave source/template unset)', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const i18n = text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'i18n' } }));
    expect(i18n).toMatch(/INHERITANCE/);
    expect(i18n).toMatch(/translationGroup/);
    // The variant follows the default-locale page's code; it does NOT copy the source.
    expect(i18n).toMatch(/follows the DEFAULT-LOCALE page/i);
    expect(i18n).not.toMatch(/copy the `?source`?\)/i);
    await mcp.close();
  });

  it('the effects guide teaches scroll-reveal animations via the standard data-aos vocabulary', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const effects = text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'effects' } }));
    expect(effects).toContain('data-aos="fade-up"');
    expect(effects).toContain('data-aos-delay');
    expect(effects).toContain('data-aos-once');
    // The platform ships its own runtime — agents must NOT add the library themselves.
    expect(effects).toMatch(/do NOT add the aos\s+package/i);
    expect(effects).toContain('prefers-reduced-motion');
    await mcp.close();
  });

  it('instructions teach that the skeleton owns the semantic landmarks (no <nav>/<main>/<footer>/<aside> in content)', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const instructions = mcp.getInstructions() ?? '';
    expect(instructions).toContain('page-content'); // <main id="page-content">
    expect(instructions).toContain('main-nav'); // <nav id="main-nav">
    expect(instructions).toMatch(/must NOT use <nav>, <main>, <footer>, or\s+<aside>/i);
    await mcp.close();
  });

  it('the images/effects/icons guides teach the lazyload, ripple, and icon vocabularies', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const g = async (topic: string) => text(await mcp.callTool({ name: 'get_guide', arguments: { topic } }));
    const images = await g('images');
    const effects = await g('effects');
    const icons = await g('icons');
    // Lazy-load (vanilla-lazyload vocabulary).
    expect(images).toMatch(/data-bg/);
    expect(images).toMatch(/class="lazyload"|lazyload/);
    expect(images).toMatch(/never add a lazy-load library/i);
    // Ripple (Waves vocabulary).
    expect(effects).toContain('waves-effect');
    expect(effects).toContain('waves-light');
    expect(effects).toMatch(/never add Waves\.js/i);
    // Icons.
    expect(icons).toContain('{{sw-icon "name"');
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

  it('preview_page requests a screenshot; with none it falls back to the HTML source', async () => {
    const client = fakeClient(); // fake preview returns { html, token } — no screenshots
    const res = await (await connect(client, readScope)).callTool({ name: 'preview_page', arguments: { page } });
    expect(calls(client).preview).toHaveBeenCalledWith(page, { screenshot: true });
    const texts = (res.content as Array<{ type: string; text?: string }>).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    expect(texts).toContain('Screenshots are unavailable'); // graceful fallback note
    expect(texts).toContain('<html></html>'); // the HTML source is still returned
  });

  it('preview_page returns the screenshots as image content blocks', async () => {
    const client = fakeClient({
      preview: vi.fn(async () => ({
        html: '<html></html>',
        token: 'tok',
        screenshots: {
          fullhd: { base64: 'AAAA', mimeType: 'image/jpeg', width: 1920, height: 2400 },
          mobile: { base64: 'BBBB', mimeType: 'image/jpeg', width: 390, height: 1800 },
        },
      })),
    });
    const res = await (await connect(client, readScope)).callTool({ name: 'preview_page', arguments: { page } });
    const images = (res.content as Array<{ type: string; data?: string; mimeType?: string }>).filter((c) => c.type === 'image');
    expect(images.map((i) => i.data)).toEqual(['AAAA', 'BBBB']);
    expect(images.every((i) => i.mimeType === 'image/jpeg')).toBe(true);
    // The HTML source is NOT dumped by default (the agent SEES it instead) — only on includeHtml.
    const texts = (res.content as Array<{ type: string; text?: string }>).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    expect(texts).not.toContain('<html></html>');
  });

  it('preview_page includes the HTML source when includeHtml is set (alongside the screenshots)', async () => {
    const client = fakeClient({
      preview: vi.fn(async () => ({
        html: '<html>SRC</html>',
        token: 'tok',
        screenshots: { desktop: { base64: 'AAAA', mimeType: 'image/jpeg', width: 1280, height: 2400 } },
      })),
    });
    const res = await (await connect(client, readScope)).callTool({ name: 'preview_page', arguments: { page, includeHtml: true } });
    expect((res.content as Array<{ type: string }>).some((c) => c.type === 'image')).toBe(true);
    const texts = (res.content as Array<{ type: string; text?: string }>).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    expect(texts).toContain('<html>SRC</html>');
  });

  it('preview_page reports a clear error when not connected, and surfaces API errors', async () => {
    // unauthenticated → actionable "not connected" message, no client call
    const offline = fakeClient();
    const offRes = await (await connect(offline, null)).callTool({ name: 'preview_page', arguments: { page } });
    expect(offRes.isError).toBe(true);
    expect(text(offRes)).toMatch(/not connected/i);
    expect(calls(offline).preview).not.toHaveBeenCalled();
    // API failure → surfaced as a tool error
    const boom = fakeClient({ preview: vi.fn(async () => { throw new SitewrightApiError(400, 'bad page'); }) });
    const errRes = await (await connect(boom, readScope)).callTool({ name: 'preview_page', arguments: { page } });
    expect(errRes.isError).toBe(true);
    expect(text(errRes)).toContain('bad page');
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
    const res = await (await connect(client, deleteScope)).callTool({ name: 'delete_page', arguments: { id: 'home' } });
    expect(calls(client).deleteContent).toHaveBeenCalledWith('page', 'home');
    expect(text(res)).toContain('home');
  });

  it('delete_content forwards kind + id and reports the deletion', async () => {
    const client = fakeClient();
    const res = await (await connect(client, deleteScope)).callTool({ name: 'delete_content', arguments: { kind: 'dataset', id: 'x' } });
    expect(calls(client).deleteContent).toHaveBeenCalledWith('dataset', 'x');
    expect(text(res)).toContain('dataset/x');
  });

  it('a content:write token (no content:delete) is refused delete tools — and no client call', async () => {
    for (const tool of [
      { name: 'delete_page', arguments: { id: 'home' } },
      { name: 'delete_content', arguments: { kind: 'dataset', id: 'x' } },
    ]) {
      const client = fakeClient();
      const res = await (await connect(client, writeScope)).callTool(tool);
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/content:delete/);
      expect(calls(client).deleteContent).not.toHaveBeenCalled();
    }
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

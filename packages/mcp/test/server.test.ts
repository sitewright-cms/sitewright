import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer, normalizePutData, parseJsonText, absolutizeInstanceUrls } from '../src/server.js';
import { SitewrightApiError, type Scope, type SitewrightClient } from '../src/client.js';
import type { BridgeAuth } from '../src/auth.js';
import { MCP_TOOL_CATALOG, DEFAULT_AGENT_INSTRUCTIONS, GUIDE_TOPICS, AGENT_GUIDES } from '@sitewright/schema';

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
    patchText: vi.fn(async (kind: string, id: string, field: string, edits: unknown[]) => ({ kind, id, field, edits: edits.length, replacements: edits.length, bytes: 1, bytesBefore: 1, changed: true, version: 'v' })),
    measureHeader: vi.fn(async (pageId: string) => ({ page: pageId, route: '/', widths: [390], rows: [], css: ':root{--sw-header-h:96px}', advice: [] })),
    deleteContent: vi.fn(async () => undefined),
    deleteContentBulk: vi.fn(async (_k: string, ids: readonly string[]) => ({ deleted: [...ids], failed: [], requested: ids.length })),
    addLocale: vi.fn(async (locale: string) => ({ locale, created: 3, pages: [] })),
    removeLocale: vi.fn(async (locale: string) => ({ locale, removed: 3 })),
    preview: vi.fn(async () => ({ html: '<html></html>', token: 'tok' })),
    inspectSource: vi.fn(async () => ({
      side: 'source' as const,
      url: 'https://orig.test/',
      sourceUrl: 'https://orig.test/',
      route: '',
      title: 'Original',
      viewport: { width: 1440, height: 900 },
      documentHeight: 4200,
      results: [
        { selector: '#main-nav a', count: 7, nodes: [{ tag: 'a', rect: { x: 294.4, y: 8, width: 82.7, height: 42.8, pageY: 8 }, styles: { 'font-size': '16px', padding: '11.2px 20.8px' } }] },
        { selector: '.missing', count: 0, nodes: [] },
        { selector: 'a[', count: -1, nodes: [] },
      ],
    })),
    compareToSource: vi.fn(async () => ({
      sourceUrl: 'https://orig.test/',
      route: '',
      sourceFrom: 'cache' as const,
      capturedAt: 1_700_000_000_000,
      build: { desktop: { base64: 'QUFB', mimeType: 'image/jpeg', width: 1280, height: 900 } },
      source: { desktop: { base64: 'QkJC', mimeType: 'image/jpeg', width: 1280, height: 900 } },
    })),
    fidelityCheck: vi.fn(async () => ({
      sourceUrl: 'https://orig.test/',
      route: '',
      pass: false,
      body: { pass: true, coverage: 0.9, matched: 9, orig: 10, fontMiss: 0, gradFail: 0, score: 0.05 },
      chrome: { pass: false, coverage: 0.8, matched: 8, orig: 10, posOff: 0, sizeOff: 0, styleOff: 2, metaOff: 1 },
      diffs: { body: [], chrome: ['(header) "Web Design": skew:25°→15°, weight:400→700'], meta: ['ripple:MISSING (original fires 8)'] },
    })),
    cloneAudit: vi.fn(async () => ({
      sourceUrl: 'https://orig.test/',
      route: '',
      pass: false,
      passed: 6,
      total: 7,
      checks: [
        { leg: 'structure' as const, id: 'datasets', label: 'datasets deduped + meaningfully named', pass: false, detail: '2 generic-named' },
        { leg: 'structure' as const, id: 'media-folders', label: 'media out of the transient imported/ tree', pass: true, detail: '0 under imported/' },
        { leg: 'structure' as const, id: 'editable', label: 'page content client-editable (data-sw-*)', pass: true, detail: '4 directives' },
        { leg: 'behaviour' as const, id: 'sliders', label: 'sliders actually enhance', pass: true, detail: '1/1' },
        { leg: 'behaviour' as const, id: 'modals', label: 'modals present', pass: true, detail: '1 dialog(s)' },
        { leg: 'behaviour' as const, id: 'fonts', label: 'heading + body fonts actually load', pass: true, detail: 'loaded' },
        { leg: 'behaviour' as const, id: 'mobile-menu', label: 'mobile menu reachable at phone width', pass: true, detail: '5/3' },
        { leg: 'visual' as const, id: 'chrome-fidelity', label: 'chrome computed-style fidelity vs original', pass: false, advisory: true, detail: 'coverage 30%' },
      ],
      fidelity: { sourceUrl: 'https://orig.test/', route: '', pass: false, body: { pass: true, coverage: 0.9, matched: 9, orig: 10, fontMiss: 0, gradFail: 0, score: 0.05 }, chrome: { pass: false, coverage: 0.3, matched: 3, orig: 10, posOff: 0, sizeOff: 0, styleOff: 5, metaOff: 2 }, diffs: { body: [], chrome: [], meta: [] } },
    })),
    visualAudit: vi.fn(async () => ({
      sourceUrl: 'https://orig.test/',
      route: '',
      rubric: 'For each region (header, hero, each section, footer) tag category + severity.',
      categories: ['layout', 'spacing', 'typography', 'color', 'image', 'component', 'content', 'chrome', 'responsive'],
      severities: ['blocker', 'major', 'minor'],
      source: {
        desktop: { base64: 'U1JDRA', mimeType: 'image/jpeg' as const, width: 1280, height: 900 },
        mobile: { base64: 'U1JDTQ', mimeType: 'image/jpeg' as const, width: 390, height: 844 },
      },
      build: {
        desktop: { base64: 'QkxERA', mimeType: 'image/jpeg' as const, width: 1280, height: 900 },
        mobile: { base64: 'QkxETQ', mimeType: 'image/jpeg' as const, width: 390, height: 844 },
      },
    })),
    pagespeedAudit: vi.fn(async () => ({
      url: 'http://127.0.0.1/',
      formFactor: 'mobile' as const,
      scores: { performance: 73, accessibility: 95, bestPractices: 100, seo: 100 },
      metrics: { firstContentfulPaintMs: 3304, largestContentfulPaintMs: 5427, totalBlockingTimeMs: 0, cumulativeLayoutShift: 0.05, speedIndexMs: 3000 },
      findings: [
        {
          id: 'render-blocking',
          title: 'Eliminate render-blocking resources',
          category: 'performance' as const,
          score: 0.2,
          displayValue: 'Est savings of 750 ms',
          overallSavingsBytes: 122880,
          items: [
            { url: '/_assets/b.js', totalBytes: 92160, wastedBytes: 92160, wastedMs: 450 },
            { label: 'a node' },
          ],
          moreItems: 3,
        },
        { id: 'color-contrast', title: 'Contrast ratio is too low', category: 'accessibility' as const, score: 0, overallSavingsMs: 120 },
      ],
      outline: {
        headings: [
          { level: 2, text: 'Section' },
          { level: 4, text: 'Deep', issue: 'Skips from H2 to H4 — don’t skip heading levels.' },
        ],
        issues: ['No H1 heading. Add a single, descriptive H1 as the page’s main title.'],
        truncated: 2,
      },
      lighthouseVersion: '13.4.0',
      fetchedAt: '2026-07-18T21:00:00.000Z',
    })),
    compareRegions: vi.fn(async () => ({
      sourceUrl: 'https://orig.test/',
      route: '',
      regions: {
        header: { build: { base64: 'QlVJTEQ', mimeType: 'image/webp' as const, width: 3840, height: 200 }, source: { base64: 'U1JD', mimeType: 'image/webp' as const, width: 3840, height: 200 } },
        footer: { build: { base64: 'RlRS', mimeType: 'image/webp' as const, width: 3840, height: 700 }, source: { base64: 'RlRS', mimeType: 'image/webp' as const, width: 3840, height: 700 } },
      },
    })),
    publish: vi.fn(async () => ({ release: { routes: 1 }, url: '/sites/p/' })),
    publishStatus: vi.fn(async () => ({ release: null })),
    listPreviewShares: vi.fn(async () => ({ defaultExpiryDays: 30, items: [] })),
    createPreviewShare: vi.fn(async () => ({ id: 'sh1', label: 'Client', url: '/preview-site/site/sh1-mac/' })),
    revokePreviewShare: vi.fn(async () => ({ ok: true })),
    listSubmissions: vi.fn(async () => ({ items: [{ id: 's1', formId: 'contact', fields: { email: 'a@b.co' } }], total: 1 })),
    siteStats: vi.fn(async () => ({ enabled: true, human: { views: 12, visitors: 5 }, botViews: 3 })),
    stockProviders: vi.fn(async () => ({ providers: [{ name: 'openverse', available: true, requiresKey: false }] })),
    stockSearch: vi.fn(async () => ({ provider: 'openverse', page: 1, results: [{ provider: 'openverse', id: 'ov1', author: 'Ann' }] })),
    importStock: vi.fn(async () => ({ id: 'asset1', url: '/media/p/asset1/x.jpg' })),
    importWebsite: vi.fn(async () => ({ ok: true, jobId: 'imp_1', status: 'running' })),
    importStatus: vi.fn(async () => ({ id: 'imp_1', url: 'https://x.test/', status: 'running', startedAt: Date.now() - 120_000, progress: ['crawl: 7 pages'] })),
    listMedia: vi.fn(async () => ({ items: [{ id: 'm1', kind: 'image', url: '/media/p/m1/x.webp', alt: '' }] })),
    importImageUrl: vi.fn(async () => ({ id: 'm2', kind: 'image', url: '/media/p/m2/y.webp' })),
    createMediaUpload: vi.fn(async () => ({ uploadUrl: 'https://sw.test/media-upload/tok-1', expiresInSeconds: 600, maxBytes: 209715200 })),
    uploadMediaBase64: vi.fn(async () => ({ id: 'm3', kind: 'image', url: '/media/p/m3/icon.svg' })),
    createMediaReplace: vi.fn(async () => ({ uploadUrl: 'https://sw.test/media-upload/tok-2', expiresInSeconds: 600, maxBytes: 209715200 })),
    replaceMediaBase64: vi.fn(async () => ({
      item: { id: 'm1', kind: 'image', url: '/media/p/m1/x.webp', width: 800, height: 800 },
      previous: { bytes: 4096, width: 1200, height: 800 },
      snapshotId: 'm9',
    })),
    listMediaFolders: vi.fn(async () => ({ items: [{ id: 'f1', path: 'Header Images' }] })),
    createMediaFolder: vi.fn(async () => ({ ok: true })),
    renameMediaFolder: vi.fn(async () => ({ ok: true })),
    updateMedia: vi.fn(async (_id: string, changes: unknown) => ({ id: 'm1', kind: 'image', url: '/media/p/m1/x.webp', ...(changes as object) })),
    deleteMedia: vi.fn(async () => ({ ok: true })),
    deleteMediaBulk: vi.fn(async (ids: readonly string[]) => ({ deleted: [...ids], failed: [], requested: ids.length })),
    setMediaAlt: vi.fn(async (items: ReadonlyArray<{ id: string }>) => ({ updated: items.map((i) => i.id), failed: [], requested: items.length })),
    selectGoogleFont: vi.fn(async (family: string) => ({ id: 'f1', kind: 'font', family, source: 'google', files: [{ weight: 400 }] })),
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

  it('accepts a JSON-STRINGIFIED page argument — same data, so do not refuse it', async () => {
    // Two clone agents independently hit this on their first large page write (~12.5KB): put_page
    // answered "page — Expected object, received string", which names the wrong cause entirely, and
    // the identical payload succeeded once split into put_page + patch_page. One lost a cycle to it,
    // the other worked around it for the whole job.
    const client = fakeClient();
    const mcp = await connect(client, writeScope);

    const res = await mcp.callTool({ name: 'put_page', arguments: { page: JSON.stringify(page) } });
    expect(res.isError).toBeFalsy();
    // it must reach the client as a real OBJECT, not a string
    expect(callsOf(client).putContent).toHaveBeenCalledWith('page', 'home', expect.objectContaining({ id: 'home', title: 'Home' }), expect.anything());

    // patch_page takes the same treatment
    expect((await mcp.callTool({ name: 'patch_page', arguments: { page: JSON.stringify({ id: 'home', title: 'X' }) } })).isError).toBeFalsy();
  });

  it('patch_text forwards the edits (a stringified array too) and refuses a field it cannot patch', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    const edits = [{ old: '<p>One</p>', new: '<p>Uno</p>' }, { old: 'a', new: 'b', all: true }];
    expect((await mcp.callTool({ name: 'patch_text', arguments: { kind: 'page', id: 'home', field: 'source', edits } })).isError).toBeFalsy();
    expect(callsOf(client).patchText).toHaveBeenLastCalledWith('page', 'home', 'source', edits);
    // A model that serialised the array sends the same data — parsed, not refused.
    const res = await mcp.callTool({ name: 'patch_text', arguments: { kind: 'settings', id: 'settings', field: 'website.footer', edits: JSON.stringify(edits) } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(client).patchText).toHaveBeenLastCalledWith('settings', 'settings', 'website.footer', edits);
    // Operator-only raw fields are not addressable, and an empty batch is meaningless.
    expect((await mcp.callTool({ name: 'patch_text', arguments: { kind: 'settings', id: 'settings', field: 'website.head', edits } })).isError).toBe(true);
    expect((await mcp.callTool({ name: 'patch_text', arguments: { kind: 'page', id: 'home', field: 'source', edits: [] } })).isError).toBe(true);
    expect(callsOf(client).patchText).toHaveBeenCalledTimes(2);
  });

  it('patch_text is a write: a read-only token is refused before any client call', async () => {
    const client = fakeClient();
    const res = await (await connect(client, readScope)).callTool({ name: 'patch_text', arguments: { kind: 'page', id: 'home', field: 'source', edits: [{ old: 'a', new: 'b' }] } });
    expect(res.isError).toBe(true);
    expect(callsOf(client).patchText).not.toHaveBeenCalled();
  });

  it('measure_header defaults to the home page and needs only content:read', async () => {
    const client = fakeClient();
    const res = await (await connect(client, readScope)).callTool({ name: 'measure_header', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(callsOf(client).measureHeader).toHaveBeenCalledWith('home');
    expect(text(res)).toContain('--sw-header-h:96px');
    await (await connect(client, readScope)).callTool({ name: 'measure_header', arguments: { pageId: 'about' } });
    expect(callsOf(client).measureHeader).toHaveBeenLastCalledWith('about');
  });

  it('a string that is not JSON is still rejected by the same schema', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    expect((await mcp.callTool({ name: 'put_page', arguments: { page: '{not json at all' } })).isError).toBeTruthy();
    expect((await mcp.callTool({ name: 'put_page', arguments: { page: 'home' } })).isError).toBeTruthy();
    expect(callsOf(client).putContent).not.toHaveBeenCalled();
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
    expect(callsOf(reader).listRevisions).toHaveBeenCalledWith('page', 'home', undefined);
    // An ENTRY forwards its owning dataset (its id is only unique per-dataset).
    await r.callTool({ name: 'list_revisions', arguments: { kind: 'entry', id: 'row_1', dataset: 'team' } });
    expect(callsOf(reader).listRevisions).toHaveBeenCalledWith('entry', 'row_1', 'team');
    const denied = await r.callTool({ name: 'restore_revision', arguments: { kind: 'page', id: 'home', revisionId: 'rev1' } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(callsOf(reader).restoreRevision).not.toHaveBeenCalled();

    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    expect((await w.callTool({ name: 'restore_revision', arguments: { kind: 'page', id: 'home', revisionId: 'rev1' } })).isError).toBeFalsy();
    expect(callsOf(writer).restoreRevision).toHaveBeenCalledWith('page', 'home', 'rev1', undefined);
    // An ENTRY forwards its owning dataset to restore the RIGHT one (its id repeats across datasets).
    await w.callTool({ name: 'restore_revision', arguments: { kind: 'entry', id: 'row_1', revisionId: 'rev1', dataset: 'team' } });
    expect(callsOf(writer).restoreRevision).toHaveBeenCalledWith('entry', 'row_1', 'rev1', 'team');
  });
});

describe('preview_page argument shape', () => {
  it('accepts a SAVED page by id alone — the shape its own description documents', async () => {
    // The description has promised `page:{id:"home"}` since the stored-page fallback landed, while the
    // schema still demanded `path` and `title` — so the documented call failed validation on first use.
    // Reported by a clone agent whose very first preview_page call errored.
    const mcp = await connect(fakeClient(), null);
    const res = await mcp.callTool({ name: 'preview_page', arguments: { page: { id: 'home' } } });
    // Not connected in this harness, so it fails on SCOPE, never on argument validation.
    expect(text(res)).not.toMatch(/required|invalid_type|Input validation/i);
  });

  it('still validates a FULL page properly rather than waving it through as a stub', async () => {
    const mcp = await connect(fakeClient(), null);
    const res = await mcp.callTool({ name: 'preview_page', arguments: { page: { id: 'home', title: 'No path' } } });
    expect(res.isError).toBe(true); // ambiguous: richer than a stub, incomplete as a page
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
    expect(text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'EFFECTS' } }))).toContain('data-sw-animation');
    // unknown topic → an error that lists the valid topics
    const bad = await mcp.callTool({ name: 'get_guide', arguments: { topic: 'nope' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('topics:');
    // NO topic → the index (success), so a model that omits the arg recovers instead of hard-failing
    const index = await mcp.callTool({ name: 'get_guide', arguments: {} });
    expect(index.isError).toBeFalsy();
    const parsed = JSON.parse(text(index)) as { topics: string[]; guides: Array<{ topic: string; title: string }> };
    expect(parsed.topics).toEqual([...GUIDE_TOPICS]);
    expect(parsed.guides.length).toBe(GUIDE_TOPICS.length);
  });

  it('a LONG guide answers with an overview + section index, not 54k characters', async () => {
    const mcp = await connect(fakeClient(), null);

    // Plain call: the overview and a menu, small enough not to overflow the tool-output cap. Before
    // this, every clone agent paid 54k characters here and at least once spilled it to a file.
    const plain = text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'import' } }));
    expect(plain.length).toBeLessThan(4_000);
    expect(plain).toContain('THIS GUIDE CONTINUES');
    expect(plain).toContain('get_guide({ topic: "import", section:');
    for (const key of ['pages', 'chrome', 'fidelity', 'verify', 'cleanup', 'all']) {
      expect(plain).toContain(`- ${key} (~`); // every section is reachable from the index
    }

    // A section returns its own prose and NOT the rest of the guide.
    const chrome = text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'import', section: 'chrome' } }));
    expect(chrome).toContain('website.criticalCss');
    expect(chrome).not.toContain('COMMON FIDELITY MISSES');
    expect(chrome.length).toBeLessThan(AGENT_GUIDES.import.body.length / 2);

    // "all" is the escape hatch back to the old behaviour.
    const all = text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'import', section: 'all' } }));
    expect(all).toContain('COMMON FIDELITY MISSES');
    expect(all).toContain('PORT CHECKLIST');

    // A near-miss is an error listing the real keys, never a silent fallback to the wrong prose.
    const bad = await mcp.callTool({ name: 'get_guide', arguments: { topic: 'import', section: 'chrom' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('sections:');

    // A short guide ignores sectioning entirely and still comes back whole.
    const shop = text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'shop' } }));
    expect(shop).toContain(AGENT_GUIDES.shop.body.trim());
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

  it('search_icons finds Phosphor names for one OR MANY terms (no auth); empty query errors', async () => {
    const mcp = await connect(fakeClient(), null);
    expect(await toolNames(mcp)).toContain('search_icons');
    const res = JSON.parse(text(await mcp.callTool({ name: 'search_icons', arguments: { query: 'settings, trash cog', limit: 5 } }))) as {
      results: Array<{ term: string; matches: string[] }>;
    };
    expect(res.results.map((g) => g.term)).toEqual(['settings', 'trash', 'cog']);
    expect(res.results[0]!.matches[0]).toBe('gear'); // "settings" → gear (alias)
    expect(res.results[0]!.matches.length).toBeLessThanOrEqual(5);
    expect(res.results[2]!.matches).toContain('gear'); // "cog" → gear via keyword synonym
    // Also exercise the no-limit path (default) so the handler's branches are fully covered.
    const dflt = JSON.parse(text(await mcp.callTool({ name: 'search_icons', arguments: { query: 'heart' } }))) as {
      results: Array<{ matches: string[] }>;
    };
    expect(dflt.results[0]!.matches).toContain('heart');
    // A whitespace-only query has no terms → the tool returns an error result.
    expect((await mcp.callTool({ name: 'search_icons', arguments: { query: '   ' } })).isError).toBe(true);
  });

  it('search_textures finds transparent overlays with ready-to-paste CSS (no auth); empty query errors', async () => {
    const mcp = await connect(fakeClient(), null);
    expect(await toolNames(mcp)).toContain('search_textures');
    const res = JSON.parse(text(await mcp.callTool({ name: 'search_textures', arguments: { query: 'paper, fabric', limit: 4 } }))) as {
      results: Array<{ term: string; matches: Array<{ name: string; css: string }> }>;
    };
    expect(res.results.map((g) => g.term)).toEqual(['paper', 'fabric']);
    expect(res.results[0]!.matches.length).toBeLessThanOrEqual(4);
    const first = res.results[0]!.matches[0]!;
    expect(first.name).toContain('paper');
    expect(first.css).toContain(`url("/authoring/textures/${first.name}.png")`);
    expect(first.css).toContain('var(--sw-color-primary)');
    // Default-limit path (branch coverage).
    const dflt = JSON.parse(text(await mcp.callTool({ name: 'search_textures', arguments: { query: 'noise' } }))) as {
      results: Array<{ matches: Array<{ name: string }> }>;
    };
    expect(dflt.results[0]!.matches.length).toBeGreaterThan(0);
    expect((await mcp.callTool({ name: 'search_textures', arguments: { query: '   ' } })).isError).toBe(true);
  });

  it('get_capabilities returns the capability index — components + guides + write kinds + need→tool map (no auth)', async () => {
    const mcp = await connect(fakeClient(), null);
    expect(await toolNames(mcp)).toContain('get_capabilities');
    const idx = JSON.parse(text(await mcp.callTool({ name: 'get_capabilities', arguments: {} }))) as {
      guides: Array<{ topic: string }>;
      components: Array<{ marker: string }>;
      writeKinds: Array<{ kind: string; shape: string }>;
      findByNeed: Array<{ need: string; where: string }>;
    };
    expect(idx.guides.some((g) => g.topic === 'datasets')).toBe(true);
    expect(idx.components.some((c) => c.marker === 'modal')).toBe(true);
    // the write shapes flag the entry `values` gotcha, and the need-map answers the wrongly-assumed-missing ones
    expect(idx.writeKinds.find((w) => w.kind === 'entry')?.shape).toMatch(/values/);
    expect(idx.findByNeed.some((n) => n.need.toLowerCase().includes('ripple'))).toBe(true);
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
    expect(callsOf(client).putContent).toHaveBeenCalledWith('snippet', 'cta', expect.anything(), { merge: undefined, receipt: true });
  });
});

// The recipes every guide names (get_content("snippet","nav-header")) live in the instance-wide global
// library, not in the project — so a project-scoped read 404'd. get_content falls back; list_content
// says where they are. Driven end to end over /mcp (both credential kinds) in apps/api mcp-http.test.ts.
describe('createSitewrightMcpServer — the global snippet/template library', () => {
  const notFound = () => Promise.reject(new SitewrightApiError(404, 'snippet not found'));

  it('get_content falls back to the global library for a snippet the project lacks, labelled read-only', async () => {
    const client = fakeClient({
      getContent: vi.fn(notFound),
      getGlobalContent: vi.fn(async () => ({ id: 'nav-header', name: 'nav-header', source: '<div>nav</div>' })),
    });
    const res = await (await connect(client, readScope)).callTool({ name: 'get_content', arguments: { kind: 'snippet', id: 'nav-header' } });
    expect(res.isError).toBeFalsy();
    const item = JSON.parse(text(res)) as { source: string; _global: { readOnly: boolean; note: string } };
    expect(item.source).toBe('<div>nav</div>');
    expect(item._global.readOnly).toBe(true);
    expect(item._global.note).toContain('put_content("snippet","nav-header",{ name:"nav-header", source })');
    expect(callsOf(client).getGlobalContent).toHaveBeenCalledWith('snippet', 'nav-header');
  });

  it('a global:<id> template reference goes straight to the library (there is no project row to try)', async () => {
    const client = fakeClient({ getGlobalContent: vi.fn(async () => ({ id: 'landing', name: 'Landing', source: 'x' })) });
    const mcp = await connect(client, readScope);
    const res = await mcp.callTool({ name: 'get_content', arguments: { kind: 'template', id: 'global:landing' } });
    expect(JSON.parse(text(res))._global.note).toContain('template:"global:landing"');
    expect(callsOf(client).getContent).not.toHaveBeenCalled();
    expect(callsOf(client).getGlobalContent).toHaveBeenCalledWith('template', 'landing');
    // …and one the library lacks is a plain 404 naming it.
    const none = fakeClient({ getGlobalContent: vi.fn(notFound) });
    const miss = await (await connect(none, readScope)).callTool({ name: 'get_content', arguments: { kind: 'template', id: 'global:nope' } });
    expect(miss.isError).toBe(true);
    expect(text(miss)).toBe('Error 404: no global template "nope"');
  });

  it('keeps the ORIGINAL error when the fallback cannot help — and never falls back for other kinds or statuses', async () => {
    // Not in the library either (or an older instance without the route): the project's own 404.
    const both = fakeClient({ getContent: vi.fn(notFound), getGlobalContent: vi.fn(notFound) });
    const res = await (await connect(both, readScope)).callTool({ name: 'get_content', arguments: { kind: 'snippet', id: 'x' } });
    expect(text(res)).toBe('Error 404: snippet not found');
    // A non-object answer is not a library entry.
    const odd = fakeClient({ getContent: vi.fn(notFound), getGlobalContent: vi.fn(async () => 'nope') });
    expect((await (await connect(odd, readScope)).callTool({ name: 'get_content', arguments: { kind: 'snippet', id: 'x' } })).isError).toBe(true);
    // A page is never looked up in the library; a 403 on a snippet is not a "missing" one.
    const page = fakeClient({ getContent: vi.fn(notFound), getGlobalContent: vi.fn() });
    await (await connect(page, readScope)).callTool({ name: 'get_content', arguments: { kind: 'page', id: 'x' } });
    const denied = fakeClient({ getContent: vi.fn(() => Promise.reject(new SitewrightApiError(403, 'forbidden'))), getGlobalContent: vi.fn() });
    expect(text(await (await connect(denied, readScope)).callTool({ name: 'get_content', arguments: { kind: 'snippet', id: 'x' } }))).toBe('Error 403: forbidden');
    expect(callsOf(page).getGlobalContent).not.toHaveBeenCalled();
    expect(callsOf(denied).getGlobalContent).not.toHaveBeenCalled();
    // A failure of the library read that is NOT a 404 is reported as itself, never as "not found".
    const limited = fakeClient({ getContent: vi.fn(notFound), getGlobalContent: vi.fn(() => Promise.reject(new SitewrightApiError(429, 'slow down'))) });
    expect(text(await (await connect(limited, readScope)).callTool({ name: 'get_content', arguments: { kind: 'snippet', id: 'x' } }))).toBe('Error 429: slow down');
  });

  // list_content keeps ONE shape — a plain array — for every kind. Its snippet/template result briefly
  // became `{ items, global }` whenever the extra library call succeeded and stayed an array when it
  // failed (a 429 from the shared agent bucket), so a caller could not rely on either. The recipes are
  // found through the tool DESCRIPTIONS instead, and read with get_content.
  it('list_content returns the plain project array for every kind, and the descriptions point at get_content', async () => {
    const client = fakeClient({ listContent: vi.fn(async () => [{ id: 'mine' }]), getGlobalContent: vi.fn() });
    const mcp = await connect(client, readScope);
    for (const kind of ['snippet', 'template', 'dataset']) {
      expect(JSON.parse(text(await mcp.callTool({ name: 'list_content', arguments: { kind } })))).toEqual([{ id: 'mine' }]);
    }
    expect(callsOf(client).getGlobalContent).not.toHaveBeenCalled(); // no hidden second request
    const old = fakeClient({ listContent: vi.fn(async () => []), getGlobalContent: vi.fn(notFound) });
    expect(JSON.parse(text(await (await connect(old, readScope)).callTool({ name: 'list_content', arguments: { kind: 'snippet' } })))).toEqual([]);

    const tools = (await mcp.listTools()).tools;
    const descOf = (name: string) => tools.find((t) => t.name === name)?.description ?? '';
    for (const recipe of ['nav-header', 'nav-footer', 'form-custom']) {
      expect(descOf('list_content')).toContain(recipe);
      expect(descOf('get_content')).toContain(recipe);
    }
    expect(descOf('list_content')).toContain('NOT listed here');
    expect(descOf('list_content')).toContain('get_content(kind, id)');
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
    expect(callsOf(writer).importImageUrl).toHaveBeenCalledWith('https://example.com/a.jpg', 'team', undefined);
  });

  it('import_image carries the alt the asset is born with — held to the stored bound', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'import_image', arguments: { url: 'https://example.com/a.jpg', alt: 'Fishing boats at dusk' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).importImageUrl).toHaveBeenCalledWith('https://example.com/a.jpg', undefined, 'Fishing boats at dusk');
    const tooLong = await w.callTool({ name: 'import_image', arguments: { url: 'https://example.com/b.jpg', alt: 'x'.repeat(501) } });
    expect(tooLong.isError).toBe(true);
    expect(callsOf(writer).importImageUrl).toHaveBeenCalledTimes(1);
  });

  it('create_media_upload mints a one-shot URL for a LOCAL file, gated on content:write', async () => {
    // The gap it fills: import_image takes a PUBLIC url the SERVER fetches, so a file on the agent's
    // own disk had no way in. The bytes deliberately do NOT travel through the tool call — as base64 a
    // 1MB image is ~370k tokens — so the tool hands back a URL the agent sends the file to itself.
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'create_media_upload', arguments: { folder: 'Logos' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).createMediaUpload).toHaveBeenCalledWith('Logos', {});
    // The agent needs the URL back to be able to do anything with it.
    expect(text(res)).toContain('https://sw.test/media-upload/tok-1');

    // A read token gets a capability error and the client is never called.
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    const denied = await r.callTool({ name: 'create_media_upload', arguments: {} });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(callsOf(reader).createMediaUpload).not.toHaveBeenCalled();
  });

  it('create_media_upload mints a BATCH with per-ticket alts and font metadata in one call', async () => {
    // 78 photos used to be 78 mint calls, and none of them could carry an alt.
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({
      name: 'create_media_upload',
      arguments: { folder: 'Gallery', count: 2, alts: ['Front door', 'Garden'] },
    });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).createMediaUpload).toHaveBeenCalledWith('Gallery', { count: 2, alts: ['Front door', 'Garden'] });

    await w.callTool({ name: 'create_media_upload', arguments: { alt: 'Logo', family: 'Inter', weight: 700, style: 'italic', fallback: 'serif' } });
    expect(callsOf(writer).createMediaUpload).toHaveBeenLastCalledWith(undefined, {
      alt: 'Logo',
      family: 'Inter',
      weight: 700,
      style: 'italic',
      fallback: 'serif',
    });

    // The bounds hold at the schema, before the API is asked.
    expect((await w.callTool({ name: 'create_media_upload', arguments: { count: 51 } })).isError).toBe(true);
    expect((await w.callTool({ name: 'create_media_upload', arguments: { weight: 450 } })).isError).toBe(true);
    expect(callsOf(writer).createMediaUpload).toHaveBeenCalledTimes(2);
  });

  it('upload_media carries alt and font metadata through to the ticket', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const b64 = Buffer.from('wOF2x').toString('base64');
    const res = await w.callTool({ name: 'upload_media', arguments: { filename: 'Inter-Bold.woff2', content_base64: b64, family: 'Inter', weight: 700 } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).uploadMediaBase64).toHaveBeenCalledWith('Inter-Bold.woff2', b64, undefined, { family: 'Inter', weight: 700 });
  });

  it('upload_media sends a SMALL file inline, gated on content:write', async () => {
    // The one-call path, for when there is no shell and the file is small enough that its base64 does
    // not dominate the conversation.
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const b64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const res = await w.callTool({ name: 'upload_media', arguments: { filename: 'icon.svg', content_base64: b64, folder: 'Icons' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).uploadMediaBase64).toHaveBeenCalledWith('icon.svg', b64, 'Icons', {});

    const reader = fakeClient();
    const r = await connect(reader, readScope);
    const denied = await r.callTool({ name: 'upload_media', arguments: { filename: 'a.svg', content_base64: b64 } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(callsOf(reader).uploadMediaBase64).not.toHaveBeenCalled();
  });

  it('replace_media overwrites in place and hands back the PREVIOUS dimensions, gated on content:write', async () => {
    // The receipt is the whole point of the tool over upload_media: the id and URL do not move, so an
    // agent gets no other signal that the asset it just swapped is now a different shape — and every
    // page referencing it will reflow.
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const b64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const res = await w.callTool({ name: 'replace_media', arguments: { id: 'm1', filename: 'x.webp', content_base64: b64 } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).replaceMediaBase64).toHaveBeenCalledWith('m1', 'x.webp', b64);
    expect(text(res)).toContain('1200'); // the previous width reaches the agent
    expect(text(res)).toContain('m9'); // …as does the snapshot it can restore to undo

    const reader = fakeClient();
    const r = await connect(reader, readScope);
    const denied = await r.callTool({ name: 'replace_media', arguments: { id: 'm1', filename: 'x.webp', content_base64: b64 } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(callsOf(reader).replaceMediaBase64).not.toHaveBeenCalled();
  });

  it('create_media_replace mints a ticket pinned to ONE asset, gated on content:write', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'create_media_replace', arguments: { id: 'm1' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).createMediaReplace).toHaveBeenCalledWith('m1');
    expect(text(res)).toContain('https://sw.test/media-upload/tok-2');

    const reader = fakeClient();
    const r = await connect(reader, readScope);
    const denied = await r.callTool({ name: 'create_media_replace', arguments: { id: 'm1' } });
    expect(denied.isError).toBe(true);
    expect(callsOf(reader).createMediaReplace).not.toHaveBeenCalled();
  });

  it('★ upload_media REFUSES an oversized payload at the schema, before it is ever decoded', async () => {
    // The cap is about the CONVERSATION, so it belongs on the argument: a 1MB image is ~370k tokens of
    // base64. Rejecting at the schema means the tool never buffers what it is about to refuse.
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const tooBig = 'A'.repeat(400 * 1024);
    const res = await w.callTool({ name: 'upload_media', arguments: { filename: 'big.png', content_base64: tooBig } });
    expect(res.isError).toBe(true);
    expect(callsOf(writer).uploadMediaBase64).not.toHaveBeenCalled();
  });

  it('the two upload tools TELL the agent which to reach for', async () => {
    // Two tools for one job only works if each says when it is the wrong one.
    const c = fakeClient();
    const w = await connect(c, writeScope);
    const tools = await w.listTools();
    const inline = tools.tools.find((t) => t.name === 'upload_media')!;
    const ticket = tools.tools.find((t) => t.name === 'create_media_upload')!;
    expect(inline.description).toMatch(/create_media_upload/);   // "bigger than this? use that one"
    expect(inline.description).toMatch(/256 KB/);                 // …and where the line is
    expect(ticket.description).toMatch(/curl -T/);                // how to actually send the bytes
    expect(ticket.description).toMatch(/filename=/);              // the part that is easy to forget
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

  it('fidelity_check returns measured PASS/FAIL numbers + diffs (content:read)', async () => {
    const r = await connect(fakeClient(), readScope);
    const res = await r.callTool({ name: 'fidelity_check', arguments: { pageId: 'about' } });
    expect(res.isError).toBeFalsy();
    const t = text(res);
    expect(t).toMatch(/FIDELITY FAIL/);
    expect(t).toMatch(/BODY\s+pass/);
    expect(t).toMatch(/CHROME FAIL/);
    expect(t).toMatch(/skew:25°→15°/); // the chrome diff is surfaced verbatim
    expect(t).toMatch(/ripple:MISSING/); // the meta diff too
    expect(t).toMatch(/NOT faithful yet/); // the fail guidance
  });

  it('fidelity_check reports a clean PASS when the gate passes', async () => {
    const passC = fakeClient({ fidelityCheck: vi.fn(async () => ({ sourceUrl: 'x', route: '', pass: true, body: { pass: true, coverage: 1, matched: 5, orig: 5, fontMiss: 0, gradFail: 0, score: 0 }, chrome: { pass: true, coverage: 1, matched: 5, orig: 5, posOff: 0, sizeOff: 0, styleOff: 0, metaOff: 0 }, diffs: { body: [], chrome: [], meta: [] } })) });
    const res = await (await connect(passC, readScope)).callTool({ name: 'fidelity_check', arguments: { pageId: 'home' } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/FIDELITY PASS ✓/);
    expect(text(res)).not.toMatch(/NOT faithful/);
  });

  it('clone_audit returns the three-leg scorecard + fail guidance (content:read)', async () => {
    const res = await (await connect(fakeClient(), readScope)).callTool({ name: 'clone_audit', arguments: { pageId: 'home' } });
    expect(res.isError).toBeFalsy();
    const t = text(res);
    expect(t).toMatch(/CLONE AUDIT FAIL ✗ — 6\/7 gating/);
    expect(t).toMatch(/\[STRUCTURE\]/);
    expect(t).toMatch(/\[BEHAVIOUR\]/);
    expect(t).toMatch(/\[VISUAL\]/);
    expect(t).toMatch(/FAIL {2}datasets deduped/); // a failing check surfaces its detail
    expect(t).toMatch(/advisory {2}chrome computed-style/); // the advisory chrome line is labelled "advisory", NOT "FAIL"
    expect(t).not.toMatch(/FAIL {2}chrome computed-style/);
    expect(t).toMatch(/NOT done/); // fail guidance
  });

  it('clone_audit is DONE when every GATING check passes even though the advisory chrome check fails', async () => {
    const advC = fakeClient({ cloneAudit: vi.fn(async () => ({
      sourceUrl: 'x', route: '', pass: true, passed: 8, total: 8,
      checks: [
        { leg: 'structure' as const, id: 'datasets', label: 'datasets deduped + meaningfully named', pass: true, detail: 'ok' },
        { leg: 'visual' as const, id: 'body-fidelity', label: 'body computed-style fidelity vs original', pass: true, detail: 'coverage 90%' },
        { leg: 'visual' as const, id: 'chrome-fidelity', label: 'chrome computed-style fidelity vs original', pass: false, advisory: true, detail: 'coverage 33%' },
      ],
      fidelity: { sourceUrl: 'x', route: '', pass: false, body: { pass: true, coverage: 0.9, matched: 9, orig: 10, fontMiss: 0, gradFail: 0, score: 0 }, chrome: { pass: false, coverage: 0.33, matched: 3, orig: 10, posOff: 0, sizeOff: 0, styleOff: 8, metaOff: 2 }, diffs: { body: [], chrome: [], meta: [] } },
    })) });
    const t = text(await (await connect(advC, readScope)).callTool({ name: 'clone_audit', arguments: { pageId: 'home' } }));
    expect(t).toMatch(/CLONE AUDIT PASS ✓/);
    expect(t).toMatch(/advisory {2}chrome computed-style/); // still reported, just not gating
    expect(t).toMatch(/NECESSARY, NOT SUFFICIENT/); // clone_audit pass alone is not "done" — visual_audit must be zero
    expect(t).toMatch(/visual_audit/);
    expect(t).not.toMatch(/NOT done/);
  });

  it('clone_audit reports a clean PASS when every leg is green', async () => {
    const passC = fakeClient({ cloneAudit: vi.fn(async () => ({ sourceUrl: 'x', route: '', pass: true, passed: 8, total: 8, checks: [{ leg: 'structure' as const, id: 'datasets', label: 'datasets deduped + meaningfully named', pass: true, detail: 'ok' }], fidelity: { sourceUrl: 'x', route: '', pass: true, body: { pass: true, coverage: 1, matched: 5, orig: 5, fontMiss: 0, gradFail: 0, score: 0 }, chrome: { pass: true, coverage: 1, matched: 5, orig: 5, posOff: 0, sizeOff: 0, styleOff: 0, metaOff: 0 }, diffs: { body: [], chrome: [], meta: [] } } })) });
    const res = await (await connect(passC, readScope)).callTool({ name: 'clone_audit', arguments: { pageId: 'home' } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/CLONE AUDIT PASS ✓/);
    expect(text(res)).not.toMatch(/NOT done/);
  });

  it('clone_audit: gates on login + content:read', async () => {
    expect((await (await connect(fakeClient(), null)).callTool({ name: 'clone_audit', arguments: { pageId: 'home' } })).isError).toBe(true);
    const noRead = await connect(fakeClient(), { projectId: 'p', role: 'member', capabilities: ['publish'] });
    expect((await noRead.callTool({ name: 'clone_audit', arguments: { pageId: 'home' } })).isError).toBe(true);
  });

  it('fidelity_check: gates on login + content:read, and surfaces client errors', async () => {
    expect((await (await connect(fakeClient(), null)).callTool({ name: 'fidelity_check', arguments: { pageId: 'home' } })).isError).toBe(true);
    const noRead = await connect(fakeClient(), { projectId: 'p', role: 'member', capabilities: ['publish'] });
    const r2 = await noRead.callTool({ name: 'fidelity_check', arguments: { pageId: 'home' } });
    expect(r2.isError).toBe(true);
    expect(text(r2)).toMatch(/content:read/);
    const errC = fakeClient({ fidelityCheck: vi.fn(async () => { throw new SitewrightApiError(400, 'no source'); }) });
    const r3 = await (await connect(errC, readScope)).callTool({ name: 'fidelity_check', arguments: { pageId: 'home' } });
    expect(r3.isError).toBe(true);
    expect(text(r3)).toMatch(/no source/);
  });

  it('compare_regions returns high-res BUILD + ORIGINAL image blocks per region (content:read)', async () => {
    const r = await connect(fakeClient(), readScope);
    const res = await r.callTool({ name: 'compare_regions', arguments: { pageId: 'about' } });
    expect(res.isError).toBeFalsy();
    const imgs = (res.content as Array<{ type: string; mimeType?: string }>).filter((b) => b.type === 'image');
    expect(imgs).toHaveLength(4); // header build+source, footer build+source
    expect(imgs.every((b) => b.mimeType === 'image/webp')).toBe(true);
    expect(text(res)).toMatch(/HIGH-RES chrome compare/);
  });

  it('visual_audit returns the rubric + side-by-side ORIGINAL/CLONE screenshots (content:read)', async () => {
    const res = await (await connect(fakeClient(), readScope)).callTool({ name: 'visual_audit', arguments: { pageId: 'home' } });
    expect(res.isError).toBeFalsy();
    const blocks = res.content as Array<{ type: string; text?: string; mimeType?: string }>;
    const imgs = blocks.filter((b) => b.type === 'image');
    expect(imgs).toHaveLength(4); // desktop + mobile, each ORIGINAL then CLONE
    expect(imgs.every((b) => b.mimeType === 'image/jpeg')).toBe(true);
    expect(text(res)).toMatch(/VISUAL AUDIT/);
    expect(blocks.some((b) => b.text?.includes('ORIGINAL'))).toBe(true);
    expect(blocks.some((b) => b.text?.includes('YOUR CLONE'))).toBe(true);
  });

  it('visual_audit reports when no screenshots could be captured', async () => {
    const emptyC = fakeClient({ visualAudit: vi.fn(async () => ({ sourceUrl: 'x', route: '', rubric: 'r', categories: [], severities: [], source: {}, build: {} })) });
    const res = await (await connect(emptyC, readScope)).callTool({ name: 'visual_audit', arguments: { pageId: 'home' } });
    expect(res.isError).toBeFalsy();
    expect((res.content as Array<{ type: string }>).some((b) => b.type === 'image')).toBe(false);
    // The message must NOT assert a cause it has not checked. It used to read "no Chromium on this
    // server, or neither side rendered" — two causes with opposite remedies, and an agent that had just
    // received a screenshot from another tool still read it as "this server cannot capture" and stopped.
    expect(JSON.stringify(res.content)).toMatch(/No screenshots came back for either side/);
    expect(JSON.stringify(res.content)).not.toMatch(/no Chromium/);
  });

  it('visual_audit: gates on login + content:read, and surfaces client errors', async () => {
    expect((await (await connect(fakeClient(), null)).callTool({ name: 'visual_audit', arguments: { pageId: 'home' } })).isError).toBe(true);
    const noRead = await connect(fakeClient(), { projectId: 'p', role: 'member', capabilities: ['publish'] });
    const noReadRes = await noRead.callTool({ name: 'visual_audit', arguments: { pageId: 'home' } });
    expect(noReadRes.isError).toBe(true);
    expect(text(noReadRes)).toMatch(/content:read/);
    const apiErr = fakeClient({ visualAudit: vi.fn(async () => { throw new SitewrightApiError(404, 'no import source'); }) });
    const r2 = await (await connect(apiErr, readScope)).callTool({ name: 'visual_audit', arguments: { pageId: 'home' } });
    expect(r2.isError).toBe(true);
    expect(text(r2)).toMatch(/no import source/);
    const genErr = fakeClient({ visualAudit: vi.fn(async () => { throw new Error('render crashed'); }) });
    const r3 = await (await connect(genErr, readScope)).callTool({ name: 'visual_audit', arguments: { pageId: 'home' } });
    expect(r3.isError).toBe(true);
    expect(text(r3)).toMatch(/render crashed/);
  });

  it('clone_audit + compare_regions surface client errors', async () => {
    const caErr = fakeClient({ cloneAudit: vi.fn(async () => { throw new SitewrightApiError(400, 'no source'); }) });
    const r1 = await (await connect(caErr, readScope)).callTool({ name: 'clone_audit', arguments: { pageId: 'home' } });
    expect(r1.isError).toBe(true);
    expect(text(r1)).toMatch(/no source/);
    const crErr = fakeClient({ compareRegions: vi.fn(async () => { throw new Error('crop failed'); }) });
    const r2 = await (await connect(crErr, readScope)).callTool({ name: 'compare_regions', arguments: { pageId: 'home' } });
    expect(r2.isError).toBe(true);
    expect(text(r2)).toMatch(/crop failed/);
  });

  it('exposes the clone_site workflow as a pre-defined prompt', async () => {
    const mcp = await connect(fakeClient(), readScope);
    const list = await mcp.listPrompts();
    expect(list.prompts.some((p) => p.name === 'clone_site')).toBe(true);
    const got = await mcp.getPrompt({ name: 'clone_site' });
    expect(JSON.stringify(got.messages)).toMatch(/Clone this imported website/);
  });

  it('compare_regions: gates on login + content:read, empty regions note, and client errors', async () => {
    expect((await (await connect(fakeClient(), null)).callTool({ name: 'compare_regions', arguments: { pageId: 'home' } })).isError).toBe(true);
    const noRead = await connect(fakeClient(), { projectId: 'p', role: 'member', capabilities: ['publish'] });
    expect((await noRead.callTool({ name: 'compare_regions', arguments: { pageId: 'home' } })).isError).toBe(true);
    // no crops captured → a note, no image blocks
    const emptyC = fakeClient({ compareRegions: vi.fn(async () => ({ sourceUrl: 'x', route: '', regions: {} })) });
    const r2 = await (await connect(emptyC, readScope)).callTool({ name: 'compare_regions', arguments: { pageId: 'home' } });
    expect(r2.isError).toBeFalsy();
    expect((r2.content as Array<{ type: string }>).some((b) => b.type === 'image')).toBe(false);
    const errC = fakeClient({ compareRegions: vi.fn(async () => { throw new SitewrightApiError(400, 'no source'); }) });
    expect((await (await connect(errC, readScope)).callTool({ name: 'compare_regions', arguments: { pageId: 'home' } })).isError).toBe(true);
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

  it('delete_media_bulk needs content:delete and forwards the whole id list, returning the per-id result', async () => {
    const writer = fakeClient();
    const refused = await (await connect(writer, writeScope)).callTool({ name: 'delete_media_bulk', arguments: { ids: ['m1', 'm2'] } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/content:delete/);
    expect(callsOf(writer).deleteMediaBulk).not.toHaveBeenCalled();

    const deleter = fakeClient({
      deleteMediaBulk: vi.fn(async () => ({ deleted: ['m1'], failed: [{ id: 'm2', error: 'media not found' }], requested: 2 })),
    });
    const res = await (await connect(deleter, deleteScope)).callTool({ name: 'delete_media_bulk', arguments: { ids: ['m1', 'm2'] } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(deleter).deleteMediaBulk).toHaveBeenCalledWith(['m1', 'm2']);
    // The id that did NOT go reaches the agent — a partial result is never reported as a clean sweep.
    expect(text(res)).toContain('"requested": 2');
    expect(text(res)).toContain('media not found');
  });

  it('delete_media_bulk takes at most 200 non-empty ids, the server cap, and refuses more before any request', async () => {
    const deleter = fakeClient();
    const d = await connect(deleter, deleteScope);
    const ids = Array.from({ length: 201 }, (_, i) => `m${i}`);
    const res = await d.callTool({ name: 'delete_media_bulk', arguments: { ids } });
    expect(res.isError).toBe(true);
    expect(callsOf(deleter).deleteMediaBulk).not.toHaveBeenCalled();
    // An empty id is refused here too, rather than reaching the route and failing the whole batch.
    expect((await d.callTool({ name: 'delete_media_bulk', arguments: { ids: ['m1', ''] } })).isError).toBe(true);
    expect(callsOf(deleter).deleteMediaBulk).not.toHaveBeenCalled();
    expect((await d.callTool({ name: 'delete_media_bulk', arguments: { ids: ids.slice(0, 200) } })).isError).toBeFalsy();
  });

  it('rename_dataset forwards (id, slug, name, cascade=true) with a write token', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'rename_dataset', arguments: { id: 'ds1', slug: 'features', name: 'Features' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).renameDataset).toHaveBeenCalledWith('ds1', 'features', 'Features', true);
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

  it('move_media sets alt text too — alone or with a move — and "" clears it', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    expect((await w.callTool({ name: 'move_media', arguments: { id: 'm1', alt: 'The team at work' } })).isError).toBeFalsy();
    expect(callsOf(writer).updateMedia).toHaveBeenLastCalledWith('m1', { alt: 'The team at work' });
    await w.callTool({ name: 'move_media', arguments: { id: 'm1', folder: 'Team', alt: '' } });
    expect(callsOf(writer).updateMedia).toHaveBeenLastCalledWith('m1', { folder: 'Team', alt: '' });
    // The nothing-to-do message names alt as an option now.
    const none = await w.callTool({ name: 'move_media', arguments: { id: 'm1' } });
    expect(text(none)).toMatch(/alt/);
    expect((await w.callTool({ name: 'move_media', arguments: { id: 'm1', alt: 'x'.repeat(501) } })).isError).toBe(true);
  });

  it('set_media_alt describes MANY assets in one call and returns the per-id result', async () => {
    const reader = fakeClient();
    const denied = await (await connect(reader, readScope)).callTool({ name: 'set_media_alt', arguments: { items: [{ id: 'm1', alt: 'x' }] } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/content:write/);
    expect(callsOf(reader).setMediaAlt).not.toHaveBeenCalled();

    const writer = fakeClient({
      setMediaAlt: vi.fn(async () => ({ updated: ['m1'], failed: [{ id: 'm2', error: 'media not found' }], requested: 2 })),
    });
    const w = await connect(writer, writeScope);
    const items = [
      { id: 'm1', alt: 'Front door' },
      { id: 'm2', alt: 'Garden path' },
    ];
    const res = await w.callTool({ name: 'set_media_alt', arguments: { items } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).setMediaAlt).toHaveBeenCalledWith(items);
    expect(text(res)).toContain('media not found'); // a partial result reaches the agent
  });

  it('set_media_alt holds the server bounds at the schema (1-200 items, alt ≤ 500)', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    expect((await w.callTool({ name: 'set_media_alt', arguments: { items: [] } })).isError).toBe(true);
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, alt: 'x' }));
    expect((await w.callTool({ name: 'set_media_alt', arguments: { items: tooMany } })).isError).toBe(true);
    expect((await w.callTool({ name: 'set_media_alt', arguments: { items: [{ id: 'm1', alt: 'x'.repeat(501) }] } })).isError).toBe(true);
    expect(callsOf(writer).setMediaAlt).not.toHaveBeenCalled();
  });

  it('set_font_metadata corrects a font through the media PATCH, and needs something to change', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'set_font_metadata', arguments: { id: 'f1', family: 'Inter', weight: 700, face: 'inter-bold-400.woff2' } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).updateMedia).toHaveBeenCalledWith('f1', { family: 'Inter', weight: 700, face: 'inter-bold-400.woff2' });

    await w.callTool({ name: 'set_font_metadata', arguments: { id: 'f1', style: 'italic', fallback: 'serif' } });
    expect(callsOf(writer).updateMedia).toHaveBeenLastCalledWith('f1', { style: 'italic', fallback: 'serif' });

    const none = await w.callTool({ name: 'set_font_metadata', arguments: { id: 'f1', face: 'inter-400.woff2' } });
    expect(none.isError).toBe(true);
    expect(text(none)).toMatch(/at least one/i);
    expect((await w.callTool({ name: 'set_font_metadata', arguments: { id: 'f1', weight: 450 } })).isError).toBe(true);
    expect(callsOf(writer).updateMedia).toHaveBeenCalledTimes(2);

    const reader = fakeClient();
    expect((await (await connect(reader, readScope)).callTool({ name: 'set_font_metadata', arguments: { id: 'f1', weight: 700 } })).isError).toBe(true);
    expect(callsOf(reader).updateMedia).not.toHaveBeenCalled();
  });

  it('select_google_font self-hosts a catalog family and returns the asset to reference', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    const res = await w.callTool({ name: 'select_google_font', arguments: { family: 'Inter', weights: [400, 700] } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(writer).selectGoogleFont).toHaveBeenCalledWith('Inter', [400, 700], undefined);
    expect(text(res)).toContain('"source": "google"');

    await w.callTool({ name: 'select_google_font', arguments: { family: 'Inter', weights: [400], folder: 'Brand' } });
    expect(callsOf(writer).selectGoogleFont).toHaveBeenLastCalledWith('Inter', [400], 'Brand');
  });

  it('select_google_font fixes the CASE of a family, since the server allowlist is exact', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    expect((await w.callTool({ name: 'select_google_font', arguments: { family: 'playfair display', weights: [700] } })).isError).toBeFalsy();
    expect(callsOf(writer).selectGoogleFont).toHaveBeenCalledWith('Playfair Display', [700], undefined);
  });

  it('select_google_font answers a wrong family with catalog suggestions, without asking the server', async () => {
    const writer = fakeClient();
    const w = await connect(writer, writeScope);
    // The usual miss: a style word glued onto the family.
    const res = await w.callTool({ name: 'select_google_font', arguments: { family: 'Playfair Bold', weights: [700] } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Playfair Display');
    expect(text(res)).toMatch(/search_google_fonts/);
    const nothing = await w.callTool({ name: 'select_google_font', arguments: { family: 'Zzqx Nonexistent', weights: [400] } });
    expect(nothing.isError).toBe(true);
    expect(text(nothing)).toMatch(/search_google_fonts/);
    expect(callsOf(writer).selectGoogleFont).not.toHaveBeenCalled();

    const reader = fakeClient();
    expect((await (await connect(reader, readScope)).callTool({ name: 'select_google_font', arguments: { family: 'Inter', weights: [400] } })).isError).toBe(true);
    expect(callsOf(reader).selectGoogleFont).not.toHaveBeenCalled();
  });

  it('search_google_fonts searches the bundled catalog — no connection, no outbound fetch', async () => {
    const mcp = await connect(fakeClient(), null);
    const res = JSON.parse(text(await mcp.callTool({ name: 'search_google_fonts', arguments: { query: 'playfair' } }))) as {
      results: Array<{ family: string; fallback: string; weights: number[] }>;
    };
    expect(res.results.map((r) => r.family)).toContain('Playfair Display');
    expect(res.results.find((r) => r.family === 'Playfair Display')?.weights).toContain(700);

    const serif = JSON.parse(text(await mcp.callTool({ name: 'search_google_fonts', arguments: { category: 'monospace', limit: 5 } }))) as {
      results: Array<{ fallback: string }>;
    };
    expect(serif.results).toHaveLength(5);
    expect(serif.results.every((r) => r.fallback === 'monospace')).toBe(true);

    expect((await mcp.callTool({ name: 'search_google_fonts', arguments: {} })).isError).toBe(true);
    const none = await mcp.callTool({ name: 'search_google_fonts', arguments: { query: 'zzqx nonexistent' } });
    expect(none.isError).toBe(true);
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

describe('pagespeed_audit tool', () => {
  it('renders a readable score + findings report (content:read)', async () => {
    const reader = fakeClient();
    const r = await connect(reader, readScope);
    const res = await r.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home', formFactor: 'mobile' } });
    expect(res.isError).toBeFalsy();
    const out = text(res);
    expect(out).toMatch(/PAGE-SPEED \+ SEO AUDIT/);
    expect(out).toContain('Performance    73');
    expect(out).toContain('SEO            100');
    // A finding WITH a displayValue and one WITHOUT both render, each with its estimated saving.
    expect(out).toContain('Eliminate render-blocking resources — Est savings of 750 ms — est. save 120 KiB');
    expect(out).toContain('Contrast ratio is too low — est. save 120 ms');
    // Concrete per-resource detail: the file, its size + saving, and the "+N more" line.
    expect(out).toContain('• /_assets/b.js — 90 KiB, save 90 KiB, save 450 ms');
    expect(out).toContain('• a node');
    expect(out).toContain('…and 3 more');
    // Heading structure: the indented outline (with a per-node warning) + document-level issue.
    expect(out).toMatch(/Heading structure:/);
    expect(out).toContain('H2  Section');
    expect(out).toContain('H4  Deep   ⚠ Skips from H2 to H4');
    expect(out).toContain('…and 2 more headings');
    expect(out).toContain('⚠ No H1 heading');
    expect(callsOf(reader).pagespeedAudit).toHaveBeenCalledWith('home', 'mobile', { signal: expect.any(AbortSignal) });
  });

  it('defaults to ONE mobile run; "desktop" asks for desktop; "both" asks the route for the keyed pair', async () => {
    const pair = fakeClient({
      pagespeedAudit: vi.fn(async (_id: string, ff?: string) => {
        const one = (formFactor: 'mobile' | 'desktop') => ({
          url: '/',
          formFactor,
          scores: { performance: formFactor === 'mobile' ? 61 : 93, accessibility: 100, bestPractices: 100, seo: 100 },
          metrics: {},
          findings: [],
          lighthouseVersion: '13.5.0',
          fetchedAt: '2026-10-16T00:00:00.000Z',
        });
        return ff ? one(ff as 'mobile' | 'desktop') : { mobile: one('mobile'), desktop: one('desktop') };
      }),
    });
    const r = await connect(pair, readScope);
    const calls = callsOf(pair).pagespeedAudit;

    const dflt = text(await r.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } }));
    expect(calls).toHaveBeenLastCalledWith('home', 'mobile', { signal: expect.any(AbortSignal) });
    expect(dflt).toContain('· mobile ·');
    expect(dflt).not.toContain('· desktop ·');

    await r.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home', formFactor: 'desktop' } });
    expect(calls).toHaveBeenLastCalledWith('home', 'desktop', { signal: expect.any(AbortSignal) });

    const both = text(await r.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home', formFactor: 'both' } }));
    // No formFactor on the wire = the route's both-devices answer.
    expect(calls).toHaveBeenLastCalledWith('home', undefined, { signal: expect.any(AbortSignal) });
    expect(both).toContain('· mobile ·');
    expect(both).toContain('· desktop ·');
  });

  it('★ "both" with one device missing reports the one that ran AND why the other did not', async () => {
    const partial = fakeClient({
      pagespeedAudit: vi.fn(async () => ({
        mobile: {
          url: '/',
          formFactor: 'mobile' as const,
          scores: { performance: 61, accessibility: 100, bestPractices: 100, seo: 100 },
          metrics: {},
          findings: [],
          lighthouseVersion: '13.5.0',
          fetchedAt: '2026-10-16T00:00:00.000Z',
        },
        errors: {
          desktop: { code: 'TARGET_CRASHED', retryable: true, error: 'Lighthouse could not audit this page: Browser tab has unexpectedly crashed. On this server that almost always means the browser ran out of memory on a heavy page: retry, auditing one device at a time.' },
        },
      })),
    });
    const out = text(await (await connect(partial, readScope)).callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home', formFactor: 'both' } }));
    expect(out).toContain('· mobile ·');
    expect(out).toContain('Performance    61');
    expect(out).toContain('DESKTOP — NOT AUDITED (TARGET_CRASHED): Lighthouse could not audit this page: Browser tab has unexpectedly crashed.');
    expect(out).toContain("call pagespeed_audit again with formFactor 'desktop'");
  });

  it('a missing device whose failure is about the PAGE says retrying will not help', async () => {
    const partial = fakeClient({
      pagespeedAudit: vi.fn(async () => ({
        desktop: { url: '/', formFactor: 'desktop' as const, scores: { performance: 90, accessibility: 100, bestPractices: 100, seo: 100 }, metrics: {}, findings: [], lighthouseVersion: '13.5.0', fetchedAt: '2026-10-16T00:00:00.000Z' },
        errors: { mobile: { code: 'NO_FCP', retryable: false, error: 'Lighthouse could not audit this page: no paint.' } },
      })),
    });
    const out = text(await (await connect(partial, readScope)).callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home', formFactor: 'both' } }));
    expect(out).toContain('MOBILE — NOT AUDITED (NO_FCP)');
    expect(out).toMatch(/Retrying will fail the same way/);
  });

  it('the description explains the partial answer and what 503 / 502 mean now', async () => {
    const tools = await (await connect(fakeClient(), readScope)).listTools();
    const d = tools.tools.find((t) => t.name === 'pagespeed_audit')!.description!;
    expect(d).toMatch(/the other is still reported/);
    expect(d).toMatch(/not enough free memory/);
    expect(d).toMatch(/TARGET_CRASHED/);
  });

  it('renders the MAIN-THREAD section: longest tasks, then the animations the compositor refused', async () => {
    const heavy = fakeClient({
      pagespeedAudit: vi.fn(async () => ({
        url: '/',
        formFactor: 'mobile' as const,
        scores: { performance: 38, accessibility: 100, bestPractices: 100, seo: 100 },
        metrics: { totalBlockingTimeMs: 790 },
        findings: [],
        mainThread: {
          longTasks: [
            { url: '/_assets/_sw/shader-bg.js', durationMs: 412.6, startMs: 2310.4 },
            { label: 'Unattributable', durationMs: 230 },
          ],
          moreLongTasks: 4,
          nonCompositedAnimations: [
            {
              label: 'Welcome to Acme',
              animations: ['sw-pan'],
              properties: ['background-position', 'filter'],
              reasons: ['Unsupported CSS Properties: background-position, filter'],
            },
            { reasons: ['Transform-related property depends on box size'] },
          ],
          moreNonCompositedAnimations: 2,
        },
        lighthouseVersion: '13.5.0',
        fetchedAt: '2026-10-16T00:00:00.000Z',
      })),
    });
    const out = text(await (await connect(heavy, readScope)).callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } }));
    expect(out).toMatch(/Main-thread diagnostics/);
    expect(out).toContain('• /_assets/_sw/shader-bg.js — 413 ms (at 2310 ms)');
    expect(out).toContain('• Unattributable — 230 ms');
    expect(out).toContain('…and 4 more');
    expect(out).toContain('• Welcome to Acme — animation sw-pan · animates background-position, filter');
    expect(out).toContain('Unsupported CSS Properties: background-position, filter');
    expect(out).toContain('• (element)');
    expect(out).toContain('…and 2 more');
    // …and how to act on it: the no-GPU caveat and the patch_critical_css bisect.
    expect(out).toMatch(/WITHOUT a GPU/);
    expect(out).toMatch(/patch_critical_css/);
  });

  it('a section with only animations (no long tasks) renders just that half', async () => {
    const anims = fakeClient({
      pagespeedAudit: vi.fn(async () => ({
        url: '/',
        formFactor: 'mobile' as const,
        scores: { performance: 40, accessibility: 100, bestPractices: 100, seo: 100 },
        metrics: {},
        findings: [],
        mainThread: { longTasks: [], nonCompositedAnimations: [{ label: 'Card', reasons: ['Effect has unsupported timing parameters'] }] },
        lighthouseVersion: '13.5.0',
        fetchedAt: '2026-10-16T00:00:00.000Z',
      })),
    });
    const out = text(await (await connect(anims, readScope)).callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } }));
    expect(out).not.toMatch(/Longest tasks/);
    expect(out).toContain('• Card');
    expect(out).not.toContain('• Card —');
  });

  it('a host that CANCELS the call aborts the request it made (so the server can stop the audit)', async () => {
    let seen: AbortSignal | undefined;
    const slow = fakeClient({
      pagespeedAudit: vi.fn(
        (_id: string, _ff: string | undefined, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            seen = opts.signal;
            opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
      ),
    });
    const r = await connect(slow, readScope);
    const ac = new AbortController();
    const call = r.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } }, undefined, { signal: ac.signal });
    await vi.waitFor(() => expect(seen).toBeDefined());
    ac.abort();
    await expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(seen!.aborted).toBe(true));
  });

  it('gives up after its deadline — aborting the request — and says what to do next', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let seen: AbortSignal | undefined;
      const wedged = fakeClient({
        pagespeedAudit: vi.fn(
          (_id: string, _ff: string | undefined, opts: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              seen = opts.signal;
              opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            }),
        ),
      });
      const r = await connect(wedged, readScope);
      const call = r.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home', formFactor: 'both' } }, undefined, { timeout: 3_600_000 });
      await vi.waitFor(() => expect(seen).toBeDefined());
      await vi.advanceTimersByTimeAsync(420_000);
      const res = await call;
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/did not finish within 420s/);
      expect(text(res)).toMatch(/formFactor 'mobile'/); // a 'both' run is told to drop to one
      expect(seen!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes a busy server (503) through with its own retry guidance', async () => {
    const busy = fakeClient({
      pagespeedAudit: vi.fn(async () => {
        throw new SitewrightApiError(503, 'the headless-render queue is busy — retry in about 15s');
      }),
    });
    const res = await (await connect(busy, readScope)).callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('Error 503: the headless-render queue is busy — retry in about 15s');
  });

  it('renders the all-clear line when there are no failing audits', async () => {
    const clean = fakeClient({
      pagespeedAudit: vi.fn(async () => ({
        url: 'http://127.0.0.1/',
        formFactor: 'desktop' as const,
        scores: { performance: 100, accessibility: 100, bestPractices: 100, seo: 100 },
        metrics: {},
        findings: [],
        lighthouseVersion: '13.4.0',
        fetchedAt: '2026-07-18T21:00:00.000Z',
      })),
    });
    const out = text(await (await connect(clean, readScope)).callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } }));
    expect(out).toMatch(/No failing audits/);
  });

  it('renders a finding without savings/items and an outline with no headings', async () => {
    const bare = fakeClient({
      pagespeedAudit: vi.fn(async () => ({
        url: 'http://127.0.0.1/',
        formFactor: 'mobile' as const,
        scores: { performance: 60, accessibility: 100, bestPractices: 100, seo: 90 },
        metrics: {},
        findings: [{ id: 'plain', title: 'Some diagnostic', category: 'seo' as const, score: 0.5 }],
        outline: { headings: [], issues: ['This page has no headings.'] },
        lighthouseVersion: '13.4.0',
        fetchedAt: '2026-07-18T21:00:00.000Z',
      })),
    });
    const out = text(await (await connect(bare, readScope)).callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } }));
    expect(out).toContain('[seo] Some diagnostic'); // no "— est. save" suffix when there's no saving
    expect(out).not.toMatch(/est\. save/);
    expect(out).toContain('(no headings on this page)');
    expect(out).toContain('⚠ This page has no headings.');
  });

  it('is gated: rejects when disconnected and when the content:read capability is missing', async () => {
    const disconnected = await connect(fakeClient(), null);
    expect((await disconnected.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } })).isError).toBe(true);
    const noCap = await connect(fakeClient(), { projectId: 'p', role: 'member', capabilities: [] });
    const res = await noCap.callTool({ name: 'pagespeed_audit', arguments: { pageId: 'home' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/content:read/);
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

describe('createSitewrightMcpServer — built-in statistics', () => {
  it('get_site_stats defaults to the last 30 days', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    const res = await mcp.callTool({ name: 'get_site_stats', arguments: {} });
    const call = (client as unknown as Record<string, ReturnType<typeof vi.fn>>).siteStats!.mock.calls[0]![0] as { from: string; to: string };
    expect(call.to).toBe(new Date().toISOString().slice(0, 10));
    expect((Date.parse(call.to) - Date.parse(call.from)) / 86_400_000).toBe(29);
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain('"visitors": 5');
    expect(res.isError).toBeFalsy();
  });

  it('get_site_stats forwards a range and the filters', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    await mcp.callTool({ name: 'get_site_stats', arguments: { from: '2026-10-01', to: '2026-10-19', device: 'mobile', country: 'DE' } });
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).siteStats).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-19', device: 'mobile', country: 'DE' });
  });

  it('get_site_stats rejects a malformed day or device before calling the platform', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    expect((await mcp.callTool({ name: 'get_site_stats', arguments: { from: 'last week' } })).isError).toBe(true);
    expect((await mcp.callTool({ name: 'get_site_stats', arguments: { device: 'phone' } })).isError).toBe(true);
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).siteStats).not.toHaveBeenCalled();
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
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).putContent).toHaveBeenCalledWith('form', 'contact', formData, { merge: undefined, receipt: true });
    expect(res.isError).toBeFalsy();
  });

  it('a failed put_content appends the expected `data` shape for the kind (teach on error)', async () => {
    // Simulate the server rejecting a mis-shaped write (what a weak model produces): the tool result
    // should carry BOTH the original validation message AND the kind's expected top-level shape so the
    // model can self-correct instead of looping on the same guess.
    const client = fakeClient({
      putContent: vi.fn(async () => {
        throw new SitewrightApiError(400, 'invalid request — fields: Expected array, received object');
      }),
    });
    const mcp = await connect(client, writeScope);
    const res = await mcp.callTool({ name: 'put_content', arguments: { kind: 'dataset', id: 'faqs', data: { fields: {} } } });
    expect(res.isError).toBe(true);
    const msg = text(res);
    expect(msg).toContain('Expected `data` shape for kind "dataset"');
    // the derived shape must expose that dataset.fields is an ARRAY (the exact thing the model got wrong)
    expect(msg).toMatch(/fields\??:\s*array/);
    // …and ONE level deeper so the model learns a field ITEM needs `name` (not the guessed `key`)
    expect(msg).toMatch(/array<\{[^}]*\bname\b/);
    // a non-400 error is passed through untouched (no hint appended)
    const client2 = fakeClient({
      putContent: vi.fn(async () => {
        throw new SitewrightApiError(403, 'forbidden');
      }),
    });
    const mcp2 = await connect(client2, writeScope);
    const res2 = await mcp2.callTool({ name: 'put_content', arguments: { kind: 'dataset', id: 'faqs', data: {} } });
    expect(text(res2)).not.toContain('Expected `data` shape');
  });

  it('put_content backfills the omitted data.id from the id arg (weak-model forgiveness)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    // A dataset payload that (like a weak model) leaves out the "redundant" id the schema demands.
    await mcp.callTool({ name: 'put_content', arguments: { kind: 'dataset', id: 'services', data: { name: 'Services', slug: 'services', fields: [] } } });
    expect(callsOf(client).putContent).toHaveBeenCalledWith('dataset', 'services', expect.objectContaining({ id: 'services', name: 'Services', slug: 'services' }), { merge: undefined, receipt: true });
  });

  it('put_content backfills an entry’s id AND dataset from the args', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    await mcp.callTool({ name: 'put_content', arguments: { kind: 'entry', id: 'leak', dataset: 'services', data: { values: { title: 'Leak detection' } } } });
    expect(callsOf(client).putContent).toHaveBeenCalledWith('entry', 'leak', expect.objectContaining({ id: 'leak', dataset: 'services', values: { title: 'Leak detection' } }), { merge: undefined, receipt: true });
  });

  it('put_content parses a JSON-STRING data payload (models that stringify the object)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    await mcp.callTool({ name: 'put_content', arguments: { kind: 'snippet', id: 'cta', data: JSON.stringify({ name: 'CTA', source: '<div>hi</div>' }) } });
    expect(callsOf(client).putContent).toHaveBeenCalledWith('snippet', 'cta', expect.objectContaining({ id: 'cta', name: 'CTA', source: '<div>hi</div>' }), { merge: undefined, receipt: true });
  });

  it('put_content does NOT inject an id into the settings singleton (it has no id field)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    await mcp.callTool({ name: 'put_content', arguments: { kind: 'settings', id: 'settings', data: { identity: { name: 'Acme' } } } });
    // The settings body is written through verbatim — no stray `id` field injected.
    expect(callsOf(client).putContent).toHaveBeenCalledWith('settings', 'settings', { identity: { name: 'Acme' } }, { merge: undefined, receipt: true });
  });

  it('put_content forwards merge:true so a settings patch PATCHES instead of replacing', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    await mcp.callTool({ name: 'put_content', arguments: { kind: 'settings', id: 'settings', data: { website: { footer: '<div>x</div>' } }, merge: true } });
    expect(callsOf(client).putContent).toHaveBeenCalledWith('settings', 'settings', { website: { footer: '<div>x</div>' } }, { merge: true, receipt: true });
  });

  it('put_content leaves an explicit, matching data.id untouched (no clobber)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    await mcp.callTool({ name: 'put_content', arguments: { kind: 'snippet', id: 'cta', data: { id: 'cta', name: 'CTA', source: '<b>x</b>' } } });
    expect(callsOf(client).putContent).toHaveBeenCalledWith('snippet', 'cta', { id: 'cta', name: 'CTA', source: '<b>x</b>' }, { merge: undefined, receipt: true });
  });

  it('put_content does NOT rewrite a MISMATCHED explicit data.id (the server’s ConflictError must still fire)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    // A wrong-but-present id is passed through verbatim (id arg 'cta' ≠ data.id 'other') so the API's
    // entityKey guard raises ConflictError rather than the MCP layer silently "fixing" it.
    await mcp.callTool({ name: 'put_content', arguments: { kind: 'snippet', id: 'cta', data: { id: 'other', name: 'X', source: '<b/>' } } });
    expect(callsOf(client).putContent).toHaveBeenCalledWith('snippet', 'cta', { id: 'other', name: 'X', source: '<b/>' }, { merge: undefined, receipt: true });
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
    expect((client as unknown as Record<string, ReturnType<typeof vi.fn>>).putContent).toHaveBeenCalledWith('page', 'home', page, { receipt: true });
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

describe('normalizePutData — forgiving put_content normalization', () => {
  it('defaults an OMITTED entry status to published (a draft entry is invisible on the published site)', () => {
    const out = normalizePutData('entry', 'row1', 'venues', { title: 'Barn' }) as Record<string, unknown>;
    expect(out.status).toBe('published');
    expect(out.id).toBe('row1'); // still back-fills id + dataset
    expect(out.dataset).toBe('venues');
  });

  it('respects an EXPLICIT entry status (intentional draft staging still works)', () => {
    const out = normalizePutData('entry', 'row1', 'venues', { title: 'WIP', status: 'draft' }) as Record<string, unknown>;
    expect(out.status).toBe('draft');
  });

  it('does NOT default status when the field is explicitly null/empty (the API rejects it, not the helper)', () => {
    // Locks in the `=== undefined` contract: a refactor to `!obj.status` would wrongly coerce these.
    expect((normalizePutData('entry', 'r', 'd', { status: null }) as Record<string, unknown>).status).toBeNull();
    expect((normalizePutData('entry', 'r', 'd', { status: '' }) as Record<string, unknown>).status).toBe('');
  });

  it('does NOT inject a status for non-entry kinds (pages keep their own draft/published workflow)', () => {
    const out = normalizePutData('page', 'home', undefined, { path: '', title: 'Home' }) as Record<string, unknown>;
    expect(out.status).toBeUndefined();
  });

  it('parses a stringified entry object then defaults its status', () => {
    const out = normalizePutData('entry', 'row1', 'venues', JSON.stringify({ title: 'Barn' })) as Record<string, unknown>;
    expect(out.status).toBe('published');
    expect(out.title).toBe('Barn');
  });
});

describe('put_content: a stringified `data` that does not parse is REFUSED with the reason', () => {
  it('repairs raw line breaks inside string literals (the usual cause) and parses', () => {
    const raw = '{"website":{"mainNav":"<div>\n  <a href=\\"/\\">Home</a>\n</div>"}}';
    expect(() => JSON.parse(raw)).toThrow(); // the literal newline makes it invalid JSON…
    const out = normalizePutData('settings', 'settings', undefined, raw) as { website: { mainNav: string } };
    expect(out.website.mainNav).toBe('<div>\n  <a href="/">Home</a>\n</div>'); // …and it is repaired, not mangled
  });

  it('throws a clear error naming the parse failure instead of forwarding the string', () => {
    expect(() => normalizePutData('settings', 'settings', undefined, '{"website": {"footer": "x",}')).toThrow(/arrived as a STRING that is not valid JSON .*nothing was written/);
  });

  it('parses a stringified object field one level down (website as a string), and only named fields', () => {
    const out = normalizePutData('settings', 'settings', undefined, { website: JSON.stringify({ footer: '<p>f</p>' }) }) as { website: unknown };
    expect(out.website).toEqual({ footer: '<p>f</p>' });
    // A page `source` that starts with "{" is template text — never parsed.
    const page = normalizePutData('page', 'home', undefined, { path: '', title: 'H', source: '{{> header}}' }) as { source: unknown };
    expect(page.source).toBe('{{> header}}');
    expect(() => normalizePutData('page', 'home', undefined, { data: '{"a":' })).toThrow(/data\.data. arrived as a STRING/);
  });

  it('a put_content call with an unparseable string reports the reason and never reaches the API', async () => {
    const client = fakeClient();
    const res = await (await connect(client, writeScope)).callTool({ name: 'put_content', arguments: { kind: 'settings', id: 'settings', data: '{"website":', merge: true } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/not valid JSON/);
    expect(callsOf(client).putContent).not.toHaveBeenCalled();
  });

  it('repairs ANY raw control character inside a string, and a stray backslash before a line break', () => {
    expect(parseJsonText('{"a":"x\fy\u0001z"}')).toEqual({ ok: true, value: { a: 'x\fy\u0001z' } });
    expect(parseJsonText('{"a":"one\\\ntwo"}')).toEqual({ ok: true, value: { a: 'one\ntwo' } });
  });

  it('an unparseable stringified payload names the expected shape for its kind', async () => {
    const res = await (await connect(fakeClient(), writeScope)).callTool({ name: 'put_content', arguments: { kind: 'page', id: 'home', data: '{"path":' } });
    expect(text(res)).toMatch(/not valid JSON[\s\S]*Expected `data` shape for kind "page"/);
  });

  it('parseJsonText keeps escaped quotes and existing escapes intact', () => {
    expect(parseJsonText('{"a":"x\\"y\\n"}')).toEqual({ ok: true, value: { a: 'x"y\n' } });
    expect(parseJsonText('nope')).toMatchObject({ ok: false });
  });
});

describe('instance addresses come back ABSOLUTE', () => {
  it('rewrites previewUrl / share / upload addresses against the origin — and NEVER site data', () => {
    const out = absolutizeInstanceUrls(
      {
        items: [{ id: 'home', previewUrl: '/preview-site/p1/sig/' }],
        uploadUrl: '/media-upload/tok',
        url: '/media/site/a1/x.jpg',
        // Site data an agent will write back: a nav/link target, a page path, a dataset value that
        // happen to look like instance paths must survive a read-then-write untouched.
        link: { target: '/preview/pricing' },
        target: '/preview-site/p1/sig/',
        values: { cta: '/preview-site/p1/sig/' },
      },
      'https://cms.example',
    );
    expect(out).toEqual({
      items: [{ id: 'home', previewUrl: 'https://cms.example/preview-site/p1/sig/' }],
      uploadUrl: 'https://cms.example/media-upload/tok',
      url: '/media/site/a1/x.jpg', // goes INTO page sources — root-relative is what publish rewrites
      link: { target: '/preview/pricing' },
      target: '/preview-site/p1/sig/',
      values: { cta: '/preview-site/p1/sig/' },
    });
    expect(absolutizeInstanceUrls({ previewUrl: '/preview-site/x' }, '')).toEqual({ previewUrl: '/preview-site/x' }); // origin unknown
  });

  it('tool results and get_scope carry the origin the client was given', async () => {
    const client = fakeClient({ listContent: vi.fn(async () => [{ id: 'home', previewUrl: '/preview-site/p/s/' }]) });
    (client as unknown as { publicOrigin: string }).publicOrigin = 'https://cms.example';
    const mcp = await connect(client, writeScope);
    expect(text(await mcp.callTool({ name: 'list_pages', arguments: {} }))).toContain('https://cms.example/preview-site/p/s/');
    expect(JSON.parse(text(await mcp.callTool({ name: 'get_scope', arguments: {} })))).toMatchObject({ origin: 'https://cms.example' });
  });
});

describe('preview_page — reading the rendered HTML', () => {
  const textOf = (res: unknown): string =>
    ((res as { content: Array<{ type: string; text?: string }> }).content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  const doc = '<html><head><style>' + '.x{}'.repeat(2000) + '</style></head><body><main><h1>Hi</h1></main><footer>f</footer></body></html>';
  const htmlClient = () => fakeClient({ preview: vi.fn(async () => ({ html: doc, token: 'tok', screenshots: {} })) });

  it('includeHtml elides the inline stylesheet; fullHtml keeps it', async () => {
    const mcp = await connect(htmlClient(), writeScope);
    const lean = textOf(await mcp.callTool({ name: 'preview_page', arguments: { page, includeHtml: true } }));
    expect(lean).toContain('KB of inline CSS omitted');
    expect(lean).not.toContain('.x{}.x{}');
    const full = textOf(await mcp.callTool({ name: 'preview_page', arguments: { page, fullHtml: true } }));
    expect(full).toContain('.x{}.x{}');
  });

  it('selector narrows the HTML; screenshot:false skips the capture entirely', async () => {
    const client = htmlClient();
    const mcp = await connect(client, writeScope);
    const res = textOf(await mcp.callTool({ name: 'preview_page', arguments: { page, selector: 'main', screenshot: false } }));
    expect(callsOf(client).preview).toHaveBeenLastCalledWith(page, { screenshot: false });
    expect(res).toContain('HTML for selector "main" — 1 match:');
    expect(res).toContain('<main><h1>Hi</h1></main>');
    expect(res).not.toContain('<footer>');
  });

  it('an unsupported selector is refused BEFORE rendering', async () => {
    const client = htmlClient();
    const res = await (await connect(client, writeScope)).callTool({ name: 'preview_page', arguments: { page, selector: 'a:hover' } });
    expect(res.isError).toBe(true);
    expect(callsOf(client).preview).not.toHaveBeenCalled();
  });

  it('the description tells the agent drafts render here', async () => {
    const tools = (await (await connect(fakeClient(), writeScope)).listTools()).tools;
    expect(tools.find((t) => t.name === 'preview_page')?.description).toMatch(/DRAFT pages too/);
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
    expect(i18n).toMatch(/inherit/i);
    expect(i18n).toMatch(/translationGroup/);
    // The variant INHERITS the default-locale page's code; it does NOT copy the source.
    expect(i18n).toMatch(/INHERITS the default-locale page/i);
    expect(i18n).not.toMatch(/copy the `?source`?\)/i);
    // It teaches the atomic add_language tool and warns AGAINST hand-editing settings.locales.
    expect(i18n).toMatch(/add_language\(\{\s*locale/);
    expect(i18n).toMatch(/NEVER add a language by hand-editing\s+settings\.locales/i);
    // STRENGTHENED: translate = data only (never a forked source), and the main page must be BOUND.
    expect(i18n).toMatch(/TRANSLATE = DATA ONLY, NEVER CODE/);
    expect(i18n).toMatch(/Do NOT put_page a variant with its OWN\s+`?source`?/i);
    expect(i18n).toMatch(/inheritance can only translate text that carries a\s+data-sw-text/i);
    await mcp.close();
  });

  it('the effects guide teaches scroll-reveal animations via the standard data-sw-animation vocabulary', async () => {
    const mcp = await connect(fakeClient(), writeScope);
    const effects = text(await mcp.callTool({ name: 'get_guide', arguments: { topic: 'effects' } }));
    expect(effects).toContain('data-sw-animation="fade-up"');
    expect(effects).toContain('data-sw-delay');
    expect(effects).toContain('data-sw-once');
    // The platform ships its own runtime — agents must NOT add the library themselves.
    expect(effects).toMatch(/do NOT add any\s+animation library/i);
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
    // list_pages now requests the SUMMARY projection (metadata only) — the full body is get_page's job.
    expect(calls(client).listContent).toHaveBeenCalledWith('page', undefined, { summary: true });
    expect(res.isError).toBeFalsy();
  });

  it('list_content forwards the requested kind (+ optional dataset scope for entries)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    await mcp.callTool({ name: 'list_content', arguments: { kind: 'dataset' } });
    expect(calls(client).listContent).toHaveBeenCalledWith('dataset', undefined, { summary: undefined });
    await mcp.callTool({ name: 'list_content', arguments: { kind: 'entry', dataset: 'team' } });
    expect(calls(client).listContent).toHaveBeenCalledWith('entry', 'team', { summary: undefined });
  });

  it('get_content forwards kind + id (+ dataset for an entry)', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    await mcp.callTool({ name: 'get_content', arguments: { kind: 'dataset', id: 'x' } });
    expect(calls(client).getContent).toHaveBeenCalledWith('dataset', 'x', undefined);
    // An ENTRY forwards its owning dataset — its id is only unique within that dataset.
    await mcp.callTool({ name: 'get_content', arguments: { kind: 'entry', id: 'row_1', dataset: 'team' } });
    expect(calls(client).getContent).toHaveBeenCalledWith('entry', 'row_1', 'team');
  });

  it('preview_page requests a screenshot; with none it falls back to the HTML source', async () => {
    const client = fakeClient(); // fake preview returns { html, token } — no screenshots
    const res = await (await connect(client, readScope)).callTool({ name: 'preview_page', arguments: { page } });
    // `segment` always rides along with a capture — it is what asks for the segmented contract.
    expect(calls(client).preview).toHaveBeenCalledWith(page, { screenshot: true, segment: 1 });
    const texts = (res.content as Array<{ type: string; text?: string }>).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    // No screenshots AND no reason from the server → the fallback is unchanged: say so, and hand
    // back the HTML, because there is nothing better to offer. (When the server DOES give a reason,
    // the payload is withheld instead — see the "must SAY SO" suite below.)
    expect(texts).toContain('NO SCREENSHOT'); // graceful fallback note
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

  it('★ preview_page forwards segment + screenshotSelector, and SAYS what each segmented image covers', async () => {
    const seg = (index: number, top: number, bottom: number) => ({
      viewport: 'fullhd' as const,
      kind: 'page' as const,
      base64: `S${index}`,
      mimeType: 'image/jpeg',
      width: 960,
      height: 1354,
      scale: 0.5,
      segments: [{ index, top, bottom }],
      segmentCount: 4,
      totalHeight: 9450,
    });
    const client = fakeClient({
      preview: vi.fn(async () => ({
        html: '<html>SRC</html>',
        token: 'tok',
        captures: [seg(3, 5416, 8124), seg(4, 8124, 9450)],
        captureNotes: [{ viewport: 'mobile' as const, message: 'there is no segment 3: the page is 5,000px tall here — 2 segments of 3,136px.' }],
      })),
    });
    const res = await (await connect(client, readScope)).callTool({
      name: 'preview_page',
      arguments: { page, segment: 3, viewports: ['desktop', 'phone'], screenshotSelector: 'main' },
    });
    expect(calls(client).preview).toHaveBeenCalledWith(page, { screenshot: true, viewports: 'fullhd,mobile', segment: 3, selector: 'main' });
    const blocks = res.content as Array<{ type: string; text?: string; data?: string }>;
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.data)).toEqual(['S3', 'S4']);
    const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    expect(texts).toContain('segments 3–4 of 4, y 5,416–9,450');
    expect(texts).toContain('— fullhd · segment 4 of 4 (y 8,124–9,450) —');
    expect(texts).toContain('mobile: there is no segment 3');
    expect(texts).not.toContain('<html>SRC</html>'); // not asked for
  });

  it('preview_page with only NOTES (a selector that matched nothing) explains, and does not dump the page', async () => {
    const client = fakeClient({
      preview: vi.fn(async () => ({
        html: `<html>${'<p>filler</p>'.repeat(5000)}</html>`,
        token: 'tok',
        captures: [],
        captureNotes: [{ viewport: 'fullhd' as const, message: 'no element matches ".nope" at this width.' }],
      })),
    });
    const res = await (await connect(client, readScope)).callTool({ name: 'preview_page', arguments: { page, screenshotSelector: '.nope' } });
    const texts = (res.content as Array<{ type: string; text?: string }>).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    expect(texts).toContain('nothing was captured');
    expect(texts).toContain('fullhd: no element matches ".nope"');
    expect(texts).not.toContain('<p>filler</p>');
  });

  it('preview_page refuses a segment below 1 before rendering', async () => {
    const client = fakeClient();
    const res = await (await connect(client, readScope)).callTool({ name: 'preview_page', arguments: { page, segment: 0 } });
    expect(res.isError).toBe(true);
    expect(calls(client).preview).not.toHaveBeenCalled();
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

  it('list_preview_shares forwards to the client (content:read)', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({ name: 'list_preview_shares', arguments: {} });
    expect(calls(client).listPreviewShares).toHaveBeenCalled();
  });

  it('create_preview_share passes the label, and omits expiryDays when not given', async () => {
    const client = fakeClient();
    await (await connect(client, writeScope)).callTool({ name: 'create_preview_share', arguments: { label: 'Client review' } });
    expect(calls(client).createPreviewShare).toHaveBeenCalledWith('Client review', undefined);
  });

  it('★ create_preview_share passes expiryDays 0 through — it means NEVER expires, not "unset"', async () => {
    const client = fakeClient();
    await (await connect(client, writeScope)).callTool({ name: 'create_preview_share', arguments: { label: 'Forever', expiryDays: 0 } });
    expect(calls(client).createPreviewShare).toHaveBeenCalledWith('Forever', 0);
  });

  it('create_preview_share needs content:write — a read-only token cannot mint a credential', async () => {
    const client = fakeClient();
    const res = await (await connect(client, readScope)).callTool({ name: 'create_preview_share', arguments: { label: 'Nope' } });
    expect(res.isError).toBe(true);
    expect(calls(client).createPreviewShare).not.toHaveBeenCalled();
  });

  it('revoke_preview_share forwards the id (content:write)', async () => {
    const client = fakeClient();
    await (await connect(client, writeScope)).callTool({ name: 'revoke_preview_share', arguments: { shareId: 'sh1' } });
    expect(calls(client).revokePreviewShare).toHaveBeenCalledWith('sh1');
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

  it('delete_content forwards kind + id (+ dataset for an entry) and reports the deletion', async () => {
    const client = fakeClient();
    const mcp = await connect(client, deleteScope);
    const res = await mcp.callTool({ name: 'delete_content', arguments: { kind: 'dataset', id: 'x' } });
    expect(calls(client).deleteContent).toHaveBeenCalledWith('dataset', 'x', undefined);
    expect(text(res)).toContain('dataset/x');
    // An ENTRY forwards its owning dataset.
    await mcp.callTool({ name: 'delete_content', arguments: { kind: 'entry', id: 'row_1', dataset: 'team' } });
    expect(calls(client).deleteContent).toHaveBeenCalledWith('entry', 'row_1', 'team');
  });

  it('delete_content_bulk forwards the whole id list (+ dataset for entries) and returns the per-id result', async () => {
    const client = fakeClient();
    const mcp = await connect(client, deleteScope);
    const res = await mcp.callTool({ name: 'delete_content_bulk', arguments: { kind: 'dataset', ids: ['x', 'y'] } });
    expect(calls(client).deleteContentBulk).toHaveBeenCalledWith('dataset', ['x', 'y'], undefined);
    // The partial-success report reaches the agent, so it can see what did NOT go.
    expect(text(res)).toContain('"requested": 2');
    expect(text(res)).toContain('"failed": []');
    await mcp.callTool({ name: 'delete_content_bulk', arguments: { kind: 'entry', ids: ['row_1'], dataset: 'team' } });
    expect(calls(client).deleteContentBulk).toHaveBeenCalledWith('entry', ['row_1'], 'team');
  });

  // A real crawl outlives any tool call, so import_website hands back a job id and the agent polls. The
  // summaries must make that unmistakable — a model that reads "ok" as "finished" starts nativizing pages
  // that do not exist yet, and one that re-runs the import duplicates the whole crawl.
  describe('import_website / import_status (async)', () => {
    it('forwards the options and reports a STARTED job, not a finished import', async () => {
      const client = fakeClient();
      const res = await (await connect(client, writeScope)).callTool({
        name: 'import_website',
        arguments: { url: 'https://x.test/', renderMode: 'always', maxPages: 10 },
      });
      expect(calls(client).importWebsite).toHaveBeenCalledWith('https://x.test/', expect.objectContaining({ renderMode: 'always', maxPages: 10 }));
      expect(text(res)).toMatch(/IMPORT STARTED \(job imp_1\)/);
      expect(text(res)).toMatch(/import_status/);
      expect(text(res)).not.toMatch(/IMPORTED ✓/); // never reads as complete
    });

    it('reports a RUNNING job with its elapsed time and latest progress, and says not to restart', async () => {
      const client = fakeClient();
      const res = await (await connect(client, writeScope)).callTool({ name: 'import_status', arguments: { jobId: 'imp_1' } });
      expect(calls(client).importStatus).toHaveBeenCalledWith('imp_1', {});
      // Elapsed is m+s, not Math.round(minutes): rounding read "1m" for everything from 30s to 90s, so
      // five consecutive polls showed the same figure while real minutes passed and an agent reported
      // the counter as FROZEN.
      expect(text(res)).toMatch(/IMPORT RUNNING \(2m 0s elapsed/);
      expect(text(res)).toMatch(/crawl: 7 pages/);
      expect(text(res)).toMatch(/do NOT start a second import/);
      // …and it points at the wait, rather than inviting another poll.
      expect(text(res)).toMatch(/waitMs:30000/);
    });

    it('shows SECONDS under a minute, so a young job does not read as stalled', async () => {
      const client = fakeClient({
        importStatus: vi.fn(async () => ({ id: 'imp_1', url: 'u', status: 'running', startedAt: Date.now() - 8_000, progress: ['crawl: 1 page'] })),
      });
      const res = await (await connect(client, writeScope)).callTool({ name: 'import_status', arguments: { jobId: 'imp_1' } });
      expect(text(res)).toMatch(/IMPORT RUNNING \([0-9]+s elapsed/);
    });

    it('forwards waitMs/since so ONE call can await the job instead of polling', async () => {
      // The behaviour this replaces: 25 import_status calls plus 7 shell sleeps in a single run.
      const client = fakeClient();
      await (await connect(client, writeScope)).callTool({
        name: 'import_status',
        arguments: { jobId: 'imp_1', waitMs: 30_000, since: 4 },
      });
      expect(calls(client).importStatus).toHaveBeenCalledWith('imp_1', { waitMs: 30_000, since: 4 });
    });

    it('reports a FAILED job with its reason', async () => {
      const client = fakeClient({ importStatus: vi.fn(async () => ({ id: 'imp_1', url: 'u', status: 'failed', startedAt: 0, progress: [], error: 'dns exploded' })) });
      const res = await (await connect(client, writeScope)).callTool({ name: 'import_status', arguments: { jobId: 'imp_1' } });
      expect(text(res)).toMatch(/IMPORT FAILED — dns exploded/);
    });

    it('hands back the NATIVIZE instructions once the job is done', async () => {
      const client = fakeClient({
        importStatus: vi.fn(async () => ({ id: 'imp_1', url: 'u', status: 'done', startedAt: 0, progress: [], report: { pagesImported: 22, mediaSelfHosted: 100, warnings: ['a'] } })),
      });
      const res = await (await connect(client, writeScope)).callTool({ name: 'import_status', arguments: { jobId: 'imp_1' } });
      expect(text(res)).toMatch(/WEBSITE IMPORTED ✓ — 22 page\(s\)/);
      expect(text(res)).toMatch(/NOW NATIVIZE/);
      expect(text(res)).toMatch(/Importer notes \(1\)/);
    });

    it('needs content:write — a read-only token is refused and no crawl starts', async () => {
      const ro = fakeClient();
      const rej = await (await connect(ro, readScope)).callTool({ name: 'import_website', arguments: { url: 'https://x.test/' } });
      expect(rej.isError).toBe(true);
      expect(calls(ro).importWebsite).not.toHaveBeenCalled();
    });
  });

  it('add_language forwards the locale (atomic scaffold) with a write token', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    const res = await mcp.callTool({ name: 'add_language', arguments: { locale: 'de' } });
    expect(calls(client).addLocale).toHaveBeenCalledWith('de');
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('"created": 3');
    // A read-only token can't add a language, and no client call is made.
    const ro = fakeClient();
    const rej = await (await connect(ro, readScope)).callTool({ name: 'add_language', arguments: { locale: 'de' } });
    expect(rej.isError).toBe(true);
    expect(text(rej)).toMatch(/content:write/);
    expect(calls(ro).addLocale).not.toHaveBeenCalled();
  });

  it('remove_language forwards the locale and needs content:delete (a write token is refused)', async () => {
    const client = fakeClient();
    const res = await (await connect(client, deleteScope)).callTool({ name: 'remove_language', arguments: { locale: 'de' } });
    expect(calls(client).removeLocale).toHaveBeenCalledWith('de');
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('"removed": 3');
    // content:write alone is not enough — it cascade-deletes a whole subtree.
    const w = fakeClient();
    const rej = await (await connect(w, writeScope)).callTool({ name: 'remove_language', arguments: { locale: 'de' } });
    expect(rej.isError).toBe(true);
    expect(text(rej)).toMatch(/content:delete/);
    expect(calls(w).removeLocale).not.toHaveBeenCalled();
  });

  it('a content:write token (no content:delete) is refused delete tools — and no client call', async () => {
    for (const tool of [
      { name: 'delete_page', arguments: { id: 'home' } },
      { name: 'delete_content', arguments: { kind: 'dataset', id: 'x' } },
      { name: 'delete_content_bulk', arguments: { kind: 'dataset', ids: ['x'] } },
      { name: 'delete_media', arguments: { id: 'm1' } },
      { name: 'delete_media_bulk', arguments: { ids: ['m1'] } },
    ]) {
      const client = fakeClient();
      const res = await (await connect(client, writeScope)).callTool(tool);
      expect(res.isError).toBe(true);
      expect(text(res)).toMatch(/content:delete/);
      expect(calls(client).deleteContent).not.toHaveBeenCalled();
      expect(calls(client).deleteContentBulk).not.toHaveBeenCalled();
      expect(calls(client).deleteMedia).not.toHaveBeenCalled();
      expect(calls(client).deleteMediaBulk).not.toHaveBeenCalled();
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

// patch_page exists because put_page is a TOTAL replace: `{id, path, title, nav}` silently deleted the
// page's source/status/description/order/parent AND data.swImport (the marker every fidelity tool needs).
describe('patch_page', () => {
  it('sends the fragment with merge:true so omitted fields survive', async () => {
    const client = fakeClient();
    const mcp = await connect(client, writeScope);
    const res = await mcp.callTool({ name: 'patch_page', arguments: { page: { id: 'home', nav: { title: 'Home', slots: ['header'] } } } });
    expect(res.isError).toBeFalsy();
    expect(callsOf(client).putContent).toHaveBeenCalledWith('page', 'home', { id: 'home', nav: { title: 'Home', slots: ['header'] } }, { merge: true, receipt: true });
  });

  it('is gated on content:write, and put_page stays a REPLACE (no merge flag)', async () => {
    const reader = fakeClient();
    const r = await (await connect(reader, readScope)).callTool({ name: 'patch_page', arguments: { page: { id: 'home', title: 'X' } } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/content:write/);
    expect(callsOf(reader).putContent).not.toHaveBeenCalled();

    const writer = fakeClient();
    await (await connect(writer, writeScope)).callTool({ name: 'put_page', arguments: { page } });
    expect(callsOf(writer).putContent).toHaveBeenCalledWith('page', page.id, page, { receipt: true });
  });
});

// inspect_source is the only tool that returns NUMBERS off the live original — the measurement the import
// guide keeps asking for but previously shipped no way to obtain.
describe('inspect_source', () => {
  it('measures the original and flags selectors that matched nothing / were invalid', async () => {
    const client = fakeClient();
    const mcp = await connect(client, readScope);
    const res = await mcp.callTool({ name: 'inspect_source', arguments: { pageId: 'home', selectors: ['#main-nav a', '.missing', 'a['] } });
    expect(res.isError).toBeFalsy();
    const out = text(res);
    expect(out).toMatch(/LIVE ORIGINAL/);
    expect(out).toMatch(/1440×900|1440×900/);
    expect(out).toMatch(/NO MATCH: \.missing/);
    expect(out).toMatch(/INVALID selector syntax.*a\[/);
    expect(out).toContain('font-size'); // the measured values themselves come back
    expect(callsOf(client).inspectSource).toHaveBeenCalledWith('home', { selectors: ['#main-nav a', '.missing', 'a['] });
  });

  it('forwards the optional knobs only when given', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({
      name: 'inspect_source',
      arguments: { pageId: 'home', selectors: ['h1'], styles: ['backdrop-filter'], html: true, viewport: 'mobile', side: 'build' },
    });
    expect(callsOf(client).inspectSource).toHaveBeenCalledWith('home', {
      selectors: ['h1'], styles: ['backdrop-filter'], html: true, viewport: 'mobile', side: 'build',
    });
  });

  it('needs content:read and surfaces an API failure as a tool error', async () => {
    const noCaps = fakeClient();
    const res = await (await connect(noCaps, { projectId: 'p', role: 'member', capabilities: [] })).callTool({
      name: 'inspect_source', arguments: { pageId: 'home', selectors: ['h1'] },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/content:read/);
    expect(callsOf(noCaps).inspectSource).not.toHaveBeenCalled();

    const boom = fakeClient({ inspectSource: vi.fn(async () => { throw new Error('render failed'); }) });
    const err = await (await connect(boom, readScope)).callTool({ name: 'inspect_source', arguments: { pageId: 'home', selectors: ['h1'] } });
    expect(err.isError).toBe(true);
    expect(text(err)).toBe('Error: render failed');
  });
});

// A full page list carries every page's Handlebars source — 337 KB on a 22-page imported site, past the
// tool-output ceiling — so list_pages defaults to metadata only and get_page fetches the one body needed.
describe('list_pages summary', () => {
  it('asks the API for the SUMMARY projection by default', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({ name: 'list_pages', arguments: {} });
    expect(callsOf(client).listContent).toHaveBeenCalledWith('page', undefined, { summary: true });
  });

  it('includeSource:true opts back into the full bodies', async () => {
    const client = fakeClient();
    await (await connect(client, readScope)).callTool({ name: 'list_pages', arguments: { includeSource: true } });
    expect(callsOf(client).listContent).toHaveBeenCalledWith('page', undefined, { summary: false });
  });

  it('list_content stays FULL by default and takes an explicit summary flag', async () => {
    const a = fakeClient();
    await (await connect(a, readScope)).callTool({ name: 'list_content', arguments: { kind: 'template' } });
    expect(callsOf(a).listContent).toHaveBeenCalledWith('template', undefined, { summary: undefined });

    const b = fakeClient();
    await (await connect(b, readScope)).callTool({ name: 'list_content', arguments: { kind: 'entry', dataset: 'team', summary: true } });
    expect(callsOf(b).listContent).toHaveBeenCalledWith('entry', 'team', { summary: true });
  });
});

describe('preview_page — a refused screenshot must SAY SO, not hide behind the page source', () => {
  /** A page big enough that dumping it would be the thing the caller notices. */
  const BIG_HTML = `<html><body>${'<p>filler</p>'.repeat(20_000)}</body></html>`;

  const textOf = (res: unknown): string =>
    ((res as { content: Array<{ type: string; text?: string }> }).content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

  it('★ a TRANSIENT memory refusal reports the reason + a retry, and withholds the HTML', async () => {
    // THE BUG. Every no-screenshot case produced one sentence — "unavailable on this server" — plus
    // the ENTIRE rendered HTML. The sentence misdiagnosed a temporary refusal as a permanent server
    // limitation, and the ~300 KB of markup overran the tool-output token limit, so the caller saw a
    // size error and never read the sentence. An actionable "out of memory, retry" was hidden behind
    // a token-limit failure.
    const client = fakeClient({
      preview: vi.fn(async () => ({
        html: BIG_HTML,
        token: 'tok',
        screenshotsUnavailable: {
          reason: 'memory' as const,
          retryable: true,
          message: 'the screenshot was skipped because the instance is temporarily out of memory — the HTML is complete; retry shortly for the image',
        },
      })),
    });
    const mcp = await connect(client as unknown as SitewrightClient, writeScope);
    const text = textOf(await mcp.callTool({ name: 'preview_page', arguments: { page } }));

    expect(text).toMatch(/out of memory/i);
    expect(text).toMatch(/TRANSIENT/);
    expect(text).toMatch(/retry/i);
    // ★ and the payload stays small — the whole point.
    expect(text).not.toContain('<p>filler</p>');
    expect(text.length).toBeLessThan(2000);
    // The old, wrong diagnosis must not come back.
    expect(text).not.toMatch(/unavailable on this server/i);
  });

  it('a PERMANENT failure says not to retry, and still withholds the bulk payload', async () => {
    const client = fakeClient({
      preview: vi.fn(async () => ({
        html: BIG_HTML,
        token: 'tok',
        screenshotsUnavailable: { reason: 'failed' as const, retryable: false, message: 'the screenshot could not be taken: no browser' },
      })),
    });
    const mcp = await connect(client as unknown as SitewrightClient, writeScope);
    const text = textOf(await mcp.callTool({ name: 'preview_page', arguments: { page } }));
    expect(text).toMatch(/NOT retryable/);
    expect(text).not.toContain('<p>filler</p>');
  });

  it('includeHtml:true still returns the HTML alongside the refusal — it was asked for', async () => {
    const client = fakeClient({
      preview: vi.fn(async () => ({
        html: '<html><body><p>filler</p></body></html>',
        token: 'tok',
        screenshotsUnavailable: { reason: 'memory' as const, retryable: true, message: 'out of memory' },
      })),
    });
    const mcp = await connect(client as unknown as SitewrightClient, writeScope);
    const text = textOf(await mcp.callTool({ name: 'preview_page', arguments: { page, includeHtml: true } }));
    expect(text).toMatch(/out of memory/);
    expect(text).toContain('<p>filler</p>');
  });

  it('a server that gives NO reason keeps the old HTML fallback — there is nothing else to offer', async () => {
    const client = fakeClient({ preview: vi.fn(async () => ({ html: '<html><body><p>filler</p></body></html>', token: 'tok' })) });
    const mcp = await connect(client as unknown as SitewrightClient, writeScope);
    const text = textOf(await mcp.callTool({ name: 'preview_page', arguments: { page } }));
    expect(text).toMatch(/no headless browser/i);
    expect(text).toContain('<p>filler</p>');
  });
});

describe('transform_image', () => {
  const okClient = () => fakeClient({ transformMedia: vi.fn(async (_id: string, body: unknown) => ({ id: 'a1', body })) });

  it('needs at least one operation — a call with neither rotate nor crop is refused', async () => {
    // The schema cannot express "one of these two", so the tool says it plainly rather than sending an
    // empty edit the server would 400.
    const client = okClient();
    const mcp = await connect(client as unknown as SitewrightClient, writeScope);
    const res = (await mcp.callTool({ name: 'transform_image', arguments: { id: 'a1' } })) as { isError?: boolean; content: Array<{ text?: string }> };
    expect(res.isError).toBe(true);
    expect(res.content.map((c) => c.text).join('')).toMatch(/at least one of/);
    expect(callsOf(client as unknown as SitewrightClient).transformMedia).not.toHaveBeenCalled();
  });

  it('passes only the operations actually given (in place by default)', async () => {
    const client = okClient();
    const mcp = await connect(client as unknown as SitewrightClient, writeScope);
    await mcp.callTool({ name: 'transform_image', arguments: { id: 'a1', rotate: 90 } });
    expect(callsOf(client as unknown as SitewrightClient).transformMedia).toHaveBeenCalledWith('a1', { rotate: 90 });
  });

  it('carries a crop, an explicit format and saveAs when supplied', async () => {
    const client = okClient();
    const mcp = await connect(client as unknown as SitewrightClient, writeScope);
    await mcp.callTool({
      name: 'transform_image',
      arguments: { id: 'a1', crop: { left: 1, top: 2, width: 3, height: 4 }, format: 'webp', saveAs: { filename: 'cut.webp' } },
    });
    expect(callsOf(client as unknown as SitewrightClient).transformMedia).toHaveBeenCalledWith('a1', {
      crop: { left: 1, top: 2, width: 3, height: 4 },
      format: 'webp',
      saveAs: { filename: 'cut.webp' },
    });
  });

  it('is gated on content:write — a read-only connection cannot edit pixels', async () => {
    // The gate refuses at CALL time (the tool stays listed, as every other write tool does), so the
    // assertion is on the refusal and on the client never being reached.
    const client = okClient();
    const mcp = await connect(client as unknown as SitewrightClient, readScope);
    const res = (await mcp.callTool({ name: 'transform_image', arguments: { id: 'a1', rotate: 90 } })) as {
      isError?: boolean;
      content: Array<{ text?: string }>;
    };
    expect(res.isError).toBe(true);
    expect(res.content.map((c) => c.text).join('')).toMatch(/content:write/);
    expect(callsOf(client as unknown as SitewrightClient).transformMedia).not.toHaveBeenCalled();
  });
});

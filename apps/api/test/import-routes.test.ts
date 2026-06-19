import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { assertNoScripts, registerImportRoutes } from '../src/http/import-routes.js';
import type { CrawlResult } from '../src/import/crawl.js';
import type { ImportBundle } from '@sitewright/site-import';
import type { ProjectContext } from '../src/repo/context.js';

function ctxFor(id: string, role: 'owner' | 'member'): ProjectContext {
  return { userId: 'u', projectId: id, role, actor: 'user' } as unknown as ProjectContext;
}

function onePageCrawl(html = '<html><body><main>hi</main></body></html>'): CrawlResult {
  return {
    site: { baseUrl: 'https://ex.com/', pages: [{ sourceUrl: 'https://ex.com/', html }], assets: new Map(), origin: { kind: 'crawl', label: 'ex.com' } },
    truncated: false,
    warnings: [],
  };
}

interface Built {
  app: FastifyInstance;
  importBundle: ReturnType<typeof vi.fn>;
  createMediaAsset: ReturnType<typeof vi.fn>;
}

function makeApp(opts: { role?: 'owner' | 'member'; crawl?: () => Promise<CrawlResult>; buildBundle?: () => Promise<{ bundles: ImportBundle[]; diagnostics: []; stats: { pages: number; imagesHosted: number; scriptsDropped: number; chromeExtracted: boolean } }> } = {}): Built {
  const app = Fastify();
  const importBundle = vi.fn(async () => ({ imported: 1 }));
  const createMediaAsset = vi.fn(async () => ({ url: '/media/x/1.jpg' }));
  registerImportRoutes(app, {
    resolveProject: async (req) => ({ ctx: ctxFor(req.params.projectId, opts.role ?? 'owner'), project: { id: req.params.projectId, name: 'P', slug: 'p' } }),
    contentRepo: { importBundle } as never,
    createMediaAsset,
    rl: (max) => ({ rateLimit: { max, timeWindow: '1 minute' } }),
    log: app.log,
    crawl: (opts.crawl ?? (async () => onePageCrawl())) as never,
    ...(opts.buildBundle ? { buildBundle: opts.buildBundle as never } : {}),
    isAllowed: async () => true,
  });
  return { app, importBundle, createMediaAsset };
}

const ticks = async (n = 4): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

let apps: FastifyInstance[] = [];
function track(b: Built): Built {
  apps.push(b.app);
  return b;
}
afterEach(async () => {
  await Promise.all(apps.map((a) => a.close()));
  apps = [];
});

describe('assertNoScripts', () => {
  const base: ImportBundle = { project: { identity: { name: 'X', colors: {} } as never, settings: { defaultLocale: 'en', locales: ['en'] } }, pages: [], templates: [], datasets: [], entries: [] };
  it('passes a clean bundle', () => {
    expect(() => assertNoScripts({ ...base, pages: [{ id: 'h', path: '', title: 'H', source: '<div>ok</div>' }] })).not.toThrow();
  });
  it('throws on a script in a page source', () => {
    expect(() => assertNoScripts({ ...base, pages: [{ id: 'h', path: '', title: 'H', source: '<script>x()</script>' }] })).toThrow();
  });
  it('throws on a script in a website slot', () => {
    expect(() => assertNoScripts({ ...base, project: { ...base.project, website: { footer: '<script>x</script>' } as never } })).toThrow();
  });
});

describe('POST /projects/:id/import/website/stream', () => {
  it('imports a crawled site and streams done (owner)', async () => {
    const { app, importBundle } = track(makeApp());
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(res.payload).toContain('event: done');
  });

  it('self-hosts an image whose bytes are already captured (no fetch)', async () => {
    const crawl = async (): Promise<CrawlResult> => ({
      site: {
        baseUrl: 'https://ex.com/',
        pages: [{ sourceUrl: 'https://ex.com/', html: '<html><body><main><img src="/x.png"></main></body></html>' }],
        assets: new Map([['https://ex.com/x.png', { sourceRef: 'https://ex.com/x.png', kind: 'image', bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }]]),
        origin: { kind: 'crawl', label: 'ex.com' },
      },
      truncated: false,
      warnings: [],
    });
    const { app, createMediaAsset, importBundle } = track(makeApp({ crawl }));
    await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(createMediaAsset).toHaveBeenCalledTimes(1);
    expect(importBundle).toHaveBeenCalledTimes(1);
  });

  it('fetches + self-hosts a remote image, and skips an SVG', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const u = String(input);
      const ct = u.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': ct } });
    });
    try {
      const crawl = async (): Promise<CrawlResult> => ({
        site: {
          baseUrl: 'https://ex.com/',
          pages: [{ sourceUrl: 'https://ex.com/', html: '<html><body><main><img src="https://ex.com/a.png"><img src="https://ex.com/logo.svg"></main></body></html>' }],
          assets: new Map(),
          origin: { kind: 'crawl', label: 'ex.com' },
        },
        truncated: true,
        warnings: ['blocked (SSRF): https://ex.com/secret'],
      });
      const { app, createMediaAsset } = track(makeApp({ crawl }));
      const res = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
      // png hosted, svg skipped.
      expect(createMediaAsset).toHaveBeenCalledTimes(1);
      expect(res.payload).toContain('"truncated":true');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects a non-owner with 403', async () => {
    const { app, importBundle } = track(makeApp({ role: 'member' }));
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(res.statusCode).toBe(403);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it('rejects a non-https or private-host URL with 400', async () => {
    const { app } = track(makeApp());
    expect((await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'http://ex.com/' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://localhost/' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: {} })).statusCode).toBe(400);
  });

  it('refuses a script that reached the bundle (assertNoScripts) without importing', async () => {
    const buildBundle = async () => ({
      bundles: [{ project: { identity: { name: 'X', colors: {} } as never, settings: { defaultLocale: 'en', locales: ['en'] } }, pages: [{ id: 'h', path: '', title: 'H', source: '<script>evil()</script>' }], templates: [], datasets: [], entries: [] }],
      diagnostics: [] as [],
      stats: { pages: 1, imagesHosted: 0, scriptsDropped: 0, chromeExtracted: false },
    });
    const { app, importBundle } = track(makeApp({ buildBundle }));
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(res.payload).toContain('event: error');
    expect(importBundle).not.toHaveBeenCalled();
  });

  it('refuses a bundle flagged invalid (validateProject) without importing', async () => {
    const buildBundle = async () => ({
      bundles: [{ project: { identity: { name: 'X', colors: {} } as never, settings: { defaultLocale: 'en', locales: ['en'] } }, pages: [], templates: [], datasets: [], entries: [] }],
      diagnostics: [{ code: 'bundle-invalid', message: 'duplicate_page_id: x' }] as never,
      stats: { pages: 0, imagesHosted: 0, scriptsDropped: 0, chromeExtracted: false },
    });
    const { app, importBundle } = track(makeApp({ buildBundle }));
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(res.payload).toContain('event: error');
    expect(importBundle).not.toHaveBeenCalled();
  });

  it('returns 409 when an import is already running for the project', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app } = track(makeApp({ crawl: async () => { await gate; return onePageCrawl(); } }));
    const p1 = app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    await ticks();
    const r2 = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(r2.statusCode).toBe(409);
    release();
    await p1;
  });

  it('returns 429 when the global import cap is reached', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app } = track(makeApp({ crawl: async () => { await gate; return onePageCrawl(); } }));
    const p1 = app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    const p2 = app.inject({ method: 'POST', url: '/projects/pb/import/website/stream', payload: { url: 'https://ex.com/' } });
    await ticks();
    const r3 = await app.inject({ method: 'POST', url: '/projects/pc/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(r3.statusCode).toBe(429);
    release();
    await Promise.all([p1, p2]);
  });
});

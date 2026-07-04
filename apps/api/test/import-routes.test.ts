import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import JSZip from 'jszip';
import { assertNoScripts, importMediaFolder, registerImportRoutes } from '../src/http/import-routes.js';
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
  createSvgAsset: ReturnType<typeof vi.fn>;
  hostScript: ReturnType<typeof vi.fn>;
}

type PinnedStub = (url: string) => Promise<{ status: number; contentType: string; bytes: Uint8Array } | null>;

function makeApp(opts: { role?: 'owner' | 'member'; crawl?: () => Promise<CrawlResult>; buildBundle?: () => Promise<{ bundles: ImportBundle[]; diagnostics: []; stats: { pages: number; imagesHosted: number; scriptsDropped: number; chromeExtracted: boolean } }>; pinnedFetch?: PinnedStub; cacheSourceRefs?: (slug: string, pages: unknown[], onProgress: (e: unknown) => void, signal: AbortSignal) => Promise<{ captured: number; total: number; capped: boolean }> } = {}): Built {
  const app = Fastify();
  void app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024, files: 1, fields: 0 } });
  const importBundle = vi.fn(async () => ({ imported: 1 }));
  const createMediaAsset = vi.fn(async () => ({ url: '/media/x/1.jpg' }));
  const createSvgAsset = vi.fn(async () => ({ url: '/media/x/logo.svg' }));
  const hostScript = vi.fn(async (_ctx: unknown, slug: string) => `/media/${slug}/sid/script.js`);
  registerImportRoutes(app, {
    resolveProject: async (req) => ({ ctx: ctxFor(req.params.projectId, opts.role ?? 'owner'), project: { id: req.params.projectId, name: 'P', slug: 'p' } }),
    contentRepo: { importBundle } as never,
    createMediaAsset,
    createSvgAsset,
    hostScript: hostScript as never,
    rl: (max) => ({ rateLimit: { max, timeWindow: '1 minute' } }),
    log: app.log,
    crawl: (opts.crawl ?? (async () => onePageCrawl())) as never,
    ...(opts.buildBundle ? { buildBundle: opts.buildBundle as never } : {}),
    // Default: no network (pinnedFetch returns null); SPA render disabled in tests (no headless browser).
    pinnedFetch: (opts.pinnedFetch ?? (async () => null)) as never,
    render: undefined,
    ...(opts.cacheSourceRefs ? { cacheSourceRefs: opts.cacheSourceRefs as never } : {}),
  });
  return { app, importBundle, createMediaAsset, createSvgAsset, hostScript };
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

async function siteZip(): Promise<Buffer> {
  const z = new JSZip();
  z.file('index.html', '<html><body><main><h1>Home</h1><img src="img/logo.png"></main></body></html>');
  z.file('about/index.html', '<html><body><main><h2>About</h2></main></body></html>');
  z.file('img/logo.png', 'PNGBYTES');
  return z.generateAsync({ type: 'nodebuffer' });
}

function multipartBody(file: Buffer, filename: string, contentType: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----swimporttest';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, file, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('POST /projects/:id/import/upload/stream', () => {
  it('imports an uploaded ZIP (owner) and self-hosts its images', async () => {
    const { app, importBundle, createMediaAsset } = track(makeApp());
    const { payload, headers } = multipartBody(await siteZip(), 'site.zip', 'application/zip');
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/upload/stream', payload, headers });
    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(createMediaAsset).toHaveBeenCalledTimes(1); // the in-zip image
    expect(res.payload).toContain('event: done');
    expect(res.payload).toContain('"pagesImported":2');
  });

  it('self-hosts the imported JS (inline + external) into website.scripts via hostScript', async () => {
    const html = '<html><body><main><h1>Home</h1></main><script src="https://cdn.com/lib.js"></script><script>init();</script></body></html>';
    const pinnedFetch: PinnedStub = async (url) => (url === 'https://cdn.com/lib.js' ? { status: 200, contentType: 'text/javascript', bytes: new TextEncoder().encode('LIB();') } : null);
    const { app, importBundle, hostScript } = track(makeApp({ pinnedFetch }));
    const { payload, headers } = multipartBody(Buffer.from(html), 'page.html', 'text/html');
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/upload/stream', payload, headers });
    expect(res.payload).toContain('event: done');
    expect(hostScript).toHaveBeenCalledTimes(2); // external (fetched) + inline (body)
    const bundle = importBundle.mock.calls[0]![2] as { project: { website?: { scripts?: string } } };
    expect(bundle.project.website?.scripts).toContain('<script src="/media/p/sid/script.js" defer></script>'); // self-hosted refs
  });

  it('imports a single uploaded HTML file', async () => {
    const { app, importBundle } = track(makeApp());
    const { payload, headers } = multipartBody(Buffer.from('<html><body><main>solo</main></body></html>'), 'page.html', 'text/html');
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/upload/stream', payload, headers });
    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(res.payload).toContain('event: done');
  });

  it('rejects an unsupported upload with 400 (before streaming)', async () => {
    const { app, importBundle } = track(makeApp());
    const { payload, headers } = multipartBody(Buffer.from('just notes'), 'notes.txt', 'text/plain');
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/upload/stream', payload, headers });
    expect(res.statusCode).toBe(400);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it('rejects a non-owner upload with 403', async () => {
    const { app } = track(makeApp({ role: 'member' }));
    const { payload, headers } = multipartBody(await siteZip(), 'site.zip', 'application/zip');
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/upload/stream', payload, headers });
    expect(res.statusCode).toBe(403);
  });
});

describe('importMediaFolder', () => {
  it('mirrors the source path into imported/<last-meaningful-dir>, dropping noise + numeric segments', () => {
    expect(importMediaFolder('https://site.com/wp-content/uploads/2024/03/logo.png', true)).toBe('imported/uploads');
    expect(importMediaFolder('https://site.com/assets/img/team/jane.jpg', true)).toBe('imported/team');
    expect(importMediaFolder('https://site.com/static/2023/photo.jpg', true)).toBe('imported/static'); // all-noise→numeric falls back to last clean
  });
  it('falls back by kind at the site root / unparseable refs, and sanitizes odd segments', () => {
    expect(importMediaFolder('https://site.com/logo.png', true)).toBe('imported/images');
    expect(importMediaFolder('https://site.com/doc.pdf', false)).toBe('imported/files');
    expect(importMediaFolder('a/b/c/file.png', true)).toBe('imported/c'); // relative (upload) ref
    expect(importMediaFolder('https://site.com/My Photos/x.jpg', true)).toBe('imported/My Photos'); // %20 decoded; space is a valid folder char
  });
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
  it('ALLOWS a self-hosted <script src="/media/…js"> in the scripts slot (the JS-hosting output)', () => {
    const scripts = '<script src="/media/proj/abc-1/script.js" defer></script>\n<script src="/media/proj/def-2/script.js"></script>';
    expect(() => assertNoScripts({ ...base, project: { ...base.project, website: { scripts } as never } })).not.toThrow();
  });
  it('still rejects an inline body / foreign src / on* even in the scripts slot', () => {
    const w = (scripts: string) => ({ ...base, project: { ...base.project, website: { scripts } as never } });
    expect(() => assertNoScripts(w('<script>evil()</script>'))).toThrow(); // inline body
    expect(() => assertNoScripts(w('<script src="https://evil.com/x.js"></script>'))).toThrow(); // foreign src
    expect(() => assertNoScripts(w('<script src="/media/p/i/s.js" onload="evil()"></script>'))).toThrow(); // on* handler
  });
  it('still rejects a self-hosted script in a NON-script slot (e.g. footer)', () => {
    expect(() => assertNoScripts({ ...base, project: { ...base.project, website: { footer: '<script src="/media/p/i/s.js"></script>' } as never } })).toThrow();
  });
});

describe('POST /projects/:id/import/website/stream', () => {
  it('imports a crawled site and streams done (owner)', async () => {
    const { app, importBundle } = track(makeApp());
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(res.payload).toContain('event: done');
  });

  it('forwards foundation to the engine only when ?foundation=1', async () => {
    const okBundle = () => ({
      bundles: [{ project: { identity: { name: 'X', colors: {} } as never, settings: { defaultLocale: 'en', locales: ['en'] } }, pages: [{ id: 'h', path: '', title: 'H', source: '<p>ok</p>' }], templates: [], datasets: [], entries: [] }],
      diagnostics: [] as [],
      stats: { pages: 1, imagesHosted: 0, scriptsDropped: 0, chromeExtracted: false },
    });
    const seen: Array<{ foundation?: boolean }> = [];
    const buildBundle = (async (_site: unknown, opts: { foundation?: boolean }) => { seen.push(opts); return okBundle(); }) as never;

    const on = track(makeApp({ buildBundle }));
    await on.app.inject({ method: 'POST', url: '/projects/pa/import/website/stream?foundation=1', payload: { url: 'https://ex.com/' } });
    expect(seen[0]?.foundation).toBe(true);

    const off = track(makeApp({ buildBundle }));
    await off.app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(seen[1]?.foundation).toBeUndefined();
  });

  it('caches source references ONLY on a foundation import, and reports the count', async () => {
    const okBundle = () => ({
      bundles: [{ project: { identity: { name: 'X', colors: {} } as never, settings: { defaultLocale: 'en', locales: ['en'] } }, pages: [{ id: 'h', path: '', title: 'H', source: '<p>ok</p>', data: { swImport: { sourceUrl: 'https://ex.com/', rewritten: false } } }], templates: [], datasets: [], entries: [] }],
      diagnostics: [] as [],
      stats: { pages: 1, imagesHosted: 0, scriptsDropped: 0, chromeExtracted: false },
    });
    const buildBundle = (async () => okBundle()) as never;
    const cacheSourceRefs = vi.fn(async () => ({ captured: 1, total: 1, capped: false }));

    // foundation import → references captured, count surfaced in the SSE `done` report.
    const on = track(makeApp({ buildBundle, cacheSourceRefs }));
    const res = await on.app.inject({ method: 'POST', url: '/projects/pa/import/website/stream?foundation=1', payload: { url: 'https://ex.com/' } });
    expect(cacheSourceRefs).toHaveBeenCalledTimes(1);
    expect((cacheSourceRefs.mock.calls[0] as unknown[])[0]).toBe('p'); // project slug
    expect(res.payload).toContain('"sourceRefsCaptured":1');

    // plain import → NOT called.
    const off = track(makeApp({ buildBundle, cacheSourceRefs }));
    await off.app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(cacheSourceRefs).toHaveBeenCalledTimes(1); // still 1
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

  it('content-hash DEDUPES identical bytes hosted under different URLs (one media record)', async () => {
    // The same physical file referenced via two distinct URLs (depth-relative paths / thumbnail aliases) —
    // hosted concurrently — must self-host ONCE, not per URL (else the media library is Nx bloated).
    const crawl = async (): Promise<CrawlResult> => ({
      site: {
        baseUrl: 'https://ex.com/',
        pages: [{ sourceUrl: 'https://ex.com/', html: '<html><body><main><img src="/a/logo.png"><img src="/b/logo.png"></main></body></html>' }],
        assets: new Map([
          ['https://ex.com/a/logo.png', { sourceRef: 'https://ex.com/a/logo.png', kind: 'image', bytes: new Uint8Array([9, 9, 9, 9]), contentType: 'image/png' }],
          ['https://ex.com/b/logo.png', { sourceRef: 'https://ex.com/b/logo.png', kind: 'image', bytes: new Uint8Array([9, 9, 9, 9]), contentType: 'image/png' }],
        ]),
        origin: { kind: 'crawl', label: 'ex.com' },
      },
      truncated: false,
      warnings: [],
    });
    const { app, createMediaAsset } = track(makeApp({ crawl }));
    await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    expect(createMediaAsset).toHaveBeenCalledTimes(1); // both URLs → one hosted asset (content hash)
  });

  it('fetches + self-hosts a remote raster image AND preserves an SVG (sanitized vector)', async () => {
    // Inject a stub pinnedFetch (the route's outbound) — png hosted as raster, svg returned as image/svg+xml.
    const pinnedFetch: PinnedStub = async (u) => ({
      status: 200,
      contentType: u.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
      bytes: u.endsWith('.svg') ? new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>') : new Uint8Array([1, 2, 3, 4]),
    });
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
    const { app, createMediaAsset, createSvgAsset } = track(makeApp({ crawl, pinnedFetch }));
    const res = await app.inject({ method: 'POST', url: '/projects/pa/import/website/stream', payload: { url: 'https://ex.com/' } });
    // png hosted as a raster; svg PRESERVED via the vector path (not dropped, not rasterized).
    expect(createMediaAsset).toHaveBeenCalledTimes(1);
    expect(createSvgAsset).toHaveBeenCalledTimes(1);
    expect(res.payload).toContain('"truncated":true');
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

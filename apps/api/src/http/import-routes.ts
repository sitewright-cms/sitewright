// Website-import routes: crawl a live URL OR ingest an uploaded ZIP/HTML bundle → a mechanical
// Sitewright scaffold → import into a project, streaming progress over SSE. Highest-SSRF surface in the
// app, so: OWNER-only, every outbound request SSRF-guarded (DNS-resolving), budgets clamped server-side,
// per-project lock + global cap, and a hard assertion that no <script> reached any slot before the
// bundle is written. The AI rewrite stage (separate) turns the faithful scaffold into native idioms.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { targetsPrivateHost } from '@sitewright/schema';
import { buildImportBundle, type CapturedSite, type ImportBundle, type ImportResult, type MediaPort } from '@sitewright/site-import';
import { buildSrcset } from '@sitewright/image-pipeline';
import { crawlSite, type FetchedResource } from '../import/crawl.js';
import { buildCapturedSiteFromUpload, UploadError, type UploadResult } from '../import/upload.js';
import { pinnedFetch } from '../import/pinned-fetch.js';
import { renderViaBrowser } from '../import/render.js';
import type { ReferencePage, CaptureRefsResult } from '../render/source-ref.js';
import type { ProjectContext } from '../repo/context.js';
import type { ContentRepository } from '../repo/content.js';

const MAX_CONCURRENT_IMPORTS = 2;
const IMPORT_PAGE_CEIL = 200;
const IMPORT_DEPTH_CEIL = 5;
const IMPORT_DEFAULT_PAGES = 50;
const IMPORT_DEFAULT_DEPTH = 3;
const IMPORT_FETCH_TIMEOUT_MS = 12_000;
const MAX_RESOURCE_BYTES = 15 * 1024 * 1024; // per fetched page/asset
// Whole-crawl byte budget (HTML pages + fetched stylesheets; images don't count — they're hosted later).
// 60MB was too low: a small but asset-heavy site (big HTML + many/large stylesheets) blew it and dropped
// pages even on a ~19-page crawl. 200MB comfortably covers a normal small/medium site; still bounded
// (held in memory during the crawl) against a runaway.
const MAX_CRAWL_BYTES = 200 * 1024 * 1024;
const MAX_STYLESHEETS = 40;
const IMPORT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // compressed upload cap (uncompressed bounded in upload.ts)
const IMPORT_UA = 'SitewrightImporter/1.0 (+website import)';

// Framework/noise path segments that don't make a useful media folder name.
const FOLDER_NOISE = new Set(['wp-content', 'wp-includes', 'assets', 'static', 'cdn', 'public', 'dist', 'build', 'sites', 'default', 'content', 'themes', 'plugins', 'i', 'image', 'images', 'img']);

/** Derive a clean media folder mirroring the source path so imported assets are sorted, not dumped flat:
 *  `imported/<last-meaningful-dir>` (e.g. /wp-content/uploads/2024/logo.png → `imported/uploads`). Falls
 *  back to `imported/images` | `imported/files`. Segments are sanitized to MediaFolderSchema's charset. */
export function importMediaFolder(source: string, isImage: boolean): string {
  let path = source;
  try {
    path = new URL(source).pathname;
  } catch {
    /* relative (upload) ref — use as-is */
  }
  const dirs = path
    .split('/')
    .filter(Boolean)
    .slice(0, -1) // drop the filename
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const clean = dirs
    .map((s) => s.replace(/[^A-Za-z0-9 _-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').trim())
    .filter((s) => s && !/^\d+$/.test(s)); // drop empty + pure-numeric (year/month) segments
  const meaningful = clean.filter((s) => !FOLDER_NOISE.has(s.toLowerCase()));
  const pick = meaningful.at(-1) ?? clean.at(-1);
  return pick ? `imported/${pick}` : `imported/${isImage ? 'images' : 'files'}`;
}

/** Opt-in `?foundation=1` (uniform across the crawl + multipart upload routes): run the deterministic
 *  FOUNDATION extractor (native theme + captured fonts + data-driven chrome, foreign CSS/JS discarded)
 *  instead of the raw foreign-CSS scaffold — the INGEST half of the AI-clone pipeline. */
function wantsFoundation(req: FastifyRequest): boolean {
  const q = (req.query as { foundation?: string } | undefined)?.foundation;
  return q === '1' || q === 'true';
}

const ImportWebsiteBody = z.object({
  url: z.string().url().max(2048),
  maxPages: z.number().int().min(1).max(IMPORT_PAGE_CEIL).optional(),
  maxDepth: z.number().int().min(0).max(IMPORT_DEPTH_CEIL).optional(),
});

/** Website slots that are RAW (unsanitized) or validated — all must be script-free after import. */
const SCRIPTABLE_SLOTS = ['mainNav', 'sidebarLeft', 'sidebarRight', 'footer', 'bottom', 'head', 'scripts', 'criticalCss'] as const;
/** Raw HTML code slots nested under `website.effects` (the engine never writes these, but assert anyway). */
const EFFECT_CODE_SLOTS = ['navCode', 'buttonCode', 'preloaderCode'] as const;

export interface ImportRouteDeps {
  resolveProject: (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    access: 'content:write',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; name: string; slug: string } }>;
  contentRepo: Pick<ContentRepository, 'importBundle'>;
  createMediaAsset: (
    ctx: ProjectContext,
    slug: string,
    buffer: Buffer,
    meta: { filename: string; mimetype: string; folder?: string },
  ) => Promise<{ url: string; variants?: ReadonlyArray<{ format: 'avif' | 'webp'; width: number; height: number; path: string }> }>;
  /** Self-host an `@font-face` web font (validates the bytes are a real font; null if not). Omit to
   *  disable font hosting (e.g. in tests) — the importer then leaves the @font-face url() as-is. */
  hostFontAsset?: (ctx: ProjectContext, slug: string, buffer: Buffer, font: { family: string; weight: number; style: 'normal' | 'italic' }) => Promise<{ url: string } | null>;
  /** Self-host a linked document (PDF/doc/…) as-is, served download-only → its /media URL (or null). */
  hostFileAsset?: (ctx: ProjectContext, slug: string, buffer: Buffer, meta: { filename: string; mimetype: string; folder?: string }) => Promise<{ url: string } | null>;
  /** Host the imported CSS as one inline-served stylesheet → its /media URL (or null). Omit to inline. */
  hostStylesheet?: (ctx: ProjectContext, slug: string, css: string) => Promise<string | null>;
  /** Host an imported script's JS → its /media URL (or null). Omit to strip scripts (the safe default). */
  hostScript?: (ctx: ProjectContext, slug: string, js: string) => Promise<string | null>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  log: FastifyBaseLogger;
  // Injectable seams (default to the real implementations) so the routes are testable without a network.
  crawl?: typeof crawlSite;
  buildBundle?: typeof buildImportBundle;
  /** The connect-pinned, SSRF-validated fetcher (the binding outbound guard). */
  pinnedFetch?: typeof pinnedFetch;
  /** Headless render of a client-rendered page (omit to disable SPA rendering, e.g. in tests). */
  render?: (url: string, opts?: { signal?: AbortSignal }) => Promise<string | null>;
  /**
   * Capture + cache each imported page's LIVE source screenshot (for compare_to_source). Called only on
   * a FOUNDATION import (the AI-clone path). Omit to skip (e.g. in tests, or when caching is disabled).
   */
  cacheSourceRefs?: (
    slug: string,
    pages: ReferencePage[],
    onProgress: (e: unknown) => void,
    signal: AbortSignal,
  ) => Promise<CaptureRefsResult>;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// The ONLY script tags allowed in a bundle: a self-hosted `<script src="/media/<slug>/<id>/<file>.js">`
// (optionally `defer`/`async`) — the importer's JS-hosting output. No inline body, no foreign src, no
// `on*`/other attributes. ONLY the `scripts` slot may carry these; everything else stays script-free.
const SELF_HOSTED_SCRIPT = /<script src="\/media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.js"(?:\s+(?:defer|async))*><\/script>/gi;
const JS_HOST_SLOTS: ReadonlySet<string> = new Set(['scripts']); // ONLY website.scripts carries hosted <script src> (head holds the CSS <link> only)

/** True if the value contains any `<script>` OTHER than allowed self-hosted refs. */
function hasDisallowedScript(value: string, allowSelfHosted: boolean): boolean {
  const stripped = allowSelfHosted ? value.replace(SELF_HOSTED_SCRIPT, '') : value;
  return /<script[\s/>]/i.test(stripped);
}

/** Throws if any page source or website slot contains a disallowed <script> — defense-in-depth over the
 *  engine. Self-hosted `<script src="/media/…js">` refs ARE allowed in head/scripts (the JS-hosting output);
 *  page sources + all other slots stay strictly script-free. */
export function assertNoScripts(bundle: ImportBundle): void {
  for (const page of bundle.pages) {
    if (page.source && /<script[\s/>]/i.test(page.source)) throw new Error(`page "${page.id}" source contains a script`);
  }
  const website = bundle.project.website as Record<string, unknown> | undefined;
  if (website) {
    for (const slot of SCRIPTABLE_SLOTS) {
      // eslint-disable-next-line security/detect-object-injection -- `slot` is from the constant SCRIPTABLE_SLOTS list
      const value = website[slot];
      if (typeof value === 'string' && hasDisallowedScript(value, JS_HOST_SLOTS.has(slot))) throw new Error(`website.${slot} contains a disallowed script`);
    }
    const effects = website.effects;
    if (effects && typeof effects === 'object') {
      for (const slot of EFFECT_CODE_SLOTS) {
        // eslint-disable-next-line security/detect-object-injection -- `slot` is from the constant EFFECT_CODE_SLOTS list
        const value = (effects as Record<string, unknown>)[slot];
        if (typeof value === 'string' && /<script[\s/>]/i.test(value)) throw new Error(`website.effects.${slot} contains a script`);
      }
    }
  }
}

/** The importBundle input shape (the engine bundle minus its non-importable framing). */
function toImportInput(bundle: ImportBundle): unknown {
  return { project: bundle.project, pages: bundle.pages, templates: bundle.templates, datasets: bundle.datasets, entries: bundle.entries };
}

function buildReport(site: CapturedSite, result: ImportResult, extra: { truncated: boolean; warnings: string[] }): Record<string, unknown> {
  return {
    pagesImported: result.stats.pages,
    pagesFound: site.pages.length,
    mediaSelfHosted: result.stats.imagesHosted,
    scriptsDropped: result.stats.scriptsDropped,
    chromeExtracted: result.stats.chromeExtracted,
    truncated: extra.truncated,
    warnings: [...extra.warnings.slice(0, 30), ...result.diagnostics.map((d) => `${d.code}: ${d.message}`).slice(0, 100)],
  };
}

/** SSE wrapper: hijacks the reply and streams `progress` frames, then `done {report}` / `error`. */
export async function streamImport(
  reply: FastifyReply,
  run: (onProgress: (e: unknown) => void) => Promise<unknown>,
  logCtx: Record<string, unknown>,
  log: FastifyBaseLogger,
  /** Generic client-facing failure message for the SSE `error` frame (never leaks internals). */
  clientErrorMessage = 'import failed: could not crawl or convert the site',
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (event: string, data: unknown): void => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    const report = await run((e) => send('progress', e));
    send('done', { report });
  } catch (err) {
    log.error({ ...logCtx, errMsg: err instanceof Error ? err.message : String(err) }, 'streaming import failed');
    // Generic message only — never leak internals. (Client-fixable upload errors are surfaced as a clean
    // JSON 400 BEFORE the stream is hijacked, so they never reach here.)
    send('error', { message: clientErrorMessage });
  } finally {
    raw.end();
  }
}

export function registerImportRoutes(app: FastifyInstance, deps: ImportRouteDeps): void {
  const { resolveProject, contentRepo, createMediaAsset, rl, log } = deps;
  const crawl = deps.crawl ?? crawlSite;
  const buildBundle = deps.buildBundle ?? buildImportBundle;
  const fetchPinned = deps.pinnedFetch ?? pinnedFetch;
  const render = 'render' in deps ? deps.render : renderViaBrowser;

  const activeImports = new Set<string>();
  let activeImportCount = 0;

  /**
   * The outbound fetcher for the crawl + media. It is `pinnedFetch`: resolve once, reject any private
   * IP, then connect to the PINNED IP — so there is no DNS-rebinding TOCTOU window (this fetcher stores
   * response bytes, unlike the pixels-only screenshot renderer). https-only, redirect-refusing, size +
   * timeout bounded. The guard lives in the fetcher so no call path can bypass it.
   */
  function makeFetcher(signal: AbortSignal): (url: string) => Promise<FetchedResource | null> {
    return async (url) => {
      const r = await fetchPinned(url, { timeoutMs: IMPORT_FETCH_TIMEOUT_MS, maxBytes: MAX_RESOURCE_BYTES, headers: { 'user-agent': IMPORT_UA }, signal });
      return r ? { url, status: r.status, contentType: r.contentType, bytes: r.bytes } : null;
    };
  }

  /** MediaPort: host an asset's bytes, or fetch a remote image (pinned-fetch guarded) then self-host it. */
  function makeMediaPort(ctx: ProjectContext, slug: string, fetcher: (url: string) => Promise<FetchedResource | null>): MediaPort {
    return {
      hostAsset: async (asset) => {
        let buffer: Buffer | null = null;
        let mimetype = asset.contentType ?? '';
        let filename = 'image';
        if (asset.bytes) {
          buffer = Buffer.from(asset.bytes);
        } else if (asset.remoteUrl) {
          // pinnedFetch enforces https + the SSRF check; this cheap pre-check just skips the obvious.
          if (!/^https:\/\//i.test(asset.remoteUrl) || targetsPrivateHost(asset.remoteUrl)) return null;
          const fetched = await fetcher(asset.remoteUrl);
          if (!fetched) return null;
          buffer = Buffer.from(fetched.bytes);
          mimetype = fetched.contentType;
          try {
            filename = decodeURIComponent(new URL(asset.remoteUrl).pathname.split('/').pop() || 'image') || 'image';
          } catch {
            filename = 'image';
          }
        }
        if (!buffer) return null;
        // @font-face web fonts → the self-hosted-font pipeline (magic-byte validated, served inline).
        if (asset.kind === 'font') {
          if (!deps.hostFontAsset || !asset.font) return null;
          const saved = await deps.hostFontAsset(ctx, slug, buffer, asset.font).catch(() => null);
          return saved ? { ref: saved.url } : null;
        }
        // Documents (PDF/doc/…) → the file-asset path: stored as-is, served download-only (no sharp).
        if (asset.kind === 'other') {
          if (!deps.hostFileAsset) return null;
          const folder = importMediaFolder(asset.remoteUrl || asset.sourceRef || '', false);
          const saved = await deps.hostFileAsset(ctx, slug, buffer, { filename, mimetype: mimetype || 'application/octet-stream', folder }).catch(() => null);
          return saved ? { ref: saved.url } : null;
        }
        if (mimetype === 'image/svg+xml' || mimetype === 'image/svg') return null; // sharp rejects SVG; engine inlines small ones
        if (mimetype && !mimetype.startsWith('image/')) return null; // only host images
        try {
          const folder = importMediaFolder(asset.remoteUrl || asset.sourceRef || '', true);
          const saved = await createMediaAsset(ctx, slug, buffer, { filename, mimetype: mimetype || 'image/jpeg', folder });
          // Serve the efficient WebP variants the pipeline already produced via a responsive srcset
          // (the <img src> stays the fallback for legacy browsers). Base = the asset dir of saved.url.
          const base = saved.url.slice(0, saved.url.lastIndexOf('/'));
          const srcset = saved.variants ? buildSrcset(saved.variants, 'webp', base) : undefined;
          return { ref: saved.url, ...(srcset ? { srcset } : {}) };
        } catch {
          return null;
        }
      },
      ...(deps.hostStylesheet ? { hostStylesheet: (css: string) => deps.hostStylesheet!(ctx, slug, css) } : {}),
      ...(deps.hostScript
        ? {
            // Inline script → store its body; external → SSRF-fetch then store. Returns the /media URL.
            hostScript: async (arg: { code: string } | { url: string }): Promise<string | null> => {
              let js: string;
              if ('code' in arg) {
                js = arg.code;
              } else {
                if (!/^https:\/\//i.test(arg.url) || targetsPrivateHost(arg.url)) return null;
                const fetched = await fetcher(arg.url);
                if (!fetched) return null;
                js = Buffer.from(fetched.bytes).toString('utf8');
              }
              return deps.hostScript!(ctx, slug, js);
            },
          }
        : {}),
    };
  }

  /** Convert a CapturedSite → bundle (assert script-free, reject invalid) → write it; returns the report. */
  async function convertAndImport(
    ctx: ProjectContext,
    project: { id: string; name: string; slug: string },
    site: CapturedSite,
    media: MediaPort,
    onProgress: (e: unknown) => void,
    extra: { truncated: boolean; warnings: string[] },
    foundation = false,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    onProgress({ phase: 'transform', detail: `converting ${site.pages.length} pages` });
    const result = await buildBundle(site, {
      media,
      onProgress,
      importedAt: new Date().toISOString(),
      ...(foundation ? { foundation: true } : {}),
    });
    const bundle = result.bundles[0];
    if (!bundle) throw new Error('the import produced no content');
    if (result.diagnostics.some((d) => d.code === 'bundle-invalid')) throw new Error('the import produced an invalid bundle');
    assertNoScripts(bundle);
    onProgress({ phase: 'assemble', detail: 'saving content' });
    await contentRepo.importBundle(ctx, project, toImportInput(bundle));
    const report = buildReport(site, result, extra);
    // FOUNDATION (AI-clone) only: cache each page's live-source screenshot so compare_to_source has a
    // stable reference from import time. Best-effort — a failure never fails the import.
    if (foundation && deps.cacheSourceRefs) {
      try {
        const refs = await deps.cacheSourceRefs(project.slug, bundle.pages as ReferencePage[], onProgress, signal ?? new AbortController().signal);
        report.sourceRefsCaptured = refs.captured;
        if (refs.capped) report.sourceRefsCapped = refs.total;
      } catch (err) {
        log.warn({ projectId: project.id, errMsg: err instanceof Error ? err.message : String(err) }, 'source-reference capture failed');
      }
    }
    return report;
  }

  /** Claim the per-project lock + a global slot; sends the 409/429 and returns false if unavailable. */
  function acquireSlot(reply: FastifyReply, projectId: string): boolean {
    if (activeImports.has(projectId)) {
      reply.code(409).send({ error: 'an import is already in progress for this project' });
      return false;
    }
    if (activeImportCount >= MAX_CONCURRENT_IMPORTS) {
      reply.code(429).send({ error: 'too many imports in progress; try again shortly' });
      return false;
    }
    activeImports.add(projectId);
    activeImportCount += 1;
    return true;
  }
  function releaseSlot(projectId: string): void {
    activeImports.delete(projectId);
    activeImportCount -= 1;
  }

  // ──────────────────────────────── crawl a live URL ────────────────────────────────
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/import/website/stream', { config: rl(5) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:write');
    if (ctx.role !== 'owner') return reply.code(403).send({ error: 'only the project owner can import a website' });

    const parsed = ImportWebsiteBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });
    const { url } = parsed.data;
    if (!/^https:\/\//i.test(url) || targetsPrivateHost(url)) return reply.code(400).send({ error: 'only public https URLs can be imported' });

    if (!acquireSlot(reply, project.id)) return;
    const foundation = wantsFoundation(req);
    const maxPages = clamp(parsed.data.maxPages ?? IMPORT_DEFAULT_PAGES, 1, IMPORT_PAGE_CEIL);
    const maxDepth = clamp(parsed.data.maxDepth ?? IMPORT_DEFAULT_DEPTH, 0, IMPORT_DEPTH_CEIL);
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    try {
      await streamImport(
        reply,
        async (onProgress) => {
          const fetcher = makeFetcher(abort.signal);
          const media = makeMediaPort(ctx, project.slug, fetcher);
          const crawlResult = await crawl(
            url,
            { maxPages, maxDepth, sameOriginOnly: true, maxBytesTotal: MAX_CRAWL_BYTES, maxStylesheets: MAX_STYLESHEETS },
            {
              fetchResource: fetcher,
              // Cheap sync pre-filter for the discovery skip; pinnedFetch is the binding SSRF guard.
              isAllowed: async (u) => !targetsPrivateHost(u),
              ...(render ? { render } : {}),
              onProgress: (e) => onProgress({ phase: 'crawl', ...e }),
              signal: abort.signal,
            },
          );
          if (crawlResult.site.pages.length === 0) throw new Error('no pages could be crawled from the URL');
          return convertAndImport(ctx, project, crawlResult.site, media, onProgress, { truncated: crawlResult.truncated, warnings: crawlResult.warnings }, foundation, abort.signal);
        },
        { projectId: project.id },
        log,
      );
    } finally {
      releaseSlot(project.id);
    }
  });

  // ──────────────────────────────── upload a ZIP/HTML bundle ────────────────────────────────
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/import/upload/stream', { config: rl(5) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:write');
    if (ctx.role !== 'owner') return reply.code(403).send({ error: 'only the project owner can import a website' });

    let buffer: Buffer;
    let filename: string;
    try {
      const file = await req.file({ limits: { fileSize: IMPORT_UPLOAD_MAX_BYTES, files: 1 } });
      if (!file) return reply.code(400).send({ error: 'no file uploaded' });
      filename = file.filename || 'upload';
      buffer = await file.toBuffer();
      // Belt-and-suspenders: @fastify/multipart throws on oversize by default, but also flag a silent truncation.
      if (file.file.truncated) return reply.code(413).send({ error: 'file exceeds the upload size limit' });
    } catch (err) {
      // toBuffer throws when the file exceeds the per-request size limit.
      if (err instanceof Error && /file too large|maxFileSize|request file too large/i.test(err.message)) {
        return reply.code(413).send({ error: 'file exceeds the upload size limit' });
      }
      return reply.code(400).send({ error: 'expected a multipart file upload' });
    }

    // Extract BEFORE hijacking so a bad archive returns a clean JSON 400 (with a helpful message).
    let upload: UploadResult;
    try {
      upload = await buildCapturedSiteFromUpload(buffer, filename);
    } catch (err) {
      if (err instanceof UploadError) return reply.code(400).send({ error: err.message });
      throw err;
    }

    if (!acquireSlot(reply, project.id)) return;
    const foundation = wantsFoundation(req);
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    try {
      await streamImport(
        reply,
        async (onProgress) => {
          const fetcher = makeFetcher(abort.signal);
          const media = makeMediaPort(ctx, project.slug, fetcher);
          return convertAndImport(ctx, project, upload.site, media, onProgress, { truncated: false, warnings: upload.warnings }, foundation, abort.signal);
        },
        { projectId: project.id },
        log,
      );
    } finally {
      releaseSlot(project.id);
    }
  });
}

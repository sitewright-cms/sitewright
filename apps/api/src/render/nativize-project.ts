// Orchestrate the server-side mechanical nativize of an imported project: for each still-faithful
// (rawFidelity) page, render its literal replica → capture computed styles headlessly → run the pure
// transform (@sitewright/site-import) → write the native Tailwind+token source back and flip the page out
// of rawFidelity. This is the "bulk of the job"; an agent can fine-tune individual pages afterward.
import type { FastifyBaseLogger } from 'fastify';
import type { Page } from '@sitewright/schema';
import { validateTemplate, type TemplateContext } from '@sitewright/blocks';
import { buildPalette, mergeTrees, renderTree, type NativizeContext } from '@sitewright/site-import';
import { type ContentRepository, SETTINGS_ENTITY_ID, type Settings } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import type { RenderPool } from './render-pool.js';
import { isRawFidelityPage } from '../import/raw-fidelity.js';
import { captureStyledTrees } from './nativize-capture.js';

/** The headless capture seam — defaults to the real Playwright capture; tests inject a fixture. */
export type CaptureFn = typeof captureStyledTrees;

export interface NativizeDeps {
  contentRepo: ContentRepository;
  renderPool: RenderPool;
  /** The API's own loopback origin (host:port) so the headless browser can load self-hosted /media. */
  originHostPort: string;
  log: FastifyBaseLogger;
  /** Aborts the batch between pages when the client disconnects. */
  signal?: AbortSignal;
  /** Override the headless capture (tests inject fixture trees; production uses the real Playwright walk). */
  capture?: CaptureFn;
}

export interface NativizeProgress {
  phase: 'nativize';
  done?: number;
  total?: number;
  detail?: string;
}

export interface NativizeReport {
  pagesNativized: number;
  pagesTotal: number;
  marqueeLogos: number;
  skipped: string[];
}

/** Unique source hostnames across the project's imported pages → toRoute() internalizes their links. */
function originHostsOf(pages: readonly Page[]): string[] {
  const hosts = new Set<string>();
  for (const p of pages) {
    const url = (p.data as { swImport?: { sourceUrl?: string } } | undefined)?.swImport?.sourceUrl;
    if (!url) continue;
    try { hosts.add(new URL(url).hostname); } catch { /* skip a malformed source URL */ }
  }
  return [...hosts];
}

/**
 * Nativize every rawFidelity page in `project`. Emits per-page progress and returns a summary. A page
 * that fails to render/capture/validate is left untouched (still a faithful replica) and reported in
 * `skipped`, so one bad page never aborts the batch.
 */
export async function nativizeProject(
  ctx: ProjectContext,
  deps: NativizeDeps,
  onProgress: (e: NativizeProgress) => void,
): Promise<NativizeReport> {
  const settings = (await deps.contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
  const brand = settings.identity;
  const website = settings.website;
  const palette = buildPalette(brand?.colors ?? {});

  const allPages = (await deps.contentRepo.list(ctx, 'page')) as Page[];
  const targets = allPages.filter((p) => isRawFidelityPage(p));
  const nctx: NativizeContext = { palette, originHosts: originHostsOf(allPages), breakpoints: ['', 'md:', 'lg:'] };

  onProgress({ phase: 'nativize', total: targets.length, detail: `${targets.length} page${targets.length === 1 ? '' : 's'} to nativize` });
  const capture = deps.capture ?? captureStyledTrees;
  const skipped: string[] = [];
  let nativized = 0;
  let marqueeLogos = 0;
  let done = 0;

  for (const page of targets) {
    if (deps.signal?.aborted) break; // client disconnected → stop the batch (pages already written persist)
    done += 1;
    const label = page.title || page.path || page.id;
    onProgress({ phase: 'nativize', done, total: targets.length, detail: label });
    try {
      // Render the page's literal source (its inlined imported CSS comes along) → a minimal full document
      // (no platform chrome/base CSS) so the headless capture sees the page exactly as the import styled it.
      const context = {
        company: brand as unknown as Record<string, unknown>,
        website: { siteUrl: website?.siteUrl, data: website?.data },
        page: page as unknown as Record<string, unknown>,
        dataset: {},
      } as unknown as TemplateContext;
      const body = await deps.renderPool.render(page.source ?? '', context);
      const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${body}</body></html>`;
      const { base, md, lg } = await capture(doc, { originHostPort: deps.originHostPort, rootSelector: 'body' });
      const { html, marqueeLogos: logos } = renderTree(mergeTrees(base, md, lg, nctx), nctx);
      validateTemplate(html); // page.source must be validator-safe before it's written
      const updated = {
        ...page,
        source: html,
        data: { ...(page.data ?? {}), swImport: { ...((page.data as { swImport?: object })?.swImport ?? {}), rewritten: true } },
      };
      await deps.contentRepo.put(ctx, 'page', page.id, updated, { op: 'put', note: 'nativize' });
      nativized += 1;
      marqueeLogos += logos.length;
    } catch (err) {
      deps.log.warn({ pageId: page.id, err: err instanceof Error ? err.message : String(err) }, 'nativize: page skipped');
      skipped.push(page.id);
    }
  }
  return { pagesNativized: nativized, pagesTotal: targets.length, marqueeLogos, skipped };
}

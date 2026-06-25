// Orchestrate the server-side mechanical nativize of an imported project: for each still-faithful
// (rawFidelity) page, render its literal replica → capture computed styles headlessly → run the pure
// transform (@sitewright/site-import) → write the native Tailwind+token source back, PUBLISH it, and flip
// the page out of rawFidelity. Pages are nativized CONCURRENTLY (bounded). Once the whole site is native,
// the imported foreign CSS/JS are dropped and the chrome nav is rebuilt as a data-driven menu. This is
// the "bulk of the job"; an agent can fine-tune individual pages afterward.
import type { FastifyBaseLogger } from 'fastify';
import type { Page, Entry } from '@sitewright/schema';
import { validateTemplate, type TemplateContext } from '@sitewright/blocks';
import { resolveLocaleDatasets, compareEntryOrder, keyedDatasets } from '@sitewright/core';
import { buildPalette, mergeTrees, renderTree, type NativizeContext } from '@sitewright/site-import';
import { type ContentRepository, SETTINGS_ENTITY_ID, type Settings } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import type { RenderPool } from './render-pool.js';
import { isRawFidelityPage } from '../import/raw-fidelity.js';
import { captureStyledTrees } from './nativize-capture.js';

/** The headless capture seam — defaults to the real Playwright capture; tests inject a fixture. */
export type CaptureFn = typeof captureStyledTrees;

// Nativize this many pages at once. Each page renders (renderPool, own child-process pool) then captures
// headlessly (gated to 2 by the shared render slot), so a small pool overlaps render+capture across pages.
const PAGE_CONCURRENCY = 4;

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
  /** True when the whole site went native, so the chrome was rebuilt + the foreign CSS/JS dropped. */
  chromeRebuilt: boolean;
}

/** Run `fn` over `items` with at most `limit` promises in flight. */
async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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

const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * A clean, RESPONSIVE, data-driven navbar to replace the imported chrome's hard-coded links: a desktop
 * menu + a CSS-only mobile dropdown, both looping `{{#each nav.header}}` (built from each page's nav
 * config) with `{{sw-active}}` highlighting. No `<nav>` (the platform wraps the topNav slot in one).
 */
function buildNavbar(logo: string | undefined): string {
  const logoHtml = logo
    ? `<a href="{{sw-url '/'}}" class="flex shrink-0 items-center"><img src="${escAttr(logo)}" alt="{{company.name}}" class="h-10 w-auto max-w-full"></a>`
    : `<a href="{{sw-url '/'}}" class="font-heading text-xl font-bold text-primary no-underline">{{company.name}}</a>`;
  return `<div class="sw-container flex items-center gap-4 py-3">
  ${logoHtml}
  <ul class="ml-auto flex list-none items-center gap-2 max-lg:hidden">
    {{#each nav.header}}
    <li><a href="{{sw-url path}}" class="px-3 py-2 font-medium no-underline transition-colors {{#if (sw-active path)}}rounded-full bg-secondary text-secondary-content{{else}}text-base-content hover:text-secondary{{/if}}">{{sw-label}}</a></li>
    {{/each}}
  </ul>
  <details class="dropdown dropdown-end ml-auto lg:hidden">
    <summary class="btn btn-ghost btn-square list-none" aria-label="Open menu">{{sw-icon "menu" "h-6 w-6"}}</summary>
    <ul class="dropdown-content z-20 mt-2 w-56 list-none space-y-1 rounded-box bg-base-100 p-2 shadow-lg ring-1 ring-base-200">
      {{#each nav.header}}
      <li><a href="{{sw-url path}}" class="block rounded-md px-3 py-2 font-medium no-underline {{#if (sw-active path)}}bg-secondary text-secondary-content{{else}}text-base-content hover:bg-base-200{{/if}}">{{sw-label}}</a></li>
      {{/each}}
    </ul>
  </details>
</div>`;
}

/** Remove the imported foreign stylesheet `<link>` from `website.head` (keep any other head content). */
function stripForeignStylesheet(head: string | undefined): string {
  return (head ?? '').replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, '').trim();
}

/**
 * Nativize one HTML fragment (a chrome slot like the footer): render it, capture its computed styles
 * headlessly UNDER the foreign CSS (`head` carries the import's stylesheet link), transform to native
 * Tailwind, strip the loopback origin. Returns null on any failure (caller keeps the original). Mirrors
 * the per-page path so a footer's dark bg / grid / map iframe survive the foreign-CSS drop.
 */
async function nativizeFragment(
  html: string, context: TemplateContext, head: string,
  deps: NativizeDeps, capture: CaptureFn, nctx: NativizeContext, loopbackOrigin: RegExp,
): Promise<string | null> {
  try {
    const body = await deps.renderPool.render(html, context);
    const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
    const { base, md, lg } = await capture(doc, { originHostPort: deps.originHostPort, rootSelector: 'body' });
    const out = renderTree(mergeTrees(base, md, lg, nctx), nctx).html.replace(loopbackOrigin, '');
    validateTemplate(out);
    return out;
  } catch (err) {
    deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'nativize: chrome fragment skipped');
    return null;
  }
}

/**
 * Nativize every rawFidelity page in `project` (concurrently). Emits per-page progress and returns a
 * summary. A page that fails to render/capture/validate is left untouched (still a faithful replica) and
 * reported in `skipped`, so one bad page never aborts the batch. Once EVERY page is native (no rawFidelity
 * remains), the foreign stylesheet + scripts are dropped and the chrome nav is rebuilt as a data-driven
 * menu — gated on that, because a still-rawFidelity page renders without the platform base CSS and needs
 * the foreign sheet + the literal chrome.
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

  // Group dataset entries (sorted) so dataset-driven {{#each}} loops — e.g. an inferred service-tile
  // grid — actually RENDER during capture. (Rendering with an empty dataset silently dropped them.)
  const entries = (await deps.contentRepo.list(ctx, 'entry')) as Entry[];
  const byDataset = new Map<string, Entry[]>();
  for (const e of entries) byDataset.set(e.dataset, [...(byDataset.get(e.dataset) ?? []), e]);
  for (const list of byDataset.values()) list.sort(compareEntryOrder);
  const sourceData = Object.fromEntries(byDataset);

  onProgress({ phase: 'nativize', total: targets.length, detail: `${targets.length} page${targets.length === 1 ? '' : 's'} to nativize` });
  const capture = deps.capture ?? captureStyledTrees;
  const loopbackHost = deps.originHostPort.split(':')[0] ?? '127.0.0.1';
  const loopbackOrigin = new RegExp(`http://${loopbackHost.replace(/[.]/g, '\\.')}(:\\d+)?`, 'g'); // host with OR without port
  const skipped: string[] = [];
  let nativized = 0;
  let marqueeLogos = 0;
  let done = 0;

  await runPool(targets, PAGE_CONCURRENCY, async (page) => {
    if (deps.signal?.aborted) return; // client disconnected → stop taking new pages (those done persist)
    try {
      // Render the page's literal source (its inlined imported CSS comes along) → a minimal full document
      // (no platform chrome/base CSS) so the headless capture sees the page exactly as the import styled it.
      const localeData = resolveLocaleDatasets(sourceData, (page as { locale?: string }).locale);
      const context = {
        company: brand as unknown as Record<string, unknown>,
        website: { siteUrl: website?.siteUrl, data: website?.data },
        page: page as unknown as Record<string, unknown>,
        dataset: localeData, // real dataset entries → {{#each}} loops (e.g. service tiles) render + are captured
        item: keyedDatasets(page.source ?? '', localeData),
      } as unknown as TemplateContext;
      const body = await deps.renderPool.render(page.source ?? '', context);
      // website.head carries the <link> to the import's hosted stylesheet — without it the headless
      // capture sees an UNSTYLED page. injectBaseHref (in the capture) resolves the /media link to loopback.
      const head = typeof website?.head === 'string' ? website.head : '';
      const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
      const { base, md, lg } = await capture(doc, { originHostPort: deps.originHostPort, rootSelector: 'body' });
      const result = renderTree(mergeTrees(base, md, lg, nctx), nctx);
      // Strip the loopback <base> origin the capture resolved media against, so /media stays root-relative
      // (the host may appear with or without its port — new URL() drops the default :80).
      const html = result.html.replace(loopbackOrigin, '');
      validateTemplate(html); // page.source must be validator-safe before it's written
      const updated = {
        ...page,
        status: 'published', // the native version is publish-ready (#7)
        source: html,
        data: { ...(page.data ?? {}), swImport: { ...((page.data as { swImport?: object })?.swImport ?? {}), rewritten: true } },
      };
      await deps.contentRepo.put(ctx, 'page', page.id, updated, { op: 'put', note: 'nativize' });
      nativized += 1;
      marqueeLogos += result.marqueeLogos.length;
    } catch (err) {
      deps.log.warn({ pageId: page.id, err: err instanceof Error ? err.message : String(err) }, 'nativize: page skipped');
      skipped.push(page.id);
    }
    done += 1;
    onProgress({ phase: 'nativize', done, total: targets.length, detail: page.title || page.path || page.id });
  });

  // Once the WHOLE site is native (no rawFidelity page remains), transition the chrome: drop the foreign
  // stylesheet + scripts (native pages don't need them) and rebuild the nav into the data-driven menu.
  // Gated on skipped===0 because a still-rawFidelity page renders without the platform base CSS and relies
  // on the foreign sheet + the literal imported chrome.
  let chromeRebuilt = false;
  if (nativized > 0 && skipped.length === 0 && !deps.signal?.aborted) {
    const fctx = {
      company: brand as unknown as Record<string, unknown>,
      website: { siteUrl: website?.siteUrl, data: website?.data },
      page: {}, dataset: {}, item: {},
    } as unknown as TemplateContext;
    const foreignHead = typeof website?.head === 'string' ? website.head : '';
    // Nativize the FOOTER (still foreign markup) under the foreign CSS BEFORE we drop it — else clearing
    // the sheet leaves the footer unstyled (its dark bg / 3-col grid / map come from the foreign classes).
    const footerSrc = typeof website?.footer === 'string' && website.footer.trim() ? website.footer : '';
    const nativeFooter = footerSrc ? await nativizeFragment(footerSrc, fctx, foreignHead, deps, capture, nctx, loopbackOrigin) : '';
    // The foreign CSS/JS can only be dropped once the footer no longer needs it. If the footer couldn't be
    // nativized, keep the foreign sheet so it stays styled (the data-driven nav uses platform classes, so
    // it renders regardless).
    const footerOk = !footerSrc || nativeFooter !== null;

    const newWebsite: Record<string, unknown> = {
      ...website,
      topNav: buildNavbar(brand?.logo),
      mobileNav: '', // the rebuilt navbar is self-contained responsive (its own mobile dropdown)
    };
    if (footerOk) {
      newWebsite.head = stripForeignStylesheet(website?.head); // #5 — safe now nothing foreign-styled remains
      newWebsite.scripts = ''; // drop the imported foreign JS — native pages use the platform runtimes
      if (footerSrc) newWebsite.footer = nativeFooter;
    }
    await deps.contentRepo.put(ctx, 'settings', SETTINGS_ENTITY_ID, { ...settings, website: newWebsite }, { op: 'put', note: 'nativize-chrome' });
    chromeRebuilt = footerOk;
  }

  return { pagesNativized: nativized, pagesTotal: targets.length, marqueeLogos, skipped, chromeRebuilt };
}

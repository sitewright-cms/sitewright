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
import { buildPalette, hoistGlobalModals, mergeTrees, renderTree, type CapturedNode, type NativizeContext } from '@sitewright/site-import';
import { type ContentRepository, SETTINGS_ENTITY_ID, type Settings } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import type { RenderPool } from './render-pool.js';
import { isRawFidelityPage } from '../import/raw-fidelity.js';
import { captureStyledTrees, type BodyBackground } from './nativize-capture.js';

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

/** A Facebook page widget (a `#facebook-page` / FB plugin iframe in a sidebar) doesn't map to an in-flow
 *  sidebar column without dominating every page. Reproduce the source's collapsed LEFT EDGE-TAB instead: a
 *  small fixed vertical tab linking to the FB page. Returns null if no FB page URL is found. */
function fbFloatingTab(sidebarHtml: string | undefined): string | null {
  if (!sidebarHtml || !/facebook\.com/i.test(sidebarHtml)) return null;
  const hrefParam = sidebarHtml.match(/[?&]href=([^&"']+)/i);
  const url = hrefParam ? decodeURIComponent(hrefParam[1]!) : (sidebarHtml.match(/https?:\/\/(?:www\.)?facebook\.com\/[^"'?&\s]+/i)?.[0] ?? '');
  if (!/^https?:\/\/(?:www\.)?facebook\.com\//i.test(url)) return null;
  return `<a href="${escAttr(url)}" target="_blank" rel="noopener" aria-label="Facebook" class="fixed left-0 top-1/2 z-30 hidden -translate-y-1/2 rotate-180 items-center gap-1 rounded-r-md bg-[#1877f2] px-1.5 py-3 text-xs font-semibold uppercase tracking-wide text-white shadow-lg [writing-mode:vertical-rl] transition-[padding] hover:pl-2.5 lg:flex">${'{{sw-icon "brand:facebook" "h-4 w-4 rotate-180"}}'}<span>Facebook</span></a>`;
}

/**
 * A clean, RESPONSIVE, data-driven navbar to replace the imported chrome's hard-coded links: a desktop
 * menu + a CSS-only mobile dropdown, both looping `{{#each nav.header}}` (built from each page's nav
 * config) with `{{sw-active}}` highlighting. No `<nav>` (the platform wraps the topNav slot in one).
 */
function buildNavbar(logo: string | undefined): string {
  // Brand block: logo (if any) + company NAME + SLOGAN (matches the original nav's logo + tagline).
  const brand = `<a href="{{sw-url '/'}}" class="flex shrink-0 items-center gap-3 no-underline">${
    logo ? `<img src="${escAttr(logo)}" alt="{{company.name}}" class="h-12 w-auto max-w-full">` : ''
  }<span class="flex flex-col justify-center leading-tight">
    <span class="font-heading text-base font-bold text-primary lg:text-lg">{{company.name}}</span>
    {{#if company.slogan}}<span class="text-[11px] font-medium text-base-content/70 lg:text-xs">{{company.slogan}}</span>{{/if}}
  </span></a>`;
  // Mobile menu = a left SIDEBAR DRAWER (no-JS, CSS peer-checkbox): hamburger toggles a slide-in panel +
  // dimmed overlay. The checkbox must PRECEDE the overlay/panel for `peer-checked:` to reach them.
  // Full-width SOLID bar (bg-base-100 = white surface) so the site-wide page-background texture never
  // shows THROUGH the header; the inner sw-container holds the brand + links.
  return `<div class="bg-base-100 border-b border-base-200">
  <div class="sw-container flex items-center gap-4 py-3">
  ${brand}
  <ul class="ml-auto flex list-none items-center gap-1 max-lg:hidden">
    {{#each nav.header}}
    <li><a href="{{sw-url path}}" class="rounded px-3 py-2 font-medium no-underline transition-colors {{#if (sw-active path)}}bg-neutral text-neutral-content{{else}}text-base-content hover:bg-base-200{{/if}}">{{sw-label}}</a></li>
    {{/each}}
  </ul>
  <input type="checkbox" id="sw-nav-drawer" class="peer sr-only" aria-label="Open menu">
  <label for="sw-nav-drawer" class="btn btn-ghost btn-square ml-auto lg:hidden">{{sw-icon "menu" "h-6 w-6"}}</label>
  <label for="sw-nav-drawer" class="fixed inset-0 z-40 bg-black/40 opacity-0 pointer-events-none transition-opacity duration-300 peer-checked:opacity-100 peer-checked:pointer-events-auto lg:hidden"></label>
  <div class="fixed inset-y-0 left-0 z-50 w-72 max-w-[80%] -translate-x-full bg-base-100 shadow-xl transition-transform duration-300 peer-checked:translate-x-0 lg:hidden">
    <ul class="menu w-full p-4 pt-16">
      {{#each nav.header}}
      <li><a href="{{sw-url path}}" class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>
      {{/each}}
    </ul>
  </div>
  </div>
</div>`;
}

/** Remove the imported foreign stylesheet `<link>` from `website.head` (keep any other head content). */
function stripForeignStylesheet(head: string | undefined): string {
  return (head ?? '').replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, '').trim();
}

/** The dominant content-container width from a captured (WIDE-viewport) tree: the largest horizontally
 *  CENTERED structural block (a `width:Npx; margin:auto` container caps + shows margins at the wide
 *  capture). → website.containerWidth so the platform `.sw-container` matches the source's max-width. */
export function detectContainerWidth(nodes: readonly CapturedNode[]): number | undefined {
  let best: number | undefined;
  const visit = (n: CapturedNode): void => {
    const w = parseFloat(n.s.width || '0'), ml = parseFloat(n.s['margin-left'] || '0'), mr = parseFloat(n.s['margin-right'] || '0');
    if (w >= 760 && w <= 2000 && ml > 4 && Math.abs(ml - mr) < 3 && n.children.length > 0 && (best === undefined || w > best)) best = w;
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return best;
}

/** Match the captured heading/body font-family to a hosted font asset (kind:'font') by family → an
 *  `identity.typography` so the nativized site renders in the SOURCE's fonts, not the platform defaults. */
export function buildTypography(bodyBg: BodyBackground | undefined, fonts: ReadonlyArray<{ id: string; family: string }>): Record<string, unknown> | undefined {
  if (!bodyBg || fonts.length === 0) return undefined;
  const firstFamily = (stack: string): string => (stack || '').split(',')[0]!.replace(/['"]/g, '').trim();
  const byFamily = new Map(fonts.map((a) => [a.family.toLowerCase(), a]));
  const slot = (font: string, weight: number): Record<string, unknown> | undefined => {
    const fam = firstFamily(font);
    const a = fam ? byFamily.get(fam.toLowerCase()) : undefined;
    return a && /^[A-Za-z0-9][A-Za-z0-9 '-]*$/.test(fam) ? { source: 'asset', family: fam, assetId: a.id, weight } : undefined;
  };
  const t: Record<string, unknown> = {};
  const h = slot(bodyBg.headingFont, 700); if (h) t.heading = h;
  const b = slot(bodyBg.bodyFont, 400); if (b) t.body = b;
  return Object.keys(t).length ? t : undefined;
}

/** Build a site-wide `body{…}` rule from the captured page background, for `website.criticalCss`. The
 *  loopback origin the capture resolved /media against is stripped (→ root-relative). Returns '' for no
 *  meaningful background. (`</style` can't appear — url()/colors only — so it's criticalCss-safe.) */
export function bodyBgCss(bg: BodyBackground | undefined, loopbackOrigin: RegExp): string {
  if (!bg) return '';
  const first = (v: string): string => (v || '').split(',')[0]!.trim();
  const opaque = (c: string): string => (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && !/,\s*0\)$/.test(c) ? c : '');
  // Only take the first layer for a url() STACK — a gradient (`linear-gradient(to right, …, …)`) has commas
  // INSIDE its parens, so splitting on `,` would truncate it to invalid CSS. Keep gradients whole.
  const rawImg = bg.image && bg.image !== 'none' && !/url\(\s*["']?data:/i.test(bg.image) ? bg.image : '';
  const image = rawImg ? (rawImg.trimStart().startsWith('url(') ? first(rawImg) : rawImg).replace(loopbackOrigin, '') : '';
  // The base color BEHIND the image: the body's, else the <html>'s, else WHITE (the browser default the
  // source relied on). Critical for a SEMI-TRANSPARENT texture — without it the platform's (dark) base
  // shows through and the page reads black instead of the source's light grey.
  const color = opaque(bg.color) || opaque(bg.htmlColor) || (image ? '#ffffff' : '');
  if (!image && !color) return '';
  const decls: string[] = [];
  if (color) decls.push(`background-color:${color}`);
  if (image) decls.push(`background-image:${image}`, `background-size:${first(bg.size) || 'auto'}`, `background-position:${first(bg.position) || '0% 0%'}`, `background-repeat:${first(bg.repeat) || 'repeat'}`, `background-attachment:${first(bg.attachment) || 'scroll'}`);
  return `body{${decls.join(';')}}`;
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
  const bodyBgByPath = new Map<string, BodyBackground>(); // page bg per page → prefer the HOME's after the pool
  let containerWidth: number | undefined; // the source content-container max-width → website.containerWidth
  const nativizedPages: Array<{ id: string; html: string; page: Record<string, unknown> }> = []; // → global-modal hoisting

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
      const cap = await capture(doc, { originHostPort: deps.originHostPort, rootSelector: 'body' });
      const { base, md, lg } = cap;
      // Site-wide page bg + fonts: record PER PAGE (distinct Map keys → no concurrency race on a shared
      // scalar); the HOME page is preferred after the pool (its headings give the real heading font; a
      // heading-less page would wrongly fall the heading font back to the body font).
      if (cap.bodyBg && cap.bodyBg.image && cap.bodyBg.image !== 'none') bodyBgByPath.set(page.path ?? '', cap.bodyBg);
      if (!containerWidth) containerWidth = detectContainerWidth(lg); // content-container width (site-wide)
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
      nativizedPages.push({ id: page.id, html, page: updated }); // for global-modal hoisting once the site is native
      nativized += 1;
      marqueeLogos += result.marqueeLogos.length;
    } catch (err) {
      deps.log.warn({ pageId: page.id, err: err instanceof Error ? err.message : String(err) }, 'nativize: page skipped');
      skipped.push(page.id);
    }
    done += 1;
    onProgress({ phase: 'nativize', done, total: targets.length, detail: page.title || page.path || page.id });
  });

  // Site-wide background + fonts come from the HOME page (path ''), else any page that has one.
  const bodyBg: BodyBackground | undefined = bodyBgByPath.get('') ?? [...bodyBgByPath.values()][0];

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
      const bgCss = bodyBgCss(bodyBg, loopbackOrigin); // site-wide PAGE BACKGROUND → criticalCss
      if (bgCss) newWebsite.criticalCss = `${bgCss}${typeof website?.criticalCss === 'string' && website.criticalCss.trim() ? `\n${website.criticalCss}` : ''}`;
      if (containerWidth && containerWidth >= 760 && containerWidth <= 2000) newWebsite.containerWidth = `${Math.round(containerWidth)}px`; // sw-container cap = source's
    }
    // Typography: match the captured heading/body fonts to the hosted @font-face assets → identity.typography
    // so the nativized site renders in the SOURCE fonts (not the platform defaults).
    const fontAssets = ((await deps.contentRepo.list(ctx, 'media')) as Array<{ id: string; kind?: string; family?: string }>)
      .filter((a) => a.kind === 'font' && typeof a.family === 'string').map((a) => ({ id: a.id, family: a.family! }));
    const typography = buildTypography(bodyBg, fontAssets);
    // GLOBAL MODALS → website.bottom: a `<dialog data-sw-component="modal">` repeated across the site lives
    // ONCE in the site-wide slot (rendered on every page); the per-page triggers (`<a href="#id">`) still
    // open it via the platform modal runtime. Page-LOCAL modals stay in their page.
    const { bottom: modalBottom, stripped: strippedPages } = hoistGlobalModals(nativizedPages.map((p) => ({ id: p.id, html: p.html })));
    // Facebook sidebar widget → a fixed left EDGE-TAB in `bottom` (not the full-width in-flow sidebar block).
    const fbTab = fbFloatingTab(typeof website?.sidebarLeft === 'string' ? website.sidebarLeft : undefined);
    if (fbTab) newWebsite.sidebarLeft = '';
    const priorBottom = typeof website?.bottom === 'string' && website.bottom.trim() ? website.bottom : '';
    const bottomParts = [modalBottom, fbTab, priorBottom].filter((s): s is string => Boolean(s));
    if (bottomParts.length) newWebsite.bottom = bottomParts.join('\n');
    if (modalBottom) {
      for (const np of nativizedPages) {
        const h = strippedPages.get(np.id);
        if (h === undefined) continue;
        try {
          validateTemplate(h);
          await deps.contentRepo.put(ctx, 'page', np.id, { ...np.page, source: h }, { op: 'put', note: 'nativize-modal-hoist' });
        } catch (err) {
          deps.log.warn({ pageId: np.id, err: err instanceof Error ? err.message : String(err) }, 'nativize: modal hoist skipped');
        }
      }
    }
    const newSettings = typography ? { ...settings, identity: { ...(settings.identity ?? {}), typography }, website: newWebsite } : { ...settings, website: newWebsite };
    await deps.contentRepo.put(ctx, 'settings', SETTINGS_ENTITY_ID, newSettings, { op: 'put', note: 'nativize-chrome' });
    chromeRebuilt = footerOk;
  }

  return { pagesNativized: nativized, pagesTotal: targets.length, marqueeLogos, skipped, chromeRebuilt };
}

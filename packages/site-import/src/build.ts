// The pure engine entrypoint: a CapturedSite (from either intake) → one or more Sitewright import
// bundles. The only side effect is hosting assets through the injected MediaPort. The result is
// guaranteed `validateTemplate`-clean per page and `validateProject`-clean per bundle.
import {
  CorporateIdentitySchema,
  PROJECT_FORMAT_VERSION,
  WebsiteSettingsSchema,
  type CorporateIdentity,
  type Project,
  type WebsiteSettings,
} from '@sitewright/schema';
import { validateProject } from '@sitewright/core';
import { firstByName, getBody, parse, allByName, type Document, type Element } from './dom.js';
import { normalizePageUrl, resolveUrl, routePath, sameOrigin } from './url-util.js';
import { resolveLimits } from './limits.js';
import { buildRoutes } from './transform/routes.js';
import { collectImageRefs, hostAssets } from './transform/assets.js';
import { collectCss } from './transform/css.js';
import { extractIdentity, extractPageSeo } from './transform/identity.js';
import { extractChrome } from './transform/chrome.js';
import { transformBody, type TransformCtx } from './transform/page.js';
import type { CapturedSite, ImportBundle, ImportDiagnostic, ImportResult, TransformOptions } from './types.js';

interface ParsedPage {
  url: string;
  doc: Document;
  body: Element | undefined;
}

function hostFallbackName(baseUrl: string): string {
  try {
    const h = new URL(baseUrl).hostname.replace(/^www\./, '');
    const label = h.split('.')[0] ?? h;
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Website';
  } catch {
    return 'Website';
  }
}

/** Ordered, deduped, internal page URLs linked from the home page's <header> — the preferred nav order.
 *  Returns [] when there is no <header> (so we don't mistake footer/body links for the nav). */
function extractNavLinks(home: ParsedPage | undefined, baseUrl: string): string[] {
  if (!home?.body) return [];
  const header = firstByName(home.body.children, 'header');
  if (!header) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of allByName([header], 'a')) {
    const href = a.attribs.href;
    if (!href) continue;
    const abs = resolveUrl(href, home.url);
    if (!abs || !sameOrigin(abs, baseUrl)) continue;
    const norm = normalizePageUrl(abs);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function buildWebsite(
  chrome: { topNav?: string; footer?: string },
  css: { criticalCss?: string; headStyle?: string },
): WebsiteSettings | undefined {
  const input: Record<string, string> = {};
  if (chrome.topNav) input.topNav = chrome.topNav;
  if (chrome.footer) input.footer = chrome.footer;
  if (css.criticalCss) input.criticalCss = css.criticalCss;
  if (css.headStyle) input.head = css.headStyle;
  if (Object.keys(input).length === 0) return undefined;
  return WebsiteSettingsSchema.parse(input);
}

export async function buildImportBundle(site: CapturedSite, opts: TransformOptions): Promise<ImportResult> {
  const limits = resolveLimits(opts.limits);
  const defaultLocale = opts.defaultLocale ?? 'en';
  const diagnostics: ImportDiagnostic[] = [];

  const cappedPages = site.pages.slice(0, limits.maxPages);
  if (site.pages.length > limits.maxPages) {
    diagnostics.push({ code: 'page-skipped', message: `only the first ${limits.maxPages} of ${site.pages.length} pages were imported` });
  }
  const workSite: CapturedSite = { ...site, pages: cappedPages };

  const parsed: ParsedPage[] = cappedPages.map((p) => {
    const doc = parse(p.html);
    return { url: p.sourceUrl, doc, body: getBody(doc) };
  });

  // The semantic home page (route "/"), used for both nav-order extraction and identity.
  const home = parsed.find((x) => routePath(x.url, workSite.baseUrl) === '/') ?? parsed[0];

  // Routes / nav (independent of the DOM mutation that follows).
  const navLinks = extractNavLinks(home, workSite.baseUrl);
  const routeRes = buildRoutes(workSite, { navLinks });
  diagnostics.push(...routeRes.diagnostics);

  // Collect + self-host images.
  opts.onProgress?.({ phase: 'host-media', detail: 'collecting assets' });
  const refs = collectImageRefs(parsed.map((x) => ({ url: x.url, doc: x.doc })), workSite);
  const host = await hostAssets(refs, opts.media, limits, opts.onProgress);
  diagnostics.push(...host.diagnostics);
  const assetMap = host.assetMap;

  // CSS + identity + per-page SEO must read the docs BEFORE the transform removes <style>/<script>.
  const css = collectCss(parsed.map((x) => x.doc), workSite, limits);
  if (css.overflow) {
    diagnostics.push({ code: 'css-overflow', message: 'source CSS exceeded the inline slot budget; excess dropped (the AI rewrite re-derives styling)' });
  }

  const identity: CorporateIdentity = home
    ? extractIdentity(home.doc, { baseUrl: home.url, assetMap, fallbackName: hostFallbackName(workSite.baseUrl) })
    : CorporateIdentitySchema.parse({ name: hostFallbackName(workSite.baseUrl) });

  const seoByNorm = new Map<string, ReturnType<typeof extractPageSeo>>();
  for (const x of parsed) {
    const norm = normalizePageUrl(x.url) ?? x.url;
    seoByNorm.set(norm, extractPageSeo(x.doc, { baseUrl: x.url, assetMap }));
  }

  // Hoist shared chrome into slots (mutates docs: removes the hoisted header/footer).
  const chrome = extractChrome(parsed, { siteBase: workSite.baseUrl, internalRoutes: routeRes.internalRoutes, assetMap, limits });
  if (chrome.extracted) {
    const parts = [chrome.topNav ? 'header' : '', chrome.footer ? 'footer' : ''].filter(Boolean).join(' + ');
    diagnostics.push({ code: 'chrome-extracted', message: `hoisted shared ${parts} into the site slots` });
  }

  // Transform each captured page body into source and attach SEO/title by id.
  opts.onProgress?.({ phase: 'transform', total: parsed.length });
  const pageById = new Map(routeRes.pages.map((p) => [p.id, p] as const));
  let scriptsDropped = 0;
  let transformed = 0;
  for (const x of parsed) {
    transformed += 1;
    const norm = normalizePageUrl(x.url) ?? x.url;
    const id = routeRes.idByNormUrl.get(norm);
    const page = id ? pageById.get(id) : undefined;
    if (!page) continue;
    const ctx: TransformCtx = {
      pageUrl: x.url,
      siteBase: workSite.baseUrl,
      internalRoutes: routeRes.internalRoutes,
      assetMap,
      limits,
    };
    const { source, diagnostics: pageDiags } = transformBody(x.doc, ctx);
    diagnostics.push(...pageDiags);
    scriptsDropped += pageDiags.filter((d) => d.code === 'script-dropped').length;
    page.source = source;
    // Mark the captured page for the AI rewrite stage (sourceUrl + rewritten:false; see get_guide("import")).
    page.data = { ...(page.data ?? {}), swImport: { sourceUrl: x.url, rewritten: false, ...(opts.importedAt ? { importedAt: opts.importedAt } : {}) } };
    const seo = seoByNorm.get(norm);
    if (seo?.title) page.title = seo.title;
    if (seo?.description) page.description = seo.description;
    if (seo?.image) page.image = seo.image;
    if (seo?.canonical) page.canonical = seo.canonical;
    if (seo?.noindex) page.noindex = true;
    opts.onProgress?.({ phase: 'transform', done: transformed, total: parsed.length });
  }
  // Imported pages start as DRAFTS — a faithful scaffold shouldn't auto-publish before review/rewrite.
  for (const p of routeRes.pages) p.status = 'draft';

  const website = buildWebsite(chrome, css);
  const bundle: ImportBundle = {
    project: { identity, website, settings: { defaultLocale, locales: [defaultLocale] } },
    pages: routeRes.pages,
    templates: [],
    datasets: [],
    entries: [],
  };

  // Final cross-entity check: any issue is surfaced as a `bundle-invalid` diagnostic — the import route
  // refuses to write a bundle so flagged (the route-layer enforcement of the "valid bundle" invariant).
  const stubProject: Project = {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: 'import',
    name: identity.name.slice(0, 200) || 'Imported site',
    slug: 'import',
    identity,
    settings: { defaultLocale, locales: [defaultLocale] },
  };
  const issues = validateProject({ project: stubProject, pages: bundle.pages, datasets: [], entries: [] });
  for (const issue of issues) {
    diagnostics.push({ code: 'bundle-invalid', message: `${issue.code}: ${issue.message}` });
  }

  return {
    bundles: [bundle],
    diagnostics,
    stats: {
      pages: routeRes.pages.length,
      imagesHosted: host.hosted,
      scriptsDropped,
      chromeExtracted: chrome.extracted,
    },
  };
}

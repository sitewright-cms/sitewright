// The pure engine entrypoint: a CapturedSite (from either intake) → one or more Sitewright import
// bundles. The only side effect is hosting assets through the injected MediaPort. The result is
// guaranteed `validateTemplate`-clean per page and `validateProject`-clean per bundle.
import {
  CorporateIdentitySchema,
  PROJECT_FORMAT_VERSION,
  WebsiteSettingsSchema,
  type CorporateIdentity,
  type Dataset,
  type Entry,
  type Project,
  type WebsiteSettings,
} from '@sitewright/schema';
import { validateProject } from '@sitewright/core';
import { validateTemplate } from '@sitewright/blocks';
import { firstByName, getBody, parse, allByName, type Document, type Element } from './dom.js';
import { normalizePageUrl, resolveUrl, routePath, sameOrigin } from './url-util.js';
import { resolveLimits } from './limits.js';
import { buildRoutes } from './transform/routes.js';
import { applyLocales, detectLocaleSet } from './transform/locales.js';
import { collectImageRefs, hostAssets } from './transform/assets.js';
import { collectCssRefs, buildPageStyles, buildHostableCss } from './transform/css.js';
import { collectFontFaces } from './transform/fonts.js';
import { extractIdentity, extractPageSeo } from './transform/identity.js';
import { extractChrome } from './transform/chrome.js';
import { inferDatasets } from './transform/datasets.js';
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

function buildWebsite(chrome: { topNav?: string; footer?: string }, head?: string): WebsiteSettings | undefined {
  const input: Record<string, string> = {};
  if (chrome.topNav) input.topNav = chrome.topNav;
  if (chrome.footer) input.footer = chrome.footer;
  if (head) input.head = head; // the <link> to the hosted imported stylesheet (tiny; well under HTML_MAX)
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

  // Multilingual: label locale-prefixed pages (/de/…) with locale + translationGroup; derive locales.
  const localeSet = detectLocaleSet(parsed.map((x) => ({ doc: x.doc })));
  const i18n = applyLocales(routeRes.pages, localeSet, defaultLocale);
  if (i18n.locales.length > 1) {
    diagnostics.push({ code: 'locales-detected', message: `detected ${i18n.locales.length} locales (${i18n.locales.join(', ')}); default ${i18n.defaultLocale}` });
  }

  // Collect CSS (incl. its url() image refs, resolved absolute) BEFORE the transform removes <style>,
  // so those images are self-hosted in the same pass as the DOM images.
  const cssCollection = collectCssRefs(parsed.map((x) => ({ url: x.url, doc: x.doc })), workSite);

  // Collect + self-host images (DOM refs + CSS url() refs).
  opts.onProgress?.({ phase: 'host-media', detail: 'collecting assets' });
  const refs = collectImageRefs(parsed.map((x) => ({ url: x.url, doc: x.doc })), workSite);
  for (const [key, asset] of cssCollection.imageRefs) if (!refs.has(key)) refs.set(key, asset);
  // Self-host @font-face web fonts too (keyed like images → the same host pass; buildPageStyles then
  // rewrites the @font-face url() to the hosted file). The page renders rawFidelity, so these fonts
  // — not the platform typography — apply.
  for (const [key, asset] of collectFontFaces(cssCollection.cssText)) if (!refs.has(key)) refs.set(key, asset);
  const host = await hostAssets(refs, opts.media, limits, opts.onProgress);
  diagnostics.push(...host.diagnostics);
  const assetMap = host.assetMap;
  const srcsetMap = host.srcsetMap;

  // Imported CSS (url()s → self-hosted refs). EDITABLE path: host it as ONE inline-served stylesheet
  // and `<link>` it from the head, so the bulk CSS stays OUT of the page source (which stays editable
  // markup). FALLBACK (no hostStylesheet port, e.g. tests): inline a single `<style>` per page. Either
  // way imported pages render in `rawFidelity` so the platform's own base CSS doesn't fight it.
  const hostableCss = buildHostableCss(cssCollection.cssText, assetMap);
  const cssUrl = hostableCss && opts.media.hostStylesheet ? await opts.media.hostStylesheet(hostableCss) : null;
  const cssLink = cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : '';
  const pageStyles = cssUrl ? '' : buildPageStyles(cssCollection.cssText, assetMap);

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
  const usedSlugs = new Set<string>();
  const datasets: Dataset[] = [];
  const entries: Entry[] = [];
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
      srcsetMap,
      limits,
    };
    // Conservative dataset inference (runs BEFORE the transform so its sentinel markers serialize as
    // plain text); each marker is swapped for the generated {{#each}} loop after the page transform.
    const inf = inferDatasets(x.doc, ctx, usedSlugs, `@@SWDS${transformed}_`);
    const { source: rawSource, diagnostics: pageDiags } = transformBody(x.doc, ctx);
    // Splice each loop in, but ONLY keep the dataset if its marker survived the transform AND the swap
    // leaves the page validateTemplate-clean (the marker can be dropped by fitSource or land inside a
    // text fallback). Un-kept markers are stripped so they never leak as visible text.
    let source = rawSource;
    const keptSlugs = new Set<string>();
    for (const [marker, { loop, slug }] of inf.markers) {
      if (source.includes(marker)) {
        const swapped = source.split(marker).join(loop);
        try {
          validateTemplate(swapped);
          source = swapped;
          keptSlugs.add(slug);
          continue;
        } catch {
          /* the swap would invalidate the page → fall through and strip the marker */
        }
      }
      source = source.split(marker).join('');
    }
    // Safety net: scrub any residual marker text (incl. a fragment a fallback truncation cut mid-marker).
    // Requires ≥1 digit after the prefix so a bare "@@SWDS" in real page text is never touched.
    if (inf.markers.size > 0) source = source.replace(/@@SWDS\d+(?:_\d*)?@{0,2}/g, '');
    const keptDatasets = inf.datasets.filter((d) => keptSlugs.has(d.slug));
    datasets.push(...keptDatasets);
    entries.push(...inf.entries.filter((e) => keptSlugs.has(e.dataset)));
    if (keptDatasets.length > 0) diagnostics.push({ code: 'dataset-inferred', message: `inferred ${keptDatasets.length} dataset(s) from repeated content on ${x.url}` });
    diagnostics.push(...pageDiags);
    scriptsDropped += pageDiags.filter((d) => d.code === 'script-dropped').length;
    // Inline the full imported stylesheet at the top of the page so it's an accurate replica (the
    // page renders in rawFidelity → no platform base CSS to fight it). `pageStyles` is already
    // validateTemplate-safe (</style + {{ neutralized) and `source` was validated by transformBody;
    // re-validate the JOIN as defense-in-depth so page.source is ALWAYS validateTemplate-clean, and
    // fall back to the body alone if (unexpectedly) the combination is rejected.
    let finalSource = pageStyles ? `${pageStyles}\n${source}` : source;
    if (pageStyles) {
      // The body was already fit to maxSourceBytes; the prepended CSS can push the total past the
      // PageSchema.source cap (a hard Zod reject) → fall back to the body alone with a diagnostic.
      if (Buffer.byteLength(finalSource, 'utf8') > limits.maxSourceBytes) {
        finalSource = source;
        diagnostics.push({ code: 'css-overflow', message: `full CSS + content exceeds the page size cap on ${x.url}; CSS omitted for this page` });
      }
      try {
        validateTemplate(finalSource); // defense-in-depth: page.source is always validateTemplate-clean
      } catch {
        finalSource = source;
      }
    }
    page.source = finalSource;
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
  // ALL pages (incl. synthesized stub parents) start as DRAFTS — a faithful scaffold shouldn't
  // auto-publish before review/rewrite. Only captured pages carry the swImport marker (set above);
  // stubs have no source HTML to rewrite.
  for (const p of routeRes.pages) p.status = 'draft';

  const website = buildWebsite(chrome, cssLink || undefined);
  const bundle: ImportBundle = {
    project: { identity, website, settings: { defaultLocale: i18n.defaultLocale, locales: i18n.locales } },
    pages: routeRes.pages,
    templates: [],
    datasets,
    entries,
  };

  // Final cross-entity check: any issue is surfaced as a `bundle-invalid` diagnostic — the import route
  // refuses to write a bundle so flagged (the route-layer enforcement of the "valid bundle" invariant).
  const stubProject: Project = {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: 'import',
    name: identity.name.slice(0, 200) || 'Imported site',
    slug: 'import',
    identity,
    settings: { defaultLocale: i18n.defaultLocale, locales: i18n.locales },
  };
  const issues = validateProject({ project: stubProject, pages: bundle.pages, datasets, entries });
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

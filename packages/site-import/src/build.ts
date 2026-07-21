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
import { collectDocumentRefs, collectImageRefs, hostAssets } from './transform/assets.js';
import { collectCssRefs, buildPageStyles, buildHostableCss } from './transform/css.js';
import { collectAndHostScripts } from './transform/scripts.js';
import { collectWidgetIntegrations } from './widgets.js';
import { collectFontFaces } from './transform/fonts.js';
import { parseGoogleFontRefs } from './transform/webfonts.js';
import { applyFoundation, isIconFont, type HostedFont } from './transform/foundation.js';
import { extractIdentity, extractPageSeo } from './transform/identity.js';
import { extractChrome, type ChromeResult } from './transform/chrome.js';
import { inferDatasets, uniquifyEntryIds } from './transform/datasets.js';
import { transformBody, type TransformCtx } from './transform/page.js';
import type { CapturedAsset, CapturedSite, ImportBundle, ImportDiagnostic, ImportResult, TransformOptions } from './types.js';

/** Upper bound on the hosted imported stylesheet (a real site's full minified CSS is far smaller). */
const MAX_HOSTABLE_CSS_BYTES = 2 * 1024 * 1024;

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

/** A clean nav label from a page title: strips a trailing " <sep> Site Name" (— – - | : ·) suffix that
 *  page <title>s carry for SEO ("Programmes — Hatzlacha College" → "Programmes"). Falls back to the
 *  original title if stripping would empty it. */
export function navLabelFromTitle(title: string, siteName: string): string {
  if (!title || !siteName) return title;
  const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`\\s*[-–—|:·]\\s*${esc}\\s*$`, 'i'), '').trim() || title;
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

function buildWebsite(chrome: ChromeResult, head?: string, scripts?: string): WebsiteSettings | undefined {
  const input: Record<string, unknown> = {};
  if (chrome.mainNav) input.mainNav = chrome.mainNav;
  if (chrome.footer) input.footer = chrome.footer;
  if (chrome.sidebarLeft) input.sidebarLeft = chrome.sidebarLeft;
  if (chrome.sidebarRight) input.sidebarRight = chrome.sidebarRight;
  if (head) input.head = head; // the <link> to the hosted imported stylesheet (tiny; well under HTML_MAX)
  if (scripts) input.scripts = scripts; // <script src> links to the self-hosted imported JS (after the body)
  // Enable the platform BACK-TO-TOP explicitly (it's the replacement for the foreign back-to-top buttons
  // stripped from the page bodies; default-on, but set so it's clearly enabled in the editor's settings).
  const effects: Record<string, unknown> = { backToTop: true };
  if (chrome.preloaderEffect) effects.preloaderEffect = chrome.preloaderEffect;
  input.effects = effects;
  return WebsiteSettingsSchema.parse(input);
}

/**
 * The asset id inside a hosted `/media/…` url — the flat `/media/<slug>/<id>-<name>` shape (id = the
 * run before the first hyphen of the file segment) or the legacy `/media/<slug>/<id>/<file>` shape (id
 * = the whole 2nd segment, hyphenated old uuids included).
 */
function hostedAssetId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const parts = (url.split('?')[0] ?? '').split('/'); // ['', 'media', slug, seg, file?, …]
  if (parts[1] !== 'media' || parts.length < 4) return undefined;
  if (parts.length >= 5) return parts[3] || undefined; // legacy: a full <id> segment
  const seg = parts[3] ?? '';
  const dash = seg.indexOf('-'); // flat: <id>-<name>
  return dash > 0 ? seg.slice(0, dash) : undefined;
}

/**
 * The self-hosted web fonts as `{ family, assetId, weight, style }` — the foundation extractor matches
 * the page's heading/body families against these to wire native typography. The `assetId` is parsed from
 * the hosted media path, deduped per asset+weight.
 */
function collectHostedFonts(refs: ReadonlyMap<string, CapturedAsset>, assetMap: ReadonlyMap<string, string>): HostedFont[] {
  const out: HostedFont[] = [];
  const seen = new Set<string>();
  for (const [key, asset] of refs) {
    if (asset.kind !== 'font' || !asset.font) continue;
    const id = hostedAssetId(assetMap.get(key));
    if (!id) continue;
    const dedupe = `${id}|${asset.font.weight}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ family: asset.font.family, assetId: id, weight: asset.font.weight, style: asset.font.style });
  }
  return out;
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
  // In FOUNDATION mode the foreign CSS is discarded, so its icon fonts (FontAwesome/icomoon/…) are dead
  // weight — don't self-host them (they'd otherwise litter the media library). Brand text fonts ARE kept
  // (the foundation matches them into identity.typography).
  for (const [key, asset] of collectFontFaces(cssCollection.cssText)) {
    if (opts.foundation && isIconFont(asset.font?.family)) continue;
    if (!refs.has(key)) refs.set(key, asset);
  }
  // Self-host Google-Fonts families referenced via a `<link>`/`@import` (a page that loads its fonts from
  // the CDN, with NO `@font-face` of its own) — download the woff2 server-side (route-provided hook) and
  // add each weight as a captured font asset, so the clone renders its real fonts locally (never a CDN)
  // and the foundation extractor matches them into identity.typography.
  if (opts.fetchWebfont) {
    const pageHtml = cappedPages.map((p) => p.html).join('\n');
    const webfonts = parseGoogleFontRefs(pageHtml).filter((r) => !(opts.foundation && isIconFont(r.family)));
    const hosted: string[] = [];
    for (const ref of webfonts) {
      const faces = await opts.fetchWebfont(ref.family, ref.weights).catch(() => []);
      for (const face of faces) {
        const key = `googlefont:${ref.family.toLowerCase()}:${face.weight}`;
        if (!refs.has(key)) refs.set(key, { sourceRef: key, kind: 'font', bytes: face.bytes, font: { family: ref.family, weight: face.weight, style: 'normal' } });
      }
      if (faces.length) hosted.push(ref.family);
    }
    if (hosted.length) diagnostics.push({ code: 'webfonts-hosted', message: `self-hosted Google Fonts: ${hosted.join(', ')}` });
  }
  // Self-host linked documents (PDFs/docs) too, so a `<a href="brochure.pdf">` keeps working off /media.
  for (const [key, asset] of collectDocumentRefs(parsed.map((x) => ({ url: x.url, doc: x.doc })))) if (!refs.has(key)) refs.set(key, asset);
  const host = await hostAssets(refs, opts.media, limits, opts.onProgress);
  diagnostics.push(...host.diagnostics);
  const assetMap = host.assetMap;
  const srcsetMap = host.srcsetMap;

  // Imported CSS (url()s → self-hosted refs). EDITABLE path: host it as ONE inline-served stylesheet
  // and `<link>` it from the head, so the bulk CSS stays OUT of the page source (which stays editable
  // markup). FALLBACK (no hostStylesheet port, e.g. tests): inline a single `<style>` per page. Either
  // way imported pages render in `rawFidelity` so the platform's own base CSS doesn't fight it.
  let hostableCss = buildHostableCss(cssCollection.cssText, assetMap);
  // Cap the hosted CSS so a pathological source (e.g. a ZIP packed with megabytes of CSS) can't
  // exhaust disk/memory — real sites' full minified CSS is well under this. Over the cap → drop it.
  if (hostableCss && Buffer.byteLength(hostableCss, 'utf8') > MAX_HOSTABLE_CSS_BYTES) {
    hostableCss = '';
    diagnostics.push({ code: 'css-overflow', message: `imported CSS exceeds ${Math.round(MAX_HOSTABLE_CSS_BYTES / 1024)} KB; omitted` });
  }
  // FOUNDATION mode DISCARDS the foreign stylesheet entirely — it is NOT hosted and NOT linked. It used to
  // be self-hosted + linked into website.head for the mechanical nativizer (which read each page's computed
  // styles off a foreign-styled headless render); that nativizer is RETIRED, so the link's only consumer is
  // gone. Left in, the foreign CSS's high-specificity/!important rules FIGHT the native authored pages and
  // it's ~600 KB of dead weight — so foundation clones stand on native CSS alone. The LITERAL/raw import
  // (rawFidelity replica) still hosts + links it below, because that mode IS the foreign site verbatim.
  const cssUrl = !opts.foundation && hostableCss && opts.media.hostStylesheet ? await opts.media.hostStylesheet(hostableCss) : null;
  const cssLink = cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : '';
  const pageStyles = opts.foundation || cssUrl ? '' : buildPageStyles(cssCollection.cssText, assetMap);

  // Self-host the imported site's scripts (inline + external) as `<script src>` links for the
  // website.scripts slot — done BEFORE the transform strips <script> from page sources/chrome. Empty
  // string when the media port has no `hostScript` (the safe, scripts-dropped default) or in foundation mode.
  const scriptLinks = opts.foundation ? '' : await collectAndHostScripts(parsed, opts.media);
  // Known 3rd-party WIDGET scripts (weather/chat/reviews) → functional consent integrations. Detected NOW,
  // before the transform strips <script> — applied to the website below (both modes: a widget is a foreign
  // integration the clone should reproduce, independent of the scripts-dropped/foundation behaviour).
  const widgetIntegrations = collectWidgetIntegrations(parsed.map((x) => x.doc));

  const identity: CorporateIdentity = home
    ? extractIdentity(home.doc, { baseUrl: home.url, assetMap, fallbackName: hostFallbackName(workSite.baseUrl) })
    : CorporateIdentitySchema.parse({ name: hostFallbackName(workSite.baseUrl) });

  const seoByNorm = new Map<string, ReturnType<typeof extractPageSeo>>();
  for (const x of parsed) {
    const norm = normalizePageUrl(x.url) ?? x.url;
    seoByNorm.set(norm, extractPageSeo(x.doc, { baseUrl: x.url, assetMap }));
  }

  // Hoist shared chrome into its slots (mutates docs: removes the hoisted regions + preloader/cookie cruft).
  // In FOUNDATION mode the chrome is rebuilt natively, so also strip any foreign chrome left inline (the
  // < 60%-shared pages) — otherwise the native nav/footer renders on top of a leftover foreign one.
  const chrome = extractChrome(
    parsed,
    { siteBase: workSite.baseUrl, internalRoutes: routeRes.internalRoutes, assetMap, limits },
    { stripUnsharedChrome: opts.foundation },
  );
  if (chrome.extracted) {
    const parts = [
      chrome.mainNav && 'header→mainNav',
      chrome.sidebarLeft && 'sidebar→left',
      chrome.sidebarRight && 'sidebar→right',
      chrome.footer && 'footer',
      chrome.preloaderEffect && 'preloader→platform',
    ].filter(Boolean).join(', ');
    diagnostics.push({ code: 'chrome-extracted', message: `hoisted shared chrome into the site slots: ${parts}` });
  }

  // Transform each captured page body into source and attach SEO/title by id.
  opts.onProgress?.({ phase: 'transform', total: parsed.length });
  const pageById = new Map(routeRes.pages.map((p) => [p.id, p] as const));
  const usedSlugs = new Set<string>();
  // Entry ids are DATASET-SCOPED storage keys — this set holds `slug id` keys (see inferDatasets) so ids
  // are deduped per-dataset across the whole import; the same clean `row_1` may recur in another dataset.
  const usedEntryIds = new Set<string>();
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
    const inf = inferDatasets(x.doc, ctx, usedSlugs, usedEntryIds, `@@SWDS${transformed}_`);
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
    // A LITERAL import keeps the foreign CSS/JS → render the page as RAW HTML so the platform's own CSS/JS
    // never fights it. A FOUNDATION import discards all foreign CSS/JS → render NATIVE (no rawHtml), so the
    // page is styled by the platform sheet from the start (and an agent's nativization is visible at once).
    if (!opts.foundation) page.rawHtml = true;
    const seo = seoByNorm.get(norm);
    if (seo?.title) page.title = seo.title;
    // NAV LABEL: page titles usually carry a " — Site Name" suffix; the nav menu should show just the page
    // name (the full title stays for <title>/SEO). Only for pages actually in a nav slot.
    if (page.nav && page.title && identity.name) {
      const navTitle = navLabelFromTitle(page.title, identity.name);
      if (navTitle !== page.title) page.nav = { ...page.nav, title: navTitle };
    }
    if (seo?.description) page.description = seo.description;
    if (seo?.image) page.image = seo.image;
    if (seo?.canonical) page.canonical = seo.canonical;
    if (seo?.noindex) page.noindex = true;
    let pageLabel: string;
    try { pageLabel = new URL(x.url).pathname || '/'; } catch { pageLabel = x.url; }
    opts.onProgress?.({ phase: 'transform', done: transformed, total: parsed.length, detail: page.title ? `${page.title} · ${pageLabel}` : pageLabel });
  }
  // Captured pages (real imported content, marked with swImport) are PUBLISHED so the imported site is
  // live by default; synthesized stub parents (no source HTML) stay DRAFT so an empty placeholder never
  // goes live. The subsequent nativize keeps published pages published.
  for (const p of routeRes.pages) p.status = (p.data as { swImport?: unknown } | undefined)?.swImport ? 'published' : 'draft';

  // The foreign stylesheet <link> IS wired into website.head even in FOUNDATION mode — the nativize capture
  // needs it to read real computed styles (see the cssUrl note above); nativize strips it at finalize. Only
  // foreign SCRIPTS stay discarded in foundation mode (the extractor replaces chrome/theme; JS isn't needed).
  let website = buildWebsite(chrome, cssLink || undefined, opts.foundation ? undefined : scriptLinks || undefined);
  let bundleIdentity = identity;
  let bundlePages = routeRes.pages;
  if (opts.foundation) {
    const fnd = applyFoundation({
      cssText: cssCollection.cssText,
      identity,
      website,
      pages: routeRes.pages,
      hostedFonts: collectHostedFonts(refs, assetMap),
      assetMap,
      preloaderRemoved: diagnostics.some((d) => d.code === 'preloader-removed'),
    });
    bundleIdentity = fnd.identity;
    website = fnd.website;
    bundlePages = fnd.pages;
    diagnostics.push(...fnd.diagnostics);
  }
  // Register detected 3rd-party widget scripts as functional consent integrations + turn the consent manager
  // ON (the ONLY way a strict `script-src 'self'` site can load foreign JS; it's gated behind the banner, the
  // privacy-correct behaviour). Merges onto whatever consent the chrome/foundation already set.
  if (widgetIntegrations.length && website) {
    const prev = website.consent ?? {};
    const existing = prev.integrations ?? [];
    const existingIds = new Set(existing.map((i) => i.id));
    const slots = Math.max(0, 20 - existing.length); // don't let widgets evict integrations the chrome already set
    const added = widgetIntegrations.filter((i) => !existingIds.has(i.id)).slice(0, slots); // skip already-registered providers
    if (added.length) {
      website = WebsiteSettingsSchema.parse({ ...website, consent: { ...prev, enabled: true, integrations: [...existing, ...added] } });
      diagnostics.push({ code: 'widget-consent-registered', message: `registered 3rd-party widget script(s) as functional consent integrations (gated behind the cookie banner): ${added.map((i) => i.name).join(', ')}` });
    }
  }
  // Entry ids must be unique across the WHOLE bundle (the content store keys entries by `entityId` per
  // project). Per-page dataset extraction only dedupes within a dataset, so a dataset folded on multiple
  // pages collides — re-key the duplicates globally before validation.
  uniquifyEntryIds(entries);

  const bundle: ImportBundle = {
    project: { identity: bundleIdentity, website, settings: { defaultLocale: i18n.defaultLocale, locales: i18n.locales } },
    pages: bundlePages,
    templates: [],
    datasets,
    entries,
  };

  // Final cross-entity check: any issue is surfaced as a `bundle-invalid` diagnostic — the import route
  // refuses to write a bundle so flagged (the route-layer enforcement of the "valid bundle" invariant).
  const stubProject: Project = {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: 'import',
    name: bundleIdentity.name.slice(0, 200) || 'Imported site',
    slug: 'import',
    identity: bundleIdentity,
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

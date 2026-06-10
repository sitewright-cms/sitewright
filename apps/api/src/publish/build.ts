import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { minify as minifyHtmlDocument } from 'html-minifier-terser';
import {
  allRoutes,
  buildNav,
  collectClassNames,
  datasetEntries,
  keyedDatasets,
  extractClassNames,
  publishedPages,
  relativeRoot,
  resolveTemplateSource,
  GLOBAL_TEMPLATE_PREFIX,
  resolveLocaleDatasets,
  resolveCodeRef,
  translationsOf,
  localeOf as localeOfPage,
  pagesInLocale,
  pagePath,
  pagesById,
  childrenOf,
  parentPageView,
  referencesChildren,
  referencesParentPage,
  type ProjectBundle,
} from '@sitewright/core';
import type { Page, Template } from '@sitewright/schema';
import {
  renderDocument,
  renderTemplate,
  TemplateError,
  type TemplateContext,
  resolveInternalUrl,
  relativizeInternalLinks,
  usedComponentTypes,
  componentAssets,
  usesAnimations,
  treeUsesAnimations,
  ANIMATION_CSS,
  ANIMATION_JS,
  usesLazyload,
  treeUsesLazyload,
  LAZYLOAD_CSS,
  LAZYLOAD_JS,
  usesRipple,
  treeUsesRipple,
  RIPPLE_CSS,
  RIPPLE_JS,
} from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { companyToOrganization } from './company-seo.js';
import { renderSitemap, renderRobots, renderHtaccess, renderNetlifyRedirects, siteUrlFor, siteBase } from './seo.js';
import { renderContactPhp, hasContactPhpForm } from './contact-php.js';
import { toPublicForm, type FormPublic, type MediaAsset } from '@sitewright/schema';

/** The compiled utility stylesheet, written at the site root and linked per page. */
const UTILITY_STYLESHEET = 'styles.css';
/** The platform component-behavior bundle, written at the site root and linked per page. */
const COMPONENT_SCRIPT = 'components.js';
/** The scroll-reveal (data-aos) runtime, written at the site root and linked per page. */
const ANIMATION_SCRIPT = 'animations.js';
/** The lazy-load (data-bg / lazyload) runtime, written at the site root and linked per page. */
const LAZYLOAD_SCRIPT = 'lazyload.js';
/** The ripple (waves-effect) runtime, written at the site root and linked per page. */
const RIPPLE_SCRIPT = 'ripple.js';

/** A static `{{> name}}` / `{{#> name}}` partial include (snippet names are identifier-safe). */
const PARTIAL_REF = /\{\{~?\s*#?>\s*([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * The subset of `snippets` actually reachable from the published surfaces — every `{{> name}}`
 * a page/template/slot source includes, expanded transitively (a snippet may compose another).
 * Only these contribute to the shared utility sheet / runtime markers, so a defined-but-unused
 * snippet (notably a built-in global the site never composes) adds no weight to the output.
 */
function referencedSnippets(rootSources: readonly (string | undefined)[], snippets: Record<string, string>): Record<string, string> {
  const used = new Set<string>();
  const queue: string[] = [];
  const scan = (src: string | null | undefined): void => {
    if (!src) return;
    for (const m of src.matchAll(PARTIAL_REF)) {
      const name = m[1]!;
      if (name in snippets && !used.has(name)) {
        used.add(name);
        queue.push(name); // a referenced snippet may itself compose others
      }
    }
  };
  for (const s of rootSources) scan(s);
  while (queue.length) scan(snippets[queue.shift()!]);
  return Object.fromEntries(Object.entries(snippets).filter(([n]) => used.has(n)));
}

/** A client-correctable publish failure (bad route graph) → maps to HTTP 409. */
export class PublishError extends Error {}

/** Metadata about one published build. */
export interface ReleaseManifest {
  publishedAt: string;
  routes: number;
  bytes: number;
}

// Output path segments come from validated routes, but we still reject anything
// that could traverse, then confine the resolved path to the output directory.
// `%` is excluded: Fastify percent-decodes serve paths, so a `%`-bearing slug
// would be written but never reachably served.
const SAFE_OUT_SEGMENT = /^[A-Za-z0-9._~-]+$/;

// Bound the total bytes a single build writes to disk. A pathological project
// (e.g. a large raw-HTML embed repeated across a big collection) could otherwise
// fill the disk during the in-process build, before the 100 MiB archive cap that
// only applies at export time. Matches that archive cap; operator-configurable.
const DEFAULT_MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

function relPathForSlug(slug: string | undefined): string {
  if (!slug) return 'index.html';
  const segments = slug.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || !SAFE_OUT_SEGMENT.test(segment)) {
      throw new PublishError(`unsafe route segment: ${segment}`);
    }
  }
  return join(...segments, 'index.html');
}

export interface BuildSiteOptions {
  /** Absolute output directory for this project's site. */
  outDir: string;
  bundle: ProjectBundle;
  /** ISO timestamp for the release (injected for deterministic tests). */
  publishedAt: string;
  /** Project media metadata (enables optimized, bundled `<picture>` output). */
  media?: readonly MediaAsset[];
  /** Reads a media binary (assetId, file) — used to copy assets (incl. `kind:'font'`) into the artifact. */
  readMedia?: (assetId: string, file: string) => Promise<Buffer>;
  /** Max total HTML/CSS bytes written before aborting (default 100 MiB). */
  maxOutputBytes?: number;
  /**
   * The Sitewright platform's public base URL (e.g. `https://cms.agency.com`).
   * Exported `Form` blocks post to `<publicBaseUrl>/f/<projectId>/<formId>`; when
   * unset, a same-origin `/f/…` path is emitted (works only when the export is
   * served by the platform itself, e.g. the in-container preview).
   */
  publicBaseUrl?: string;
  /** Instance hCaptcha site key (public) — rendered into forms that require hCaptcha. */
  hcaptchaSiteKey?: string;
  /**
   * The publish-time JSON snapshot fetched from `website.jsonDataUrl` (already SSRF-guarded,
   * fetched + parsed in the main process). Exposed to templates as `{{ website.json_data }}`.
   */
  jsonData?: unknown;
  /**
   * Reusable Handlebars partials (snippet name → source) a source page can compose with
   * `{{> name}}`. Validated by `renderTemplate` like the page source. Matches the editor preview,
   * which already loads these — this closes the publish-side gap.
   */
  snippets?: Record<string, string>;
  /**
   * The runtime GLOBAL template library (admin-edited `global:<id>` templates), stored with bare ids.
   * Omitted → `resolveTemplateSource` uses the built-in constants. Threaded to the isolated worker.
   */
  globalTemplates?: Template[];
  /** Minify each rendered page's HTML before writing (the `website.minifyHtml` publish option). */
  minifyHtml?: boolean;
}

/** The published directory that holds each project's bundled asset binaries. */
export const ASSET_DIR = '_assets';

/**
 * Conservatively minify a rendered page (the `website.minifyHtml` option). `conservativeCollapse`
 * collapses whitespace runs to a single space (never to zero) so inline-element spacing is preserved;
 * inline CSS/JS are left untouched (already compiled/minified upstream). Falls back to the original
 * HTML if the minifier throws on some edge case — minification is cosmetic and must never fail a publish.
 */
async function minifyPageHtml(html: string): Promise<string> {
  try {
    return await minifyHtmlDocument(html, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      removeComments: true,
      keepClosingSlash: true,
      caseSensitive: true,
      minifyCSS: false,
      minifyJS: false,
    });
  } catch {
    return html;
  }
}

/**
 * Copies every media asset's files into `<base>/_assets/<assetId>/` (path-safe). Image
 * variants/fallback land directly under the asset dir; a RAW (non-image) blob goes under a
 * `file/` segment — mirroring the editor URL (`/media/<projectId>/<assetId>/file/<name>`), so
 * the publish-time media rewrite maps both kinds to the right bundled path.
 */
async function copyMedia(
  base: string,
  media: readonly MediaAsset[],
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
): Promise<void> {
  for (const asset of media) {
    // Image assets carry optimized variants + a fallback; a font carries its face files; a raw file
    // is a single stored blob. Images + fonts land flat in the asset dir (their URL has no `/file/`);
    // a raw blob is nested under `file/` so its bundled path matches its served URL.
    const files =
      asset.kind === 'image'
        ? [asset.fallback, ...asset.variants.map((v) => v.path)]
        : asset.kind === 'font'
          ? asset.files.map((f) => f.file)
          : [asset.storedName];
    const dir = join(base, ASSET_DIR, asset.id);
    const writeDir = asset.kind === 'file' ? join(dir, 'file') : dir;
    // asset.id is IdSchema-validated; file names are FileNameSchema-validated.
    /* v8 ignore next -- defensive: validated id can't escape */
    if (!resolve(dir).startsWith(base + sep)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets
    await mkdir(writeDir, { recursive: true });
    for (const file of files) {
      const target = resolve(writeDir, file);
      /* v8 ignore next -- defensive: validated file name can't escape */
      if (!target.startsWith(resolve(writeDir) + sep)) continue;
      try {
        const data = await readMedia(asset.id, file);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets/<id>
        await writeFile(target, data);
      } catch (err) {
        // A missing variant is tolerable; any other I/O error (disk full,
        // permissions) must fail the build so a partial artifact isn't swapped in.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
  }
}

/**
 * Generates a static site for a project bundle: one `index.html` per route
 * (static pages + collection pages expanded per published entry), rendered by
 * the pure `@sitewright/blocks` renderer. Drafts are excluded (published build).
 * Pure Node — no Astro toolchain — so it runs inside the single API container.
 *
 * The artifact is SELF-CONTAINED: uploaded media is copied into `media/` and
 * referenced by page-relative paths, and Image blocks render optimized
 * `<picture>` (AVIF/WebP + fallback), so the export works unchanged on any
 * external webspace (the product exports; it does not host).
 *
 * NOTE (fidelity): styling uses the framework-free renderer's brand-variable CSS
 * rather than a full Tailwind build — close, not byte-identical to a hypothetical
 * Astro build. NOTE (in-container preview): `/sites/<slug>/` is a build
 * preview only; the downloadable/deployable artifact is the product.
 *
 * The site is built into a sibling temp dir and swapped in via `rename`, so a
 * mid-build failure leaves the previously-published site intact.
 */
export async function buildSite(opts: BuildSiteOptions): Promise<ReleaseManifest> {
  const { outDir, bundle, publishedAt } = opts;
  const media = opts.media ?? [];
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const base = resolve(outDir);
  const tmp = `${base}.tmp`;

  // Drafts are excluded from the published site: filter once, so routes, auto-nav,
  // and the sitemap all see only published pages. Draft *collection pages* are
  // excluded here too (collectionRoutes iterates this filtered set); draft
  // *collection entries* are filtered separately inside collectionRoutes.
  const pubBundle: ProjectBundle = { ...bundle, pages: publishedPages(bundle.pages) };
  let routes;
  try {
    routes = allRoutes(pubBundle);
  } catch (err) {
    // e.g. duplicate route slugs — author-correctable.
    throw new PublishError(err instanceof Error ? err.message : 'invalid route graph');
  }

  await rm(tmp, { recursive: true, force: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- tmp derives from a resolved, validated dir
  await mkdir(tmp, { recursive: true });
  try {
    const datasets = datasetEntries(bundle);
    // The unified Corporate Identity drives BOTH the brand tokens (CSS vars/theme)
    // and the schema.org/favicon/OG fields; it's project-level, computed once.
    const identity = bundle.project.identity;
    const brand = identity;
    const baseOrg = companyToOrganization(identity, bundle.project.name);
    // Project-wide website settings (raw head/criticalCss/scripts + validated slots) — same for every page.
    const website = bundle.project.website;
    // Auto-nav: page-tree-derived menus per slot (same for every page; consumed by Nav blocks
    // and code-first skeleton slots via `{{#each nav.header}}`).
    const nav = {
      header: buildNav(pubBundle.pages, 'header'),
      footer: buildNav(pubBundle.pages, 'footer'),
      mobile: buildNav(pubBundle.pages, 'mobile'),
    };
    // Multilingual model (see docs/i18n-content-model.md): a locale VARIANT of a
    // page is itself a Page (own path/title/seo/content), so each route renders
    // ONCE at its own path. The page's `locale` drives `<html lang>` + which
    // dataset variant (`<slug>_<locale>`) its bindings resolve to; `translationGroup`
    // drives the hreflang alternates. No per-locale loop / tree overrides.
    const settings = bundle.project.settings;
    const defaultLocale = settings?.defaultLocale ?? 'en';
    const localeOf = (p: Page): string => localeOfPage(p, defaultLocale);
    /** A page path → its output slug (home '/' → undefined; else the path without the leading '/'). */
    const slugForPath = (p: string): string | undefined => {
      const s = p.replace(/^\/+/, '').replace(/\/+$/, '');
      return s === '' ? undefined : s;
    };
    // Auto-nav is built PER LOCALE — each locale's menus list only that locale's
    // pages, using their own (already-localized) paths. No link rebasing.
    const navByLocale = new Map<string, typeof nav>();
    for (const loc of new Set(pubBundle.pages.map(localeOf))) {
      const pagesIn = pagesInLocale(pubBundle.pages, loc, defaultLocale);
      navByLocale.set(loc, {
        header: buildNav(pagesIn, 'header'),
        footer: buildNav(pagesIn, 'footer'),
        mobile: buildNav(pagesIn, 'mobile'),
      });
    }
    // Index for computing each page's full route (`{root}/{parent slugs}/{slug}`) — a
    // page's `path` is only its own slug segment.
    const byId = pagesById(pubBundle.pages);

    // Compile a Tailwind utility sheet / ship component CSS+JS only when used.
    // Sites using none get the previous output (no extra file/request).
    const scanRoots = routes.map((r) => r.root);
    // A page's EFFECTIVE source: its referenced template's (project entity or built-in
    // global) when set, else its own. An unknown reference is an author-correctable
    // publish failure — never a silently blank page.
    const templateMap = new Map<string, Template>((bundle.templates ?? []).map((t) => [t.id, t]));
    // The runtime global-template library (admin-edited), keyed by the full `global:<id>` ref.
    // `undefined` when not supplied so `resolveTemplateSource` falls back to the built-in constants.
    const globalTemplateMap = opts.globalTemplates
      ? new Map<string, Template>(opts.globalTemplates.map((t) => [GLOBAL_TEMPLATE_PREFIX + t.id, t]))
      : undefined;
    const effectiveSource = (page: Page): string | undefined => {
      // A locale variant in INHERIT mode (no own source/template) follows its
      // translation-group owner's code; `resolveCodeRef` returns the owner's source or
      // template ref. Resolve against the FULL page set so a published variant still
      // finds a (rare) draft owner's code. See docs/i18n-content-model.md.
      const ref = resolveCodeRef(page, bundle.pages, defaultLocale);
      if (ref.template) {
        try {
          return resolveTemplateSource(ref.template, templateMap, globalTemplateMap);
        } catch (err) {
          throw new PublishError(err instanceof Error ? err.message : `unknown template: ${ref.template}`);
        }
      }
      return ref.source;
    };
    // Code-first source-pages (and the templates they reference) contribute their
    // literal Tailwind classes to the shared sheet.
    const effectiveSources = routes
      .map((r) => effectiveSource(r.page))
      .filter((s): s is string => Boolean(s));
    const sourceClassNames = effectiveSources.flatMap((s) => extractClassNames(s));
    // Project-wide skeleton slots feed the shared sheet too.
    const slotSources = [
      website?.topNav,
      website?.mobileNav,
      website?.sidebarLeft,
      website?.sidebarRight,
      website?.footer,
      website?.bottom,
    ].filter((s): s is string => Boolean(s));
    const slotClassNames = slotSources.flatMap((s) => extractClassNames(s));
    // Only the snippets a page/template/slot actually composes (transitively) contribute — an
    // un-composed snippet (including a built-in global) ships nothing, so a utility-free site
    // stays utility-free.
    const usedSnippets = referencedSnippets([...effectiveSources, ...slotSources], opts.snippets ?? {});
    // {{> snippet}} partials a source page composes contribute their classes too.
    const snippetClassNames = Object.values(usedSnippets).flatMap((s) => extractClassNames(s));
    const classNames = [
      ...scanRoots.flatMap(collectClassNames),
      ...sourceClassNames,
      ...slotClassNames,
      ...snippetClassNames,
    ];
    const usesUtilities = classNames.length > 0;
    const componentTypes = [...new Set(scanRoots.flatMap(usedComponentTypes))];
    const usesComponents = componentTypes.length > 0;
    const components = componentAssets(componentTypes);
    // Scroll-reveal animations (`data-aos`) ship the first-party runtime only when
    // some authored surface uses the attribute — block trees (raw Html embeds),
    // code-first page sources, skeleton slots, or snippets. Same only-used-ships
    // discipline as components.js; unused sites get byte-identical output.
    // Each platform runtime (animations / lazyload / ripple) ships only when some
    // authored surface uses its marker — block trees (raw Html embeds), code-first
    // page sources, skeleton slots, or snippets. Same only-used-ships discipline.
    const usesMarker = (
      treeFn: (r: Page['root']) => boolean,
      strFn: (s: string | null | undefined) => boolean,
    ): boolean =>
      scanRoots.some(treeFn) ||
      routes.some((r) => strFn(effectiveSource(r.page))) ||
      slotSources.some(strFn) ||
      Object.values(usedSnippets).some(strFn);
    const usesAnims = usesMarker(treeUsesAnimations, usesAnimations);
    const usesLazy = usesMarker(treeUsesLazyload, usesLazyload);
    const usesWaves = usesMarker(treeUsesRipple, usesRipple);
    // Public form definitions (recipient stripped) + the absolute submission
    // endpoint for exported `Form` blocks. Built once (same for every page).
    const forms: Record<string, FormPublic> = Object.fromEntries(
      (bundle.forms ?? []).map((f) => [f.id, toPublicForm(f)]),
    );
    const formBase = (opts.publicBaseUrl ?? '').replace(/\/+$/, '');
    const formEndpoint = (formId: string): string => `${formBase}/f/${bundle.project.id}/${formId}`;
    let bytes = 0;
    // Absolute URLs for sitemap.xml (when a production site URL is configured);
    // noindex pages are excluded.
    const siteUrl = website?.siteUrl;
    const sitemapUrls: Array<{ loc: string; lastmod?: string }> = [];

    // Bundle media into the artifact so the export is self-contained + portable.
    // copyMedia handles every kind — images, raw files, AND `kind:'font'` (a font's faces are
    // bundled flat under `_assets/<id>/`, so its `@font-face` media url resolves in the export).
    if (media.length > 0 && opts.readMedia) {
      await copyMedia(tmp, media, opts.readMedia);
    }

    // Render a project-wide skeleton slot (topNav/mobileNav/sidebarLeft/sidebarRight/footer/bottom)
    // for a page, validated; an unsafe or
    // invalid slot fails the publish with a clear, slot-scoped error. Hoisted above the loops
    // so the closure isn't rebuilt per page.
    const renderSlot = (src: string | undefined, name: string, ctx: TemplateContext): string | undefined => {
      if (!src) return undefined;
      try {
        return renderTemplate(src, ctx);
      } catch (err) {
        throw new PublishError(
          err instanceof TemplateError ? `website ${name} template error: ${err.message}` : `website ${name} failed to render`,
        );
      }
    };

    // Each route (incl. every locale variant, which is its own Page) renders ONCE
    // at its own path. Guard against two routes resolving to the same output file.
    const writtenPaths = new Set<string>();
    {
      for (const route of routes) {
        // `route.root` is the page's block tree with partials expanded (used for
        // block-tree pages; code-first pages render from `source` instead).
        const page = { ...route.page, root: route.root };
        const pageLocale = localeOf(page);
        const navForPage = navByLocale.get(pageLocale) ?? nav;
        const outSlug = route.slug;
        const full = resolve(tmp, relPathForSlug(outSlug));
        if (full !== tmp && !full.startsWith(tmp + sep)) {
          throw new PublishError('route output escapes the publish directory');
        }
        if (writtenPaths.has(full)) {
          throw new PublishError(`output path collision at "/${outSlug ?? ''}" — two pages resolve to the same URL`);
        }
        writtenPaths.add(full);
        // Sitemap: indexable pages only (skip noindex), absolute URLs. lastmod is a
        // W3C date (YYYY-MM-DD) — the subset crawlers reliably accept.
        if (siteUrl && !page.seo?.noindex) {
          sitemapUrls.push({ loc: siteUrlFor(siteUrl, outSlug), lastmod: publishedAt.slice(0, 10) });
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
        await mkdir(dirname(full), { recursive: true });
        // Internal page links + assets are relative to this page's depth (portable).
        const siteRoot = relativeRoot(outSlug);
        const rel = (src: string | undefined): string | undefined =>
          src ? resolveInternalUrl(src, siteRoot) : undefined;
        const organization = baseOrg
          ? { ...baseOrg, logo: rel(baseOrg.logo), image: rel(baseOrg.image) }
          : undefined;
        // hreflang alternates from the page's translation group (its locale variants),
        // as absolute URLs (Google requires absolute hreflang hrefs); x-default points
        // at the default-locale variant. Only for a configured site URL + indexable pages.
        const group = translationsOf(pubBundle.pages, page, defaultLocale);
        const xDefault = group.find((m) => m.locale === defaultLocale);
        const alternates =
          siteUrl && group.length > 1 && !page.seo?.noindex
            ? [
                ...group.map((m) => ({ hreflang: m.locale, href: siteUrlFor(siteUrl, slugForPath(m.path)) })),
                ...(xDefault ? [{ hreflang: 'x-default', href: siteUrlFor(siteUrl, slugForPath(xDefault.path)) }] : []),
              ]
            : undefined;
        // `data.<name>` resolves to this page's locale variant (`<name>-<locale>`) when
        // present, else the base dataset (auto locale-suffix). Translation links for a
        // language switcher (`{{#each page.translations}}<a href="{{sw-url path}}">`) use the
        // ROOT-RELATIVE page path — same as nav — so the `{{sw-url}}` helper (which only
        // accepts `/…`/`http(s)`/`#`) emits a real link rather than its `#` fallback.
        const localeData = resolveLocaleDatasets(datasets, page.locale);
        const pageTranslations = group.map((m) => ({ locale: m.locale, path: m.path, title: m.title }));
        // `{{ page.path }}` is the page's FULL route (computed from the parent chain), not
        // its bare slug — so a code-first page can reference its own URL.
        const pageFullPath = pagePath(page, byId);
        // Code-first page: render the Handlebars `source` to a body, then wrap it in the
        // SAME document shell (head/SEO/CSS/nav). Validated by renderTemplate; a bad
        // source fails the publish with a clear, page-scoped error.
        // The page's own source, or its referenced template's (the page then contributes only its
        // data-sw-text / page.data content). Resolved before renderCtx so `page.children` is built referenced-only.
        const pageSource = effectiveSource(page);
        const renderCtx = {
          company: identity as unknown as Record<string, unknown>,
          // `json_data` is the publish-time snapshot of `website.jsonDataUrl` (full object — a
          // code-first page/slot can `{{#each website.json_data.items}}`). siteUrl is the only
          // OTHER website field exposed; the raw head/criticalCss/scripts blobs are never surfaced.
          website: { siteUrl: website?.siteUrl, json_data: opts.jsonData, data: website?.data },
          // `page.children` — this page's child pages, flattened — built only when the source loops
          // them (keeps each child's `data` off the render unless used). Published subset → no drafts.
          page: {
            title: page.title,
            // Own segment (authored `path` field); `path` above is the full computed route.
            slug: page.path,
            path: pageFullPath,
            locale: pageLocale,
            translations: pageTranslations,
            data: page.data,
            children: pageSource && referencesChildren(pageSource) ? childrenOf(pubBundle.pages, page, defaultLocale) : [],
          },
          // The page's PARENT as a lean view (`{{parentPage.path}}`, `{{parentPage.data.x}}`); absent at the
          // tree root. Built only when the source references it (gates the parent's own `data` like children).
          parentPage: pageSource && referencesParentPage(pageSource)
            ? (parentPageView(pubBundle.pages, page, defaultLocale) as unknown as Record<string, unknown> | undefined)
            : undefined,
          data: localeData as Record<string, unknown>,
          nav: navForPage as unknown as Record<string, unknown>,
        };
        let bodyHtml: string | undefined;
        if (pageSource) {
          try {
            // Client-edited region overrides (page.data via data-sw-*) baked into the static output, plus
            // the project snippets the page can {{> compose}} (validated by renderTemplate, like preview).
            // No `preview` flag → resolveDirectives STRIPS every data-sw-* marker, leaving clean static
            // HTML; the html sink sanitizes rich values at render (page.data is the single store).
            bodyHtml = renderTemplate(pageSource, {
              ...renderCtx,
              item: keyedDatasets(pageSource, localeData),
              partials: opts.snippets,
            });
          } catch (err) {
            throw new PublishError(
              err instanceof TemplateError
                ? `page "${page.id}" template error: ${err.message}`
                : `page "${page.id}" failed to render`,
            );
          }
        }
        // Project-wide skeleton slots, validated + rendered per page (the page binding lets a
        // nav highlight the active link).
        const topNavHtml = renderSlot(website?.topNav, 'topNav', renderCtx);
        const mobileNavHtml = renderSlot(website?.mobileNav, 'mobileNav', renderCtx);
        const sidebarLeftHtml = renderSlot(website?.sidebarLeft, 'sidebarLeft', renderCtx);
        const sidebarRightHtml = renderSlot(website?.sidebarRight, 'sidebarRight', renderCtx);
        const footerHtml = renderSlot(website?.footer, 'footer', renderCtx);
        const bottomHtml = renderSlot(website?.bottom, 'bottom', renderCtx);
        const pageInlineStyles = [
          ...(usesComponents && components.css ? [components.css] : []),
          ...(usesAnims ? [ANIMATION_CSS] : []),
          ...(usesLazy ? [LAZYLOAD_CSS] : []),
          ...(usesWaves ? [RIPPLE_CSS] : []),
        ];
        const pageScripts = [
          ...(usesComponents && components.js ? [`${siteRoot}${COMPONENT_SCRIPT}`] : []),
          ...(usesAnims ? [`${siteRoot}${ANIMATION_SCRIPT}`] : []),
          ...(usesLazy ? [`${siteRoot}${LAZYLOAD_SCRIPT}`] : []),
          ...(usesWaves ? [`${siteRoot}${RIPPLE_SCRIPT}`] : []),
        ];
        const html = renderDocument(page, {
          brand,
          bodyHtml,
          topNav: topNavHtml,
          mobileNav: mobileNavHtml,
          sidebarLeft: sidebarLeftHtml,
          sidebarRight: sidebarRightHtml,
          footer: footerHtml,
          bottom: bottomHtml,
          // {{ company.* }}/{{ website.* }}/{{ page.* }} substitution in text props.
          // `website` is projected to only its public fields — never the raw
          // head/footer/CSS blobs, which aren't meant to be surfaced via a variable.
          vars: { company: identity, website: { siteUrl: website?.siteUrl, json_data: opts.jsonData, data: website?.data }, page: { title: page.title, path: pageFullPath, locale: pageLocale, translations: pageTranslations, data: page.data } },
          datasets: localeData,
          entry: route.entry,
          includeDrafts: false,
          media,
          root: siteRoot,
          lang: pageLocale,
          nav: navForPage,
          forms,
          formEndpoint,
          hcaptchaSiteKey: opts.hcaptchaSiteKey,
          // Images AND fonts resolve through ONE page-relative resolver (a font's @font-face uses
          // this too) so the export is portable + self-hosted (never a font CDN).
          mediaUrl: (asset, file) => `${siteRoot}${ASSET_DIR}/${asset.id}/${file}`,
          seo: {
            // `||` not `??`: an empty SEO title must fall back to the page title.
            title: page.seo?.title || page.title,
            description: page.seo?.description,
            // og:image falls back to the identity image; favicon to icon then favicon.
            ogImage: rel(page.seo?.ogImage ?? identity.image),
            url: page.seo?.canonical,
            noindex: page.seo?.noindex,
            themeColor: identity.colors.primary,
            favicon: rel(identity.icon ?? identity.favicon),
            alternates,
          },
          organization,
          criticalCss: website?.criticalCss,
          head: website?.head,
          customScripts: website?.scripts,
          // Shared assets (site root, NOT locale-prefixed), rebased to page depth.
          // Inline-style order: component CSS, then animation CSS; the linked
          // utility sheet stays last so Tailwind wins at equal specificity.
          stylesheets: usesUtilities ? [`${siteRoot}${UTILITY_STYLESHEET}`] : undefined,
          inlineStyles:
            pageInlineStyles.length > 0 ? pageInlineStyles : undefined,
          scripts: pageScripts.length > 0 ? pageScripts : undefined,
        });
        // Rewrite editor media URLs (`/media/<projectSlug>/<assetId>/…`) to the page-relative
        // bundled path (`<siteRoot>_assets/<assetId>/…`) — across ANY attribute (src, data-src,
        // srcset, href, meta), so raw `<img>`/dataset-driven images resolve in both the
        // `/sites/<slug>/` preview and a deployed copy. The project-slug segment is dropped
        // because the bundle namespaces by asset id only. Done BEFORE relativize so the result
        // is already relative (and not re-touched).
        //
        // Deliberately a flat string replace (not attribute-anchored) so it also catches
        // `data-bg`/`data-src`/`srcset` that `relativizeInternalLinks` misses. The prefix is a
        // slug-scoped literal, so a stray match in body text/an operator `<script>` string would
        // only be a reference to THIS project's own media — i.e. one we want rebased anyway.
        const mediaPrefix = `/media/${bundle.project.slug}/`;
        const mediaRebased = html.split(mediaPrefix).join(`${siteRoot}${ASSET_DIR}/`);
        // Rebase the remaining internal `/…` links onto this page's depth so the artifact is
        // portable (works at a domain root, in a sub-folder, and at the `/sites/<slug>/`
        // preview) — covers code-first `{{sw-url}}` + literal `href="/…"`; block-tree links are
        // already relative from render time.
        const portableHtml = relativizeInternalLinks(mediaRebased, siteRoot);
        const finalHtml = opts.minifyHtml ? await minifyPageHtml(portableHtml) : portableHtml;
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
        await writeFile(full, finalHtml, 'utf8');
        bytes += Buffer.byteLength(finalHtml);
        if (bytes > maxOutputBytes) {
          throw new PublishError('published site exceeds the maximum output size');
        }
      }
    }

    // One minimal stylesheet for the whole site (shared + cacheable across pages),
    // containing only the utilities actually used, with brand tokens in the theme.
    if (usesUtilities) {
      const css = await compileUtilityCss([classNames.join(' ')], brandToTailwindTheme(brand));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, UTILITY_STYLESHEET), css, 'utf8');
      bytes += Buffer.byteLength(css);
    }

    // One platform component bundle (first-party behavior; only-used-ships).
    if (usesComponents && components.js) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, COMPONENT_SCRIPT), components.js, 'utf8');
      bytes += Buffer.byteLength(components.js);
    }

    // The scroll-reveal runtime (first-party behavior; only-used-ships).
    if (usesAnims) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, ANIMATION_SCRIPT), ANIMATION_JS, 'utf8');
      bytes += Buffer.byteLength(ANIMATION_JS);
    }
    // The lazy-load runtime (first-party behavior; only-used-ships).
    if (usesLazy) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, LAZYLOAD_SCRIPT), LAZYLOAD_JS, 'utf8');
      bytes += Buffer.byteLength(LAZYLOAD_JS);
    }
    // The ripple runtime (first-party behavior; only-used-ships).
    if (usesWaves) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, RIPPLE_SCRIPT), RIPPLE_JS, 'utf8');
      bytes += Buffer.byteLength(RIPPLE_JS);
    }

    // robots.txt (always) + sitemap.xml (only when a production site URL is set).
    // The Sitemap line is built from the SAME `siteBase` as the sitemap <loc>s so
    // the two can never drift.
    const robots = renderRobots(siteUrl ? `${siteBase(siteUrl)}/sitemap.xml` : undefined);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
    await writeFile(join(tmp, 'robots.txt'), robots, 'utf8');
    bytes += Buffer.byteLength(robots);
    if (siteUrl && sitemapUrls.length > 0) {
      const sitemap = renderSitemap(sitemapUrls);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, 'sitemap.xml'), sitemap, 'utf8');
      bytes += Buffer.byteLength(sitemap);
    }

    // Redirect rules (Apache + Netlify) when configured.
    const redirects = website?.redirects;
    if (redirects && redirects.length > 0) {
      const htaccess = renderHtaccess(redirects);
      const netlify = renderNetlifyRedirects(redirects);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, '.htaccess'), htaccess, 'utf8');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, '_redirects'), netlify, 'utf8');
      bytes += Buffer.byteLength(htaccess) + Buffer.byteLength(netlify);
    }

    // contact.php (Mode B): one PHP mail() handler for every `contactPhp` form.
    // Recipients are baked SERVER-SIDE in the PHP (never in the page HTML).
    const allForms = bundle.forms ?? [];
    if (hasContactPhpForm(allForms)) {
      const php = renderContactPhp(allForms);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, 'contact.php'), php, 'utf8');
      bytes += Buffer.byteLength(php);
    }

    // The page loop enforces the size cap per page; re-check after the SEO/redirect
    // files so a site that squeaks under the cap can't exceed it via these tail writes.
    if (bytes > maxOutputBytes) {
      throw new PublishError('published site exceeds the maximum output size');
    }

    // One emitted page per route (locale variants are their own routes/pages now).
    const manifest: ReleaseManifest = { publishedAt, routes: routes.length, bytes };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- tmp is a resolved, validated dir
    await writeFile(join(tmp, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    // Swap the completed build into place (brief gap only between rm and rename).
    await rm(base, { recursive: true, force: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- both are resolved, validated dirs
    await rename(tmp, base);
    return manifest;
  } catch (err) {
    // Build failed → discard the temp dir; the previous live site is untouched.
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { minify as minifyHtmlDocument } from 'html-minifier-terser';
import {
  allRoutes,
  buildNav,
  datasetEntries,
  publishedDatasetEntries,
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
  pagesContext,
  referencesChildren,
  referencesParentPage,
  resolveTranslations,
  WIDGET_PARTIALS,
  type ProjectBundle,
} from '@sitewright/core';
import { isLinkPage, type Page, type Template } from '@sitewright/schema';
import {
  renderDocument,
  renderTemplate,
  TemplateError,
  type TemplateContext,
  decorateNav,
  NAV_LINK_JS,
  resolveInternalUrl,
  relativizeInternalLinks,
  componentTypesInSource,
  componentAssets,
  systemI18nData,
  usesDialog,
  usesAnimations,
  ANIMATION_CSS,
  ANIMATION_JS,
  usesParallax,
  PARALLAX_CSS,
  PARALLAX_JS,
  usesMarquee,
  MARQUEE_CSS,
  usesLazyload,
  LAZYLOAD_CSS,
  LAZYLOAD_JS,
  usesRipple,
  RIPPLE_CSS,
  RIPPLE_JS,
  usesCart,
  CART_CSS,
  CART_JS,
  usesConsent,
  CONSENT_CSS,
  CONSENT_JS,
  consentMountMarkup,
  usesThemeToggle,
  THEME_TOGGLE_CSS,
  THEME_TOGGLE_JS,
  preloaderHtml,
  PRELOADER_CSS,
  PRELOADER_JS,
  backToTopHtml,
  BACK_TO_TOP_CSS,
  BACK_TO_TOP_JS,
  STICKY_HEADER_JS,
  SCROLLSPY_JS,
  usesScrollSpy,
  NAV_EFFECTS_JS,
  usesNavEffects,
  BUTTON_EFFECTS_JS,
  usesButtonEffects,
  resolveShopChannels,
  resolveFormEndpoints,
  mediaForRender,
} from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { companyToOrganization } from './company-seo.js';
import { emitFaviconSet, type IconSet } from './favicon-assets.js';
import { renderSitemap, renderRobots, renderHtaccess, renderNetlifyRedirects, siteUrlFor, siteBase } from './seo.js';
import { renderContactPhp, hasContactPhpForm } from './contact-php.js';
import {
  toPublicForm,
  websiteEffectsClasses,
  websiteEffectsCustomCode,
  navEffectUsesRuntime,
  buttonEffectUsesRuntime,
  stickyHeaderUsesRuntime,
  scrollSpyUsesRuntime,
  buildConsentMetaCsp,
  authorContentCspOrigins,
  gateAuthorIframes,
  DEFAULT_EMBED_CATEGORY,
  RESERVED_TRANSLATION_DEFAULTS,
  type FormPublic,
  type MediaAsset,
} from '@sitewright/schema';

/** The compiled utility stylesheet, written at the site root and linked per page. */
const UTILITY_STYLESHEET = 'styles.css';
/** The platform component-behavior bundle, written at the site root and linked per page. */
const COMPONENT_SCRIPT = 'components.js';
/** The scroll-reveal (data-aos) runtime, written at the site root and linked per page. */
const ANIMATION_SCRIPT = 'animations.js';
/** The parallax / scroll-linked property runtime (translate/opacity/scale/blur), linked per page. */
const PARALLAX_SCRIPT = 'parallax.js';
/** The lazy-load (data-bg / lazyload) runtime, written at the site root and linked per page. */
const LAZYLOAD_SCRIPT = 'lazyload.js';
/** The ripple (waves-effect) runtime, written at the site root and linked per page. */
const RIPPLE_SCRIPT = 'ripple.js';
/** The MINI SHOP cart runtime, written at the site root and linked per page. */
const CART_SCRIPT = 'cart.js';
/** The CONSENT MANAGER runtime, written at the site root and linked per page. */
const CONSENT_SCRIPT = 'consent.js';
/** The color-scheme toggle + no-flash runtime, written at the site root and linked SYNC in <head>. */
const THEME_SCRIPT = 'theme.js';
/** The nav-placeholder runtime (open a <dialog>/smooth-scroll a #section), linked per page. */
const NAV_LINK_SCRIPT = 'nav-link.js';
/** The PRELOADER runtime (overlay show/clear + scroll-lock + internal-link bridge), linked per page. */
const PRELOADER_SCRIPT = 'preloader.js';
/** The BACK-TO-TOP runtime (show after the first viewport of scroll + scroll-to-top), linked per page. */
const BACK_TO_TOP_SCRIPT = 'back-to-top.js';
/** The STICKY-HEADER runtime (scroll-state classes for hide-on-scroll / shrink), linked per page. */
const STICKY_HEADER_SCRIPT = 'sticky-header.js';
/** The SCROLLSPY runtime (highlight the nav link whose in-page section is in view), linked per page. */
const SCROLLSPY_SCRIPT = 'scrollspy.js';
/** The NAV-EFFECTS runtime (sliding indicator + cursor-following spotlight), linked per page. */
const NAV_EFFECTS_SCRIPT = 'nav-effects.js';
/** The BUTTON-EFFECTS runtime (ripple on every .btn + magnetic + spotlight), linked per page. */
const BUTTON_EFFECTS_SCRIPT = 'button-effects.js';

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
  /**
   * Include `draft` pages too. The PUBLISHED build excludes drafts; the live PREVIEW
   * browse-surface sets this so an author/agent sees work-in-progress pages before they
   * are marked `published`. Off (published-only) by default.
   */
  includeDrafts?: boolean;
  /**
   * First-party runtime injected INLINE into every rendered page (preview only). The live
   * preview's parent-bridge reports the iframe's location to the editor shell so it can
   * auto-reload / auto-navigate on a content change. Empty in a published build — the
   * artifact stays clean and self-contained.
   */
  previewRuntime?: string;
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
  // The live-preview draft build (set when a previewRuntime is injected). Preview is a CONTENT
  // surface served under a sandboxed, opaque origin: the site's loading overlay adds no preview
  // value AND its clear-on-load handshake is unreliable cross-origin (it would cover the page), so
  // the preloader is omitted entirely from preview builds. The published site is unaffected.
  const previewMode = opts.previewRuntime !== undefined;
  // Per-publish cache-bust token (the publish timestamp's digits) appended as `?v=` to the fixed-name
  // runtime assets (styles.css / consent.js / components.js / …). A republish writes fresh assets AND a new
  // token → the browser cache busts instantly, while the assets are served `immutable` between publishes.
  const assetVer = publishedAt.replace(/\D/g, '') || '0';
  const base = resolve(outDir);
  const tmp = `${base}.tmp`;

  // Drafts are excluded from the published site: filter once, so routes, auto-nav,
  // and the sitemap all see only published pages. Draft *collection pages* are
  // excluded here too (collectionRoutes iterates this filtered set); draft
  // *collection entries* are filtered separately inside collectionRoutes.
  const pubBundle: ProjectBundle = {
    ...bundle,
    pages: opts.includeDrafts ? [...bundle.pages] : publishedPages(bundle.pages),
  };
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
    // Drafts appear in the preview (includeDrafts) but NOT in a published build — mirrors the page
    // filter above so `{{#each dataset.x}}` loops + keyed `{{item.x.key}}` show published entries only.
    const datasets = opts.includeDrafts ? datasetEntries(bundle) : publishedDatasetEntries(bundle);
    // Resolvable `{{> name}}` partials. `opts.snippets` carries the global snippets (a DB read —
    // admin-editable, so it MUST come from the caller, not a constant) ∪ the project's snippets. The
    // MANAGED Widget bodies are added HERE from the constant — before the Tailwind class scan AND the
    // page render — so every build caller (preview-build, worker, scheduled publish) resolves widgets
    // identically without each having to remember to merge them. Widgets are spread LAST so a widget
    // name can't be shadowed by a snippet of the same name. only-used-ships still applies
    // (referencedSnippets keeps the reachable subset).
    const snippets = { ...(opts.snippets ?? {}), ...WIDGET_PARTIALS };
    // The unified Corporate Identity drives BOTH the brand tokens (CSS vars/theme)
    // and the schema.org/favicon/OG fields; it's project-level, computed once.
    const identity = bundle.project.identity;
    const brand = identity;
    const baseOrg = companyToOrganization(identity, bundle.project.name);
    // Project-wide website settings (raw head/criticalCss/scripts + validated slots) — same for every page.
    const website = bundle.project.website;
    // Auto-nav: page-tree-derived menus per slot (same for every page; consumed by Nav blocks
    // and code-first skeleton slots via `{{#each nav.header}}`).
    const nav = decorateNav({
      header: buildNav(pubBundle.pages, 'header'),
      footer: buildNav(pubBundle.pages, 'footer'),
      mobile: buildNav(pubBundle.pages, 'mobile'),
    });
    // Multilingual model (see docs/i18n-content-model.md): a locale VARIANT of a
    // page is itself a Page (own path/title/description/data), so each route renders
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
      navByLocale.set(loc, decorateNav({
        header: buildNav(pagesIn, 'header'),
        footer: buildNav(pagesIn, 'footer'),
        mobile: buildNav(pagesIn, 'mobile'),
      }));
    }
    // `usesNavLink` (the <dialog>/smooth-scroll runtime) is computed below, once the source/slot/
    // snippet surfaces it scans for an authored <dialog> are in scope (see `usesMarker`).
    // Index for computing each page's full route (`{root}/{parent slugs}/{slug}`) — a
    // page's `path` is only its own slug segment.
    const byId = pagesById(pubBundle.pages);

    // Compile a Tailwind utility sheet / ship component CSS+JS only when used.
    // Sites using none get the previous output (no extra file/request).
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
      website?.mainNav,
      website?.sidebarLeft,
      website?.sidebarRight,
      website?.footer,
      website?.bottom,
    ].filter((s): s is string => Boolean(s));
    const slotClassNames = slotSources.flatMap((s) => extractClassNames(s));
    // Only the snippets a page/template/slot actually composes (transitively) contribute — an
    // un-composed snippet (including a built-in global) ships nothing, so a utility-free site
    // stays utility-free.
    const usedSnippets = referencedSnippets([...effectiveSources, ...slotSources], snippets);
    // {{> snippet}} partials a source page composes contribute their classes too.
    const snippetClassNames = Object.values(usedSnippets).flatMap((s) => extractClassNames(s));
    // The site-wide nav/button effect scheme classes land on <body> (renderDocument), so feed them
    // into the candidate set too — else their (tree-shaken) effect CSS wouldn't be compiled.
    const themeClassNames = websiteEffectsClasses(website?.effects).split(' ').filter(Boolean);
    // The platform-injected BACK-TO-TOP button (renderDocument) carries `btn sw-btn-shape-square` — feed
    // those classes in so the (tree-shaken) square-shape utility compiles into the sheet.
    const backToTopClassNames = website?.effects?.backToTop !== false ? ['btn', 'sw-btn-shape-square'] : [];
    // The consent gate's click-to-load placeholder uses daisyUI `.skeleton` (loading shimmer); it's added by
    // the runtime, so the source scan never sees it — feed it in when consent is on so it compiles.
    const consentClassNames = website?.consent?.enabled === true ? ['skeleton'] : [];
    const classNames = [
      ...sourceClassNames,
      ...slotClassNames,
      ...snippetClassNames,
      ...themeClassNames,
      ...backToTopClassNames,
      ...consentClassNames,
    ];
    const usesUtilities = classNames.length > 0;
    // Interactive component JS/CSS (modal / tabs / carousel / lightbox / banner / form) ships
    // when a CODE-FIRST surface renders its `data-sw-component="…"` marker — page sources, skeleton
    // slots, snippets. Same only-used-ships discipline as the animation/lazyload/ripple runtimes below.
    const componentTypes = [
      ...new Set([
        ...effectiveSources.flatMap(componentTypesInSource),
        ...slotSources.flatMap(componentTypesInSource),
        ...Object.values(usedSnippets).flatMap(componentTypesInSource),
      ]),
    ];
    const usesComponents = componentTypes.length > 0;
    const components = componentAssets(componentTypes);
    // Each platform runtime (animations / lazyload / ripple / cart / dialog) ships only when some
    // authored CODE-FIRST surface uses its marker — page sources, skeleton slots, or snippets. Same
    // only-used-ships discipline as components.js; unused sites get byte-identical output.
    const usesMarker = (strFn: (s: string | null | undefined) => boolean): boolean =>
      routes.some((r) => strFn(effectiveSource(r.page))) ||
      slotSources.some(strFn) ||
      Object.values(usedSnippets).some(strFn);
    const usesAnims = usesMarker(usesAnimations);
    const usesPx = usesMarker(usesParallax);
    const usesMarq = usesMarker(usesMarquee); // CSS-only logo marquee → ship MARQUEE_CSS when used
    const usesLazy = usesMarker(usesLazyload);
    const usesWaves = usesMarker(usesRipple);
    // MINI SHOP cart runtime — ships only when a page/slot uses the {{sw-cart}}/{{sw-add-to-cart}}
    // helpers (their rendered `data-sw-cart` marker). Same only-used-ships discipline.
    const usesCartRuntime = usesMarker(usesCart);
    // The consent runtime also hydrates HELD author iframes/scripts, which only exist when the manager is
    // enabled — so ship it whenever consent is on, not only when a {{sw-consent}} marker is authored.
    const usesConsentRuntime = website?.consent?.enabled === true || usesMarker(usesConsent);
    // Color-scheme toggle runtime — ships only when color schemes are ON *and* a page/slot uses
    // {{sw-theme-toggle}}. The source-level scan would match the helper call even on a disabled site
    // (where the helper renders nothing), so the enableThemes gate keeps single-theme output clean.
    const usesThemeToggleRuntime = !!website?.enableThemes && usesMarker(usesThemeToggle);
    // PRELOADER runtime — ships when the site enables a preloader effect (theme.preloaderEffect ≠
    // 'none'). The platform injects the overlay markup (renderDocument), so this is gated on the
    // theme choice rather than an authored marker.
    const usesPreloaderRuntime = !previewMode && (website?.effects?.preloaderEffect ?? 'none') !== 'none';
    // BACK-TO-TOP runtime — ON BY DEFAULT (ships unless website.effects.backToTop is explicitly false).
    // The platform injects the button markup (renderDocument), so this is gated on the setting only.
    const usesBackToTopRuntime = website?.effects?.backToTop !== false;
    // STICKY-HEADER runtime — ships only for the JS-backed fixed-header modes (hide-on-scroll /
    // shrink), which toggle scroll-state classes. 'pinned' is pure CSS (no runtime); the fixed
    // positioning + offset token are emitted by renderDocument (gated on the mode) for every mode.
    const usesStickyHeaderRuntime = stickyHeaderUsesRuntime(website?.effects?.stickyHeader);
    // SCROLLSPY runtime — ships when the site-wide toggle is on (effects.scrollSpy, governs #main-nav)
    // OR a page/slot/snippet uses a per-element `data-sw-scrollspy` (same only-used-ships discipline as
    // cart/nav-effects). The marker substring `sw-scrollspy` matches BOTH the attribute and the body
    // class, so the source scan can't drift from the runtime.
    const usesScrollSpyRuntime =
      scrollSpyUsesRuntime(website?.effects?.scrollSpy) || usesMarker(usesScrollSpy);
    // NAV-EFFECTS runtime — ships when a JS-backed nav scheme is used (a shared sliding indicator or
    // the cursor-following spotlight). Two ways to opt in: the site-wide picker (effects.navEffect) OR
    // a per-element class authored on a nav <ul>/snippet — so scan the sources too (same only-used-ships
    // discipline as cart/ripple), else a one-off `sw-nav-sliding-pill` would preview but ship broken.
    const usesNavRuntime =
      navEffectUsesRuntime(website?.effects?.navEffect) || usesMarker(usesNavEffects);
    // BUTTON-EFFECTS runtime — ripple is the always-on .btn baseline, so this ships whenever the page has
    // a button (or a JS-backed magnetic/spotlight default). usesButtonEffects scans for a `.btn`; the
    // back-to-top button is a platform-injected `.btn` no scan sees, so OR it in for its ripple.
    const usesBtnRuntime =
      buttonEffectUsesRuntime(website?.effects?.buttonEffect) || usesMarker(usesButtonEffects) || usesBackToTopRuntime;
    // The nav-link runtime opens a <dialog> (global modal) and smooth-scrolls #section links. Ship it
    // when a nav placeholder targets a #fragment OR any authored surface embeds a <dialog> — so a modal
    // triggered from page CONTENT (a CTA, an in-content `<a href="#id">`), not only a nav placeholder,
    // actually opens. NAV_LINK_JS is a general document-wide a[href^="#"] handler, so this is enough.
    const usesNavLink =
      pubBundle.pages.some((p) => isLinkPage(p) && (p.link?.target ?? '').includes('#')) ||
      usesMarker(usesDialog);
    // Public form definitions (recipient stripped) + the submission endpoint per form — consumed
    // by the form-embed pass in renderTemplate ({{sw-form}} / data-sw-form) and the cart's form
    // channel. Built once (same for every page); absolute when a publicBaseUrl is configured,
    // root-relative same-origin otherwise.
    const forms: Record<string, FormPublic> = Object.fromEntries(
      (bundle.forms ?? []).map((f) => [f.id, toPublicForm(f)]),
    );
    const formBase = (opts.publicBaseUrl ?? '').replace(/\/+$/, '');
    const formEndpoint = (formId: string): string => `${formBase}/f/${bundle.project.id}/${formId}`;
    const resolvedForms = resolveFormEndpoints(forms, formEndpoint);
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

    // Favicon / PWA icon set + Web App Manifest, derived ONCE from the single Corporate-Identity
    // `icon` (favicon.ico + 32px PNG + apple-touch-180 + manifest 192/512/maskable). Best-effort:
    // any failure (external icon, missing bytes, sharp error) leaves `iconSet` undefined and each
    // page falls back to a single generic <link rel="icon"> below.
    const iconSet: IconSet | undefined = opts.readMedia
      ? await emitFaviconSet(tmp, bundle.project.slug, identity, media, opts.readMedia)
      : undefined;

    // Render a project-wide skeleton slot (mainNav/sidebarLeft/sidebarRight/footer/bottom)
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
        // Code-first: the page renders from its Handlebars `source` (resolved below into `bodyHtml`).
        const page = route.page;
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
        if (siteUrl && !page.noindex) {
          sitemapUrls.push({ loc: siteUrlFor(siteUrl, outSlug), lastmod: publishedAt.slice(0, 10) });
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
        await mkdir(dirname(full), { recursive: true });
        // Internal page links + assets are relative to this page's depth (portable).
        const siteRoot = relativeRoot(outSlug);
        // Editor media URLs (`/media/<slug>/<id>/<file>`) bundle under `_assets/<id>/<file>` (the
        // slug segment is dropped). The page-BODY rewrite below handles raw `/media/…` refs, but
        // SEO/head values (favicon, og:image, schema.org logo/image) are resolved HERE first — so
        // `rel()` must do the SAME media→_assets rebase, else a relativised `/media/…` no longer
        // matches that body pass and ships broken (a 404 favicon/og at every page depth).
        const mediaPrefix = `/media/${bundle.project.slug}/`;
        const rel = (src: string | undefined): string | undefined =>
          !src
            ? undefined
            : src.startsWith(mediaPrefix)
              ? `${siteRoot}${ASSET_DIR}/${src.slice(mediaPrefix.length)}`
              : resolveInternalUrl(src, siteRoot);
        const organization = baseOrg
          ? { ...baseOrg, logo: rel(baseOrg.logo), image: rel(baseOrg.image) }
          : undefined;
        // hreflang alternates from the page's translation group (its locale variants),
        // as absolute URLs (Google requires absolute hreflang hrefs); x-default points
        // at the default-locale variant. Only for a configured site URL + indexable pages.
        const group = translationsOf(pubBundle.pages, page, defaultLocale);
        const xDefault = group.find((m) => m.locale === defaultLocale);
        const alternates =
          siteUrl && group.length > 1 && !page.noindex
            ? [
                ...group.map((m) => ({ hreflang: m.locale, href: siteUrlFor(siteUrl, slugForPath(m.path)) })),
                ...(xDefault ? [{ hreflang: 'x-default', href: siteUrlFor(siteUrl, slugForPath(xDefault.path)) }] : []),
              ]
            : undefined;
        // `dataset.<name>` resolves to this page's locale variant (`<name>-<locale>`) when
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
        // Locale-resolved translation catalog for this page — shared by the render context AND the
        // SYSTEM i18n dict injected for the component runtimes (window.__SW_T__).
        const pageT = resolveTranslations(website?.translations, pageLocale, defaultLocale);
        // Cross-page slug-path access (`{{pages.services.seo.data.x}}`) — referenced-only + same-locale,
        // scanning the page source AND the site-wide slot sources (the renderCtx is shared with the
        // slots, so a footer/nav can reference another page too); no-ops when nothing names `pages`.
        const pagesForRender = pagesContext(pubBundle.pages, page, defaultLocale, [pageSource, ...slotSources].filter(Boolean).join('\n'));
        // Fail fast (clear error) if a pathological source named many data-heavy pages — bound it like
        // the render-IPC ceiling rather than letting an oversized payload OOM the render worker mid-build.
        if (pagesForRender && JSON.stringify(pagesForRender).length > 4 * 1024 * 1024) {
          throw new PublishError(`page "${page.id}" references too much cross-page data to render`);
        }
        const renderCtx = {
          company: identity as unknown as Record<string, unknown>,
          // `json_data` is the publish-time snapshot of `website.jsonDataUrl` (full object — a
          // code-first page/slot can `{{#each website.json_data.items}}`). siteUrl is the only
          // OTHER website field exposed; the raw head/criticalCss/scripts blobs are never surfaced.
          website: { siteUrl: website?.siteUrl, json_data: opts.jsonData, data: website?.data, shop: resolveShopChannels(website?.shop, formEndpoint), consent: website?.consent, t: pageT, enableThemes: website?.enableThemes },
          // `page.children` — this page's child pages, flattened — built only when the source loops
          // them (keeps each child's `data` off the render unless used). Published subset → no drafts.
          page: {
            title: page.title,
            // Flattened SEO/meta fields: bound as {{page.description}} / {{page.image}} and read by the
            // {{sw-control}} current value (canonical/noindex exposed too, for completeness).
            description: page.description,
            image: page.image,
            canonical: page.canonical,
            noindex: page.noindex,
            // Own segment (authored `path` field); `path` above is the full computed route.
            slug: page.path,
            path: pageFullPath,
            locale: pageLocale,
            // The project default alongside the RESOLVED locale, so locale-aware helpers
            // ({{sw-active}}'s locale-home rule) can tell a translated page (under /<locale>/…)
            // from a default-locale one (unprefixed, locale == defaultLocale).
            defaultLocale,
            translations: pageTranslations,
            data: page.data,
            children: pageSource && referencesChildren(pageSource) ? childrenOf(pubBundle.pages, page, defaultLocale) : [],
          },
          // The page's PARENT as a lean view (`{{page.parent.path}}`, `{{page.parent.data.x}}`); absent at the
          // tree root. Built only when the source references it (gates the parent's own `data` like children).
          parentPage: pageSource && referencesParentPage(pageSource)
            ? (parentPageView(pubBundle.pages, page, defaultLocale) as unknown as Record<string, unknown> | undefined)
            : undefined,
          pages: pagesForRender,
          dataset: localeData as Record<string, unknown>,
          nav: navForPage as unknown as Record<string, unknown>,
          // Project media (slim) for {{#sw-folder}} galleries/file lists. Asset `url`s (`/media/<slug>/…`)
          // are rebased to the bundled `_assets/…` by the media rewrite below — portable in the export.
          media: mediaForRender(media),
          // Form embedding ({{sw-form}} / data-sw-form): the precomputed public definitions, the
          // instance hCaptcha sitekey, and this page's root path (for the page-relative
          // contact.php endpoint). Slots render with this same ctx — chrome forms work too.
          forms: resolvedForms,
          hcaptchaSiteKey: opts.hcaptchaSiteKey,
          siteRoot,
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
              partials: snippets,
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
        const mainNavHtml = renderSlot(website?.mainNav, 'mainNav', renderCtx);
        const sidebarLeftHtml = renderSlot(website?.sidebarLeft, 'sidebarLeft', renderCtx);
        const sidebarRightHtml = renderSlot(website?.sidebarRight, 'sidebarRight', renderCtx);
        const footerHtml = renderSlot(website?.footer, 'footer', renderCtx);
        const bottomHtml = renderSlot(website?.bottom, 'bottom', renderCtx);
        // PRELOADER overlay (first body child). The logo resolves page-relative via `rel` so logo-*
        // effects work at any page depth; non-logo effects ignore it (fall back to the built-in mark).
        const preloaderMarkup = usesPreloaderRuntime
          ? preloaderHtml(website?.effects?.preloaderEffect, { logo: rel(identity.logo) })
          : undefined;
        const backToTopMarkup = usesBackToTopRuntime ? backToTopHtml(true) : undefined;
        // Custom effect code (the "None / Custom Code" slots): nav/button code injects at body-end
        // (after the tenant's scripts); a custom preloader is the first-body-child overlay. Each
        // applies only when its built-in effect is 'none', so a site without custom code is unchanged.
        const fxCode = websiteEffectsCustomCode(website?.effects);
        const pageInlineStyles = [
          ...(usesComponents && components.css ? [components.css] : []),
          ...(usesAnims ? [ANIMATION_CSS] : []),
          ...(usesPx ? [PARALLAX_CSS] : []),
          ...(usesMarq ? [MARQUEE_CSS] : []),
          ...(usesLazy ? [LAZYLOAD_CSS] : []),
          ...(usesWaves ? [RIPPLE_CSS] : []),
          ...(usesCartRuntime ? [CART_CSS] : []),
          ...(usesConsentRuntime ? [CONSENT_CSS] : []),
          ...(usesThemeToggleRuntime ? [THEME_TOGGLE_CSS] : []),
          ...(usesPreloaderRuntime ? [PRELOADER_CSS] : []),
          ...(usesBackToTopRuntime ? [BACK_TO_TOP_CSS] : []),
        ];
        const pageScripts = [
          ...(usesComponents && components.js ? [`${siteRoot}${COMPONENT_SCRIPT}`] : []),
          ...(usesAnims ? [`${siteRoot}${ANIMATION_SCRIPT}`] : []),
          ...(usesPx ? [`${siteRoot}${PARALLAX_SCRIPT}`] : []),
          ...(usesLazy ? [`${siteRoot}${LAZYLOAD_SCRIPT}`] : []),
          ...(usesWaves ? [`${siteRoot}${RIPPLE_SCRIPT}`] : []),
          ...(usesCartRuntime ? [`${siteRoot}${CART_SCRIPT}`] : []),
          ...(usesConsentRuntime ? [`${siteRoot}${CONSENT_SCRIPT}`] : []),
          ...(usesNavLink ? [`${siteRoot}${NAV_LINK_SCRIPT}`] : []),
          ...(usesPreloaderRuntime ? [`${siteRoot}${PRELOADER_SCRIPT}`] : []),
          ...(usesNavRuntime ? [`${siteRoot}${NAV_EFFECTS_SCRIPT}`] : []),
          ...(usesBtnRuntime ? [`${siteRoot}${BUTTON_EFFECTS_SCRIPT}`] : []),
          ...(usesBackToTopRuntime ? [`${siteRoot}${BACK_TO_TOP_SCRIPT}`] : []),
          ...(usesStickyHeaderRuntime ? [`${siteRoot}${STICKY_HEADER_SCRIPT}`] : []),
          ...(usesScrollSpyRuntime ? [`${siteRoot}${SCROLLSPY_SCRIPT}`] : []),
        ];
        // Author-content CSP origins for THIS page: every cross-origin `<iframe>` (body / chrome slots /
        // head) → frame-src, and every gated `<script type="text/plain" data-sw-consent>` → script+connect.
        // Independent of consent.enabled (a held iframe still needs its frame-src origin to load on consent).
        const authorCspOrigins = authorContentCspOrigins(
          [bodyHtml, mainNavHtml, sidebarLeftHtml, sidebarRightHtml, footerHtml, bottomHtml, website?.head, website?.scripts]
            .filter((s): s is string => Boolean(s))
            .join('\n'),
        );
        const html = renderDocument(page, {
          brand,
          bodyHtml,
          // Opt-in light/dark color schemes (off by default → single-theme as before).
          theme: { enabled: !!website?.enableThemes, default: website?.defaultTheme },
          // The toggle's no-flash init — sync in <head>, only when a {{sw-theme-toggle}} is present.
          headScripts: usesThemeToggleRuntime ? [`${siteRoot}${THEME_SCRIPT}?v=${assetVer}`] : undefined,
          // Site-wide nav/button effect schemes → `<body>` classes (the effect CSS tree-shakes).
          bodyClass: websiteEffectsClasses(website?.effects),
          // Sticky/fixed top-header → the fixed `#main-nav` + `--sw-header-h` offset token, emitted at
          // first paint by renderDocument ('none'/absent = static header, byte-identical).
          stickyHeader: website?.effects?.stickyHeader,
          mainNav: mainNavHtml,
          sidebarLeft: sidebarLeftHtml,
          sidebarRight: sidebarRightHtml,
          footer: footerHtml,
          bottom: bottomHtml,
          preloader: fxCode.preloader ?? preloaderMarkup,
          backToTop: backToTopMarkup,
          // CONSENT MANAGER mount — auto-injected when consent is enabled (no authored {{sw-consent}}). The
          // copy localizes from the page's reserved consent_* translations → English defaults. grantAll only
          // in the draft whole-site preview (previewMode) so gated embeds render WYSIWYG; never on publish.
          consentMount: consentMountMarkup(
            website?.consent,
            // eslint-disable-next-line security/detect-object-injection -- key is a literal reserved consent_* slug; pageT + RESERVED_TRANSLATION_DEFAULTS are string-valued/frozen registries (missing → '')
            (key) => { const v = (pageT as Record<string, unknown> | undefined)?.[key]; return typeof v === 'string' && v ? v : RESERVED_TRANSLATION_DEFAULTS[key] ?? ''; },
            { grantAll: previewMode },
          ),
          // Custom effect code references the brand's text-on-brand tokens — make sure they're defined
          // even on a themes-off site (themes already emit them; this only fires for custom sites).
          emitBrandContentTokens: !!(fxCode.bodyEnd || fxCode.preloader),
          media,
          lang: pageLocale,
          // Images AND fonts resolve through ONE page-relative resolver (a font's @font-face uses
          // this too) so the export is portable + self-hosted (never a font CDN).
          mediaUrl: (asset, file) => `${siteRoot}${ASSET_DIR}/${asset.id}/${file}`,
          seo: {
            // The page title IS the document/og title (renderDocument resolves it from page.title).
            description: page.description,
            // og:image falls back to the company image; the favicon/PWA icons derive from `icon`.
            image: rel(page.image ?? identity.image),
            url: page.canonical,
            noindex: page.noindex,
            themeColor: identity.colors.primary,
            // The generated set when the icon is an in-project media asset (page-relative); else a
            // single generic <link rel="icon"> for an external/non-media icon.
            ...(iconSet
              ? {
                  icons: {
                    ico: `${siteRoot}${iconSet.ico}`,
                    png: `${siteRoot}${iconSet.png}`,
                    apple: `${siteRoot}${iconSet.apple}`,
                    manifest: `${siteRoot}${iconSet.manifest}`,
                  },
                }
              : { favicon: rel(identity.icon) }),
            alternates,
          },
          organization,
          criticalCss: website?.criticalCss,
          head: website?.head,
          // Baked CSP for static-export parity (a strict external host then allows the consented
          // third-party origins). Platform-local serving ALSO sets it as a response header. Omit = none.
          metaCsp: buildConsentMetaCsp(website?.consent, authorCspOrigins),
          // Site-wide content width → --sw-container (the .sw-container helper consumes it).
          containerWidth: website?.containerWidth,
          // A RAW-HTML page renders free-form: omit the platform's own CSS + JS (the explicit page setting).
          rawFidelity: page.rawHtml === true,
          // Raw-HTML pages also drop the platform effect JS — only the user's own website.scripts remains.
          customScripts: [website?.scripts, page.rawHtml ? undefined : fxCode.bodyEnd].filter(Boolean).join('\n') || undefined,
          // Shared assets (site root, NOT locale-prefixed), rebased to page depth.
          // Inline-style order: component CSS, then animation CSS; the linked
          // utility sheet stays last so Tailwind wins at equal specificity.
          stylesheets: usesUtilities ? [`${siteRoot}${UTILITY_STYLESHEET}?v=${assetVer}`] : undefined,
          inlineStyles:
            pageInlineStyles.length > 0 ? pageInlineStyles : undefined,
          scripts: pageScripts.length > 0 ? pageScripts.map((s) => `${s}?v=${assetVer}`) : undefined,
          // SYSTEM i18n dict for the component runtimes — only when interactive components ship.
          systemI18n: usesComponents && components.js ? systemI18nData(pageT) : undefined,
          // PREVIEW only: the parent-bridge runtime (reports this iframe's location to the editor
          // shell for auto-reload / auto-navigate). First-party + audited; never set in a publish.
          inlineScripts: opts.previewRuntime ? [opts.previewRuntime] : undefined,
          // PREVIEW only: scroll on <body> so the sandboxed sub-frame shows a real (classic) scrollbar
          // — its viewport scrollbar is an auto-hiding overlay in Chrome. The preview runtime bridges
          // window scroll to the body so scroll-linked JS keeps working.
          previewScroll: previewMode,
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
        // (`mediaPrefix` is defined above, shared with the SEO/head `rel()` rebase.)
        const mediaRebased = html.split(mediaPrefix).join(`${siteRoot}${ASSET_DIR}/`);
        // Rebase the remaining internal `/…` links onto this page's depth so the artifact is
        // portable (works at a domain root, in a sub-folder, and at the `/sites/<slug>/`
        // preview) — covers code-first `{{sw-url}}` + literal `href="/…"`; block-tree links are
        // already relative from render time.
        const portableHtml = relativizeInternalLinks(mediaRebased, siteRoot);
        // When the consent manager is enabled, HOLD every cross-origin author `<iframe>` (move its `src`
        // to `data-sw-consent-src`) so nothing third-party loads until consent — the consent runtime then
        // hydrates it (placeholder Allow once / Always allow). Consent off → iframes load normally (their
        // origin is still allow-listed in the baked CSP above). Same-origin / `data-sw-consent-skip` pass.
        const gatedHtml =
          website?.consent?.enabled === true
            ? gateAuthorIframes(portableHtml, { defaultCategory: website?.consent?.defaultEmbedCategory ?? DEFAULT_EMBED_CATEGORY })
            : portableHtml;
        const finalHtml = opts.minifyHtml ? await minifyPageHtml(gatedHtml) : gatedHtml;
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
    // The parallax / scroll-linked property runtime (first-party behavior; only-used-ships).
    if (usesPx) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, PARALLAX_SCRIPT), PARALLAX_JS, 'utf8');
      bytes += Buffer.byteLength(PARALLAX_JS);
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
    // The MINI SHOP cart runtime (first-party behavior; only-used-ships).
    if (usesCartRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, CART_SCRIPT), CART_JS, 'utf8');
      bytes += Buffer.byteLength(CART_JS);
    }
    // The CONSENT MANAGER runtime (first-party behavior; only-used-ships).
    if (usesConsentRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, CONSENT_SCRIPT), CONSENT_JS, 'utf8');
      bytes += Buffer.byteLength(CONSENT_JS);
    }
    // The color-scheme toggle + no-flash runtime (first-party behavior; only-used-ships).
    if (usesThemeToggleRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, THEME_SCRIPT), THEME_TOGGLE_JS, 'utf8');
      bytes += Buffer.byteLength(THEME_TOGGLE_JS);
    }
    // The nav-placeholder runtime (open a <dialog> / smooth-scroll a #section; only-used-ships).
    if (usesNavLink) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, NAV_LINK_SCRIPT), NAV_LINK_JS, 'utf8');
      bytes += Buffer.byteLength(NAV_LINK_JS);
    }
    // The PRELOADER runtime (overlay show/clear + scroll-lock + internal-link bridge; only-used-ships).
    if (usesPreloaderRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, PRELOADER_SCRIPT), PRELOADER_JS, 'utf8');
      bytes += Buffer.byteLength(PRELOADER_JS);
    }
    // The BACK-TO-TOP runtime (show after the first viewport of scroll + scroll-to-top; only-used-ships).
    if (usesBackToTopRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, BACK_TO_TOP_SCRIPT), BACK_TO_TOP_JS, 'utf8');
      bytes += Buffer.byteLength(BACK_TO_TOP_JS);
    }
    // The STICKY-HEADER runtime (scroll-state classes for hide-on-scroll / shrink; only-used-ships).
    if (usesStickyHeaderRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, STICKY_HEADER_SCRIPT), STICKY_HEADER_JS, 'utf8');
      bytes += Buffer.byteLength(STICKY_HEADER_JS);
    }
    // The SCROLLSPY runtime (highlight the nav link whose in-page section is in view; only-used-ships).
    if (usesScrollSpyRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, SCROLLSPY_SCRIPT), SCROLLSPY_JS, 'utf8');
      bytes += Buffer.byteLength(SCROLLSPY_JS);
    }
    // The NAV-EFFECTS runtime (sliding indicator + cursor-following spotlight; only-used-ships).
    if (usesNavRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, NAV_EFFECTS_SCRIPT), NAV_EFFECTS_JS, 'utf8');
      bytes += Buffer.byteLength(NAV_EFFECTS_JS);
    }
    // The BUTTON-EFFECTS runtime (ripple on every .btn + magnetic + spotlight; only-used-ships).
    if (usesBtnRuntime) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, BUTTON_EFFECTS_SCRIPT), BUTTON_EFFECTS_JS, 'utf8');
      bytes += Buffer.byteLength(BUTTON_EFFECTS_JS);
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

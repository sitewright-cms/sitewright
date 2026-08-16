import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { minify as minifyHtmlDocument } from 'html-minifier-terser';
import type { SizeToken } from '@sitewright/image-pipeline';
import {
  materializeImageThumbs,
  rewriteMediaUrlsFlat,
  resolveThumbForHead,
  rebaseMediaHeadUrl,
  type ThumbRefs,
} from './media-thumbs.js';
import { buildAliasMap, aliasResolver, flatMediaName } from './asset-alias.js';
import { rewriteTextureUrls, materializeTextures } from './publish-textures.js';
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
  resolveDatasetPageRefs,
  resolveCodeRef,
  translationsOf,
  localeOf as localeOfPage,
  pagesInLocale,
  pagePath,
  pagesById,
  childrenView,
  parentPageView,
  pagesContext,
  referencesChildren,
  referencesParentPage,
  resolveTranslations,
  WIDGET_PARTIALS,
  type ProjectBundle,
} from '@sitewright/core';
import {
  type CaptchaRenderConfig, isLinkPage, type Page, type Template } from '@sitewright/schema';
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
  formHasPickerField,
  componentAssets,
  systemI18nData,
  usesDialog,
  usesConsent,
  consentMountMarkup,
  usesThemeToggle,
  THEME_TOGGLE_CSS,
  THEME_TOGGLE_JS,
  preloaderHtml,
  PRELOADER_CSS,
  PRELOADER_JS,
  customPreloaderHtml,
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
  type RenderImageMap,
  mediaForRender,
  RICH_CONTENT_SAFELIST,
  ciRichClasses,
  escapeHtml,
} from '@sitewright/blocks';
import { minifyJs, minifyCss, MINIFIER_VERSION } from './minify.js';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { BODY_EFFECT_RUNTIMES } from './effect-runtimes.js';
import { companyToOrganization } from './company-seo.js';
import { emitFaviconSet, type IconSet } from './favicon-assets.js';
import {
  renderSitemap,
  renderRobots,
  renderHtaccess,
  renderNetlifyRedirects,
  siteUrlFor,
  siteBase,
  renderSecurityTxt,
  securityTxtContacts,
  securityTxtExpires,
  SECURITY_TXT_PATH,
} from './seo.js';
import { renderContactPhp, hasContactPhpForm, hasPhpSmtpForm, PHP_SMTP_CONFIG_FILE } from './contact-php.js';
import { buildSearchIndex, type SearchPageInput } from './search-index.js';
import { MANIFEST_FILENAME } from './deploy/manifest.js';
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
  platformInjectedCspOrigins,
  gateAuthorIframes,
  DEFAULT_EMBED_CATEGORY,
  DEFAULT_SECURITY_TXT_EXPIRY_YEARS,
  RESERVED_TRANSLATION_DEFAULTS,
  type FormPublic,
  type MediaAsset,
} from '@sitewright/schema';

/** The compiled utility stylesheet, written at the site root and linked per page. */
const UTILITY_STYLESHEET = 'styles.css';
/** Per-component-type runtime chunk filename (e.g. Carousel → `c-carousel.js`). One file per component
 *  TYPE used anywhere on the site (written once, stable name → cached across every page that uses that
 *  type), and each page links ONLY the chunks for the components IT renders — so a simple page no longer
 *  ships the whole interactive-component bundle just because some other page uses a carousel. */
const componentChunkName = (type: string): string => `c-${type.toLowerCase()}.js`;
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

/**
 * A chrome-slot render error, with the one explanation that is never obvious from Handlebars' own.
 *
 * ★ A slot cannot compose SNIPPETS. Slots render with no partials — deliberately, so the editor's
 * click-to-edit bridge over slot content has nothing to drift against — but the error you get is
 * Handlebars' bare "The partial X could not be found", which reads like a missing snippet rather
 * than a capability the surface does not have. An agent rebuilding a site hit exactly this: it
 * factored its menu into a snippet, referenced it from `mainNav`, and the entire header vanished.
 */
export function slotHint(message: string): string {
  return /partial .* could not be found/i.test(message)
    ? `${message} — a chrome slot renders WITHOUT partials, so {{> snippet}} cannot be used here; inline the markup into the slot instead`
    : message;
}

/** One page that could not be rendered, in a build that carried on without it. */
export interface PageBuildFailure {
  /** The page's entity id — what an editor link or a log line needs to name it. */
  page: string;
  /** Its route, so the failure can be reported as a place a visitor would go. */
  path: string;
  /** The template error, verbatim. */
  message: string;
}

/** Metadata about one published build. */
export interface ReleaseManifest {
  publishedAt: string;
  routes: number;
  bytes: number;
  /**
   * Pages that failed to render, DRAFT PREVIEW ONLY — a publish still fails whole on the first bad
   * page, because a broken page must never reach a live site. Empty/absent when everything rendered.
   */
  pageFailures?: PageBuildFailure[];
  /**
   * Pages left OUT of the site-search index because they are raw-fidelity imports, which are not
   * indexed until nativized (docs/site-search.md §3.1). Absent when none were skipped. Reported
   * rather than silent: a partially nativized site has a partially searchable corpus, and an author
   * whose page is unfindable is owed the reason.
   */
  searchSkippedRawHtml?: number;
  /**
   * Locales whose search corpus passed {@link SEARCH_INDEX_WARN_PAGES}. A visitor downloads one
   * locale's index on first search, so this is the number that matters — not the site total.
   */
  searchLargeLocales?: Array<{ locale: string; pages: number }>;
  /**
   * Pages whose `{{#each page.children}}` listing hit {@link MAX_PAGE_CHILDREN} and therefore rendered
   * FEWER children than the page has. Absent when nothing was dropped.
   *
   * ★ This used to be a bare `.slice()` with no signal anywhere: a news index with 831 posts published
   * 500 of them and looked complete. A partial listing the author cannot detect is worse than a loud
   * one — same reasoning as `searchSkippedRawHtml` above. Only pages that actually LOOP their children
   * are reported; a parent that never lists them lost nothing.
   */
  childrenTruncated?: Array<{ page: string; shown: number; total: number }>;
}

/**
 * The document a failed page serves in the draft preview.
 *
 * ★ The alternative — and what this replaces — was failing the WHOLE build: one page with a dangling
 * reference froze every page of the project on its last good build, serving stale HTML with a 200 and
 * no signal anywhere. The author edits, nothing changes, and nothing says why. Here the damage stays
 * on the page that has the problem, and that page says what the problem is.
 *
 * Self-contained and inert: no styles, scripts or assets from the site, because whatever the site
 * ships may itself be what failed.
 */
function previewErrorPage(failure: PageBuildFailure, title: string | undefined): string {
  const head =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Preview error — ${escapeHtml(title ?? failure.page)}</title>` +
    '<style>' +
    'body{margin:0;padding:48px 24px;font:16px/1.6 system-ui,sans-serif;color:#1e293b;background:#f8fafc}' +
    'main{max-width:44rem;margin:0 auto}' +
    'h1{margin:0 0 8px;font-size:22px}' +
    'p{margin:0 0 16px;color:#475569}' +
    'code{background:#e2e8f0;border-radius:4px;padding:1px 5px;font-size:14px}' +
    'pre{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #dc2626;border-radius:8px;' +
    'padding:14px 16px;overflow-x:auto;font-size:14px;white-space:pre-wrap;color:#b91c1c}' +
    '</style></head><body><main>';
  return (
    `${head}<h1>This page could not be rendered</h1>` +
    `<p>Every other page in this preview is up to date — only <code>${escapeHtml(failure.path)}</code> is affected.</p>` +
    `<pre>${escapeHtml(failure.message)}</pre>` +
    `<p>Page <code>${escapeHtml(failure.page)}</code>. Fix the source and the preview rebuilds on the next change.</p>` +
    '</main></body></html>'
  );
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

/** Pages in ONE locale past which the search index is worth sharding (docs/site-search.md §11.2). */
const SEARCH_INDEX_WARN_PAGES = 250;

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
  /**
   * Writes a generated image derivative back into the media store, so the next build reads it instead
   * of re-encoding it (the same cache the on-demand `/media?size=` route fills). Omit where the build
   * has no writable store — the isolated worker, for one — and it simply encodes every time.
   */
  storeMedia?: (assetId: string, file: string, data: Buffer) => Promise<void>;
  /** Max total HTML/CSS bytes written before aborting (default 100 MiB). */
  maxOutputBytes?: number;
  /**
   * The Sitewright platform's public base URL (e.g. `https://cms.agency.com`).
   * Exported `Form` blocks post to `<publicBaseUrl>/f/<projectId>/<formId>`; when
   * unset, a same-origin `/f/…` path is emitted (works only when the export is
   * served by the platform itself, e.g. the in-container preview).
   */
  publicBaseUrl?: string;
  /** The PROJECT's captcha provider + site key (public); absent → captcha forms render inert. */
  captcha?: CaptchaRenderConfig;
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
  /**
   * Progress reporter for a build a human is WAITING ON — the always-on draft preview, where a cold
   * project renders every page, re-encodes every image and compiles the stylesheet before the first
   * byte reaches the iframe. Without it the wait is a blank shell with nothing to say which of those
   * steps is the slow one. Optional and best-effort: it is dropped on the way into the isolated
   * worker (which serializes its job), and the publish path passes nothing at all.
   */
  onProgress?: (progress: BuildProgress) => void;
}

/** A build step worth telling a waiting human about. `done`/`total` are set only where the step is
 *  a countable loop (pages), so the UI can say "12 of 93" instead of an unmoving label. */
export interface BuildProgress {
  phase: 'preparing' | 'media' | 'pages' | 'styles' | 'scripts' | 'finalizing';
  done?: number;
  total?: number;
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
 * Copies every NON-image media asset's files FLAT into `<base>/_assets/` as `<alias>-<file>`
 * (path-safe). Fonts (each face), inline stylesheet/script, AND raw (non-image) blobs all land in the
 * single flat dir — the `<alias>-` prefix keeps two same-named files apart, and the raw `/file/`
 * segment the editor URL used is dropped. IMAGES are intentionally NOT copied here: their responsive
 * thumbnails are generated from the retained original by `materializeImageThumbs` once the referenced
 * sizes are known (after the page loop), so the export ships only referenced sizes.
 */
async function copyMedia(
  base: string,
  media: readonly MediaAsset[],
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
  alias: (id: string) => string,
): Promise<void> {
  const dir = join(base, ASSET_DIR);
  /* v8 ignore next -- defensive: constant `_assets` can't escape base */
  if (!resolve(dir).startsWith(base + sep)) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant `_assets` under base
  await mkdir(dir, { recursive: true });
  for (const asset of media) {
    // Images are materialized separately (on-demand thumbnails); skip them here.
    if (asset.kind === 'image') continue;
    const files = asset.kind === 'font' ? asset.files.map((f) => f.file) : [asset.storedName];
    const a = alias(asset.id); // asset.id is IdSchema-validated; file names are FileNameSchema-validated.
    for (const file of files) {
      const target = resolve(dir, flatMediaName(a, file));
      /* v8 ignore next -- defensive: validated id + file name can't escape */
      if (!target.startsWith(resolve(dir) + sep)) continue;
      try {
        const data = await readMedia(asset.id, file);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/_assets
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

/**
 * Embed hosts whose player REQUIRES first-party storage, so it cannot run in a preview at all.
 *
 * A preview document is sandboxed WITHOUT `allow-same-origin` (that is the whole security boundary —
 * see `PREVIEW_SANDBOX_TOKENS`), and sandbox flags are inherited by nested frames. The embed therefore
 * lands on an OPAQUE origin where `localStorage` throws, and these players bail before instantiating.
 *
 * MEASURED, first-party control page vs the same page sandboxed (Chromium 1223):
 *   - no sandbox                         → player ✓ video ✓ storage OK
 *   - `sandbox="allow-scripts"`          → player ✗ video ✗ storage SecurityError
 *   - `+ allow-same-origin`              → player ✓ video ✓ storage OK
 *   - CSP `sandbox allow-scripts`        → player ✗ video ✗ storage SecurityError
 * `youtube-nocookie.com` behaves identically — it is NOT a workaround.
 *
 * Deliberately narrow: Google Maps and OpenStreetMap embeds DO render sandboxed (measured), so a map
 * keeps working and is not swapped. Only add a host here after measuring it fail.
 */
const STORAGE_BOUND_EMBED_HOSTS: ReadonlyArray<{ match: RegExp; label: string }> = [
  { match: /^(?:www\.)?youtube(?:-nocookie)?\.com$/i, label: 'YouTube' },
  { match: /^(?:www\.)?youtu\.be$/i, label: 'YouTube' },
  { match: /^player\.vimeo\.com$/i, label: 'Vimeo' },
];

/**
 * Drop the LOADING-PLACEHOLDER classes when copying an embed's class list onto a static stand-in.
 *
 * The platform's media rule puts `loading="lazy"` + a `.skeleton` shimmer on iframes, so a lazy embed's
 * class list usually carries `skeleton` and/or `loading`. Copying those verbatim onto the placeholder
 * breaks it in two ways, and neither is subtle:
 *
 *   · `.skeleton` is an ANIMATED SHIMMER with its own background-color. On a real embed it is covered
 *     the moment the content paints; on the placeholder nothing ever paints over it, so the card sits
 *     under a pulsing grey wash forever.
 *   · `.loading` is worse. base-css neutralises daisyUI's spinner ONLY for media —
 *     `:is(iframe, img, video, embed, object).loading` — and the placeholder is a DIV, so it gets the
 *     raw component instead: a 1.5rem box with `aspect-ratio:1` and a mask. The card collapses to a
 *     small square with its contents masked away, which reads as "the preview is broken".
 *
 * The `loading-*` modifiers go with it: they only mean anything alongside `loading`, and leaving them
 * behind is litter that a future daisyUI could give independent meaning.
 */
function dropLoadingPlaceholderClasses(cls: string): string {
  return cls
    .split(/\s+/)
    .filter((c) => c !== '' && c !== 'skeleton' && c !== 'loading' && !c.startsWith('loading-'))
    .join(' ');
}

/** The watch URL a visitor should be sent to for an embed URL (`/embed/<id>` → a real watch page). */
function watchUrlFor(src: string): string {
  const m = /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{5,20})/i.exec(src);
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  const v = /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i.exec(src);
  if (v) return `https://vimeo.com/${v[1]}`;
  return src;
}

/**
 * PREVIEW-ONLY: replace an embed that cannot run sandboxed with a placeholder that OPENS IT.
 *
 * The author still sees the embed's real box (same `class`/`style`, so layout is unchanged) plus a
 * button that opens the video in a new tab — `allow-popups allow-popups-to-escape-sandbox` are in the
 * preview sandbox, so that lands un-sandboxed at the real origin and plays. Previously the frame just
 * painted blank, with nothing to explain why. The PUBLISHED site is untouched and embeds normally.
 */
export function replacePreviewStorageEmbeds(html: string): string {
  return html.replace(/<iframe\b[^>]*>\s*<\/iframe>/gi, (tag) => {
    // `data-src` too: the platform lazy-loads third-party embeds, so the URL is usually NOT in `src`.
    const src = (/\bsrc="([^"]*)"/i.exec(tag)?.[1] || /\bdata-src="([^"]*)"/i.exec(tag)?.[1] || '').replace(/&amp;/g, '&');
    let host: string;
    try {
      host = new URL(src).host;
    } catch {
      return tag; // relative / malformed / about:blank — not a third-party embed
    }
    const hit = STORAGE_BOUND_EMBED_HOSTS.find((h) => h.match.test(host));
    if (!hit) return tag;
    // These come from the ALREADY-serialized page HTML (so `&` and `"` are entity-escaped). Escape the
    // raw `<`/`>` a serializer may leave in an attribute value before re-emitting into text/attributes;
    // NOT `&`, which is already encoded — re-escaping would double-encode it.
    const esc = (v: string): string => v.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title = esc(/\btitle="([^"]*)"/i.exec(tag)?.[1] || `${hit.label} video`);
    // The loading-placeholder classes are stripped BEFORE escaping — this is a static stand-in, not a
    // thing that will finish loading (see dropLoadingPlaceholderClasses).
    const cls = esc(dropLoadingPlaceholderClasses(/\bclass="([^"]*)"/i.exec(tag)?.[1] || ''));
    const style = esc(/\bstyle="([^"]*)"/i.exec(tag)?.[1] || '');
    // The watch URL is usually rebuilt from an id we matched ourselves — but watchUrlFor FALLS BACK to
    // the author's own src for a host we recognise on a path we don't, so it is not inherently clean.
    // Escape it exactly like the attributes above rather than reasoning about which branch produced it.
    // (`&` is already encoded in this serialized HTML; re-escaping it would double-encode.)
    const watch = esc(watchUrlFor(src)).replace(/"/g, '&quot;');
    return (
      `<div${cls ? ` class="${cls}"` : ''} style="${style};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;text-align:center;padding:1.25rem;box-sizing:border-box;background:var(--color-base-200,#f3f4f6);color:var(--color-base-content,#4b5563);border:1px dashed var(--color-base-300,#d1d5db);border-radius:var(--radius-box,1rem)">` +
      `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg>` +
      `<strong style="font-weight:600">${title}</strong>` +
      `<span style="font-size:.8125rem;opacity:.8;max-width:38ch">${hit.label} can't play inside the sandboxed preview — its player needs first-party storage. It plays normally on the published site.</span>` +
      `<a href="${watch}" target="_blank" rel="noopener noreferrer" style="font-size:.8125rem;font-weight:600;color:inherit;text-decoration:underline">Watch on ${hit.label} \u2197</a>` +
      `</div>`
    );
  });
}

/**
 * PREVIEW-ONLY: replace a self-hosted PDF `<iframe>` with a static placeholder card. Chromium refuses to
 * instantiate its built-in PDF viewer inside the sandboxed (`sandbox allow-scripts`) preview frame
 * (`ERR_BLOCKED_BY_CLIENT`), so the real iframe would show the browser's "blocked" page in the editor
 * preview + every screenshot tool. The PUBLISHED/deployed site (a real, non-sandboxed origin) keeps the
 * working inline viewer, so this swap is gated on `previewMode` only. No script — pure static markup.
 */
export function replacePreviewPdfEmbeds(html: string): string {
  return html.replace(/<iframe\b[^>]*>\s*<\/iframe>/gi, (tag) => {
    // Match the SRC specifically (not the whole tag) — a non-PDF embed whose title/attr merely mentions a
    // ".pdf" must not be swapped. Only a self-hosted PDF file src qualifies.
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (!/\.pdf(?:[?#]|$)/i.test(src)) return tag;
    // `title`/`style` come from the ALREADY-serialized page HTML, where the serializer entity-escaped `&`
    // and `"`. It may leave `<`/`>` raw in an attribute value, so escape ONLY those before re-emitting into
    // the <strong> text / aria-label (closes the injection vector) — NOT `&`, which is already encoded
    // (re-escaping it would double-encode `&amp;` → `&amp;amp;`).
    const t = (/\btitle="([^"]*)"/i.exec(tag)?.[1] || 'PDF document').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const style = /\bstyle="([^"]*)"/i.exec(tag)?.[1] || 'min-height:80vh';
    return (
      `<div role="img" aria-label="${t} (PDF)" style="${style};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;text-align:center;padding:2rem;box-sizing:border-box;background:var(--color-base-200,#f3f4f6);color:var(--color-base-content,#4b5563);border:1px dashed var(--color-base-300,#d1d5db);border-radius:var(--radius-box,1rem)">` +
      `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></svg>` +
      `<strong style="font-weight:600">${t}</strong>` +
      `<span style="font-size:.8125rem;opacity:.8;max-width:34ch">Inline PDF preview isn't available in the editor — the browser blocks its PDF viewer inside the sandboxed preview. It renders on the published site.</span>` +
      `</div>`
    );
  });
}

export async function buildSite(opts: BuildSiteOptions): Promise<ReleaseManifest> {
  const { outDir, bundle, publishedAt } = opts;
  const media = opts.media ?? [];
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  // Progress is a courtesy to whoever is watching a spinner, never a build dependency: a throwing
  // reporter must not be able to fail a build that is otherwise fine.
  const report = (progress: BuildProgress): void => {
    try {
      opts.onProgress?.(progress);
    } catch {
      /* a broken reporter is not a broken build */
    }
  };
  report({ phase: 'preparing' });
  // The live-preview draft build (set when a previewRuntime is injected). The preview is a faithful
  // WYSIWYG surface, so it now shows the configured loading overlay too (authors asked to SEE it) —
  // its clear runs on the iframe's own `window.load` (same-context, reliable) and has an 8s failsafe
  // in PRELOADER_JS, so it can never stay stuck covering the page. The published site is unaffected.
  const previewMode = opts.previewRuntime !== undefined;
  // The preview injects `opts.previewRuntime` as an INLINE <script>. It runs via the published script-src's
  // `'unsafe-inline'` (which the meta now always carries for the OWNER's authored JS). We DELIBERATELY no
  // longer feed a per-runtime sha256 hash into the meta: per the CSP spec, a hash in the source list makes
  // `'unsafe-inline'` be ignored, which would then block the author's own inline scripts in the (sandboxed,
  // opaque, safe) preview. The sandbox — not a hash allow-list — is the preview's security boundary.
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
      // Author-only slot the default chrome never reads — exposed for {{#each nav.custom}}.
      custom: buildNav(pubBundle.pages, 'custom'),
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
        custom: buildNav(pagesIn, 'custom'),
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
    // Author-styled rich content (dataset `richtext` entries + `page.data` region overrides authored via the
    // WYSIWYG toolbar) emits a BOUNDED set of Tailwind utilities — standard colour/highlight/size/align/indent
    // classes plus this project's CI colour/font classes. That content lives in the content DB / page.data, so
    // the SOURCE scan above never sees it; feed the ones actually used into the candidate set, else they'd
    // render in preview (rendered scan) but vanish on the published site. Only classes PRESENT IN THE STORED
    // content ship (a superset of what a page actually renders — an entry in an unlooped dataset still counts,
    // matching this file's single-shared-sheet model); a project with no toolbar-styled content adds nothing,
    // so a utility-free site stays utility-free.
    const richContentAllowed = new Set([...RICH_CONTENT_SAFELIST, ...ciRichClasses(identity)]);
    const richContentClassNames: string[] = [];
    {
      const found = new Set<string>();
      const scan = (v: unknown): void => {
        if (found.size >= richContentAllowed.size) return; // every possible class already seen
        if (typeof v === 'string') {
          for (const c of extractClassNames(v)) if (richContentAllowed.has(c)) found.add(c);
        } else if (Array.isArray(v)) {
          for (const item of v) scan(item);
        } else if (v && typeof v === 'object') {
          for (const item of Object.values(v)) scan(item);
        }
      };
      for (const p of pubBundle.pages) scan(p.data);
      scan(datasets);
      richContentClassNames.push(...found);
    }
    const classNames = [
      ...sourceClassNames,
      ...slotClassNames,
      ...snippetClassNames,
      ...themeClassNames,
      ...backToTopClassNames,
      ...consentClassNames,
      ...richContentClassNames,
    ];
    const usesUtilities = classNames.length > 0;
    // Interactive component JS/CSS (modal / tabs / carousel / lightbox / banner / form) ships
    // when a CODE-FIRST surface renders its `data-sw-component="…"` marker — page sources, skeleton
    // slots, snippets. Same only-used-ships discipline as the animation/lazyload/ripple runtimes below.
    // A form carrying a date/time/datetime field renders a DateTimePicker marker that a SOURCE scan
    // cannot see (the marker only exists after the form-embed pass). Passing the ids of the forms that
    // actually have one keeps this precise — a plain contact form ships no picker chunk.
    const pickerFormIds = new Set((bundle.forms ?? []).filter(formHasPickerField).map((f) => f.id));
    const scanComponents = (html: string | null | undefined): string[] => componentTypesInSource(html, pickerFormIds);
    const componentTypes = [
      ...new Set([
        ...effectiveSources.flatMap(scanComponents),
        ...slotSources.flatMap(scanComponents),
        ...Object.values(usedSnippets).flatMap(scanComponents),
      ]),
    ];
    // The site-wide union bundle — kept only to seed the `?v=` cache-bust digest (its bytes change iff
    // any per-type chunk changes). Pages link per-TYPE chunks (per-page), never this concatenation.
    const components = componentAssets(componentTypes);
    // Each platform runtime (animations / lazyload / ripple / cart / dialog) ships only when some
    // authored CODE-FIRST surface uses its marker — page sources, skeleton slots, or snippets. Same
    // only-used-ships discipline as components.js; unused sites get byte-identical output.
    const usesMarker = (strFn: (s: string | null | undefined) => boolean): boolean =>
      routes.some((r) => strFn(effectiveSource(r.page))) ||
      slotSources.some(strFn) ||
      Object.values(usedSnippets).some(strFn);
    // The consent runtime also hydrates HELD author iframes/scripts, which only exist when the manager is
    // enabled — so ship it whenever consent is on, not only when a {{sw-consent}} marker is authored.
    const usesConsentRuntime = website?.consent?.enabled === true || usesMarker(usesConsent);
    // The marker-gated BODY-effect runtimes (animation, parallax, svg-anim, marquee, lazyload, ripple,
    // cart, consent), resolved from the SHARED registry (effect-runtimes.ts) that the editor preview also
    // consumes — so preview + deploy can NEVER ship a different set (the drift that motivated this). Every
    // entry is pure only-used-ships via its marker, EXCEPT consent (its settings-aware gate above).
    const usedBodyEffects = BODY_EFFECT_RUNTIMES.filter((r) => (r.key === 'consent' ? usesConsentRuntime : usesMarker(r.uses)));
    // Cache-bust token (`?v=`) for the shared, fixed-name runtime assets. Derived from the CONTENT
    // that determines those assets — the utility classes + brand theme (→ styles.css), and the
    // component bundle + used effect runtimes + standalone runtime scripts (→ the platform *.js) —
    // rather than the publish TIME. So a rebuild whose runtime assets are byte-identical keeps the
    // same token → byte-identical page heads → an incremental deploy re-uploads only the pages whose
    // OWN body changed, not every page on every publish. It still busts the instant any of these
    // inputs changes (a class added, a brand tweak, a platform runtime upgrade), and the assets stay
    // served `immutable` between publishes. KEEP IN SYNC: a new `?v=`-versioned runtime asset must add
    // its source to this digest, or its cache won't bust when the platform changes it. The MINIFIER
    // version is folded in too: the served bytes are minified, so a minifier/esbuild bump changes them
    // for an unchanged source — hashing its version re-busts `?v=` instead of overwriting an immutable URL.
    const assetVer = createHash('sha256')
      .update(MINIFIER_VERSION)
      .update('\x00')
      .update(classNames.join(' '))
      .update('\x00')
      .update(JSON.stringify(brand ?? null))
      .update('\x00')
      .update(components.js ?? '')
      .update('\x00')
      .update(usedBodyEffects.map((r) => r.js ?? '').join('\x00'))
      .update('\x00')
      .update([THEME_TOGGLE_JS, NAV_LINK_JS, PRELOADER_JS, BACK_TO_TOP_JS, STICKY_HEADER_JS, SCROLLSPY_JS, NAV_EFFECTS_JS, BUTTON_EFFECTS_JS].join('\x00'))
      .digest('hex')
      .slice(0, 16);
    // No-JS un-hide for the runtimes a page ships that hide content from first paint (svg-anim's no-FOUC
    // rule + the entrance-animation first-paint hide): one `<noscript><style>` at body-end so a
    // scripting-off visitor — whom the runtime can never reveal — still sees the content (keeps the
    // PE-first "never hide content without JS" guarantee). Computed PER PAGE from that page's body-effect
    // set (below); a page without a first-paint-hiding runtime emits nothing.
    const effectNoscriptHtmlFor = (effects: readonly { noscript?: string }[]): string | undefined => {
      const css = effects
        .flatMap((r) => (r.noscript ? [r.noscript] : []))
        // Defence-in-depth: neutralize any `</style` so a noscript rule can't break out of its <style>
        // block — matching the inlineStyles renderer. The registry's noscript values are static
        // first-party constants today, but this keeps the path structurally safe if one ever carries data.
        .map((s) => s.replace(/<\/(style)/gi, '<\\/$1'))
        .join('');
      return css ? `<noscript><style>${css}</style></noscript>` : undefined;
    };
    // Color-scheme toggle runtime — ships only when color schemes are ON *and* a page/slot uses
    // {{sw-theme-toggle}}. The source-level scan would match the helper call even on a disabled site
    // (where the helper renders nothing), so the enableThemes gate keeps single-theme output clean.
    const usesThemeToggleRuntime = !!website?.enableThemes && usesMarker(usesThemeToggle);
    // PRELOADER runtime — ships when the site shows an overlay AT ALL: a built-in effect, or CUSTOM
    // code. ★ Gating on the built-in effect alone was a page-killer, because the two conditions are
    // exactly opposite: custom code only applies when the effect is 'none', which was precisely when
    // the runtime did NOT ship. The one configuration that emitted an overlay was the one with
    // nothing to clear it, so every page sat behind it forever.
    const usesPreloaderRuntime =
      (website?.effects?.preloaderEffect ?? 'none') !== 'none' || Boolean(website?.effects?.preloaderCode?.trim());
    // BACK-TO-TOP runtime — ON BY DEFAULT (ships unless website.effects.backToTop is explicitly false).
    // The platform injects the button markup (renderDocument), so this is gated on the setting only.
    const usesBackToTopRuntime = website?.effects?.backToTop !== false;
    // STICKY-HEADER runtime — ships only for the JS-backed fixed-header modes (hide-on-scroll /
    // shrink), which toggle scroll-state classes. 'pinned' is pure CSS (no runtime); the fixed
    // positioning + offset token are emitted by renderDocument (gated on the mode) for every mode.
    const usesStickyHeaderRuntime = stickyHeaderUsesRuntime();
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
    // actually opens. ALSO ship it whenever SCROLLSPY is used: a scrollspy nav is in-page section
    // navigation by definition, so its links (`#about`, `/#about`) must smooth-scroll on click.
    const usesNavLink =
      pubBundle.pages.some((p) => isLinkPage(p) && (p.link?.target ?? '').includes('#')) ||
      usesMarker(usesDialog) ||
      usesScrollSpyRuntime;
    // --- PER-PAGE runtime shipping ---------------------------------------------------------------
    // The *Runtime flags above are the SITE-WIDE union: they decide which runtime files get WRITTEN
    // (a file must exist if ANY page links it). LINKING, however, is per-PAGE (below, in the render
    // loop): a page links a component/effect runtime only when the page's OWN source, a SHARED chrome
    // slot (rendered on every page), or a snippet the page composes trips its marker. That is the
    // accurate chrome-vs-content split — slot/settings-driven runtimes (nav/footer effects, preloader,
    // back-to-top, sticky, a site-wide scheme, the consent manager) ship on every page; content-driven
    // ones (the interactive components, entrance/parallax/svg/cart/…) ship only where authored. These
    // site-wide sub-conditions are the "applies to every page" half of the mixed runtimes; the per-page
    // loop OR's each with a per-PAGE marker scan. Every per-page set is a SUBSET of the union above, so
    // each linked asset was written.
    const scrollSpySiteWide = scrollSpyUsesRuntime(website?.effects?.scrollSpy);
    const navSiteWide = navEffectUsesRuntime(website?.effects?.navEffect);
    const btnSiteWide = buttonEffectUsesRuntime(website?.effects?.buttonEffect) || usesBackToTopRuntime;
    const navLinkSiteWide = pubBundle.pages.some((p) => isLinkPage(p) && (p.link?.target ?? '').includes('#'));
    const themesEnabled = !!website?.enableThemes;
    // Public form definitions (recipient stripped) + the submission endpoint per form — consumed
    // by the form-embed pass in renderTemplate ({{sw-form}} / data-sw-form) and the cart's form
    // channel. Built once (same for every page); absolute when a publicBaseUrl is configured,
    // root-relative same-origin otherwise.
    const forms: Record<string, FormPublic> = Object.fromEntries(
      (bundle.forms ?? []).map((f) => [f.id, toPublicForm(f)]),
    );
    const formBase = (opts.publicBaseUrl ?? '').replace(/\/+$/, '');
    // In the DRAFT PREVIEW every form posts to the dry-run endpoint instead: same parse, same bot
    // filters, same definition-aware validation, then nothing stored and nothing emailed. A shared
    // draft must not fire real leads at the merchant, but the author still has to be able to test the
    // form — which, before this, they could only do by publishing the site.
    const formEndpoint = (formId: string): string =>
      `${formBase}/f/${bundle.project.id}/${formId}${previewMode ? '/preview' : ''}`;
    const resolvedForms = resolveFormEndpoints(forms, formEndpoint);
    // Stored image maps, keyed by entity id — consumed by {{sw-imagemap}} and the
    // data-sw-imagemap pass. Built once (same for every page); the config's authored-markup
    // values are sanitized inside that pass, not here.
    const imageMaps: Record<string, RenderImageMap> = Object.fromEntries(
      (bundle.imageMaps ?? []).map((m) => [m.id, { id: m.id, config: m as unknown as Record<string, unknown> }]),
    );
    let bytes = 0;
    // Absolute URLs for sitemap.xml (when a production site URL is configured);
    // noindex pages are excluded.
    const siteUrl = website?.siteUrl;
    const sitemapUrls: Array<{ loc: string; lastmod?: string }> = [];
    // Locales whose corpus passed the size ceiling — reported on the manifest, not silently grown.
    const searchLargeLocales: Array<{ locale: string; pages: number }> = [];
    // Site-search corpus, collected per rendered route and emitted per locale after the loop.
    // Only pages that finish rendering are collected (see the push after the page write), so a
    // draft preview's error documents never enter the index.
    const searchPages = new Map<string, SearchPageInput[]>();
    // Raw-fidelity imports are excluded until nativized (docs/site-search.md §3.1). Counted rather
    // than dropped in silence: an author whose imported page is unfindable is owed the reason.
    let searchSkippedRawHtml = 0;
    // Pages whose child listing was cut short by MAX_PAGE_CHILDREN. Keyed by page id so a page that
    // renders in several locales/routes is reported once.
    const childrenTruncated = new Map<string, { page: string; shown: number; total: number }>();
    // Referenced-thumbnail accumulator — filled as each page's media URLs are rewritten, then
    // materialized (from originals) into `_assets/` after the loop. Only referenced sizes ship.
    const thumbRefs: ThumbRefs = new Map();
    // Platform textures referenced by any page (`/authoring/textures/<name>.png`) — copied into
    // `_assets/_textures/` after the page loop so the export is self-contained (complete + minimal).
    const usedTextures = new Set<string>();
    // Stable, collision-free short alias per asset — the flat file's `<alias>-` prefix. Computed once
    // so every emit site (copyMedia, the body/head URL rewrites, the font url callback, and
    // materializeImageThumbs) agrees on the same name for a given asset.
    const alias = aliasResolver(buildAliasMap(media));

    // Bundle media into the artifact so the export is self-contained + portable. copyMedia handles
    // every NON-image kind — raw files, stylesheet/script, AND `kind:'font'` (a font's faces are
    // bundled flat as `_assets/<alias>-<face>`, so its `@font-face` media url resolves in the export).
    if (media.length > 0 && opts.readMedia) {
      report({ phase: 'media', total: media.length });
      await copyMedia(tmp, media, opts.readMedia, alias);
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
          err instanceof TemplateError ? `website ${name} template error: ${slotHint(err.message)}` : `website ${name} failed to render`,
        );
      }
    };

    // Each route (incl. every locale variant, which is its own Page) renders ONCE
    // at its own path. Guard against two routes resolving to the same output file.
    const writtenPaths = new Set<string>();
    // Pages a DRAFT build rendered an error document for instead of aborting on — see the catch below.
    const pageFailures: PageBuildFailure[] = [];
    {
      const renderRoute = async (route: (typeof routes)[number], full: string): Promise<void> => {
        // Code-first: the page renders from its Handlebars `source` (resolved below into `bodyHtml`).
        const page = route.page;
        const pageLocale = localeOf(page);
        const navForPage = navByLocale.get(pageLocale) ?? nav;
        const outSlug = route.slug;
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
        const assetRoot = `${siteRoot}${ASSET_DIR}/`;
        const rel = (src: string | undefined): string | undefined =>
          !src
            ? undefined
            : (rebaseMediaHeadUrl(src, mediaPrefix, assetRoot, thumbRefs, alias) ?? resolveInternalUrl(src, siteRoot));
        // Head/SEO IMAGE urls (og:image, org logo/image, fallback favicon) resolve to a MATERIALIZED
        // thumbnail at a fixed size (recorded for build-time generation) — never the uncapped original.
        // A non-media url falls back to the generic `rel` rebase.
        const relImage = (src: string | undefined, size: SizeToken): string | undefined =>
          !src ? undefined : (resolveThumbForHead(src, mediaPrefix, assetRoot, size, 'webp', thumbRefs, alias) ?? rel(src));
        const organization = baseOrg
          ? { ...baseOrg, logo: relImage(baseOrg.logo, 'lg'), image: relImage(baseOrg.image, 'lg') }
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
        // og:image MUST be an absolute URL — social crawlers (Facebook/LinkedIn/X) won't fetch a
        // page-relative one. Resolve the page-relative asset URL (kept in lockstep with the body
        // rewrite via `rel()`) against THIS page's own absolute URL. Without a configured site URL
        // there's no absolute base, so we can only ship the relative form (portable static export).
        // og:image points at a MATERIALIZED `lg` thumbnail (relImage records the ref for build-time
        // generation), not the uncapped original; absolutized below when a site URL is configured.
        const relOgImage = relImage(page.image ?? identity.image, 'lg');
        // A non-URL image value can't reach `new URL()`'s first arg given the AssetRef schema, but
        // fall back to the page-relative form rather than throwing a raw TypeError out of the publish
        // loop (every other tenant-influenced op in here is guarded the same way).
        let ogImage = relOgImage;
        if (siteUrl && relOgImage) {
          try {
            ogImage = new URL(relOgImage, siteUrlFor(siteUrl, outSlug)).href;
          } catch {
            ogImage = relOgImage;
          }
        }
        // og:url + canonical: an author-set canonical always wins; otherwise default to this page's
        // OWN absolute URL when a site URL is configured (previously nothing was emitted without an
        // explicit canonical, so most pages shipped no og:url and no canonical link).
        const ogUrl = page.canonical ?? (siteUrl ? siteUrlFor(siteUrl, outSlug) : undefined);
        // og:locale: best-effort `language_TERRITORY` from the page locale (we don't fabricate a
        // territory we don't have — `en` stays `en`, `pt-BR` → `pt_BR`). og:locale:alternate lists
        // this page's OTHER locale variants (independent of siteUrl — these need no absolute URL).
        const ogLocale = pageLocale.replace(/-/g, '_');
        // NOT gated on !page.noindex (unlike the `alternates`/hreflang block above): og:locale:alternate
        // is a social-sharing hint, not an indexing directive — a noindex page can still be shared and
        // naming its sibling locales is valid. hreflang IS gated because search engines must not be
        // pointed at noindex pages.
        const ogLocaleAlternates = group.filter((m) => m.locale !== pageLocale).map((m) => m.locale.replace(/-/g, '_'));
        // `dataset.<name>` resolves to this page's locale variant (`<name>-<locale>`) when
        // present, else the base dataset (auto locale-suffix). Translation links for a
        // language switcher (`{{#each page.translations}}<a href="{{sw-url path}}">`) use the
        // ROOT-RELATIVE page path — same as nav — so the `{{sw-url}}` helper (which only
        // accepts `/…`/`http(s)`/`#`) emits a real link rather than its `#` fallback.
        // A `page` field stores an id; a template needs the page's attributes. Resolved against the
        // pages THIS build ships, so a reference to a draft/removed page reads as empty here — which is
        // the honest answer, because on the live site that page is not there.
        const localeData = resolveDatasetPageRefs(
          resolveLocaleDatasets(datasets, page.locale),
          bundle.datasets,
          pubBundle.pages,
          defaultLocale,
        );
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
        // Cross-page slug-path access (`{{pages.services.seo._attributes.data.x}}`) — referenced-only +
        // same-locale, scanning the page source AND the site-wide slot sources (the renderCtx is shared with the
        // slots, so a footer/nav can reference another page too); no-ops when nothing names `pages`.
        const pagesForRender = pagesContext(pubBundle.pages, page, defaultLocale, [pageSource, ...slotSources].filter(Boolean).join('\n'));
        // Fail fast (clear error) if a pathological source named many data-heavy pages — bound it like
        // the render-IPC ceiling rather than letting an oversized payload OOM the render worker mid-build.
        if (pagesForRender && JSON.stringify(pagesForRender).length > 4 * 1024 * 1024) {
          throw new PublishError(`page "${page.id}" references too much cross-page data to render`);
        }
        // `page.children` — this page's child pages — built only when the source loops them (keeps each
        // child's `data` off the render unless used). Published subset → no drafts. When the cap cut the
        // listing short, record it: the page renders fine and looks complete, so nothing else would say.
        const childListing =
          pageSource && referencesChildren(pageSource)
            ? childrenView(pubBundle.pages, page, defaultLocale)
            : { children: [], total: 0, truncated: false };
        if (childListing.truncated) {
          childrenTruncated.set(page.id, { page: page.id, shown: childListing.children.length, total: childListing.total });
        }
        const renderCtx = {
          company: identity as unknown as Record<string, unknown>,
          // `json_data` is the publish-time snapshot of `website.jsonDataUrl` (full object — a
          // code-first page/slot can `{{#each website.json_data.items}}`). siteUrl is the only
          // OTHER website field exposed; the raw head/criticalCss/scripts blobs are never surfaced.
          website: { siteUrl: website?.siteUrl, json_data: opts.jsonData, data: website?.data, shop: resolveShopChannels(website?.shop, formEndpoint), consent: website?.consent, t: pageT, enableThemes: website?.enableThemes },
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
            children: childListing.children,
            // The parent's REAL child count, so a capped listing can say so on the page itself
            // ({{page.children.length}} of {{page.childrenTotal}}) rather than quietly showing fewer.
            childrenTotal: childListing.total,
            // `page.template` — the template ref id this page renders from ('' = own code). `page.code` —
            // the EFFECTIVE source rendering this page (resolved through its template, if any). Gated:
            // the (large) source ships only when `{{page.code}}` is referenced.
            template: page.template ?? '',
            code: pageSource && /\bpage\.code\b/.test(pageSource) ? pageSource : '',
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
          // Site-wide AVIF delivery: {{sw-image}} emits a <picture> with an AVIF tier when the project
          // opts in (website.imageDelivery === 'avif'); otherwise a single WebP <img>.
          imageAvif: website?.imageDelivery === 'avif',
          // Form embedding ({{sw-form}} / data-sw-form): the precomputed public definitions, the
          // the project's captcha config, and this page's root path (for the page-relative
          // contact.php endpoint). Slots render with this same ctx — chrome forms work too.
          forms: resolvedForms,
          imageMaps,
          captcha: opts.captcha,
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
        // PRELOADER overlay (first body child). The logo resolves to a MATERIALIZED `lg` thumbnail
        // (`relImage` records the ref so it lands in the export — `copyMedia` skips images now that
        // they're generated on demand; a bare `rel()` would ship a dangling 404). Page-relative, so
        // Custom effect code (the "None / Custom Code" slots): nav/button code injects at body-end
        // (after the tenant's scripts); a custom preloader is the first-body-child overlay. Each
        // applies only when its built-in effect is 'none', so a site without custom code is unchanged.
        const fxCode = websiteEffectsCustomCode(website?.effects);
        // logo-* effects work at any page depth; non-logo effects ignore it (built-in mark fallback).
        // Custom code becomes the overlay's CONTENTS, inside the platform's own `[data-sw-preloader]`
        // wrapper — the author writes the spinner, the platform keeps the show/hide contract.
        const preloaderMarkup = fxCode.preloader
          ? customPreloaderHtml(fxCode.preloader, { backdrop: fxCode.preloaderBackdrop })
          : usesPreloaderRuntime
            ? preloaderHtml(website?.effects?.preloaderEffect, { logo: relImage(identity.logo, 'lg') })
            : undefined;
        const backToTopMarkup = usesBackToTopRuntime ? backToTopHtml(true) : undefined;
        // --- Per-page runtime selection (see the site-wide union + sub-conditions above) ------------
        // A runtime ships on THIS page when the page's own source, a shared chrome slot (rendered on
        // every page), or a snippet the page composes trips its marker — so content-driven runtimes
        // ship per-page while slot/settings-driven ones ship everywhere. Every set here is a SUBSET of
        // the site-wide union used to WRITE the files below, so no link can 404.
        const pageScanSources = [pageSource, ...slotSources].filter((s): s is string => Boolean(s));
        const pageScanAll = [...pageScanSources, ...Object.values(referencedSnippets(pageScanSources, snippets))];
        const pageUsesMarker = (fn: (s: string | null | undefined) => boolean): boolean => pageScanAll.some(fn);
        const pageComponentTypes = [...new Set(pageScanAll.flatMap(scanComponents))];
        const pageComponents = componentAssets(pageComponentTypes);
        const pageUsesComponents = pageComponentTypes.length > 0;
        // Marker-gated body effects for THIS page (consent stays site-wide when the manager is enabled —
        // it hydrates held iframes on every page). Mirrors the editor preview's per-page scan.
        const pageBodyEffects = BODY_EFFECT_RUNTIMES.filter((r) =>
          r.key === 'consent' ? usesConsentRuntime : pageUsesMarker(r.uses),
        );
        // No-JS un-hide for THIS page's first-paint-hiding runtimes (svg-anim / entrance animations).
        const pageEffectNoscriptHtml = effectNoscriptHtmlFor(pageBodyEffects);
        // Mixed chrome runtimes: the site-wide (settings/shell) half OR a per-page authored marker.
        const pageThemeToggle = themesEnabled && pageUsesMarker(usesThemeToggle);
        const pageScrollSpy = scrollSpySiteWide || pageUsesMarker(usesScrollSpy);
        const pageNavRuntime = navSiteWide || pageUsesMarker(usesNavEffects);
        const pageBtnRuntime = btnSiteWide || pageUsesMarker(usesButtonEffects);
        const pageNavLink = navLinkSiteWide || pageUsesMarker(usesDialog) || pageScrollSpy;
        const pageInlineStyles = [
          ...(pageUsesComponents && pageComponents.css ? [pageComponents.css] : []),
          // Shared registry: the inline CSS for every body-effect runtime THIS page uses (animation,
          // parallax, svg-anim, marquee, lazyload, ripple, cart, consent) — same set + order the editor
          // preview inlines for this page.
          ...pageBodyEffects.flatMap((r) => (r.css ? [r.css] : [])),
          ...(pageThemeToggle ? [THEME_TOGGLE_CSS] : []),
          ...(usesPreloaderRuntime ? [PRELOADER_CSS] : []),
          ...(usesBackToTopRuntime ? [BACK_TO_TOP_CSS] : []),
        ];
        const pageScripts = [
          // One external chunk per interactive-component TYPE this page renders (stable name → cached
          // across pages; a component-free page links none of them).
          ...pageComponentTypes.map((t) => `${siteRoot}${componentChunkName(t)}`),
          // Shared registry: link each body-effect runtime THIS page uses (marquee is CSS-only → no
          // script). Same set as the inline CSS above + the editor preview's inline JS for this page.
          ...pageBodyEffects.flatMap((r) => (r.script ? [`${siteRoot}${r.script}`] : [])),
          ...(pageNavLink ? [`${siteRoot}${NAV_LINK_SCRIPT}`] : []),
          ...(usesPreloaderRuntime ? [`${siteRoot}${PRELOADER_SCRIPT}`] : []),
          ...(pageNavRuntime ? [`${siteRoot}${NAV_EFFECTS_SCRIPT}`] : []),
          ...(pageBtnRuntime ? [`${siteRoot}${BUTTON_EFFECTS_SCRIPT}`] : []),
          ...(usesBackToTopRuntime ? [`${siteRoot}${BACK_TO_TOP_SCRIPT}`] : []),
          ...(usesStickyHeaderRuntime ? [`${siteRoot}${STICKY_HEADER_SCRIPT}`] : []),
          ...(pageScrollSpy ? [`${siteRoot}${SCROLLSPY_SCRIPT}`] : []),
        ];
        // Author-content CSP origins for THIS page: every cross-origin `<iframe>` (body / chrome slots /
        // head) → frame-src, and every gated `<script type="text/plain" data-sw-consent>` → script+connect.
        // Independent of consent.enabled (a held iframe still needs its frame-src origin to load on consent).
        const cspScanHtml = [bodyHtml, mainNavHtml, sidebarLeftHtml, sidebarRightHtml, footerHtml, bottomHtml, website?.head, website?.scripts]
          .filter((s): s is string => Boolean(s))
          .join('\n');
        const authorCspOrigins = authorContentCspOrigins(cspScanHtml);
        // …and the origins the PLATFORM injects into the very same page. The publisher used to contradict
        // itself here: it bakes an ABSOLUTE `/f/` endpoint into every platform-routed form, and a published
        // site is served from `<slug>.<sitesDomain>` — a DIFFERENT origin — while the policy said
        // `connect-src 'self'`. The browser blocked the submit before it left, so there was no request to
        // log and no submission to store, and a correctly configured form simply never sent. Same for the
        // captcha script the form runtime loads. Scanned per page, so a page without a form widens nothing.
        const platformCspOrigins = platformInjectedCspOrigins(cspScanHtml, formBase);
        const pageCspOrigins = {
          frame: [...authorCspOrigins.frame, ...platformCspOrigins.frame],
          script: [...authorCspOrigins.script, ...platformCspOrigins.script],
          connect: [...authorCspOrigins.connect, ...platformCspOrigins.connect],
          media: authorCspOrigins.media,
          style: platformCspOrigins.style,
        };
        const html = renderDocument(page, {
          brand,
          bodyHtml,
          // Minify the inline platform CSS (base/normalize, brand, theme, component/effect styles,
          // typography) — the published/deployed/audited build only; preview omits it.
          minifyCss,
          // Opt-in light/dark color schemes (off by default → single-theme as before).
          theme: { enabled: !!website?.enableThemes, default: website?.defaultTheme },
          // The toggle's no-flash init — sync in <head>, only when a {{sw-theme-toggle}} is present.
          headScripts: pageThemeToggle ? [`${siteRoot}${THEME_SCRIPT}?v=${assetVer}`] : undefined,
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
          preloader: preloaderMarkup,
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
          // this too) so the export is portable + self-hosted (never a font CDN). Flat: `<alias>-<file>`.
          mediaUrl: (asset, file) => `${assetRoot}${flatMediaName(alias(asset.id), file)}`,
          seo: {
            // The page title IS the document/og title (renderDocument resolves it from page.title).
            description: page.description,
            // og:image falls back to the company image (absolutized above); favicon/PWA icons derive from `icon`.
            image: ogImage,
            url: ogUrl,
            // og:site_name = the brand display name; og:locale (+ alternates) from the page's locale set.
            siteName: identity.name,
            locale: ogLocale,
            localeAlternates: ogLocaleAlternates,
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
              : { favicon: relImage(identity.icon, 'sm') }),
            alternates,
          },
          organization,
          criticalCss: website?.criticalCss,
          head: website?.head,
          // Baked CSP for static-export parity (a strict external host then allows the consented
          // third-party origins). Platform-local serving ALSO sets it as a response header. Omit = none.
          // NOTE: we no longer feed the preview-runtime HASH here. The published script-src now carries
          // `'unsafe-inline'` (for the OWNER's authored JS) — and per the CSP spec a hash in the source
          // list makes `'unsafe-inline'` be IGNORED, which would block author inline scripts in the
          // (sandboxed, opaque, safe) preview. The runtime runs via `'unsafe-inline'` instead.
          metaCsp: buildConsentMetaCsp(website?.consent, pageCspOrigins, undefined, website?.cspOrigins),
          // Coordinates for the encoded submission-endpoint resolver at body end. The form markup and the
          // cart's channel config carry only a form ID; the URL is assembled at runtime so it is never a
          // ready-to-POST address sitting in the HTML. Only meaningful with an absolute base — a
          // same-origin deployment keeps its relative endpoints.
          formApi: { base: formBase, project: bundle.project.id, preview: previewMode },
          // Site-wide content width → --sw-container (the .sw-container helper consumes it).
          containerWidth: website?.containerWidth,
          // A RAW-HTML page renders free-form: omit the platform's own CSS + JS (the explicit page setting).
          rawFidelity: page.rawHtml === true,
          // Raw-HTML pages also drop the platform effect JS — only the user's own website.scripts remains.
          customScripts: [website?.scripts, page.rawHtml ? undefined : fxCode.bodyEnd, page.rawHtml ? undefined : pageEffectNoscriptHtml].filter(Boolean).join('\n') || undefined,
          // Shared assets (site root, NOT locale-prefixed), rebased to page depth.
          // Inline-style order: component CSS, then animation CSS; the linked
          // utility sheet stays last so Tailwind wins at equal specificity.
          stylesheets: usesUtilities ? [`${siteRoot}${UTILITY_STYLESHEET}?v=${assetVer}`] : undefined,
          inlineStyles:
            pageInlineStyles.length > 0 ? pageInlineStyles : undefined,
          scripts: pageScripts.length > 0 ? pageScripts.map((s) => `${s}?v=${assetVer}`) : undefined,
          // SYSTEM i18n dict for the component runtimes — only when interactive components ship.
          systemI18n: pageUsesComponents ? systemI18nData(pageT) : undefined,
          // PREVIEW only: the parent-bridge runtime (reports this iframe's location to the editor
          // shell for auto-reload / auto-navigate). First-party + audited; never set in a publish.
          inlineScripts: opts.previewRuntime ? [opts.previewRuntime] : undefined,
          // PREVIEW only: scroll on <body> so the sandboxed sub-frame shows a real (classic) scrollbar
          // — its viewport scrollbar is an auto-hiding overlay in Chrome. The preview runtime bridges
          // window scroll to the body so scroll-linked JS keeps working.
          previewScroll: previewMode,
        });
        // Rewrite editor media URLs (`/media/<projectSlug>/<assetId>/…`) to the page-relative FLAT
        // bundled path (`<siteRoot>_assets/<alias>-<name…>`) — across ANY attribute (src, data-src,
        // srcset, href, meta), so raw `<img>`/dataset-driven images resolve in both the
        // `/sites/<slug>/` preview and a deployed copy. The project-slug + per-asset folder are dropped:
        // the bundle is a single flat dir keyed by `<alias>-`. Done BEFORE relativize so the result is
        // already relative (and not re-touched).
        //
        // ONE pass both maps image DELIVERY urls (`…/<name>?size=&format=` ⇒ static
        // `<alias>-<name>-<size>.<fmt>`, recording the referenced (asset,size,format) set for build-time
        // generation) AND rebases every other `/media/<slug>/…` ref (svg, raw `/file/` downloads,
        // directly-linked font/css/js) to its flat name. It catches `data-bg`/`data-src`/`srcset` that
        // `relativizeInternalLinks` misses. It matches the `<id>/[file/]<name>` shape, so a stray bare
        // `/media/<slug>/` string (already broken) is left untouched rather than blindly rebased.
        const mediaRebased = rewriteMediaUrlsFlat(html, bundle.project.slug, siteRoot, thumbRefs, alias);
        // Rebase platform-texture refs (`/authoring/textures/<name>.png`) to a page-relative
        // `_assets/_textures/<name>.png` and record which are used — BEFORE relativize (already-relative
        // result is not re-touched), so an authored texture background survives the export self-contained.
        const texRebased = rewriteTextureUrls(mediaRebased, siteRoot, usedTextures);
        // Rebase the remaining internal `/…` links onto this page's depth so the artifact is
        // portable (works at a domain root, in a sub-folder, and at the `/sites/<slug>/`
        // preview) — covers code-first `{{sw-url}}` + literal `href="/…"`; block-tree links are
        // already relative from render time.
        const relativized = relativizeInternalLinks(texRebased, siteRoot);
        // PREVIEW only: a self-hosted PDF <iframe> can't render in the sandboxed preview frame (Chromium
        // blocks its PDF viewer there) — swap it for a static placeholder. Publish keeps the real viewer.
        // …and likewise an embed whose player needs first-party storage (YouTube/Vimeo): the opaque
        // sandbox origin stops it instantiating at all, so it would paint an unexplained blank box.
        const portableHtml = previewMode
          ? replacePreviewStorageEmbeds(replacePreviewPdfEmbeds(relativized))
          : relativized;
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

        // ---- Site-search corpus -------------------------------------------------------------
        // Collected HERE, after the page is written, so only fully rendered pages are indexed.
        // `bodyHtml` is the page's OWN body — the chrome slots are separate variables and are
        // deliberately not passed: shared nav/footer text in the index makes every page match
        // every nav term (docs/site-search.md §2).
        if (page.rawHtml) {
          // Foreign markup with no separable chrome. Excluded until nativized, at which point the
          // page has an ordinary body and flows through the branch below with no import-specific code.
          searchSkippedRawHtml += 1;
        } else if (!page.noindex && bodyHtml) {
          const list = searchPages.get(pageLocale) ?? [];
          list.push({
            // The canonical route path, WITH a trailing slash — the same form `siteUrlFor` gives the
            // sitemap (seo.ts). A page builds to `<slug>/index.html`, so a slash-less `/roofing` 404s
            // on any host that does not silently redirect to the directory index. NOTE for the
            // runtime: the published artifact is portable (links are relativized for sub-folder and
            // `/sites/<slug>/` hosting), so a result link must be resolved against the index file's
            // own URL rather than used as a root path.
            url: outSlug ? `/${outSlug}/` : '/',
            title: page.title,
            description: page.description,
            bodyHtml,
            // Depth from the route itself. A locale variant carries its `/<locale>/` segment, which
            // is a constant within that locale's index and so cannot reorder its results.
            depth: outSlug ? outSlug.split('/').length : 0,
            // The same predicate `buildNav` uses, so "in the main nav" means what the author sees.
            inNav: page.nav?.slots.includes('header') ?? false,
          });
          searchPages.set(pageLocale, list);
        }
      };

      let renderedRoutes = 0;
      for (const route of routes) {
        report({ phase: 'pages', done: renderedRoutes, total: routes.length });
        renderedRoutes += 1;
        const outSlug = route.slug;
        const path = `/${outSlug ?? ''}`;
        const full = resolve(tmp, relPathForSlug(outSlug));
        // Never isolated: writing outside the output directory is a containment failure, not a
        // content mistake.
        if (full !== tmp && !full.startsWith(tmp + sep)) {
          throw new PublishError('route output escapes the publish directory');
        }
        if (writtenPaths.has(full)) {
          const message = `output path collision at "${path}" — two pages resolve to the same URL`;
          if (!previewMode) throw new PublishError(message);
          // The first page already OWNS this file; the second is the one that cannot be rendered.
          pageFailures.push({ page: route.page.id, path, message });
          continue;
        }
        writtenPaths.add(full);
        try {
          await renderRoute(route, full);
        } catch (err) {
          // ★ A PUBLISH still fails whole — a broken page must not reach a live site. A DRAFT PREVIEW
          // keeps going: failing the build meant one dangling reference froze EVERY page of the
          // project on its last good output, served with a 200 and no signal anywhere, so an author
          // edited and watched nothing change. The blast radius is now the page that has the problem.
          if (!previewMode) throw err;
          const message = err instanceof Error ? err.message : String(err);
          pageFailures.push({ page: route.page.id, path, message });
          const doc = previewErrorPage({ page: route.page.id, path, message }, route.page.title);
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
          await writeFile(full, doc, 'utf8');
          bytes += Buffer.byteLength(doc);
        }
        // The output cap is a property of the BUILD, not of one page, so it is checked out here and
        // stays fatal — an isolated page failure must not let a runaway project fill the disk.
        if (bytes > maxOutputBytes) {
          throw new PublishError('published site exceeds the maximum output size');
        }
      }
    }

    // Materialize exactly the thumbnails (+ any referenced originals) the rendered output points at,
    // from the retained originals — so the export is COMPLETE (every referenced variant is produced)
    // AND MINIMAL (only referenced sizes of referenced assets), independent of any preview traffic.
    if (opts.readMedia && thumbRefs.size > 0) {
      // Usually the longest single step on a cold project — every referenced size of every referenced
      // image is encoded here — which is exactly why it gets its own label.
      report({ phase: 'media', total: thumbRefs.size });
      await materializeImageThumbs(tmp, media, thumbRefs, opts.readMedia, alias, opts.storeMedia);
    }

    // Copy the platform textures any page referenced into `_assets/_textures/` so the export is
    // self-contained on any host (the URLs were already rebased to relative paths above).
    bytes += await materializeTextures(tmp, usedTextures);

    // One minimal stylesheet for the whole site (shared + cacheable across pages),
    // containing only the utilities actually used, with brand tokens in the theme.
    if (usesUtilities) {
      report({ phase: 'styles' });
      const css = await compileUtilityCss([classNames.join(' ')], brandToTailwindTheme(brand));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, UTILITY_STYLESHEET), css, 'utf8');
      bytes += Buffer.byteLength(css);
    }

    // Write a first-party runtime bundle at the site root, MINIFIED (esbuild via @sitewright/blocks
    // `minifyJs`; falls back to the source on any edge case). `bytes` tracks the minified size so the
    // manifest reflects what actually ships. Vendored library runtimes inside these bundles are already
    // minified; re-minifying the whole concatenation is idempotent-safe.
    report({ phase: 'scripts' });
    const writeJs = async (name: string, code: string): Promise<void> => {
      const min = await minifyJs(code);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant/registry filename under the validated tmp dir
      await writeFile(join(tmp, name), min, 'utf8');
      bytes += Buffer.byteLength(min);
    };

    // One first-party runtime CHUNK per component type used anywhere on the site (only-used-ships).
    // Each chunk is self-contained (its own enhance + init), so a page links just the chunks for the
    // components it renders. componentTypes is the site-wide union → every per-page link resolves.
    for (const type of componentTypes) {
      const chunk = componentAssets([type]).js;
      if (chunk) await writeJs(componentChunkName(type), chunk);
    }

    // Write each used body-effect runtime's JS at the site root (first-party behavior; only-used-ships).
    // Consolidated from the SHARED registry so the editor preview + deploy never diverge on which
    // runtimes ship (marquee is CSS-only → no script to write).
    for (const r of usedBodyEffects) {
      if (!r.script || !r.js) continue;
      await writeJs(r.script, r.js);
    }
    // The color-scheme toggle + no-flash runtime (first-party behavior; only-used-ships).
    if (usesThemeToggleRuntime) {
      await writeJs(THEME_SCRIPT, THEME_TOGGLE_JS);
    }
    // The nav-placeholder runtime (open a <dialog> / smooth-scroll a #section; only-used-ships).
    if (usesNavLink) {
      await writeJs(NAV_LINK_SCRIPT, NAV_LINK_JS);
    }
    // The PRELOADER runtime (overlay show/clear + scroll-lock + internal-link bridge; only-used-ships).
    if (usesPreloaderRuntime) {
      await writeJs(PRELOADER_SCRIPT, PRELOADER_JS);
    }
    // The BACK-TO-TOP runtime (show after the first viewport of scroll + scroll-to-top; only-used-ships).
    if (usesBackToTopRuntime) {
      await writeJs(BACK_TO_TOP_SCRIPT, BACK_TO_TOP_JS);
    }
    // The STICKY-HEADER runtime (scroll-state classes for hide-on-scroll / shrink; only-used-ships).
    if (usesStickyHeaderRuntime) {
      await writeJs(STICKY_HEADER_SCRIPT, STICKY_HEADER_JS);
    }
    // The SCROLLSPY runtime (highlight the nav link whose in-page section is in view; only-used-ships).
    if (usesScrollSpyRuntime) {
      await writeJs(SCROLLSPY_SCRIPT, SCROLLSPY_JS);
    }
    // The NAV-EFFECTS runtime (sliding indicator + cursor-following spotlight; only-used-ships).
    if (usesNavRuntime) {
      await writeJs(NAV_EFFECTS_SCRIPT, NAV_EFFECTS_JS);
    }
    // The BUTTON-EFFECTS runtime (ripple on every .btn + magnetic + spotlight; only-used-ships).
    if (usesBtnRuntime) {
      await writeJs(BUTTON_EFFECTS_SCRIPT, BUTTON_EFFECTS_JS);
    }

    // robots.txt (always) + sitemap.xml (only when a production site URL is set).
    // The Sitemap line is built from the SAME `siteBase` as the sitemap <loc>s so
    // the two can never drift.
    report({ phase: 'finalizing' });
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

    // Site-search index — ONE PAIR PER LOCALE, beside the sitemap. Emitted from the corpus collected
    // during the route loop, so the index and the HTML come from the same render and cannot drift
    // (docs/site-search.md §3.7). The default locale keeps the unsuffixed names; the runtime picks
    // its pair from `<html lang>`.
    // ONLY-USED-SHIPS. The index is a bulk full-text file; a site with no search box should not
    // publish one at all. `componentTypes` is the site-wide union the runtime chunks are written
    // from, so this gate cannot disagree with what actually ships.
    const siteUsesSearch = componentTypes.includes('Search');
    for (const [locale, pagesForLocale] of siteUsesSearch ? searchPages : []) {
      if (pagesForLocale.length === 0) continue;
      const { index, text } = buildSearchIndex(locale, pagesForLocale, {
        fold: website?.search?.foldDiacritics,
      });
      // A visitor downloads ONE locale's pair on first search, so the ceiling is per locale, not
      // site-wide. Measured at ~1.6 KB gzipped per page (docs/site-search.md §10), this threshold is
      // roughly 400 KB gzipped — past which the pair wants sharding rather than growing.
      if (pagesForLocale.length > SEARCH_INDEX_WARN_PAGES) {
        searchLargeLocales.push({ locale, pages: pagesForLocale.length });
      }
      const suffix = locale === defaultLocale ? '' : `.${locale}`;
      for (const [name, payload] of [
        [`search-index${suffix}.json`, index],
        [`search-text${suffix}.json`, text],
      ] as const) {
        const json = JSON.stringify(payload);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- locale-suffixed constant name under the validated tmp dir
        await writeFile(join(tmp, name), json, 'utf8');
        bytes += Buffer.byteLength(json);
      }
    }

    // security.txt (RFC 9116) — OPT-IN, at the normative `.well-known/` path only.
    //
    // The contact SELECTION is resolved against this publish rather than retyped by the author, so
    // the published file cannot drift from the site's real contact details. A selected source that
    // resolves to nothing FAILS the publish: the author explicitly asked for that channel, and
    // silently dropping it would ship a file promising a way to reach them that isn't there. (The
    // schema already rejects "enabled with nothing selected", so an empty selection can't get here.)
    const security = website?.security;
    if (security?.enabled) {
      const contactRoute = security.contactPageId ? routes.find((r) => r.page.id === security.contactPageId) : undefined;
      // `undefined` = not selected · `null` = selected but unusable. That distinction is what lets
      // the error below name the exact source instead of a generic "no contacts".
      const { contacts, unresolved } = securityTxtContacts({
        contactPageUrl: security.contactPageId
          ? siteUrl && contactRoute
            ? siteUrlFor(siteUrl, contactRoute.slug)
            : null
          : undefined,
        telephone: security.usePhone ? (identity.telephone ?? null) : undefined,
        email: security.useEmail ? (identity.email ?? null) : undefined,
      });
      // A misconfigured contact fails a PUBLISH but must never take down the always-on draft preview
      // — that preview is a whole-site working surface, and one unrelated setting should not blank it
      // (the same reason a broken page renders an error document there instead of aborting the build).
      // The author still learns about it: the publish they are previewing FOR will fail, loudly and
      // specifically. In preview, the file is simply skipped.
      if (unresolved.length > 0 && !previewMode) {
        const why = unresolved.map((source) => {
          if (source === 'page') {
            return siteUrl
              ? 'the selected contact page is not in this publish (deleted, or still a draft)'
              : 'the selected contact page needs a Site URL (Website settings) so its link can be absolute';
          }
          if (source === 'phone') {
            return identity.telephone
              ? `the company phone number ("${identity.telephone}") has no country code — RFC 9116 needs a tel: URI, e.g. +49 30 1234567`
              : 'the company phone number is not set (Corporate Identity)';
          }
          return 'the company email address is not set (Corporate Identity)';
        });
        throw new PublishError(`security.txt is enabled but ${why.join('; ')}`);
      }
      // Only ever write a file that HAS a contact. On a publish that is guaranteed by the throw
      // above; in preview it is not (nothing resolved → nothing to say), and a `Contact`-less
      // security.txt is invalid per RFC 9116 §2.5.3 — better absent than malformed.
      if (contacts.length > 0) {
        // Preferred-Languages: the languages the SITE is published in — the languages a report can
        // realistically be written in. Default locale first (RFC 9116 §2.5.8 gives no preference
        // order, but listing the primary language first is the useful reading), de-duplicated,
        // emitted as ONE line as the RFC requires.
        const locales = [bundle.project.settings?.defaultLocale, ...(bundle.project.settings?.locales ?? [])].filter(
          (l): l is string => Boolean(l),
        );
        const securityTxt = renderSecurityTxt({
          contacts,
          // Recomputed from THIS publish's timestamp, so republishing always rolls the window forward.
          expires: securityTxtExpires(new Date(publishedAt), security.expiryYears ?? DEFAULT_SECURITY_TXT_EXPIRY_YEARS),
          canonical: siteUrl ? `${siteBase(siteUrl)}/${SECURITY_TXT_PATH}` : undefined,
          policy: security.policyUrl,
          acknowledgments: security.acknowledgmentsUrl,
          preferredLanguages: [...new Set(locales)].join(', ') || undefined,
        });
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant path under the validated tmp dir
        await mkdir(join(tmp, dirname(SECURITY_TXT_PATH)), { recursive: true });
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant path under the validated tmp dir
        await writeFile(join(tmp, SECURITY_TXT_PATH), securityTxt, 'utf8');
        bytes += Buffer.byteLength(securityTxt);
      }
    }

    // Redirect rules (Apache + Netlify) when configured. The .htaccess is ALSO emitted with no
    // redirects at all when a form ships SMTP credentials, purely to carry the deny rule for
    // `sw-mail.config.php` (the file is written into the deploy payload by the main process, not
    // here — the build worker never sees the secret).
    const redirects = website?.redirects ?? [];
    // The manifest is denied alongside the credentials themselves: it records the NAME, SIZE and
    // content HASH of every uploaded file, so serving it tells a stranger that this site carries
    // sw-mail.config.php and lets them confirm a guessed copy byte-for-byte — recon the deny rule
    // exists to prevent, reachable by a different filename.
    const denyFiles = hasPhpSmtpForm(bundle.forms ?? []) ? [PHP_SMTP_CONFIG_FILE, MANIFEST_FILENAME] : [];
    if (redirects.length > 0 || denyFiles.length > 0) {
      const htaccess = renderHtaccess(redirects, { denyFiles });
      const netlify = renderNetlifyRedirects(redirects);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, '.htaccess'), htaccess, 'utf8');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, '_redirects'), netlify, 'utf8');
      bytes += Buffer.byteLength(htaccess) + Buffer.byteLength(netlify);
    }

    // contact.php (Mode B): ONE handler for every php-backed form (`contactPhp` = host mail(),
    // `contactPhpSmtp` = authenticated SMTP). Recipients are baked SERVER-SIDE in the PHP (never
    // in the page HTML); SMTP CREDENTIALS ARE NOT — they live in a sibling `sw-mail.config.php`
    // the main API process writes into a deploy payload, because this build may run inside the
    // isolated worker, which is guaranteed no secrets.
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
    const manifest: ReleaseManifest = {
      publishedAt,
      routes: routes.length,
      bytes,
      // Set BEFORE release.json is written, so the published manifest carries it (unlike
      // `pageFailures`, which is deliberately attached afterwards and only for draft builds).
      ...(searchSkippedRawHtml > 0 ? { searchSkippedRawHtml } : {}),
      ...(searchLargeLocales.length > 0 ? { searchLargeLocales } : {}),
      ...(childrenTruncated.size > 0 ? { childrenTruncated: [...childrenTruncated.values()] } : {}),
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- tmp is a resolved, validated dir
    await writeFile(join(tmp, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    // AFTER release.json: a published manifest describes the release, and there are no failures in one
    // (a publish throws on the first). This rides back to the caller so a draft build can be REPORTED
    // as partial rather than passing for clean.
    if (pageFailures.length > 0) manifest.pageFailures = pageFailures;

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

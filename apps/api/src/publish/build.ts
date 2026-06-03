import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  allRoutes,
  buildNav,
  collectClassNames,
  datasetEntries,
  extractClassNames,
  publishedPages,
  relativeRoot,
  type ProjectBundle,
} from '@sitewright/core';
import {
  renderDocument,
  renderTemplate,
  TemplateError,
  type TemplateContext,
  resolveInternalUrl,
  usedComponentTypes,
  componentAssets,
} from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { companyToOrganization } from './company-seo.js';
import { renderSitemap, renderRobots, renderHtaccess, renderNetlifyRedirects, siteUrlFor, siteBase } from './seo.js';
import { renderContactPhp, hasContactPhpForm } from './contact-php.js';
import { toPublicForm, type FormPublic, type MediaAsset, type PageTranslation } from '@sitewright/schema';

/** The compiled utility stylesheet, written at the site root and linked per page. */
const UTILITY_STYLESHEET = 'styles.css';
/** The platform component-behavior bundle, written at the site root and linked per page. */
const COMPONENT_SCRIPT = 'components.js';

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
  /** Reads a media binary (assetId, file) — used to copy assets into the artifact. */
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
}

/** Copies every media asset's files into `<base>/media/<assetId>/` (path-safe). */
async function copyMedia(
  base: string,
  media: readonly MediaAsset[],
  readMedia: (assetId: string, file: string) => Promise<Buffer>,
): Promise<void> {
  for (const asset of media) {
    const files = [asset.fallback, ...asset.variants.map((v) => v.path)];
    const dir = join(base, 'media', asset.id);
    // asset.id is IdSchema-validated; file names are FileNameSchema-validated.
    /* v8 ignore next -- defensive: validated id can't escape */
    if (!resolve(dir).startsWith(base + sep)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/media
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      const target = resolve(dir, file);
      /* v8 ignore next -- defensive: validated file name can't escape */
      if (!target.startsWith(resolve(dir) + sep)) continue;
      try {
        const data = await readMedia(asset.id, file);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to base/media/<id>
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
    // Locales: the default locale publishes at the site root; every other locale
    // at `/<locale>/…`, using its translation's root (else falling back to the
    // default page). A single-locale project → one pass with prefix '' → output
    // identical to the pre-multilingual behavior.
    const settings = bundle.project.settings;
    const locales = settings?.locales?.length ? settings.locales : ['en'];
    const defaultLocale = settings?.defaultLocale ?? locales[0] ?? 'en';
    const translations = bundle.translations ?? [];
    const translationFor = (pageId: string, locale: string): PageTranslation | undefined =>
      translations.find((t) => t.pageId === pageId && t.locale === locale);
    /** The output slug for a route in a locale: `<prefix><slug>` (home → undefined). */
    const localeSlug = (prefix: string, slug: string | undefined): string | undefined => {
      const composed = `${prefix}${slug ?? ''}`.replace(/\/+$/, '');
      return composed === '' ? undefined : composed;
    };

    // Compile a Tailwind utility sheet / ship component CSS+JS only when used —
    // scanning the default roots AND every translation root (a locale may use a
    // class/component the default page doesn't). Sites using none get the previous
    // output (no extra file/request).
    const scanRoots = [...routes.map((r) => r.root), ...translations.map((t) => t.root)];
    // Code-first source-pages contribute their literal Tailwind classes to the shared sheet.
    const sourceClassNames = routes
      .filter((r) => r.page.source)
      .flatMap((r) => extractClassNames(r.page.source as string));
    // Project-wide skeleton slots feed the shared sheet too.
    const slotClassNames = [
      website?.topNav,
      website?.mobileNav,
      website?.sidebarLeft,
      website?.sidebarRight,
      website?.footer,
      website?.bottom,
    ]
      .filter((s): s is string => Boolean(s))
      .flatMap((s) => extractClassNames(s));
    // {{> snippet}} partials a source page composes contribute their classes too.
    const snippetClassNames = Object.values(opts.snippets ?? {}).flatMap((s) => extractClassNames(s));
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

    // Guard against two (locale, route) pairs resolving to the same output file —
    // e.g. a page at `/de` colliding with the `de` locale's home. Catch it as a
    // PublishError instead of silently overwriting one with the other.
    const writtenPaths = new Set<string>();
    for (const locale of locales) {
      const localePrefix = locale === defaultLocale ? '' : `${locale}/`;
      // Locale-prefixed nav for THIS locale's skeleton slot links — non-default locales publish
      // under `/<locale>/`, so a shared topNav must point at the in-locale page (not the root one).
      const navForLocale =
        localePrefix === ''
          ? nav
          : {
              header: nav.header.map((i) => ({ ...i, path: `/${localePrefix}${i.path.replace(/^\//, '')}` })),
              footer: nav.footer.map((i) => ({ ...i, path: `/${localePrefix}${i.path.replace(/^\//, '')}` })),
              mobile: nav.mobile.map((i) => ({ ...i, path: `/${localePrefix}${i.path.replace(/^\//, '')}` })),
            };
      for (const route of routes) {
        const outSlug = localeSlug(localePrefix, route.slug);
        const full = resolve(tmp, relPathForSlug(outSlug));
        if (full !== tmp && !full.startsWith(tmp + sep)) {
          throw new PublishError('route output escapes the publish directory');
        }
        if (writtenPaths.has(full)) {
          throw new PublishError(`output path collision at "/${outSlug ?? ''}" — a page path conflicts with a locale prefix`);
        }
        writtenPaths.add(full);
        // Sitemap: indexable pages only (skip noindex), absolute URLs. lastmod is a
        // W3C date (YYYY-MM-DD) — the subset crawlers reliably accept.
        if (siteUrl && !route.page.seo?.noindex) {
          sitemapUrls.push({ loc: siteUrlFor(siteUrl, outSlug), lastmod: publishedAt.slice(0, 10) });
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
        await mkdir(dirname(full), { recursive: true });
        // Localized content (root + title) for non-default locales; else the page.
        const tr = localePrefix === '' ? undefined : translationFor(route.page.id, locale);
        const page = {
          ...route.page,
          root: tr?.root ?? route.root,
          title: tr?.title || route.page.title,
        };
        // Internal page links + assets are relative to this page's depth (portable);
        // assets are shared at the SITE root, so `rel`/`mediaUrl` carry NO locale
        // prefix, while internal page links (via `localePrefix`) stay in-locale.
        const siteRoot = relativeRoot(outSlug);
        const rel = (src: string | undefined): string | undefined =>
          src ? resolveInternalUrl(src, siteRoot) : undefined;
        const organization = baseOrg
          ? { ...baseOrg, logo: rel(baseOrg.logo), image: rel(baseOrg.image) }
          : undefined;
        // hreflang alternates: every locale variant of THIS route + x-default, as
        // absolute URLs (Google requires absolute hreflang hrefs). Only for a
        // multilingual site with a configured site URL, and not for noindex pages.
        const alternates =
          siteUrl && locales.length > 1 && !page.seo?.noindex
            ? [
                ...locales.map((l) => ({
                  hreflang: l,
                  href: siteUrlFor(siteUrl, localeSlug(l === defaultLocale ? '' : `${l}/`, route.slug)),
                })),
                { hreflang: 'x-default', href: siteUrlFor(siteUrl, localeSlug('', route.slug)) },
              ]
            : undefined;
        // Code-first page: render the Handlebars `source` to a body, then wrap it in the
        // SAME document shell (head/SEO/CSS/nav). Validated by renderTemplate; a bad
        // source fails the publish with a clear, page-scoped error.
        // Render context shared by the page body AND the project-wide skeleton slots — `nav`
        // is the (locale-prefixed) auto-menu so a nav slot lists pages via {{#each nav.header}}.
        const renderCtx = {
          company: identity as unknown as Record<string, unknown>,
          // `json_data` is the publish-time snapshot of `website.jsonDataUrl` (full object — a
          // code-first page/slot can `{{#each website.json_data.items}}`). siteUrl is the only
          // OTHER website field exposed; the raw head/criticalCss/scripts blobs are never surfaced.
          website: { siteUrl: website?.siteUrl, json_data: opts.jsonData },
          page: { title: page.title, path: page.path },
          data: datasets as Record<string, unknown>,
          nav: navForLocale as unknown as Record<string, unknown>,
        };
        let bodyHtml: string | undefined;
        if (page.source) {
          try {
            // Client-edited region overrides ({{edit "key"}}) baked into the static output, plus the
            // project snippets the page can {{> compose}} (validated by renderTemplate, like preview).
            bodyHtml = renderTemplate(page.source, { ...renderCtx, content: page.content, partials: opts.snippets });
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
          vars: { company: identity, website: { siteUrl: website?.siteUrl, json_data: opts.jsonData }, page: { title: page.title, path: page.path } },
          datasets,
          entry: route.entry,
          includeDrafts: false,
          media,
          root: siteRoot,
          localePrefix,
          lang: locale,
          nav,
          forms,
          formEndpoint,
          hcaptchaSiteKey: opts.hcaptchaSiteKey,
          mediaUrl: (asset, file) => `${siteRoot}media/${asset.id}/${file}`,
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
          stylesheets: usesUtilities ? [`${siteRoot}${UTILITY_STYLESHEET}`] : undefined,
          inlineStyles: usesComponents && components.css ? [components.css] : undefined,
          scripts: usesComponents && components.js ? [`${siteRoot}${COMPONENT_SCRIPT}`] : undefined,
        });
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
        await writeFile(full, html, 'utf8');
        bytes += Buffer.byteLength(html);
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

    // Total emitted pages = routes × locales (one set of routes per locale).
    const manifest: ReleaseManifest = { publishedAt, routes: routes.length * locales.length, bytes };
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

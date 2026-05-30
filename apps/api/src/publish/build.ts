import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  allRoutes,
  buildNav,
  collectClassNames,
  datasetEntries,
  relativeRoot,
  type ProjectBundle,
} from '@sitewright/core';
import { renderDocument, resolveInternalUrl } from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { companyToOrganization } from './company-seo.js';
import type { MediaAsset } from '@sitewright/schema';

/** The compiled utility stylesheet, written at the site root and linked per page. */
const UTILITY_STYLESHEET = 'styles.css';

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
 * Astro build. NOTE (in-container preview): `/sites/<projectId>/` is a build
 * preview only; the downloadable/deployable artifact is the product.
 *
 * The site is built into a sibling temp dir and swapped in via `rename`, so a
 * mid-build failure leaves the previously-published site intact.
 */
export async function buildSite(opts: BuildSiteOptions): Promise<ReleaseManifest> {
  const { outDir, bundle, publishedAt } = opts;
  const media = opts.media ?? [];
  const base = resolve(outDir);
  const tmp = `${base}.tmp`;

  let routes;
  try {
    routes = allRoutes(bundle);
  } catch (err) {
    // e.g. duplicate route slugs — author-correctable.
    throw new PublishError(err instanceof Error ? err.message : 'invalid route graph');
  }

  await rm(tmp, { recursive: true, force: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- tmp derives from a resolved, validated dir
  await mkdir(tmp, { recursive: true });
  try {
    const datasets = datasetEntries(bundle);
    const brand = bundle.project.brand;
    // Corporate identity is project-level (same for every page): compute once.
    const company = bundle.project.company;
    const baseOrg = companyToOrganization(company, bundle.project.name);
    // Project-wide website settings (critical CSS + custom head/footer) — same for every page.
    const website = bundle.project.website;
    // Auto-nav: page-tree-derived menus per slot (same for every page; Nav blocks consume it).
    const nav = {
      header: buildNav(bundle.pages, 'header'),
      footer: buildNav(bundle.pages, 'footer'),
      mobile: buildNav(bundle.pages, 'mobile'),
    };
    // Compile a Tailwind utility sheet only when the site actually uses utility
    // classes — sites that don't get exactly the previous output (no extra file,
    // no extra request). Collect the class lists from the resolved trees (not the
    // rendered HTML) so the scan is bounded + free of skeleton/custom-HTML noise.
    const classNames = routes.flatMap((route) => collectClassNames(route.root));
    const usesUtilities = classNames.length > 0;
    let bytes = 0;

    // Bundle media into the artifact so the export is self-contained + portable.
    if (media.length > 0 && opts.readMedia) {
      await copyMedia(tmp, media, opts.readMedia);
    }

    for (const route of routes) {
      const full = resolve(tmp, relPathForSlug(route.slug));
      if (full !== tmp && !full.startsWith(tmp + sep)) {
        throw new PublishError('route output escapes the publish directory');
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
      await mkdir(dirname(full), { recursive: true });
      const page = { ...route.page, root: route.root };
      // All internal links + asset paths are relative to this page's depth, so the
      // exported bundle is portable (webspace root, a subfolder, or /sites/<slug>/).
      const siteRoot = relativeRoot(route.slug);
      // Rebase a root-relative asset path so the export is portable at any base path.
      const rel = (src: string | undefined): string | undefined =>
        src ? resolveInternalUrl(src, siteRoot) : undefined;
      // schema.org logo/image are asset paths too — rebase per page depth so the
      // JSON-LD resolves correctly when the site is exported to a subfolder.
      const organization = baseOrg
        ? { ...baseOrg, logo: rel(baseOrg.logo), image: rel(baseOrg.image) }
        : undefined;
      const html = renderDocument(page, {
        brand,
        datasets,
        entry: route.entry,
        includeDrafts: false,
        media,
        root: siteRoot,
        nav,
        mediaUrl: (asset, file) => `${siteRoot}media/${asset.id}/${file}`,
        seo: {
          // `||` not `??`: an empty SEO title must fall back to the page title.
          title: page.seo?.title || page.title,
          description: page.seo?.description,
          // og:image falls back to the company image; favicon to the company icon.
          ogImage: rel(page.seo?.ogImage ?? company?.image),
          url: page.seo?.canonical,
          noindex: page.seo?.noindex,
          themeColor: brand.colors.primary,
          favicon: rel(company?.icon ?? brand.logo?.favicon),
        },
        organization,
        criticalCss: website?.criticalCss,
        customHead: website?.customHead,
        customFooter: website?.customFooter,
        // Link the root-level utility sheet, rebased to this page's depth so the
        // export stays portable. Only when the site uses utility classes.
        stylesheets: usesUtilities ? [`${siteRoot}${UTILITY_STYLESHEET}`] : undefined,
      });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
      await writeFile(full, html, 'utf8');
      bytes += Buffer.byteLength(html);
    }

    // One minimal stylesheet for the whole site (shared + cacheable across pages),
    // containing only the utilities actually used, with brand tokens in the theme.
    if (usesUtilities) {
      const css = await compileUtilityCss([classNames.join(' ')], brandToTailwindTheme(brand));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the validated tmp dir
      await writeFile(join(tmp, UTILITY_STYLESHEET), css, 'utf8');
      bytes += Buffer.byteLength(css);
    }

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

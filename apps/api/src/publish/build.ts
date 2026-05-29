import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { allRoutes, datasetEntries, type ProjectBundle } from '@sitewright/core';
import { renderDocument } from '@sitewright/blocks';

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
}

/**
 * Generates a static site for a project bundle: one `index.html` per route
 * (static pages + collection pages expanded per published entry), rendered by
 * the pure `@sitewright/blocks` renderer. Drafts are excluded (published build).
 * Pure Node — no Astro toolchain — so it runs inside the single API container.
 *
 * NOTE (v1 fidelity): the published output uses the framework-free renderer
 * (semantic HTML + brand-variable CSS), NOT the Astro pipeline (Tailwind,
 * `<picture>`/srcset, etc.), so it intentionally differs from the Astro dev
 * preview. NOTE (serving): pages are served under `/sites/<projectId>/`, so
 * root-relative links/assets authored as `/foo` resolve at the host root, not
 * under the prefix — the build artifact is the canonical deploy target (deploy
 * it at a real root via a publish adapter). Both are tracked for a later phase.
 *
 * The site is built into a sibling temp dir and swapped in via `rename`, so a
 * mid-build failure leaves the previously-published site intact.
 */
export async function buildSite(opts: BuildSiteOptions): Promise<ReleaseManifest> {
  const { outDir, bundle, publishedAt } = opts;
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
    let bytes = 0;

    for (const route of routes) {
      const full = resolve(tmp, relPathForSlug(route.slug));
      if (full !== tmp && !full.startsWith(tmp + sep)) {
        throw new PublishError('route output escapes the publish directory');
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
      await mkdir(dirname(full), { recursive: true });
      const page = { ...route.page, root: route.root };
      const html = renderDocument(page, { brand, datasets, entry: route.entry, includeDrafts: false });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
      await writeFile(full, html, 'utf8');
      bytes += Buffer.byteLength(html);
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

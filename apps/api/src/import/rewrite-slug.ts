import type { ProjectExportBundle } from '@sitewright/schema';

/**
 * Rewrites every `/media/<oldSlug>/…` reference in a bundle to the new project slug. Media URLs
 * are stored as strings that embed the project slug (`/media/<slug>/<assetId>/<file>`) throughout
 * content (page source/data, website, identity, media[].url, …), and the binaries move to
 * `MEDIA_ROOT/<newSlug>/…` on import — so a slug change (dedup on collision) requires this
 * mechanical replace or the references would 404.
 *
 * Both slugs are slug-charset (`[a-z0-9-]+`, no regex metacharacters), so a plain global string
 * replace over the serialized bundle is exact and safe. A no-op when the slug is unchanged.
 */
export function rewriteMediaSlug(
  bundle: ProjectExportBundle,
  oldSlug: string,
  newSlug: string,
): ProjectExportBundle {
  if (oldSlug === newSlug) return bundle;
  const from = `/media/${oldSlug}/`;
  const to = `/media/${newSlug}/`;
  const rewritten = JSON.stringify(bundle).split(from).join(to);
  return JSON.parse(rewritten) as ProjectExportBundle;
}

/**
 * Is a `/preview-site/:projectId/:sig/*` path a STATIC ASSET rather than a page?
 *
 * Two shapes qualify:
 *  - anything under `_assets/` — the bundled binaries (media, icons, per-page runtimes);
 *  - a ROOT-level platform file the publish writes beside the pages: the compiled stylesheet,
 *    the runtime bundles, `robots.txt`, `sitemap.xml`, `site.webmanifest` and the search index.
 *
 * Everything else is treated as a page (HTML) request.
 *
 * Kept as its own module purely so the rule is testable — it lives inside a very large app factory
 * otherwise, where a missing extension is invisible until someone loads the file in a browser.
 * That is exactly how `webmanifest` went missing: the favicon/PWA set was generated, written to
 * disk and linked from every page's `<head>`, but 404'd on the draft preview alone, because local
 * hosting (`/sites/:slug/*`) has no allowlist and served the same file happily.
 */
const ROOT_ASSET = /^[^/]+\.(css|js|xml|txt|webmanifest)$/;

/**
 * The site-search index pair, optionally locale-suffixed. Named EXACTLY rather than widening
 * ROOT_ASSET to `json`, because the allowlist's job is to serve only what the publish itself
 * writes — a stray `secrets.json` at the root must stay a page request.
 *
 * Same regression as `site.webmanifest`: the publish writes these, every search box fetches them,
 * and without this they 404 on the draft preview ALONE (local hosting has no allowlist), so search
 * works on the published site and is silently inert in preview.
 */
const SEARCH_INDEX_FILE = /^search-(index|text)(\.[A-Za-z0-9-]+)?\.json$/;

/**
 * Author-declared data files (`website.dataFiles`), emitted into `data/`.
 *
 * ★ THE SAME REGRESSION A THIRD TIME. `site.webmanifest` and the search index each shipped 404ing on
 * the draft preview ALONE — local hosting has no allowlist, so both worked on a published site and
 * were silently inert in preview. Data files repeated it exactly: the publish route was covered by an
 * integration test and the PREVIEW route, which consults this separate gate first, was not. The file
 * was on disk and `readAsset` would have served it; this function never gave it the chance.
 *
 * Mirrors `PublishStore`'s `DATA_FILE_PATH` — if one changes, change both.
 */
const DATA_FILE_PATH = /^data\/[A-Za-z0-9][A-Za-z0-9_-]*\.json$/;

export function isPreviewAssetPath(path: string): boolean {
  return (
    path.startsWith('_assets/') || ROOT_ASSET.test(path) || SEARCH_INDEX_FILE.test(path) || DATA_FILE_PATH.test(path)
  );
}

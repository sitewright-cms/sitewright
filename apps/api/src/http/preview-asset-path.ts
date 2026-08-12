/**
 * Is a `/preview-site/:projectId/:sig/*` path a STATIC ASSET rather than a page?
 *
 * Two shapes qualify:
 *  - anything under `_assets/` — the bundled binaries (media, icons, per-page runtimes);
 *  - a ROOT-level platform file the publish writes beside the pages: the compiled stylesheet,
 *    the runtime bundles, `robots.txt`, `sitemap.xml` and `site.webmanifest`.
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

export function isPreviewAssetPath(path: string): boolean {
  return path.startsWith('_assets/') || ROOT_ASSET.test(path);
}

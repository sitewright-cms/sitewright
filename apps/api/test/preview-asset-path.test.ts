import { describe, it, expect } from 'vitest';
import { isPreviewAssetPath } from '../src/http/preview-asset-path.js';

/**
 * The draft preview splits every request into "static asset" or "page". A platform file the publish
 * writes to the site ROOT has to be named here explicitly, and `site.webmanifest` was not — so the
 * PWA manifest was generated, written to disk and linked from every `<head>`, then 404'd on the
 * preview alone. Local hosting has no allowlist and served the same file, which is why it went
 * unnoticed. These cases pin every root file the publish actually emits.
 */
describe('isPreviewAssetPath', () => {
  it.each([
    'site.webmanifest', // the regression
    'styles.css',
    'animations.js',
    'back-to-top.js',
    'robots.txt',
    'sitemap.xml',
    // The SAME class of regression as site.webmanifest: the publish writes these, every search box
    // fetches them, and a missing extension makes search silently inert in the preview alone.
    'search-index.json',
    'search-text.json',
    'search-index.de.json',
    'search-text.de.json',
  ])('serves the root platform file %s as an asset', (path) => {
    expect(isPreviewAssetPath(path)).toBe(true);
  });

  it.each([
    '_assets/_icons/favicon.ico',
    '_assets/_icons/apple-touch-icon.png',
    '_assets/abc123-photo-lg.webp',
    '_assets/font.woff2',
  ])('serves the bundled asset %s', (path) => {
    expect(isPreviewAssetPath(path)).toBe(true);
  });

  it.each([
    ['the site root', ''],
    ['a top-level page', 'contact'],
    ['a nested page', 'shop/forever-daily'],
    ['a page whose slug contains a dot', 'v1.2-release-notes'],
    // A root-file EXTENSION must not win from a nested path — those are pages or media, and media
    // is reached under `_assets/` only.
    ['a nested file that mimics a root asset', 'shop/site.webmanifest'],
    ['a nested stylesheet', 'deep/nested/styles.css'],
  ])('treats %s as a page', (_label, path) => {
    expect(isPreviewAssetPath(path)).toBe(false);
  });

  it('does not serve arbitrary root files by extension', () => {
    // The allowlist is deliberate: only what the publish itself writes to the root. A stray `.json`
    // or `.html` at the root must not become a static asset response.
    // `search-index.<locale>.json` IS served, and a locale is not distinguishable by shape from any
    // other segment — so the guard is the search-index/search-text PREFIX, not the suffix.
    for (const p of ['secrets.json', 'index.html', 'notes.md', 'archive.zip', 'search-other.json', 'searchindex.json']) {
      expect(isPreviewAssetPath(p)).toBe(false);
    }
  });
});

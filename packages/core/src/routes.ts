// Pure route-expansion logic for a project bundle: turning pages (static and
// collection) into the concrete set of routes to render. Used by both the Astro
// renderer and the API's static-site publisher, so it lives in core (not in an
// app). No filesystem or framework dependencies.
import { isLinkPage, type Entry, type Page } from '@sitewright/schema';
import { compareEntryOrder } from './bindings.js';
import type { ProjectBundle } from './validate.js';

/**
 * The pages a published build should include: everything except `draft`s. Filter a
 * bundle's pages with this at the publish boundary (the preview/editor keep drafts
 * visible). Status defaults to `published`, so pages predating the field are kept.
 */
export function publishedPages(pages: readonly Page[]): Page[] {
  return pages.filter((page) => page.status !== 'draft');
}

/** The non-collection, non-link pages a build renders (link placeholders emit no route/HTML). */
export function resolvedPages(bundle: ProjectBundle): Page[] {
  return bundle.pages.filter((page) => !page.collection && !isLinkPage(page));
}

/**
 * Groups entries by dataset slug. NOTE: this is unfiltered (includes drafts) — the editor preview
 * shows work-in-progress entries. The publish boundary uses {@link publishedDatasetEntries} so a
 * published site's `{{#each dataset.x}}` loops + keyed `{{item.x.key}}` access show published only.
 */
export function datasetEntries(bundle: ProjectBundle): Record<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  for (const entry of bundle.entries) {
    map.set(entry.dataset, [...(map.get(entry.dataset) ?? []), entry]);
  }
  // Apply the canonical drag-reorder `order` so published `{{#each}}` + block bindings match the editor.
  for (const list of map.values()) list.sort(compareEntryOrder);
  return Object.fromEntries(map);
}

/**
 * Like {@link datasetEntries}, but PUBLISHED entries only — the publish boundary for `{{#each dataset.x}}`
 * loops, keyed `{{item.x.key}}` access, and widget block bindings. `Entry.status` defaults to `draft`
 * (the OPPOSITE of `Page.status`), so this matches `=== 'published'` (the same test `collectionRoutes`
 * uses), keeping a draft entry out of published HTML even though its dataset is rendered.
 */
export function publishedDatasetEntries(bundle: ProjectBundle): Record<string, Entry[]> {
  return datasetEntries({ ...bundle, entries: bundle.entries.filter((entry) => entry.status === 'published') });
}

/** Converts a full route (`/`, `/about`, `/de/services`) to an Astro `[...slug]` param. */
export function pathToSlug(path: string): string | undefined {
  const slug = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return slug === '' ? undefined : slug;
}

/** Index pages by id for parent-chain lookups (e.g. {@link pagePath}). */
export function pagesById(pages: readonly Page[]): Map<string, Page> {
  return new Map(pages.map((p) => [p.id, p]));
}

/**
 * The full root-relative route of a page, computed from its PARENT CHAIN:
 * `{root}/{ancestor slugs}/{own slug}`. Each page's `path` is a single slug SEGMENT
 * (empty for the home page / tree root). The home page (empty slug, no parent) → `/`;
 * `about` under home → `/about`; `leistungen` under a `de` page under home → `/de/leistungen`.
 * Cycle-safe — a broken parent chain stops at the first repeated id. A parent id that
 * isn't in `byId` is treated as a root (the chain ends).
 */
export function pagePath(page: Page, byId: ReadonlyMap<string, Page>): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  let cur: Page | undefined = page;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.path) segments.unshift(cur.path); // skip the empty home/root slug
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return '/' + segments.join('/');
}

/**
 * The relative path from a page at `slug` back to the site root: `''` for the
 * home page, `'../'` one level deep, `'../../'` two, etc. Prefix internal links
 * and asset paths with this so the exported site is portable — it works
 * unchanged at the webspace root, in a subfolder, or at the `/sites/<slug>/`
 * preview path (contentBase's `$root` / `dirOffset`).
 */
export function relativeRoot(slug: string | undefined): string {
  if (!slug) return '';
  return '../'.repeat(slug.split('/').length);
}

/** A concrete page to render: a route slug, the page, and an optional bound entry. */
export interface Route {
  slug: string | undefined;
  page: Page;
  /** Present for collection-page routes: the dataset entry this page renders. */
  entry?: Entry;
}

// A safe URL/path segment: lowercase alphanumeric + hyphens, no "/" or ".." so the
// value cannot traverse outside the output directory when used as a file path.
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SLUG_LENGTH = 64;

/** Reads an entry value without dynamic object indexing. */
function entryValue(entry: Entry, key: string): unknown {
  return Object.entries(entry.values).find(([k]) => k === key)?.[1];
}

/**
 * Slug for a collection entry: its `[param]` field value when that value is a
 * safe, length-bounded path segment, otherwise the entry id (which the schema
 * already constrains to a safe identifier). `entry.values` are not slug-validated
 * by the schema, so this guards against path traversal and over-long filenames in
 * the generated output.
 */
export function entrySlug(entry: Entry, param: string): string {
  const value = entryValue(entry, param);
  if (typeof value === 'string' && value.length <= MAX_SLUG_LENGTH && SAFE_SEGMENT.test(value)) {
    return value;
  }
  return entry.id;
}

/** Substitutes `[param]` in a page path with a concrete value (no regex; param is a safe identifier). */
function fillPath(path: string, param: string, value: string): string {
  return path.split(`[${param}]`).join(value);
}

/**
 * Expands every collection page (`{ collection: { dataset, param } }`) into one
 * route per published entry, with that entry placed in render context.
 */
export function collectionRoutes(bundle: ProjectBundle): Route[] {
  const byId = pagesById(bundle.pages);
  const routes: Route[] = [];
  for (const page of bundle.pages) {
    if (!page.collection) continue;
    const { dataset, param } = page.collection;
    // Locale-suffix resolution: a `de` collection variant expands over `<dataset>-de`
    // when those entries exist, else the base dataset (auto-suffix, like data bindings).
    const localized = page.locale ? `${dataset}-${page.locale.toLowerCase()}` : undefined;
    const effectiveDataset =
      localized && bundle.entries.some((e) => e.dataset === localized) ? localized : dataset;
    const entries = bundle.entries.filter(
      (entry) => entry.dataset === effectiveDataset && entry.status === 'published',
    );
    for (const entry of entries) {
      routes.push({
        // The collection page's full route (from its parent chain) with `[param]` filled.
        slug: pathToSlug(fillPath(pagePath(page, byId), param, entrySlug(entry, param))),
        page,
        entry,
      });
    }
  }
  return routes;
}

/**
 * All routes to render: static pages plus collection pages expanded per entry.
 * Throws on a duplicate route slug (two collection entries resolving to the same
 * slug, or a collision with a static page) — otherwise the generator would
 * silently overwrite one page with another.
 */
export function allRoutes(bundle: ProjectBundle): Route[] {
  const byId = pagesById(bundle.pages);
  const staticRoutes: Route[] = resolvedPages(bundle).map((page) => ({
    slug: pathToSlug(pagePath(page, byId)),
    page,
  }));
  const routes = [...staticRoutes, ...collectionRoutes(bundle)];

  const seen = new Set<string>();
  for (const route of routes) {
    const key = route.slug ?? '';
    if (seen.has(key)) {
      throw new Error(
        `Duplicate route "/${key}" — two pages resolve to the same URL ` +
          `(check collection entries for duplicate slug values).`,
      );
    }
    seen.add(key);
  }
  return routes;
}

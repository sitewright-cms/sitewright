// Pure routing logic for a project bundle: turning pages into the concrete set of
// routes to render. Shared by the preview and publish builds, so it lives in core
// (not in an app). No filesystem or framework dependencies.
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

/** The pages a build renders — everything but link placeholders (those emit no route/HTML). */
export function resolvedPages(bundle: ProjectBundle): Page[] {
  return bundle.pages.filter((page) => !isLinkPage(page));
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
 * (the OPPOSITE of `Page.status`), so this matches `=== 'published'` — keeping a draft entry out of
 * published HTML even though its dataset is rendered.
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

/** A concrete page to render: a route slug and the page it renders. */
export interface Route {
  slug: string | undefined;
  page: Page;
}

/**
 * All routes to render — one per resolved page. Throws on a duplicate route slug (two pages
 * resolving to the same URL, e.g. sibling pages sharing a slug) because the generator would
 * otherwise silently overwrite one page's HTML with another's.
 *
 * There is no dataset-driven route expansion: `page.collection` + a `[param]` path once produced
 * one route per entry, but nothing ever bound the entry into the render context, so all N routes
 * rendered blank. It was removed (see `Page.collection` in @sitewright/schema) in favour of a real
 * page per item sharing a `template:` ref.
 */
export function allRoutes(bundle: ProjectBundle): Route[] {
  const byId = pagesById(bundle.pages);
  const routes: Route[] = resolvedPages(bundle).map((page) => ({
    slug: pathToSlug(pagePath(page, byId)),
    page,
  }));

  const seen = new Set<string>();
  for (const route of routes) {
    const key = route.slug ?? '';
    if (seen.has(key)) {
      throw new Error(`Duplicate route "/${key}" — two pages resolve to the same URL.`);
    }
    seen.add(key);
  }
  return routes;
}

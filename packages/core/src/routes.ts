// Pure route-expansion logic for a project bundle: turning pages (static and
// collection) into the concrete set of routes to render. Used by both the Astro
// renderer and the API's static-site publisher, so it lives in core (not in an
// app). No filesystem or framework dependencies.
import type { Entry, Page, SitewrightPartial, Template } from '@sitewright/schema';
import { resolvePartials } from './partials.js';
import { resolveTemplate } from './templates.js';
import type { ProjectBundle } from './validate.js';

export interface ResolvedPage {
  page: Page;
  /** Block tree with the template applied + partials expanded (bindings resolve at render). */
  root: Page['root'];
}

function buildPartialMap(bundle: ProjectBundle): Map<string, SitewrightPartial> {
  return new Map(bundle.partials.map((partial) => [partial.id, partial]));
}

function buildTemplateMap(bundle: ProjectBundle): Map<string, Template> {
  return new Map((bundle.templates ?? []).map((template) => [template.id, template]));
}

/** Applies a page's template (Outlet wrap) then expands partials. */
function resolveRoot(
  page: Page,
  templateMap: ReadonlyMap<string, Template>,
  partialMap: ReadonlyMap<string, SitewrightPartial>,
): Page['root'] {
  return resolvePartials(resolveTemplate(page.root, page.template, templateMap), partialMap);
}

/** Expands templates + partials for every non-collection page. */
export function resolvedPages(bundle: ProjectBundle): ResolvedPage[] {
  const partialMap = buildPartialMap(bundle);
  const templateMap = buildTemplateMap(bundle);
  return bundle.pages
    .filter((page) => !page.collection)
    .map((page) => ({ page, root: resolveRoot(page, templateMap, partialMap) }));
}

/**
 * Groups entries by dataset slug. NOTE: this is unfiltered (includes drafts);
 * callers must gate by status before display. `resolveBinding` does this by
 * default, which is why block bindings never surface draft content.
 */
export function datasetEntries(bundle: ProjectBundle): Record<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  for (const entry of bundle.entries) {
    map.set(entry.dataset, [...(map.get(entry.dataset) ?? []), entry]);
  }
  return Object.fromEntries(map);
}

/** Converts a page path (`/`, `/about`) to an Astro `[...slug]` param. */
export function pathToSlug(path: string): string | undefined {
  const slug = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return slug === '' ? undefined : slug;
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

/** A concrete page to render: a route slug, the (partial-expanded) tree, and an optional bound entry. */
export interface Route {
  slug: string | undefined;
  page: Page;
  root: Page['root'];
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
  const partialMap = buildPartialMap(bundle);
  const templateMap = buildTemplateMap(bundle);
  const routes: Route[] = [];
  for (const page of bundle.pages) {
    if (!page.collection) continue;
    const { dataset, param } = page.collection;
    const root = resolveRoot(page, templateMap, partialMap);
    const entries = bundle.entries.filter(
      (entry) => entry.dataset === dataset && entry.status === 'published',
    );
    for (const entry of entries) {
      routes.push({
        slug: pathToSlug(fillPath(page.path, param, entrySlug(entry, param))),
        page,
        root,
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
  const staticRoutes: Route[] = resolvedPages(bundle).map(({ page, root }) => ({
    slug: pathToSlug(page.path),
    page,
    root,
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

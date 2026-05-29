import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DatasetSchema,
  EntrySchema,
  PageSchema,
  PartialSchema,
  ProjectSchema,
  type Dataset,
  type Entry,
  type Page,
  type Project,
  type SitewrightPartial,
} from '@sitewright/schema';
import { resolvePartials, validateProject, type ProjectBundle } from '@sitewright/core';

const SAMPLE_DIR = fileURLToPath(new URL('../../projects/sample', import.meta.url));

// SECURITY TODO: this loader trusts `dir` (a build-time operator setting). Before
// it is ever driven by untrusted/multi-tenant input (e.g. an API request), confine
// reads to an allowed root: `path.resolve(dir)` must start with the tenant's root.
/** Absolute path of the project to render (override with SITEWRIGHT_PROJECT). */
export function projectDir(): string {
  return process.env.SITEWRIGHT_PROJECT ?? SAMPLE_DIR;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonDir(dir: string): unknown[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => readJson(join(dir, file)));
}

/**
 * Loads, schema-validates, and integrity-checks a project from disk (the
 * on-disk project format). Throws with a readable summary if validation fails.
 */
export function loadBundle(dir: string = projectDir()): ProjectBundle {
  const project: Project = ProjectSchema.parse(readJson(join(dir, 'sitewright.json')));
  const pages: Page[] = readJsonDir(join(dir, 'pages')).map((p) => PageSchema.parse(p));
  const partials: SitewrightPartial[] = readJsonDir(join(dir, 'partials')).map((p) =>
    PartialSchema.parse(p),
  );

  const datasets: Dataset[] = [];
  const entries: Entry[] = [];
  const datasetsDir = join(dir, 'datasets');
  if (existsSync(datasetsDir)) {
    for (const slug of readdirSync(datasetsDir).sort()) {
      const datasetFile = join(datasetsDir, slug, 'dataset.json');
      if (!existsSync(datasetFile)) continue;
      datasets.push(DatasetSchema.parse(readJson(datasetFile)));
      for (const entry of readJsonDir(join(datasetsDir, slug, 'entries'))) {
        entries.push(EntrySchema.parse(entry));
      }
    }
  }

  const bundle: ProjectBundle = { project, pages, partials, datasets, entries };
  const issues = validateProject(bundle);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `  - [${issue.code}] ${issue.message}`).join('\n');
    throw new Error(`Invalid project at ${dir}:\n${detail}`);
  }
  return bundle;
}

export interface ResolvedPage {
  page: Page;
  /** Block tree with partials expanded (bindings are resolved at render time). */
  root: Page['root'];
}

/** Expands partials for every non-collection page. */
export function resolvedPages(bundle: ProjectBundle): ResolvedPage[] {
  const partialMap = new Map(bundle.partials.map((partial) => [partial.id, partial]));
  return bundle.pages
    .filter((page) => !page.collection)
    .map((page) => ({ page, root: resolvePartials(page.root, partialMap) }));
}

/** Groups entries by dataset slug for binding resolution. */
export function datasetEntries(bundle: ProjectBundle): Record<string, Entry[]> {
  const map: Record<string, Entry[]> = {};
  for (const entry of bundle.entries) {
    (map[entry.dataset] ??= []).push(entry);
  }
  return map;
}

/** Converts a page path (`/`, `/about`) to an Astro `[...slug]` param. */
export function pathToSlug(path: string): string | undefined {
  const slug = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return slug === '' ? undefined : slug;
}

/** A concrete page to render: an Astro route param, the (partial-expanded) tree, and an optional bound entry. */
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

/**
 * Slug for a collection entry: its `[param]` field value when that value is a
 * safe path segment, otherwise the entry id (which the schema already constrains
 * to a safe identifier). `entry.values` are not slug-validated by the schema, so
 * this guards against path traversal in generated filenames.
 */
export function entrySlug(entry: Entry, param: string): string {
  const value = entry.values[param];
  if (typeof value === 'string' && SAFE_SEGMENT.test(value)) return value;
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
  const partialMap = new Map(bundle.partials.map((partial) => [partial.id, partial]));
  const routes: Route[] = [];
  for (const page of bundle.pages) {
    if (!page.collection) continue;
    const { dataset, param } = page.collection;
    const root = resolvePartials(page.root, partialMap);
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

/** All routes to render: static pages plus collection pages expanded per entry. */
export function allRoutes(bundle: ProjectBundle): Route[] {
  const staticRoutes: Route[] = resolvedPages(bundle).map(({ page, root }) => ({
    slug: pathToSlug(page.path),
    page,
    root,
  }));
  return [...staticRoutes, ...collectionRoutes(bundle)];
}

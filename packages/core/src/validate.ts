import {
  isLinkPage,
  type Dataset,
  type Entry,
  type Form,
  type Page,
  type PageTranslation,
  type Project,
  type Template,
} from '@sitewright/schema';
import { GLOBAL_TEMPLATES, isGlobalTemplate } from './templates.js';
import { pagePath, pagesById } from './routes.js';

/** A complete project: the manifest plus all of its content entities. */
export interface ProjectBundle {
  project: Project;
  pages: readonly Page[];
  /** Reusable page layouts (optional; older bundles omit it). */
  templates?: readonly Template[];
  datasets: readonly Dataset[];
  entries: readonly Entry[];
  /** Per-locale page TITLE overrides (multilingual; per-locale content is a locale-variant page). */
  translations?: readonly PageTranslation[];
  /** Web form definitions (optional; consumed by the renderer for `Form` blocks). */
  forms?: readonly Form[];
}

export interface ValidationIssue {
  /** Stable machine-readable code (e.g. `unknown_partial`). */
  code: string;
  message: string;
  /** Logical location within the project, e.g. `pages/home`. */
  path?: string;
}

function reportDuplicates(
  values: readonly string[],
  code: string,
  label: string,
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const value of values) {
    if (seen.has(value) && !reported.has(value)) {
      issues.push({ code, message: `duplicate ${label}: "${value}"` });
      reported.add(value);
    }
    seen.add(value);
  }
}

/**
 * Validates a project's **referential integrity** across entities — the checks
 * that individual Zod schemas cannot express because they span files: unique
 * ids/paths/slugs, partial references that resolve, bindings and collection
 * pages that point at real datasets, and entries that belong to real datasets.
 *
 * Returns a list of issues (empty when the project is valid).
 */
export function validateProject(bundle: ProjectBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const datasetSlugs = new Set(bundle.datasets.map((dataset) => dataset.slug));
  const templateIds = new Set((bundle.templates ?? []).map((template) => template.id));

  reportDuplicates(
    bundle.pages.map((page) => page.id),
    'duplicate_page_id',
    'page id',
    issues,
  );
  // Compare the COMPUTED full routes (not the bare slug): two pages may share a slug
  // under different parents, but their `{root}/{parents}/{slug}` routes must be unique.
  // Link placeholders are routing-transparent (slugless, no emitted route) — excluded so
  // multiple of them don't false-collide on `/` (their ids are still uniqueness-checked above).
  const byId = pagesById(bundle.pages);
  reportDuplicates(
    bundle.pages.filter((page) => !isLinkPage(page)).map((page) => pagePath(page, byId)),
    'duplicate_page_path',
    'page path',
    issues,
  );
  reportDuplicates(
    bundle.datasets.map((dataset) => dataset.slug),
    'duplicate_dataset_slug',
    'dataset slug',
    issues,
  );
  reportDuplicates(
    bundle.entries.map((entry) => entry.id),
    'duplicate_entry_id',
    'entry id',
    issues,
  );
  reportDuplicates(
    (bundle.templates ?? []).map((template) => template.id),
    'duplicate_template_id',
    'template id',
    issues,
  );

  for (const entry of bundle.entries) {
    if (!datasetSlugs.has(entry.dataset)) {
      issues.push({
        code: 'unknown_dataset',
        message: `entry "${entry.id}" references unknown dataset "${entry.dataset}"`,
        path: `entries/${entry.id}`,
      });
    }
  }

  for (const page of bundle.pages) {
    // Global (`global:<key>`) references resolve against the built-in list; project
    // references against the bundle's template entities.
    if (
      page.template !== undefined &&
      (isGlobalTemplate(page.template)
        ? !GLOBAL_TEMPLATES.some((t) => t.id === page.template)
        : !templateIds.has(page.template))
    ) {
      issues.push({
        code: 'unknown_template',
        message: `page "${page.id}" references unknown template "${page.template}"`,
        path: `pages/${page.id}`,
      });
    }
  }

  for (const page of bundle.pages) {
    if (page.collection && !datasetSlugs.has(page.collection.dataset)) {
      issues.push({
        code: 'unknown_collection_dataset',
        message: `page "${page.id}" collection references unknown dataset "${page.collection.dataset}"`,
        path: `pages/${page.id}`,
      });
    }
  }

  // Templates are code-first (Handlebars source, no block tree) — their source is
  // validated by renderTemplate at render time, like page sources.

  return issues;
}

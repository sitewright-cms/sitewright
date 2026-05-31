import type {
  Dataset,
  Entry,
  Form,
  Page,
  PageTranslation,
  Project,
  SitewrightPartial,
  Template,
} from '@sitewright/schema';
import { findDuplicateIds, walk } from './tree.js';

/** A complete project: the manifest plus all of its content entities. */
export interface ProjectBundle {
  project: Project;
  pages: readonly Page[];
  partials: readonly SitewrightPartial[];
  /** Reusable page layouts (optional; older bundles omit it). */
  templates?: readonly Template[];
  datasets: readonly Dataset[];
  entries: readonly Entry[];
  /** Per-locale page content overrides (multilingual; default locale uses page.root). */
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
 * Returns a list of issues (empty when the project is valid). Reference cycles
 * are detected separately by `resolvePartials`.
 */
export function validateProject(bundle: ProjectBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const datasetSlugs = new Set(bundle.datasets.map((dataset) => dataset.slug));
  const partialIds = new Set(bundle.partials.map((partial) => partial.id));
  const templateIds = new Set((bundle.templates ?? []).map((template) => template.id));

  reportDuplicates(
    bundle.pages.map((page) => page.id),
    'duplicate_page_id',
    'page id',
    issues,
  );
  reportDuplicates(
    bundle.pages.map((page) => page.path),
    'duplicate_page_path',
    'page path',
    issues,
  );
  reportDuplicates(
    bundle.partials.map((partial) => partial.id),
    'duplicate_partial_id',
    'partial id',
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
    if (page.template !== undefined && !templateIds.has(page.template)) {
      issues.push({
        code: 'unknown_template',
        message: `page "${page.id}" references unknown template "${page.template}"`,
        path: `pages/${page.id}`,
      });
    }
  }

  const checkTree = (root: Page['root'], location: string, owner: string): void => {
    for (const duplicate of findDuplicateIds(root)) {
      issues.push({
        code: 'duplicate_node_id',
        message: `${owner} has duplicate node id "${duplicate}"`,
        path: location,
      });
    }
    walk(root, (node) => {
      if (node.partialRef !== undefined && !partialIds.has(node.partialRef)) {
        issues.push({
          code: 'unknown_partial',
          message: `${owner} references unknown partial "${node.partialRef}"`,
          path: location,
        });
      }
      if (node.binding && !datasetSlugs.has(node.binding.dataset)) {
        issues.push({
          code: 'unknown_binding_dataset',
          message: `${owner} binds unknown dataset "${node.binding.dataset}"`,
          path: location,
        });
      }
    });
  };

  for (const page of bundle.pages) {
    checkTree(page.root, `pages/${page.id}`, `page "${page.id}"`);
    if (page.collection && !datasetSlugs.has(page.collection.dataset)) {
      issues.push({
        code: 'unknown_collection_dataset',
        message: `page "${page.id}" collection references unknown dataset "${page.collection.dataset}"`,
        path: `pages/${page.id}`,
      });
    }
  }

  for (const partial of bundle.partials) {
    checkTree(partial.root, `partials/${partial.id}`, `partial "${partial.id}"`);
  }

  for (const template of bundle.templates ?? []) {
    checkTree(template.root, `templates/${template.id}`, `template "${template.id}"`);
  }

  return issues;
}

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
import { validateProject, type ProjectBundle } from '@sitewright/core';

// Route-expansion helpers now live in @sitewright/core (shared with the API
// publisher); re-export them so existing renderer imports keep working.
export {
  allRoutes,
  collectionRoutes,
  datasetEntries,
  entrySlug,
  pathToSlug,
  resolvedPages,
  type ResolvedPage,
  type Route,
} from '@sitewright/core';

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
/** Build-time guard against a project generating an unbounded number of pages. */
const MAX_ENTRIES_PER_DATASET = 50_000;

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
      let entryCount = 0;
      for (const entry of readJsonDir(join(datasetsDir, slug, 'entries'))) {
        entries.push(EntrySchema.parse(entry));
        if (++entryCount > MAX_ENTRIES_PER_DATASET) {
          throw new Error(
            `dataset "${slug}" exceeds the limit of ${MAX_ENTRIES_PER_DATASET} entries`,
          );
        }
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

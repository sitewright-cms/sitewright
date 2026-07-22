import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExportManifestSchema, ProjectExportBundleSchema, type ExportManifest, type ProjectExportBundle } from '@sitewright/schema';
import type { Database } from './db/client.js';
import { ProjectRepository } from './repo/projects.js';
import { ContentRepository } from './repo/content.js';
import { MediaStorage } from './media/storage.js';
import { rewriteMediaSlug } from './import/rewrite-slug.js';

/**
 * The committed showcase projects — each subdirectory of `apps/api/example_projects/` is one
 * UNPACKED project export (`manifest.json` + `bundle.json` + `media/<assetId>/<file>`), shipped in
 * the image next to `dist/` (same `COPY` + path idiom as the `drizzle/` migrations). They are
 * produced by `scripts/export-example.mjs` — a showcase is AUTHORED in the product (edit the project
 * in the editor / via an agent, then re-export), not in code. First boot imports every bundle via
 * the exact same core the staff `POST /projects/import/zip` route uses, so the export→import
 * pipeline is exercised on every fresh instance.
 */
export const EXAMPLE_PROJECTS_DIR = fileURLToPath(new URL('../example_projects', import.meta.url));

/** The bundle directories under `root`, sorted by name (deterministic seed order — "example" first
 *  alphabetically is a happy accident; name a bundle dir to order it). Missing root → empty. */
export async function listSeedBundles(root: string = EXAMPLE_PROJECTS_DIR): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => join(root, name));
}

export interface SeedBundle {
  manifest: ExportManifest;
  bundle: ProjectExportBundle;
}

/** Reads + schema-validates one committed bundle directory. Throws when missing/invalid — the caller
 *  decides whether that is fatal (the CI gate) or a warn-and-continue (first-boot seed). */
export async function loadSeedBundle(dir: string): Promise<SeedBundle> {
  const manifest = ExportManifestSchema.parse(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
  const bundle = ProjectExportBundleSchema.parse(JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8')));
  return { manifest, bundle };
}

export interface ImportSeedBundleOptions {
  db: Database;
  /** The freshly-created admin — becomes the project's owner. */
  userId: string;
  /** The bundle directory (one subdirectory of {@link EXAMPLE_PROJECTS_DIR}). */
  dir: string;
  /** Media storage root; absent (unit tests) → content imports, binaries are skipped. */
  mediaRoot?: string;
  log?: (message: string) => void;
}

export interface ImportSeedBundleResult {
  projectId: string;
  slug: string;
  name: string;
  /** Section sizes counted from the imported bundle itself (the manifest's counts are advisory). */
  counts: { pages: number; datasets: number; entries: number; forms: number; media: number };
  mediaFiles: number;
}

/**
 * First-boot import of the committed bundle: create the project (name/slug from the bundle), write
 * the content sections via `ContentRepository.importBundle` (ids preserved, cross-entity
 * validation), then copy the media binaries into the media root. Mirrors the zip-import route's
 * order (content before media); media is per-file best-effort so one unreadable binary can't abort
 * an otherwise-complete seed.
 */
export async function importSeedBundle(opts: ImportSeedBundleOptions): Promise<ImportSeedBundleResult> {
  const { db, userId, mediaRoot, dir, log = () => {} } = opts;
  const { manifest, bundle } = await loadSeedBundle(dir);

  const projects = new ProjectRepository(db);
  const contentRepo = new ContentRepository(db);
  const slug = bundle.project.slug;
  const project = await projects.create({ name: bundle.project.name, slug }, userId);
  const ctx = { userId, projectId: project.id, role: 'owner' as const };
  // The bundle's media URLs are keyed under manifest.mediaSlug — identical to the project slug for a
  // bundle exported from the canonical "example" project, but rewrite anyway so a bundle exported
  // from a differently-named working copy still imports cleanly.
  const rewritten = manifest.mediaSlug === slug ? bundle : rewriteMediaSlug(bundle, manifest.mediaSlug, slug);
  await contentRepo.importBundle(ctx, project, rewritten);

  let mediaFiles = 0;
  if (mediaRoot) {
    const storage = new MediaStorage(mediaRoot);
    const mediaDir = join(dir, 'media');
    const assetIds = await readdir(mediaDir).catch(() => [] as string[]);
    for (const assetId of assetIds) {
      const assetDir = join(mediaDir, assetId);
      // rel paths may nest (recursive) — mirror the zip layout media/<assetId>/<rel>.
      const entries = await readdir(assetDir, { recursive: true, withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const rel = join(entry.parentPath ?? assetDir, entry.name).slice(assetDir.length + 1).replaceAll('\\', '/');
        try {
          await storage.importAssetFile(slug, assetId, rel, await readFile(join(assetDir, rel)));
          mediaFiles++;
        } catch (err) {
          log(`[sitewright/seed] WARNING: could not restore media ${assetId}/${rel} — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  return {
    projectId: project.id,
    slug,
    name: bundle.project.name,
    counts: {
      pages: bundle.pages.length,
      datasets: bundle.datasets.length,
      entries: bundle.entries.length,
      forms: bundle.forms.length,
      media: bundle.media.length,
    },
    mediaFiles,
  };
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_MAP_TEMPLATE_IMAGES, isImageMapTemplateId } from '@sitewright/schema';

/**
 * The bundled IMAGE MAP starter templates and their images, served under `/authoring/imagemaps/`.
 *
 * Resolved relative to this module so it works in dev (`apps/api/src` → `apps/api/assets/imagemaps`)
 * AND in the built runtime image (`dist/imagemap-assets.js` → `/app/assets/imagemaps`, COPY'd by the
 * Dockerfile as a sibling of `dist/`) — exactly like `textures.ts` / `example_projects` / `drizzle`.
 *
 * The configs live here as JSON rather than as a bundled constant because the five together are
 * ~940 KB; only their METADATA is in `@sitewright/schema` (IMAGE_MAP_TEMPLATES), which the editor
 * ships to the browser. See that file for the split.
 *
 * These paths are a source for CREATING a map, never a destination: materialising a template
 * imports its images into the project's own media library and rewrites the config, so a published
 * site never points back at the platform.
 */
export const IMAGEMAP_ASSETS_DIR = fileURLToPath(new URL('../assets/imagemaps', import.meta.url));

/** Absolute path to a template's config JSON, or null when `id` is not a bundled template. */
export function templateConfigPath(id: string): string | null {
  return isImageMapTemplateId(id) ? join(IMAGEMAP_ASSETS_DIR, 'templates', `${id}.json`) : null;
}

/** Absolute path to a template image, or null when `file` is not one (allowlist — blocks traversal). */
export function templateImagePath(file: string): string | null {
  return IMAGE_MAP_TEMPLATE_IMAGES.includes(file) ? join(IMAGEMAP_ASSETS_DIR, file) : null;
}

/**
 * A bundled template's config, or null when the id is unknown or the file is missing/corrupt.
 *
 * Parsed here rather than streamed so a malformed file fails as "unknown template" instead of
 * shipping broken JSON into a project.
 */
export async function readTemplateConfig(id: string): Promise<Record<string, unknown> | null> {
  const path = templateConfigPath(id);
  if (!path) return null;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `id` is catalog-allowlisted by templateConfigPath (isImageMapTemplateId)
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A template image's bytes, or null if the name is unknown or the file is missing. */
export async function readTemplateImage(file: string): Promise<Buffer | null> {
  const path = templateImagePath(file);
  if (!path) return null;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `file` is catalog-allowlisted by templateImagePath
  return readFile(path).catch(() => null);
}

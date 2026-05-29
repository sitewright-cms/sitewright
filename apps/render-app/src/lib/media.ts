import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OptimizedImage } from '@sitewright/image-pipeline';

/** An optimized media asset plus the public dir its variant files live under. */
export interface MediaAsset extends OptimizedImage {
  /** Public path prefix for this asset's variants, e.g. `/_sw-media/hero/`. */
  dir: string;
}

/** Map of original media filename (e.g. `hero.png`) → optimized asset. */
export type MediaManifest = Record<string, MediaAsset>;

const MANIFEST_PATH = fileURLToPath(
  new URL('../../public/_sw-media/manifest.json', import.meta.url),
);

/**
 * Loads the media manifest produced by the `optimize-media` prebuild step.
 * Returns an empty manifest if the prebuild has not run (e.g. unit tests run
 * standalone), so the renderer degrades gracefully to plain `<img>`.
 */
export function loadMediaManifest(path: string = MANIFEST_PATH): MediaManifest {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as MediaManifest;
}

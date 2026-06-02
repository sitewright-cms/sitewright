import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Validate the generated manifest at load — it is trusted (we write it), but this
// enforces the shapes the renderer relies on and constrains the values that flow
// into HTML attributes (dir/path/placeholder), failing loudly on corruption.
const VariantSchema = z.object({
  format: z.enum(['avif', 'webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  path: z.string().regex(/^[\w-]+\.(avif|webp)$/),
});

const MediaAssetSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  placeholder: z.string().regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/),
  variants: z.array(VariantSchema),
  fallback: z.string().regex(/^[\w-]+\.jpg$/),
  dir: z.string().regex(/^\/_sw-media\/[\w-]+\/$/),
});

export const MediaManifestSchema = z.record(z.string(), MediaAssetSchema);

/** An optimized media asset plus the public dir its variant files live under. */
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
/** Map of original media filename (e.g. `hero.png`) → optimized asset. */
export type MediaManifest = z.infer<typeof MediaManifestSchema>;

// From the package working directory (NOT `import.meta.url`): Astro 6 bundles getStaticPaths into
// `dist/.prerender/chunks/`, where an import.meta-relative path would resolve into `dist/`.
const MANIFEST_PATH = resolve(process.cwd(), 'public/_sw-media/manifest.json');

/**
 * Loads + validates the media manifest produced by the `optimize-media` prebuild.
 * Returns an empty manifest if the prebuild has not run (so the renderer degrades
 * to plain `<img>`); throws if the manifest exists but is malformed.
 */
export function loadMediaManifest(path: string = MANIFEST_PATH): MediaManifest {
  if (!existsSync(path)) return {};
  return MediaManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

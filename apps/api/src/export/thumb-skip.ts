import { SIZE_TOKENS, THUMB_FORMATS, thumbFileName } from '@sitewright/image-pipeline';
import type { MediaAsset } from '@sitewright/schema';

/**
 * The DERIVED, regenerable thumbnail file names an image asset can accumulate in its on-disk dir.
 *
 * Post-#590 the media serve route stores only the ORIGINAL (source of truth) and generates named-size
 * thumbnails (`<stem>-<size>.<webp|avif>`) ON DEMAND, caching each into the SAME asset directory
 * (`storeFile` → asset-dir root). A whole-project export ships the retained original ONLY — these
 * cached thumbnails are disposable and regenerate on demand in the imported project — so the export
 * enumerator must skip them. Skipping is driven by the DB-known `original` (never a fragile name
 * pattern): the exhaustive cache set is `{sm,md,lg,xl} × {webp,avif}` = 8 names via `thumbFileName`,
 * so an original literally named `foo-xl.webp` (whose thumbnails would be `foo-xl-xl.webp`, …) is
 * never mistaken for a thumbnail and is always exported. Non-image assets have no thumbnails → ∅.
 */
export function derivedThumbnailNames(asset: MediaAsset): ReadonlySet<string> {
  const names = new Set<string>();
  if (asset.kind !== 'image') return names;
  for (const size of SIZE_TOKENS) {
    for (const format of THUMB_FORMATS) {
      names.add(thumbFileName(asset.original, size, format));
    }
  }
  return names;
}

/**
 * `assetId → its derived-thumbnail file names`, for every IMAGE asset in a bundle. The export route
 * passes each asset's set to {@link MediaStorage.assetFilePaths} so the streamed archive contains
 * only originals (minimal + deterministic regardless of how often the site has been previewed).
 */
export function buildThumbSkipMap(
  media: readonly MediaAsset[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, ReadonlySet<string>>();
  for (const asset of media) {
    if (asset.kind === 'image') map.set(asset.id, derivedThumbnailNames(asset));
  }
  return map;
}

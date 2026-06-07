import { randomUUID } from 'node:crypto';
import { FontAssetSchema, type FontAsset } from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { ContentRepository } from '../repo/content.js';
import type { MediaStorage } from '../media/storage.js';
import { FONT_EXT, type FontFormat } from './upload.js';

export interface CreateFontAssetInput {
  family: string;
  fallback: FontAsset['fallback'];
  source: FontAsset['source'];
  folder?: string;
  /** One stored face (woff2/woff/ttf/otf) per weight×style. */
  faces: Array<{ weight: number; style: 'normal' | 'italic'; format: FontFormat; bytes: Buffer }>;
}

/**
 * Stores a self-hosted font family as a `kind:'font'` media asset: each face under
 * `<projectId>/<assetId>/<weight>[-italic].<ext>`, plus the asset record. Shared by the upload +
 * Google-select routes and the demo seed. Served INLINE so `@font-face` can load it; bundled into
 * the published artifact like any media (zero font-CDN references).
 */
export async function createFontAsset(
  contentRepo: ContentRepository,
  storage: MediaStorage,
  ctx: ProjectContext,
  projectId: string,
  input: CreateFontAssetInput,
): Promise<FontAsset> {
  const assetId = randomUUID();
  try {
    const files: Array<{ weight: number; style: 'normal' | 'italic'; format: FontFormat; file: string }> = [];
    let bytes = 0;
    for (const f of input.faces) {
      const file = `${f.weight}${f.style === 'italic' ? '-italic' : ''}.${FONT_EXT[f.format]}`;
      await storage.storeFile(projectId, assetId, file, f.bytes);
      files.push({ weight: f.weight, style: f.style, format: f.format, file });
      bytes += f.bytes.length;
    }
    const asset = FontAssetSchema.parse({
      kind: 'font',
      id: assetId,
      filename: input.family,
      folder: input.folder ?? '',
      bytes,
      family: input.family,
      fallback: input.fallback,
      source: input.source,
      files,
      url: `/media/${projectId}/${assetId}/${files[0]!.file}`,
    });
    return (await contentRepo.put(ctx, 'media', assetId, asset)) as FontAsset;
  } catch (err) {
    await storage.remove(projectId, assetId);
    throw err;
  }
}

/**
 * Merges additional faces into an EXISTING font asset (used when re-selecting the same Google family
 * with extra weights, so the library keeps one entry per family instead of a duplicate per pick).
 * Faces whose weight×style is already present are skipped (the stored file wins); only genuinely new
 * faces are written + appended. Returns the asset unchanged when there is nothing to add.
 */
export async function mergeFontFaces(
  contentRepo: ContentRepository,
  storage: MediaStorage,
  ctx: ProjectContext,
  projectId: string,
  existing: FontAsset,
  faces: CreateFontAssetInput['faces'],
): Promise<FontAsset> {
  const have = new Set(existing.files.map((f) => `${f.weight}-${f.style}`));
  const added: Array<{ weight: number; style: 'normal' | 'italic'; format: FontFormat; file: string }> = [];
  let addedBytes = 0;
  try {
    for (const f of faces) {
      const key = `${f.weight}-${f.style}`;
      if (have.has(key)) continue;
      const file = `${f.weight}${f.style === 'italic' ? '-italic' : ''}.${FONT_EXT[f.format]}`;
      await storage.storeFile(projectId, existing.id, file, f.bytes);
      added.push({ weight: f.weight, style: f.style, format: f.format, file });
      have.add(key);
      addedBytes += f.bytes.length;
    }
  } catch (err) {
    // Roll back faces written before the failure (symmetry with createFontAsset, which drops the whole
    // new asset dir — here we remove only the NEW files, never the existing ones).
    await Promise.all(added.map((a) => storage.removeFile(projectId, existing.id, a.file).catch(() => undefined)));
    throw err;
  }
  if (added.length === 0) return existing;
  const asset = FontAssetSchema.parse({
    ...existing,
    bytes: existing.bytes + addedBytes,
    files: [...existing.files, ...added],
  });
  return (await contentRepo.put(ctx, 'media', existing.id, asset)) as FontAsset;
}

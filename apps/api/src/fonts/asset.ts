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

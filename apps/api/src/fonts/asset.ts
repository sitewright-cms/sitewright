import { FontAssetSchema, type FontAsset } from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { ContentRepository } from '../repo/content.js';
import type { MediaStorage } from '../media/storage.js';
import { mintAssetId } from '../media/mint-id.js';
import { FONT_EXT, type FontFormat } from './upload.js';

/** Slugify a font family for the stored filename: `Playfair Display` → `playfair-display`. */
function familySlug(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stored face filename: `<family-slug>-<weight>[-italic].<ext>` (slug omitted if it'd be empty). */
function faceFileName(slug: string, f: { weight: number; style: 'normal' | 'italic'; format: FontFormat }): string {
  const prefix = slug ? `${slug}-` : '';
  return `${prefix}${f.weight}${f.style === 'italic' ? '-italic' : ''}.${FONT_EXT[f.format]}`;
}

export interface CreateFontAssetInput {
  family: string;
  fallback: FontAsset['fallback'];
  source: FontAsset['source'];
  folder?: string;
  /** One stored face (woff2/woff/ttf/otf) per weight×style. A VARIABLE face additionally carries the
   *  weight axis it covers, so the renderer declares the real range instead of a single weight. */
  faces: Array<{ weight: number; weightRange?: [number, number]; style: 'normal' | 'italic'; format: FontFormat; bytes: Buffer }>;
}

/** The stored `files[]` entry for a face — the axis only when the face actually has one. */
function fileRecord(f: CreateFontAssetInput['faces'][number], file: string) {
  return { weight: f.weight, ...(f.weightRange ? { weightRange: f.weightRange } : {}), style: f.style, format: f.format, file };
}

/**
 * Stores a self-hosted font family as a `kind:'font'` media asset: each face stored flat as
 * `<projectSlug>/<assetId>-<family-slug>-<weight>[-italic].<ext>`, plus the asset record. Shared by
 * the upload + Google-select routes and the demo seed. Served INLINE so `@font-face` can load it;
 * bundled into the published artifact like any media (zero font-CDN references).
 */
export async function createFontAsset(
  contentRepo: ContentRepository,
  storage: MediaStorage,
  ctx: ProjectContext,
  projectSlug: string,
  input: CreateFontAssetInput,
): Promise<FontAsset> {
  const assetId = await mintAssetId(contentRepo, ctx);
  const slug = familySlug(input.family);
  try {
    const files: Array<ReturnType<typeof fileRecord>> = [];
    let bytes = 0;
    for (const f of input.faces) {
      const file = faceFileName(slug, f);
      await storage.storeFile(projectSlug, assetId, file, f.bytes);
      files.push(fileRecord(f, file));
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
      url: `/media/${projectSlug}/${assetId}-${files[0]!.file}`,
    });
    return (await contentRepo.put(ctx, 'media', assetId, asset)) as FontAsset;
  } catch (err) {
    await storage.remove(projectSlug, assetId);
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
  projectSlug: string,
  existing: FontAsset,
  faces: CreateFontAssetInput['faces'],
): Promise<FontAsset> {
  const have = new Set(existing.files.map((f) => `${f.weight}-${f.style}`));
  const slug = familySlug(existing.family);
  const added: Array<ReturnType<typeof fileRecord>> = [];
  let addedBytes = 0;
  try {
    for (const f of faces) {
      const key = `${f.weight}-${f.style}`;
      if (have.has(key)) continue;
      const file = faceFileName(slug, f);
      await storage.storeFile(projectSlug, existing.id, file, f.bytes);
      added.push(fileRecord(f, file));
      have.add(key);
      addedBytes += f.bytes.length;
    }
  } catch (err) {
    // Roll back faces written before the failure (symmetry with createFontAsset, which drops the whole
    // new asset dir — here we remove only the NEW files, never the existing ones).
    await Promise.all(added.map((a) => storage.removeFile(projectSlug, existing.id, a.file).catch(() => undefined)));
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

/** What may be corrected on a font asset (each optional; already boundary-validated by the caller). */
export interface FontMetadataChanges {
  family?: string;
  fallback?: FontAsset['fallback'];
  weight?: FontAsset['files'][number]['weight'];
  style?: 'normal' | 'italic';
  /** The stored face file `weight`/`style` describe — needed only when the family holds several. */
  face?: string;
}

export type FontCorrection = { ok: true; asset: FontAsset } | { ok: false; error: string };

/**
 * Correct what an upload GUESSED about a font. A dropped `Inter-Bold.woff2` is recorded as family
 * "Inter-Bold", weight 400 — the filename stem and a default — and the font cannot be replaced (a
 * family is many files), so this is the only way to fix the record.
 *
 * `family`/`fallback` describe the whole family; `weight`/`style` describe ONE face, so on a family
 * of several faces the caller has to name which (`face`). The stored FILE names are deliberately left
 * alone even when they carry the old weight: a name is part of the served URL, and a `url()` in
 * criticalCss pointing at it must not break because the metadata was corrected. Typography needs
 * nothing else — the renderer reads family, fallback and each face's weight off the asset.
 *
 * Pure: returns the corrected record (schema-checked) or the reason it cannot be, never writes.
 */
export function correctFontMetadata(existing: FontAsset, changes: FontMetadataChanges): FontCorrection {
  let files = existing.files;
  if (changes.weight !== undefined || changes.style !== undefined) {
    const names = existing.files.map((f) => f.file).join(', ');
    const target =
      changes.face !== undefined
        ? existing.files.find((f) => f.file === changes.face)
        : existing.files.length === 1
          ? existing.files[0]
          : undefined;
    if (!target) {
      return {
        ok: false,
        error:
          changes.face !== undefined
            ? `this font has no face "${changes.face}" — its faces are: ${names}`
            : `this font holds ${existing.files.length} faces — name the one to change with \`face\` (one of: ${names})`,
      };
    }
    const weight = changes.weight ?? target.weight;
    const style = changes.style ?? target.style;
    // A VARIABLE face's `weight` is its default point on the axis; a default off the axis is a face
    // the file cannot render.
    if (target.weightRange && (weight < target.weightRange[0] || weight > target.weightRange[1])) {
      return { ok: false, error: `weight ${weight} is outside this variable face's axis (${target.weightRange[0]}–${target.weightRange[1]})` };
    }
    // The same weight×style twice in one container is ambiguous to @font-face — the schema refuses it,
    // but a sentence naming the clash beats a schema error.
    if (existing.files.some((f) => f !== target && f.weight === weight && f.style === style && f.format === target.format)) {
      return { ok: false, error: `another ${target.format} face of this font is already ${weight} ${style}` };
    }
    files = existing.files.map((f) => (f === target ? { ...f, weight, style } : f));
  }
  const family = changes.family ?? existing.family;
  const asset = FontAssetSchema.parse({
    ...existing,
    family,
    fallback: changes.fallback ?? existing.fallback,
    // createFontAsset names the asset after its family; keep the two in step unless someone renamed it.
    filename: existing.filename === existing.family ? family : existing.filename,
    files,
  });
  return { ok: true, asset };
}

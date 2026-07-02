import { z } from 'zod';
import { IdSchema } from './primitives.js';
import { FontFileSchema, FontFamilyNameSchema, FontFallbackSchema, FontSourceSchema } from './corporate-identity.js';

// Optimized image variant file names (`<name>-<width>.<fmt>`) are pipeline-generated, never
// user-controlled, so this constrains them to a safe charset for path + URL segments.
const VariantFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+\.(avif|webp|jpg)$/, 'unexpected variant file name');

// Stored file name for a NON-image asset: a sanitized base + a short original extension. The
// charset excludes `/`, `\`, and dot-segments, so a value can never escape its asset directory.
const StoredFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}$/, 'unexpected stored file name');

/** One generated variant file (one format at one width). */
export const MediaVariantSchema = z.object({
  format: z.enum(['avif', 'webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  path: VariantFileNameSchema,
});
export type MediaVariant = z.infer<typeof MediaVariantSchema>;

// One folder path segment — a single linear character class (no nested quantifier → no ReDoS).
const FOLDER_SEGMENT = /^[A-Za-z0-9 _-]+$/;

// A VIRTUAL folder path: purely a grouping label for the editor (on-disk storage stays flat at
// `<projectId>/<assetId>/`). Slash-delimited safe segments, no leading/trailing slash; '' = root.
// Validated per-segment (not via a nested-quantifier regex) so a hostile query param can't ReDoS.
export const MediaFolderSchema = z
  .string()
  .max(200)
  .refine((v) => v === '' || v.split('/').every((seg) => FOLDER_SEGMENT.test(seg)), 'invalid folder path');
const FolderSchema = MediaFolderSchema.default('');

/** Stock-image attribution, recorded to satisfy a provider's license terms. */
const AttributionSchema = z.object({
  provider: z.string().min(1).max(40),
  author: z.string().max(200),
  sourceUrl: z.string().url().max(2048),
  license: z.string().max(120),
});
export type MediaAttribution = z.infer<typeof AttributionSchema>;

// Fields shared by every asset kind.
const baseShape = {
  id: IdSchema,
  /** Original upload file name (for display). */
  filename: z.string().min(1).max(255),
  /** Virtual folder this asset is filed under ('' = root). */
  folder: FolderSchema,
  bytes: z.number().int().nonnegative(),
  alt: z.string().max(500).optional(),
  attribution: AttributionSchema.optional(),
} as const;

/**
 * An uploaded **image** asset. The retained ORIGINAL lives on disk under the project's media root
 * (source of truth); responsive thumbnails are derived from it ON DEMAND (named sizes → WebP/AVIF)
 * and cached — never eagerly fanned out. This record is the tenant-scoped metadata the editor and
 * renderer reference. `url` is the id-bearing DELIVERY route (no `size=` ⇒ `xl` thumbnail), so any
 * binding that stores it is compressed by default; `?size=original` opts back to the raw original.
 */
export const ImageAssetSchema = z.object({
  kind: z.literal('image'),
  ...baseShape,
  /** Format of the STORED original (sharp): `png`|`jpeg`|`webp`|`gif`|`avif`|`tiff`. */
  format: z.string().min(1).max(20),
  /** Intrinsic dimensions of the stored original (for `width`/`height` attrs → no CLS). */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Tiny blurred inline LQIP data URI. */
  placeholder: z.string().max(20_000).optional(),
  /** Source carries an alpha channel (governs the `{{sw-image}}` fallback-format choice). */
  hasAlpha: z.boolean().default(false),
  /** Source is multi-frame (animated GIF/WebP → animated WebP thumbnails). */
  animated: z.boolean().default(false),
  /** Stored ORIGINAL file name on disk (sanitized base + extension) — the retained source of truth. */
  original: StoredFileNameSchema,
  /** Root-relative DELIVERY URL — id-bearing, ends in the stored original's (image) name; a bare fetch
   *  defaults to the `xl` thumbnail. The extension is a raster image type (storeOriginal normalizes the
   *  stored name to the detected format), never an arbitrary/executable one. */
  url: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^\/media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(avif|webp|jpg|jpeg|png|gif|tiff)$/),
});
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

/**
 * An uploaded **non-image** file (PDF, archive, document, …) stored as-is. It is served ONLY as a
 * download (`Content-Disposition: attachment` + `nosniff`), never inline, so an uploaded
 * HTML/SVG can never execute on the API/site origin.
 */
export const FileAssetSchema = z.object({
  kind: z.literal('file'),
  ...baseShape,
  /** The served MIME type (informational; the raw route forces octet-stream + attachment). */
  contentType: z.string().min(1).max(150),
  /** On-disk stored file name (sanitized base + original extension). */
  storedName: StoredFileNameSchema,
  /** Root-relative download URL (routed through the attachment-only `/file/` handler). */
  url: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^\/media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/file\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}$/),
});
export type FileAsset = z.infer<typeof FileAssetSchema>;

/**
 * A self-hosted **font** family (kind `font`): the family name, a generic CSS `fallback`, its
 * `source` (downloaded Google family or a local upload), and the stored `files` (one per weight×
 * style). Served INLINE (`font/*` + nosniff + CORS) so `@font-face` can load it; bundled like any
 * media into `_assets/<id>/<file>`. Typography slots reference a font asset by `id` + a weight.
 */
export const FontAssetSchema = z.object({
  kind: z.literal('font'),
  ...baseShape,
  family: FontFamilyNameSchema,
  fallback: FontFallbackSchema,
  source: FontSourceSchema,
  files: z
    .array(FontFileSchema)
    .min(1)
    .max(18)
    .refine((fs) => new Set(fs.map((x) => `${x.weight}-${x.style}-${x.format}`)).size === fs.length, 'duplicate font file'),
  /** Root-relative URL of a representative file (the manager's download link). */
  url: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^\/media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[a-z0-9][a-z0-9-]{0,150}\.(woff2|woff|ttf|otf)$/),
});
export type FontAsset = z.infer<typeof FontAssetSchema>;

/**
 * A self-hosted **stylesheet** (kind `stylesheet`): an imported site's CSS, stored as one `.css` file
 * and served INLINE (`text/css` + nosniff + CORS) so a page can `<link>` it — keeping the bulk CSS OUT
 * of the page `source` (which stays editable HTML). Bundled into `_assets/<id>/<file>` like other media.
 */
export const StylesheetAssetSchema = z.object({
  kind: z.literal('stylesheet'),
  ...baseShape,
  /** On-disk stored file name (e.g. `styles.css`). */
  storedName: StoredFileNameSchema,
  /** Root-relative URL of the inline-served stylesheet. */
  url: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^\/media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.css$/),
});
export type StylesheetAsset = z.infer<typeof StylesheetAssetSchema>;

/**
 * A self-hosted JavaScript file from a WEBSITE IMPORT (the cloned site's own + third-party scripts),
 * inline-served as `text/javascript` and `<script src>`-linked from `website.scripts` so the imported
 * site stays interactive. @security Foreign script execution is a deliberate, owner-only import choice
 * (the cornerstone "no foreign scripts" rule is relaxed ONLY for these self-hosted refs); preview runs
 * sandboxed and the published site is the owner's own origin. Bundled into `_assets/<id>/<file>`.
 */
export const ScriptAssetSchema = z.object({
  kind: z.literal('script'),
  ...baseShape,
  /** On-disk stored file name (e.g. `script.js`). */
  storedName: StoredFileNameSchema,
  /** Root-relative URL of the inline-served script. */
  url: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^\/media\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.js$/),
});
export type ScriptAsset = z.infer<typeof ScriptAssetSchema>;

/** Any uploaded asset — an optimized image, a raw file, a font, a stylesheet, or an imported script. */
export const MediaAssetSchema = z.discriminatedUnion('kind', [ImageAssetSchema, FileAssetSchema, FontAssetSchema, StylesheetAssetSchema, ScriptAssetSchema]);
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

/**
 * A PERSISTED folder record. Folders used to exist only implicitly (an asset's `folder`
 * label), so an empty folder vanished on reload. A `mediafolder` record makes folders
 * first-class: empty folders persist, and rename/move/delete operate on them. `path` is
 * the full slash-delimited folder path (never `''` — the root needs no record).
 */
export const MediaFolderRecordSchema = z.object({
  id: IdSchema,
  path: MediaFolderSchema.refine((v) => v !== '', 'a folder record needs a non-empty path'),
});
export type MediaFolderRecord = z.infer<typeof MediaFolderRecordSchema>;

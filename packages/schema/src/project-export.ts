import { z } from 'zod';
import { CorporateIdentitySchema } from './corporate-identity.js';
import { WebsiteSettingsSchema } from './website.js';
import { PROJECT_FORMAT_VERSION, ProjectSettingsSchema } from './project.js';
import { PageSchema } from './page.js';
import { TemplateSchema } from './template.js';
import { SnippetSchema } from './snippet.js';
import { DatasetSchema, EntrySchema } from './dataset.js';
import { PageTranslationSchema } from './translation.js';
import { FormSchema } from './form.js';
import { ImageMapSchema } from './image-map.js';
import { MediaAssetSchema, MediaFolderRecordSchema } from './media.js';
import { IdSchema, SlugSchema } from './primitives.js';
import { mergeLegacyIdentity } from './migrate-identity.js';
import { mergeLegacyTranslations } from './migrate-translations.js';

/**
 * The **complete**, portable project bundle — the `bundle.json` inside a project
 * export zip. It is a strict superset of the legacy `ExportBundle` (pages,
 * templates, datasets, entries) that also carries the sections a whole-project
 * archive needs to round-trip: snippets, per-locale translations, forms, and
 * media **metadata** (the binaries travel as files under `media/<assetId>/…` in
 * the zip, never inside this JSON).
 *
 * Deliberately excluded (never portable): deploy-target credentials and the
 * per-project SMTP password (AES-encrypted with the instance key), form
 * submissions and AI-usage (PII/metrics), members/invites/API keys, and
 * revision history — see the export route + manifest `omitted[]`.
 */

/**
 * Per-section upper bounds — defense-in-depth alongside the zip's per-entry /
 * total decompression caps. The first four mirror `content.ts` MAX_BUNDLE so a
 * bundle that imports here also survives the legacy JSON import path.
 */
/**
 * ★ These bound an IN-MEMORY object graph, not a stream — the bundle is assembled, serialized to
 * `bundle.json`, and on import parsed back in one piece. So unlike the archive BYTE ceiling (which is
 * disk-bound and generous — see apps/api/src/limits.ts), each of these trades directly against RAM.
 *
 * Measured on the reference large project: 1,085 pages = 3.0 MB of JSON (~2.8 KB each) and 7,907
 * media records = 3.5 MB (~0.45 KB each) — 6.7 MB of content in total, for a project holding 2.9 GB
 * of media. Media BYTES stream; media RECORDS do not, which is why the counts below are generous
 * rather than unbounded.
 *
 * At these ceilings a maximal bundle serializes to roughly 75 MB, which an instance with a
 * few hundred MB of headroom can hold while it writes the archive. The previous values were
 * ~5× lower and already within reach: the reference project sat at 54% of the page cap.
 */
export const EXPORT_BUNDLE_CAPS = {
  pages: 10_000,
  templates: 2000,
  snippets: 5000,
  datasets: 2000,
  entries: 200_000,
  translations: 50_000,
  forms: 2000,
  imageMaps: 1000,
  media: 100_000,
  mediaFolders: 10_000,
} as const;

/**
 * Version of the export **zip envelope** (`manifest.json`) — independent of
 * {@link PROJECT_FORMAT_VERSION}, which versions the bundle CONTENT. Bumped only
 * when the envelope/layout changes incompatibly; import refuses a newer one.
 */
export const PROJECT_EXPORT_FORMAT = 1;

/**
 * The project manifest fields carried in the bundle. `id`/`name`/`slug` are
 * advisory on import (a new project mints fresh ones); `mergeLegacyIdentity`
 * folds a pre-v2 `{brand,company}` project so older JSON exports still parse, and
 * `mergeLegacyTranslations` lifts a catalog still on the flat reserved key names so
 * an old bundle keeps its cart/consent/theme overrides.
 */
const ExportBundleProjectSchema = z.preprocess(
  (raw) => mergeLegacyTranslations(mergeLegacyIdentity(raw)),
  z.object({
    id: IdSchema,
    name: z.string().min(1).max(200),
    slug: SlugSchema,
    identity: CorporateIdentitySchema,
    website: WebsiteSettingsSchema.optional(),
    settings: ProjectSettingsSchema,
  }),
);

export const ProjectExportBundleSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  project: ExportBundleProjectSchema,
  pages: z.array(PageSchema).max(EXPORT_BUNDLE_CAPS.pages).default([]),
  templates: z.array(TemplateSchema).max(EXPORT_BUNDLE_CAPS.templates).default([]),
  snippets: z.array(SnippetSchema).max(EXPORT_BUNDLE_CAPS.snippets).default([]),
  datasets: z.array(DatasetSchema).max(EXPORT_BUNDLE_CAPS.datasets).default([]),
  entries: z.array(EntrySchema).max(EXPORT_BUNDLE_CAPS.entries).default([]),
  translations: z.array(PageTranslationSchema).max(EXPORT_BUNDLE_CAPS.translations).default([]),
  forms: z.array(FormSchema).max(EXPORT_BUNDLE_CAPS.forms).default([]),
  imageMaps: z.array(ImageMapSchema).max(EXPORT_BUNDLE_CAPS.imageMaps).default([]),
  media: z.array(MediaAssetSchema).max(EXPORT_BUNDLE_CAPS.media).default([]),
  mediaFolders: z.array(MediaFolderRecordSchema).max(EXPORT_BUNDLE_CAPS.mediaFolders).default([]),
});

export type ProjectExportBundle = z.infer<typeof ProjectExportBundleSchema>;

/**
 * The zip's `manifest.json` — the human- and machine-readable envelope that sits
 * next to `bundle.json`. `mediaSlug` records the project slug baked into the
 * bundle's `/media/<slug>/…` URLs so import can rewrite them for the new project;
 * `omitted` documents what a project export intentionally never carries.
 */
export const ExportManifestSchema = z.object({
  kind: z.literal('sitewright-project-export'),
  exportFormat: z.number().int(),
  bundleFormat: z.number().int(),
  app: z.string().max(200).nullable().optional(),
  exportedAt: z.string().max(64),
  source: z.object({
    id: z.string().max(128),
    name: z.string().max(200),
    slug: SlugSchema,
  }),
  /** Slug the bundle's media URLs are keyed under (usually === source.slug). */
  mediaSlug: SlugSchema,
  counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  omitted: z.array(z.string().max(64)).max(50).optional(),
});

export type ExportManifest = z.infer<typeof ExportManifestSchema>;


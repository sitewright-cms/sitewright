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
import { MediaAssetSchema, MediaFolderRecordSchema } from './media.js';
import { IdSchema, SlugSchema } from './primitives.js';
import { mergeLegacyIdentity } from './migrate-identity.js';

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
export const EXPORT_BUNDLE_CAPS = {
  pages: 2000,
  templates: 500,
  snippets: 1000,
  datasets: 500,
  entries: 50_000,
  translations: 20_000,
  forms: 500,
  media: 20_000,
  mediaFolders: 2000,
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
 * folds a pre-v2 `{brand,company}` project so older JSON exports still parse.
 */
const ExportBundleProjectSchema = z.preprocess(
  mergeLegacyIdentity,
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


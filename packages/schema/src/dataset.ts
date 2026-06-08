import { z } from 'zod';
import { IdSchema, KeyNameSchema, SlugSchema, safeRecord } from './primitives.js';

/** Supported CMS field types. */
export const FieldTypeSchema = z.enum([
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'image',
  'reference',
  'select',
  'json',
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/** A single field in a dataset's schema. */
export const FieldSchema = z.object({
  name: KeyNameSchema,
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  localized: z.boolean().default(false),
  /** Type-specific config: `select` options, `reference` target dataset, etc. */
  config: safeRecord(z.unknown()).optional(),
});
export type Field = z.infer<typeof FieldSchema>;

/** A dataset definition — the CMS schema for a collection. */
export const DatasetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  slug: SlugSchema,
  fields: z.array(FieldSchema).max(500).default([]),
});
export type Dataset = z.infer<typeof DatasetSchema>;

/** A single entry (row) in a dataset. */
export const EntrySchema = z.object({
  id: IdSchema,
  dataset: SlugSchema,
  locale: z.string().max(35).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
  /**
   * Sort order within the dataset (ascending; ties broken by id). Set by drag-reordering the
   * entries list. Absent → sorts AFTER ordered entries (treated as +Infinity), so legacy entries
   * keep a deterministic id order until first reordered. Mirrors `page.order`.
   */
  order: z.number().int().min(0).max(100_000).optional(),
  values: safeRecord(z.unknown()).default({}),
});
export type Entry = z.infer<typeof EntrySchema>;

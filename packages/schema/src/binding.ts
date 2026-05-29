import { z } from 'zod';
import { KeyNameSchema, SlugSchema, safeRecord } from './primitives.js';

/** Sort directive for a binding query (`dir` defaults to ascending when omitted). */
export const QuerySortSchema = z.object({
  field: KeyNameSchema,
  dir: z.enum(['asc', 'desc']).optional(),
});
export type QuerySort = z.infer<typeof QuerySortSchema>;

/**
 * A binding's query: equality `where` filters and an optional `sort`. Filter
 * keys are validated identifiers (rejecting prototype-pollution keys) so they
 * are safe to use as dataset-field accessors during resolution.
 */
export const QuerySchema = z.object({
  where: safeRecord(z.unknown(), KeyNameSchema).optional(),
  sort: QuerySortSchema.optional(),
});
export type Query = z.infer<typeof QuerySchema>;

/**
 * A binding connects a block to CMS dataset data. Bindings are resolved at
 * **build time**, so the published output remains static.
 */
export const BindingSchema = z.object({
  /** Slug of the dataset this block pulls from. */
  dataset: SlugSchema,
  /** Filter/sort spec interpreted by the renderer's dataset resolver. */
  query: QuerySchema.optional(),
  /** `single` binds one entry; `list` repeats the block per entry. */
  mode: z.enum(['single', 'list']).default('single'),
  /** Optional cap on the number of entries when `mode` is `list`. */
  limit: z.number().int().positive().max(10_000).optional(),
});

export type Binding = z.infer<typeof BindingSchema>;

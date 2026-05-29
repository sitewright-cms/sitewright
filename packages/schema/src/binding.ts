import { z } from 'zod';
import { SlugSchema, safeRecord } from './primitives.js';

/**
 * A binding connects a block to CMS dataset data. Bindings are resolved at
 * **build time**, so the published output remains static.
 */
export const BindingSchema = z.object({
  /** Slug of the dataset this block pulls from. */
  dataset: SlugSchema,
  /** Opaque filter/sort spec interpreted by the renderer's dataset resolver. */
  query: safeRecord(z.unknown()).optional(),
  /** `single` binds one entry; `list` repeats the block per entry. */
  mode: z.enum(['single', 'list']).default('single'),
  /** Optional cap on the number of entries when `mode` is `list`. */
  limit: z.number().int().positive().max(10_000).optional(),
});

export type Binding = z.infer<typeof BindingSchema>;

import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { IdSchema } from './primitives.js';

/**
 * A reusable block subtree. Referenced from a `PageNode.partialRef`; edits
 * propagate to every reference at build time.
 */
export const PartialSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  root: PageNodeSchema,
});

// Named `SitewrightPartial` to avoid shadowing TypeScript's built-in `Partial<T>`.
export type SitewrightPartial = z.infer<typeof PartialSchema>;

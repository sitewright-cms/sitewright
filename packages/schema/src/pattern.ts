import { z } from 'zod';
import { PageNodeSchema, type PageNode } from './block.js';
import { IdSchema } from './primitives.js';

/**
 * A reusable, pre-composed block subtree (a "Pattern"). Unlike a partial, a
 * pattern is NOT live-linked: the editor deep-clones it (with fresh ids) into a
 * page, where the author then customizes it freely. Project-scoped library.
 *
 * Like other tree-bearing content, untrusted input MUST be passed through
 * `assertWithinTreeDepth` on `root` before parsing (Zod parses recursively).
 */
export interface Pattern {
  id: string;
  name: string;
  root: PageNode;
}

export const PatternSchema: z.ZodType<Pattern, z.ZodTypeDef, unknown> = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  root: PageNodeSchema,
});

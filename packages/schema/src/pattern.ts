import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { IdSchema } from './primitives.js';

/**
 * A reusable, pre-composed block subtree (a "Pattern"). Unlike a partial, a
 * pattern is NOT live-linked: the editor deep-clones it (with fresh ids) into a
 * page, where the author then customizes it freely. Project-scoped library.
 *
 * Like other tree-bearing content, untrusted input MUST be passed through
 * `assertWithinTreeDepth` on `root` before parsing (Zod parses recursively).
 */
export const PatternSchema = z.object({
  id: IdSchema,
  // `.trim()` so a whitespace-only name can't pass `.min(1)` and persist blank.
  name: z.string().trim().min(1).max(200),
  root: PageNodeSchema,
});

export type Pattern = z.infer<typeof PatternSchema>;

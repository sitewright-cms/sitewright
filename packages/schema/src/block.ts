import { z } from 'zod';
import { BindingSchema, type Binding } from './binding.js';
import { ComponentTypeSchema, IdSchema, safeRecord } from './primitives.js';

/**
 * A node in a page's block tree. Recursive: a block may contain child blocks.
 *
 * - `type` maps to a component in the block registry (props are validated
 *   per-type by that registry, not here).
 * - `partialRef`, when set, replaces this node with a shared partial subtree at
 *   build time.
 * - `binding`, when set, pulls dataset data into this node at build time.
 * - `locked` hides the node from the end-user/client editing role.
 *
 * Untrusted input MUST be passed through `assertWithinTreeDepth` (see
 * `primitives.ts`) before parsing, since Zod parses this tree recursively.
 */
export interface PageNode {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: PageNode[];
  partialRef?: string;
  binding?: Binding;
  locked?: boolean;
}

// The explicit 3-arg annotation is required for a recursive `z.lazy` schema:
//   - Output is typed as `PageNode` for safe tree traversal by consumers.
//   - Input is `unknown` because `BindingSchema.mode` uses `.default()`, which
//     widens the binding's input type away from its output type; without this
//     the recursive assignment fails to type-check.
//   - `z.ZodTypeDef` is Zod v3's definition base — revisit on a Zod v4 upgrade.
export const PageNodeSchema: z.ZodType<PageNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: IdSchema,
    type: ComponentTypeSchema,
    props: safeRecord(z.unknown()).optional(),
    children: z.array(PageNodeSchema).optional(),
    partialRef: IdSchema.optional(),
    binding: BindingSchema.optional(),
    locked: z.boolean().optional(),
  }),
);

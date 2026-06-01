import { z } from 'zod';
import { BindingSchema, type Binding } from './binding.js';
import {
  ClassNameSchema,
  ComponentTypeSchema,
  IdSchema,
  MAX_CHILDREN,
  safeRecord,
} from './primitives.js';

/**
 * A node in a page's block tree. Recursive: a block may contain child blocks.
 *
 * - `type` maps to a component in the block registry (props are validated
 *   per-type by that registry, not here).
 * - `partialRef`, when set, replaces this node with a shared partial subtree at
 *   build time.
 * - `binding`, when set, pulls dataset data into this node at build time.
 * - `editable`, when `true`, marks this node as client-editable: the constrained
 *   client (member) editing role may change ONLY the props of editable nodes —
 *   never the tree structure or any other node (enforced server-side).
 * - `className`, when set, is a Tailwind utility-class list emitted onto the
 *   block's root element; the publish/preview pipeline compiles only the
 *   classes actually used into a minimal stylesheet.
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
  /** Marks this node as client-editable (see the doc above). */
  editable?: boolean;
  className?: string;
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
    children: z.array(PageNodeSchema).max(MAX_CHILDREN).optional(),
    partialRef: IdSchema.optional(),
    binding: BindingSchema.optional(),
    editable: z.boolean().optional(),
    className: ClassNameSchema.optional(),
  }),
);

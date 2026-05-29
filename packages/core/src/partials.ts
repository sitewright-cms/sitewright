import type { PageNode, SitewrightPartial } from '@sitewright/schema';
import { MAX_PAGE_TREE_DEPTH } from '@sitewright/schema';
import { PartialResolutionError } from './errors.js';

export interface ResolvePartialsOptions {
  /**
   * Maximum total recursion depth across tree structure **and** partial hops.
   * This is a stack-overflow guard, not a "partial nesting hops" limit; it
   * defaults to {@link MAX_PAGE_TREE_DEPTH}.
   */
  maxDepth?: number;
}

/**
 * Returns a new tree with every `partialRef` replaced by the referenced
 * partial's root subtree. Partials may reference other partials; expansion is
 * recursive.
 *
 * A `partialRef` node is treated as a **placeholder**: it is replaced wholesale
 * by the partial's subtree, and only the host node's `id` is preserved (so two
 * references to the same partial keep distinct ids). Any other fields on the
 * host node (`props`, `children`, `binding`, `locked`) are intentionally
 * ignored.
 *
 * Throws {@link PartialResolutionError} on a missing partial, a reference cycle,
 * or expansion exceeding `maxDepth`.
 */
export function resolvePartials(
  root: PageNode,
  partials: ReadonlyMap<string, SitewrightPartial>,
  options: ResolvePartialsOptions = {},
): PageNode {
  const maxDepth = options.maxDepth ?? MAX_PAGE_TREE_DEPTH;

  const resolveNode = (node: PageNode, refStack: readonly string[], depth: number): PageNode => {
    if (depth > maxDepth) {
      throw new PartialResolutionError(`partial expansion exceeded max depth of ${maxDepth}`);
    }

    if (node.partialRef !== undefined) {
      const ref = node.partialRef;
      if (refStack.includes(ref)) {
        throw new PartialResolutionError(
          `partial reference cycle: ${[...refStack, ref].join(' -> ')}`,
        );
      }
      const partial = partials.get(ref);
      if (partial === undefined) {
        throw new PartialResolutionError(`unknown partial: ${ref}`);
      }
      const expanded = resolveNode(partial.root, [...refStack, ref], depth + 1);
      // Preserve the host node id; the partialRef is consumed.
      return { ...expanded, id: node.id };
    }

    if (!node.children) return node;

    let changed = false;
    const children = node.children.map((child) => {
      const resolved = resolveNode(child, refStack, depth + 1);
      if (resolved !== child) changed = true;
      return resolved;
    });

    return changed ? { ...node, children } : node;
  };

  return resolveNode(root, [], 1);
}

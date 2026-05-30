import { assertWithinTreeDepth, type PageNode } from '@sitewright/schema';
import { NodeNotFoundError, TreeOperationError } from './errors.js';

/**
 * Block-tree operations. Every mutating function is **immutable**: it returns a
 * new tree and never modifies its input. Unchanged subtrees are shared by
 * reference, so only the path from the root to the changed node is rebuilt.
 *
 * These functions recurse over the tree. The public entry points first call
 * `assertWithinTreeDepth`, so they reject pathologically deep input (which would
 * otherwise overflow the call stack) even when invoked on data that did not pass
 * through `PageNodeSchema.parse`.
 */

/** Depth-first pre-order traversal. `ancestors` lists nodes from root down to (not including) `node`. */
export function walk(
  root: PageNode,
  visit: (node: PageNode, ancestors: readonly PageNode[]) => void,
): void {
  assertWithinTreeDepth(root);
  const recur = (node: PageNode, ancestors: PageNode[]): void => {
    visit(node, ancestors);
    if (node.children) {
      const next = [...ancestors, node];
      for (const child of node.children) recur(child, next);
    }
  };
  recur(root, []);
}

/** Finds the first node with the given id, or `undefined`. */
export function findNode(root: PageNode, id: string): PageNode | undefined {
  let found: PageNode | undefined;
  walk(root, (node) => {
    if (found === undefined && node.id === id) found = node;
  });
  return found;
}

/** Returns the ancestors of `id` (root first), or `undefined` if the id is absent. */
export function getAncestors(root: PageNode, id: string): PageNode[] | undefined {
  let result: PageNode[] | undefined;
  walk(root, (node, ancestors) => {
    if (result === undefined && node.id === id) result = [...ancestors];
  });
  return result;
}

/** All node ids in document order (may contain duplicates if the tree is malformed). */
export function collectIds(root: PageNode): string[] {
  const ids: string[] = [];
  walk(root, (node) => ids.push(node.id));
  return ids;
}

/**
 * Every author utility-class list in the tree (one entry per node that sets
 * `className`), in document order. The Tailwind pipeline scans these to compile
 * a minimal stylesheet — collecting them from the tree (rather than the rendered
 * HTML) avoids false positives from skeleton CSS or raw custom head/footer.
 */
export function collectClassNames(root: PageNode): string[] {
  const classNames: string[] = [];
  walk(root, (node) => {
    if (node.className) classNames.push(node.className);
  });
  return classNames;
}

/** Ids that appear more than once in the tree. */
export function findDuplicateIds(root: PageNode): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  walk(root, (node) => {
    if (seen.has(node.id)) duplicates.add(node.id);
    else seen.add(node.id);
  });
  return [...duplicates];
}

interface ApplyResult {
  node: PageNode;
  found: boolean;
}

function applyUpdate(
  node: PageNode,
  id: string,
  updater: (node: PageNode) => PageNode,
): ApplyResult {
  if (node.id === id) return { node: updater(node), found: true };
  if (!node.children) return { node, found: false };

  let found = false;
  const children = node.children.map((child) => {
    if (found) return child;
    const result = applyUpdate(child, id, updater);
    if (result.found) found = true;
    return result.node;
  });

  return found ? { node: { ...node, children }, found } : { node, found };
}

/** Returns a new tree with `id`'s node replaced by `updater(node)`. Throws if absent. */
export function updateNode(
  root: PageNode,
  id: string,
  updater: (node: PageNode) => PageNode,
): PageNode {
  assertWithinTreeDepth(root);
  const { node, found } = applyUpdate(root, id, updater);
  if (!found) throw new NodeNotFoundError(id);
  return node;
}

/** Returns a new tree with `id`'s node replaced by `replacement`. Throws if absent. */
export function replaceNode(root: PageNode, id: string, replacement: PageNode): PageNode {
  return updateNode(root, id, () => replacement);
}

function removeFrom(node: PageNode, id: string): ApplyResult {
  if (!node.children) return { node, found: false };

  let found = false;
  const children: PageNode[] = [];
  for (const child of node.children) {
    if (!found && child.id === id) {
      found = true;
      continue;
    }
    if (found) {
      children.push(child);
      continue;
    }
    const result = removeFrom(child, id);
    if (result.found) found = true;
    children.push(result.node);
  }

  return found ? { node: { ...node, children }, found } : { node, found };
}

/** Returns a new tree with `id`'s node removed. Throws if absent or if `id` is the root. */
export function removeNode(root: PageNode, id: string): PageNode {
  if (root.id === id) throw new TreeOperationError('cannot remove the root node');
  assertWithinTreeDepth(root);
  const { node, found } = removeFrom(root, id);
  if (!found) throw new NodeNotFoundError(id);
  return node;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Returns a new tree with `child` inserted into `parentId`'s children at
 * `index` (appended if `index` is omitted; clamped to a valid position).
 */
export function insertChild(
  root: PageNode,
  parentId: string,
  child: PageNode,
  index?: number,
): PageNode {
  return updateNode(root, parentId, (parent) => {
    const base = parent.children ?? [];
    const at = index === undefined ? base.length : clamp(index, 0, base.length);
    const children = [...base.slice(0, at), child, ...base.slice(at)];
    return { ...parent, children };
  });
}

/**
 * Moves `id` to be a child of `newParentId` at `index`. Throws if either node is
 * absent, if moving the root, or if moving a node into its own subtree.
 */
export function moveNode(
  root: PageNode,
  id: string,
  newParentId: string,
  index?: number,
): PageNode {
  if (id === newParentId) throw new TreeOperationError('cannot move a node into itself');

  const node = findNode(root, id);
  if (node === undefined) throw new NodeNotFoundError(id);
  if (findNode(node, newParentId) !== undefined) {
    throw new TreeOperationError('cannot move a node into its own subtree');
  }

  const without = removeNode(root, id);
  return insertChild(without, newParentId, node, index);
}

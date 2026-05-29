// Immutable operations on a page's block tree. Every function returns a new tree
// and never mutates its input — this keeps React state updates predictable and
// the operations trivially testable. Node identity is by `id`.
import type { Binding, PageNode } from '@sitewright/schema';

/** Depth-first search for a node by id (inclusive of the given root). */
export function findNode(root: PageNode, id: string): PageNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Returns a new tree with the node matching `id` replaced by `updater(node)`. */
export function updateNode(
  root: PageNode,
  id: string,
  updater: (node: PageNode) => PageNode,
): PageNode {
  if (root.id === id) return updater(root);
  if (!root.children) return root;
  return { ...root, children: root.children.map((child) => updateNode(child, id, updater)) };
}

/** Merges `props` into the node's existing props. */
export function setProps(root: PageNode, id: string, props: Record<string, unknown>): PageNode {
  return updateNode(root, id, (node) => ({ ...node, props: { ...(node.props ?? {}), ...props } }));
}

/** Removes the node with `id` (and its subtree). The root itself cannot be removed. */
export function removeNode(root: PageNode, id: string): PageNode {
  if (root.id === id || !root.children) return root;
  const children = root.children
    .filter((child) => child.id !== id)
    .map((child) => removeNode(child, id));
  return { ...root, children };
}

/** Inserts `child` into `parentId`'s children at `index` (clamped into range). */
export function insertChild(
  root: PageNode,
  parentId: string,
  index: number,
  child: PageNode,
): PageNode {
  return updateNode(root, parentId, (parent) => {
    const children = parent.children ?? [];
    const at = Math.max(0, Math.min(index, children.length));
    return { ...parent, children: [...children.slice(0, at), child, ...children.slice(at)] };
  });
}

/** Appends `child` to the end of `parentId`'s children. */
export function appendChild(root: PageNode, parentId: string, child: PageNode): PageNode {
  return updateNode(root, parentId, (parent) => ({
    ...parent,
    children: [...(parent.children ?? []), child],
  }));
}

interface ParentLocation {
  parent: PageNode;
  index: number;
}

/** Finds the parent of `id` and the child index within it. */
function findParent(root: PageNode, id: string): ParentLocation | undefined {
  const children = root.children ?? [];
  const directIndex = children.findIndex((child) => child.id === id);
  if (directIndex !== -1) return { parent: root, index: directIndex };
  for (const child of children) {
    const deeper = findParent(child, id);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * The binding that governs a node's field resolution: its own binding, or the
 * nearest ancestor's. A node bound by an ancestor `list`/`single` resolves its
 * `<key>Field` props against that ancestor's dataset, so the binding UI needs to
 * know which dataset is in scope even for unbound descendants.
 */
export function governingBinding(root: PageNode, id: string): Binding | undefined {
  // Single DFS carrying the ancestor chain; on reaching the target, return the
  // nearest binding from itself up to the root.
  function walk(node: PageNode, ancestors: PageNode[]): Binding | undefined {
    if (node.id === id) {
      if (node.binding) return node.binding;
      for (let i = ancestors.length - 1; i >= 0; i -= 1) {
        const binding = ancestors.at(i)?.binding;
        if (binding) return binding;
      }
      return undefined;
    }
    for (const child of node.children ?? []) {
      const found = walk(child, [...ancestors, node]);
      if (found) return found;
    }
    return undefined;
  }
  return walk(root, []);
}

/** Public parent lookup: the parent's id and the node's index within it. */
export function parentInfo(
  root: PageNode,
  id: string,
): { parentId: string; index: number } | undefined {
  const location = findParent(root, id);
  return location ? { parentId: location.parent.id, index: location.index } : undefined;
}

/** Moves a node one slot up or down among its siblings. No-op at the boundaries. */
export function moveWithinParent(root: PageNode, id: string, dir: 'up' | 'down'): PageNode {
  const location = findParent(root, id);
  if (!location) return root;
  const { parent, index } = location;
  const children = parent.children ?? [];
  const target = dir === 'up' ? index - 1 : index + 1;
  // Bounds check first: `.at(-1)` would wrap to the last element, so guard before use.
  if (target < 0 || target >= children.length) return root;
  const a = children.at(index);
  const b = children.at(target);
  if (!a || !b) return root;
  // Swap the two adjacent siblings without dynamic index assignment.
  const next = children.map((child, i) => (i === index ? b : i === target ? a : child));
  return updateNode(root, parent.id, (p) => ({ ...p, children: next }));
}

/** True when `nodeId` lies within the subtree rooted at `ancestorId` (inclusive). */
export function isDescendant(root: PageNode, ancestorId: string, nodeId: string): boolean {
  const ancestor = findNode(root, ancestorId);
  if (!ancestor) return false;
  return findNode(ancestor, nodeId) !== undefined;
}

/**
 * Reparents `id` under `newParentId` at `index` (index applies to the parent's
 * children after `id` has been detached). No-op when moving the root, into
 * itself, or into its own descendant (which would create a cycle).
 */
export function moveNode(
  root: PageNode,
  id: string,
  newParentId: string,
  index: number,
): PageNode {
  if (id === root.id || id === newParentId) return root;
  if (isDescendant(root, id, newParentId)) return root;
  const node = findNode(root, id);
  if (!node) return root;
  const detached = removeNode(root, id);
  return insertChild(detached, newParentId, index, node);
}

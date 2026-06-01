import { isDeepStrictEqual } from 'node:util';
import type { Page, PageNode } from '@sitewright/schema';
import { ForbiddenError } from './context.js';

// Server-side enforcement of the constrained client (member) editing role: a member
// may change ONLY the props of `editable: true` nodes, and nothing else. This is the
// authoritative guard — the client UI is advisory, so the rule cannot be bypassed by
// crafting a request. The two trees must be structurally identical (same ids/types/
// order/children/partialRef/binding/className/editable-flags); only editable nodes'
// props may differ; and all page-level fields (title/path/status/nav/template/seo/
// collection) must be unchanged.

/** True if `next` is a valid client edit of `prev` (structure identical; only editable nodes' props changed). */
function nodeEditAllowed(prev: PageNode, next: PageNode): boolean {
  if (prev.id !== next.id) return false;
  if (prev.type !== next.type) return false;
  if (prev.partialRef !== next.partialRef) return false;
  if (prev.className !== next.className) return false;
  // The editable flag itself is structure — a client cannot grant itself edit rights.
  if ((prev.editable ?? false) !== (next.editable ?? false)) return false;
  if (!isDeepStrictEqual(prev.binding, next.binding)) return false;
  // Non-editable nodes: props are frozen. Editable nodes: props may change freely
  // (the new props are still schema-validated + escaped at render).
  if (!prev.editable && !isDeepStrictEqual(prev.props, next.props)) return false;
  // Children: same count, same order, recursively consistent (no add/remove/reorder).
  const pc = prev.children ?? [];
  const nc = next.children ?? [];
  if (pc.length !== nc.length) return false;
  for (let i = 0; i < pc.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a bounded loop index
    if (!nodeEditAllowed(pc[i]!, nc[i]!)) return false;
  }
  return true;
}

/**
 * Throws {@link ForbiddenError} unless `next` is a permitted client edit of `prev`:
 * identical page settings + tree structure, with changes confined to the props of
 * `editable` nodes. Used to gate a member-role page write.
 */
export function assertClientEditAllowed(prev: Page, next: Page): void {
  const pageFieldsEqual =
    prev.id === next.id &&
    prev.path === next.path &&
    prev.title === next.title &&
    (prev.status ?? undefined) === (next.status ?? undefined) &&
    prev.template === next.template &&
    prev.source === next.source &&
    isDeepStrictEqual(prev.nav, next.nav) &&
    isDeepStrictEqual(prev.seo, next.seo) &&
    isDeepStrictEqual(prev.collection, next.collection);
  if (!pageFieldsEqual || !nodeEditAllowed(prev.root, next.root)) {
    throw new ForbiddenError('the client role may edit only the content of editable blocks');
  }
}

/** Whether a page exposes any client-editable node (used to decide if a member may open it). */
export function hasEditableNode(node: PageNode): boolean {
  if (node.editable) return true;
  return (node.children ?? []).some(hasEditableNode);
}

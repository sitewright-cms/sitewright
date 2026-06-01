import type { PageNode } from '@sitewright/schema';

/**
 * Depth-first collection of every node flagged `editable` (document order). This is
 * the allowlist the constrained client (member) editor surfaces: the client may edit
 * the content of these nodes and nothing else. The server independently enforces the
 * same boundary (assertClientEditAllowed) — this is purely which fields to render.
 */
export function collectEditableNodes(root: PageNode): PageNode[] {
  const out: PageNode[] = [];
  const walk = (node: PageNode): void => {
    if (node.editable) out.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

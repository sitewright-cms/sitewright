import type { PageNode } from '@sitewright/schema';
import { defaultPropsFor } from '@sitewright/blocks';

// Monotonic id generator. crypto.randomUUID is secure-context-only (undefined on
// plain-HTTP origins like the DinD preview), so we use a time+counter scheme that
// still satisfies IdSchema and never collides within a session. `seq` is an
// intentional session-lifetime counter (internal to this module).
let seq = 0;
/** A fresh, collision-free block id for this session (also used to re-id inserted patterns). */
export function genId(): string {
  seq += 1;
  return `b-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** Builds a fresh block node of `type`, seeded with its descriptor defaults. */
export function createBlock(type: string): PageNode {
  const props = defaultPropsFor(type);
  const node: PageNode = { id: genId(), type };
  if (Object.keys(props).length > 0) node.props = props;
  return node;
}

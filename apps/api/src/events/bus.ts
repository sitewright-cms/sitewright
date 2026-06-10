/** A content change within a project — the payload pushed to live-preview clients. */
export interface ContentChange {
  kind: string;
  entityId: string;
  op: 'put' | 'delete';
  /** Who made the change: `agent` (a bearer/MCP write) or `user` (an interactive session). Lets the
   *  editor flag "an agent is editing"; absent → treated as `user`. */
  actor?: 'agent' | 'user';
}

type Listener = (change: ContentChange) => void;

/**
 * In-process pub/sub of per-project content changes — the single "the project
 * changed" signal. Emitted at the content-write chokepoint ({@link
 * ContentRepository}) so a write from ANY channel (editor, CLI, MCP, webchat)
 * reaches the SSE endpoint that drives live-preview auto-reload.
 *
 * Single-container only: a multi-instance deployment would need a shared bus
 * (Postgres LISTEN/NOTIFY or Redis). That boundary is intentional for v1.
 */
export class ProjectEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Subscribes to a project's changes; returns an unsubscribe function. */
  subscribe(projectId: string, listener: Listener): () => void {
    let set = this.listeners.get(projectId);
    if (!set) {
      set = new Set();
      this.listeners.set(projectId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(projectId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(projectId);
    };
  }

  /** Notifies a project's subscribers. A throwing subscriber never breaks the writer. */
  emit(projectId: string, change: ContentChange): void {
    const set = this.listeners.get(projectId);
    if (!set) return;
    // Iterate a copy so a listener that unsubscribes mid-emit can't corrupt the loop.
    for (const listener of [...set]) {
      try {
        listener(change);
      } catch {
        /* a broken subscriber must not affect the write or other subscribers */
      }
    }
  }

  /** Active subscriber count for a project (tests / metrics). */
  subscriberCount(projectId: string): number {
    return this.listeners.get(projectId)?.size ?? 0;
  }
}

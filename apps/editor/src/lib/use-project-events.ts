import { useEffect, useRef } from 'react';
import { eventsUrl } from '../api';

/** One content-change event from the project change-stream (`GET /projects/:id/events`). */
export interface ContentChange {
  kind: string;
  entityId: string;
  op: 'put' | 'delete';
  /** Who made the change; absent is treated as a user edit. */
  actor?: 'user' | 'agent';
}

type Listener = (change: ContentChange) => void;

interface Channel {
  source: EventSource;
  listeners: Set<Listener>;
}

// ONE shared EventSource per projectId across the whole SPA, ref-counted. The server caps subscribers
// per project (and a browser caps connections per origin), so views must not each open their own.
const channels = new Map<string, Channel>();

function subscribe(projectId: string, listener: Listener): () => void {
  // No EventSource (SSR / unsupported) → degrade to a no-op; live-refresh is an enhancement.
  if (typeof EventSource === 'undefined') return () => {};
  let channel = channels.get(projectId);
  if (!channel) {
    let source: EventSource;
    try {
      source = new EventSource(eventsUrl(projectId), { withCredentials: true });
    } catch {
      return () => {}; // construction blocked (CSP / bad URL) → no live-refresh, the view still works
    }
    const created: Channel = { source, listeners: new Set() };
    source.addEventListener('content', (e) => {
      let change: ContentChange | null = null;
      try {
        change = JSON.parse((e as MessageEvent).data) as ContentChange;
      } catch {
        return; // non-JSON payload — ignore
      }
      // Snapshot the set so a listener that unsubscribes during dispatch can't mutate mid-iteration.
      for (const l of [...created.listeners]) l(change);
    });
    channels.set(projectId, created);
    channel = created;
  }
  channel.listeners.add(listener);
  return () => {
    const c = channels.get(projectId);
    if (!c) return;
    c.listeners.delete(listener);
    if (c.listeners.size === 0) {
      c.source.close();
      channels.delete(projectId);
    }
  };
}

/**
 * Subscribe to a project's content-change stream and run `onChange` for each event — the editor's data
 * views use this to LIVE-REFRESH when the agent (or any actor / another tab) edits content, so a list
 * no longer goes stale until a full SPA reload. One shared, ref-counted EventSource per project; the
 * latest `onChange` is always used (no re-subscribe on every render).
 */
export function useProjectEvents(projectId: string, onChange: Listener): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => subscribe(projectId, (change) => cb.current(change)), [projectId]);
}

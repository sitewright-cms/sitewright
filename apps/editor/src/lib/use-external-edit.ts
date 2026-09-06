import { useCallback, useRef, useState } from 'react';
import { isCurrentContentVersion } from '../api';
import { useProjectEvents, type ContentChange } from './use-project-events';

/**
 * "Someone else changed what I have open" — the shared reaction to the project change-stream.
 *
 * ★ WHY THIS EXISTS. Editor saves are FULL REPLACES, so an operator holding a buffer loaded before an
 * agent ran would overwrite the agent's work on their next save. `If-Match` (see api.ts) now makes the
 * server REFUSE that write, which stops the data loss — but a 409 at save time is a poor place to
 * learn about it, after the operator has already typed. This hook moves the news forward: the view
 * finds out the moment the change lands.
 *
 * The clean/dirty split is the whole point:
 *  - buffer CLEAN → refresh silently; there is nothing of the operator's to lose.
 *  - buffer DIRTY → NEVER auto-replace. Auto-refreshing unsaved edits just changes whose work is
 *    discarded. Surface `pending` and let the operator choose (see ExternalChangeBanner).
 *
 * `isDirty` and `onRefresh` are read through refs, so a view can pass inline closures over current
 * state without re-subscribing on every render.
 */
export function useExternalEdit(opts: {
  projectId: string;
  /** True when this change concerns what the view has open. */
  match: (change: ContentChange) => boolean;
  /** True when the operator has unsaved edits. */
  isDirty: () => boolean;
  /** Re-read from the server. Called directly when clean, or via `reload()` from the banner. */
  onRefresh: () => void;
}): {
  /** The change the operator still has to decide about; null when there is nothing pending. */
  pending: ContentChange | null;
  /** Take the incoming change: re-read and drop the notice. */
  reload: () => void;
  /** Keep the local buffer. The `If-Match` guard still refuses a clobbering save. */
  dismiss: () => void;
} {
  const [pending, setPending] = useState<ContentChange | null>(null);
  const matchRef = useRef(opts.match);
  const dirtyRef = useRef(opts.isDirty);
  const refreshRef = useRef(opts.onRefresh);
  matchRef.current = opts.match;
  dirtyRef.current = opts.isDirty;
  refreshRef.current = opts.onRefresh;

  useProjectEvents(opts.projectId, (change) => {
    if (!matchRef.current(change)) return;
    // The echo of OUR OWN save carries the version we already hold — ignore it, or every save would
    // re-fetch what it just wrote (and, when the operator saves from a dirty buffer, immediately raise
    // a "someone changed this" banner about themselves).
    if (isCurrentContentVersion(opts.projectId, change.kind, change.entityId, change.version, change.scope ?? '')) return;
    if (dirtyRef.current()) setPending(change);
    else refreshRef.current();
  });

  const reload = useCallback(() => {
    setPending(null);
    refreshRef.current();
  }, []);
  const dismiss = useCallback(() => setPending(null), []);
  return { pending, reload, dismiss };
}

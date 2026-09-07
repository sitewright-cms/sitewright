import { useCallback, useRef, useState } from 'react';
import { isOwnContentChange } from '../api';
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
  /**
   * The version THIS view's buffer was built from. Supply it whenever the view holds a form, and the
   * check becomes "does this event describe a state I already have?" — which is the only question that
   * has a correct answer per-view.
   *
   * ★ Without it the hook falls back to the tab-wide store, and that store is re-pointed by ANY write
   * from ANY surface. That is how a criticalCss revert got through: the Critical CSS shortcut wrote,
   * the shared store advanced to the new version, and Settings — still holding the previous state —
   * matched it, concluded "that was us", and never refreshed. It then saved its stale form over the
   * change. A view with its own base cannot be fooled that way.
   */
  baseVersion?: () => string | undefined;
  /**
   * True while THIS view's own save is in flight. Needed because the server emits the change event
   * while handling the write, so the echo routinely arrives before the response updates `baseVersion`
   * — without this the view would raise a banner about its own save.
   */
  isSaving?: () => boolean;
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
  const baseRef = useRef(opts.baseVersion);
  const savingRef = useRef(opts.isSaving);
  matchRef.current = opts.match;
  dirtyRef.current = opts.isDirty;
  refreshRef.current = opts.onRefresh;
  baseRef.current = opts.baseVersion;
  savingRef.current = opts.isSaving;

  useProjectEvents(opts.projectId, (change) => {
    if (!matchRef.current(change)) return;
    const ownBase = baseRef.current;
    if (ownBase) {
      // This view tracks its own base, so answer the question locally and IGNORE the shared store.
      if (savingRef.current?.()) return; // our own write, whose echo may beat its response
      if (change.version !== undefined && change.version === ownBase()) return; // already at that state
    } else if (isOwnContentChange(opts.projectId, change.kind, change.entityId, change.version, change.scope ?? '')) {
      // No buffer of its own — fall back to the tab-wide store (see the caveat on this option).
      return;
    }
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

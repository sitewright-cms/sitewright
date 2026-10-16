import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';

/** How long typing in a `website.data` region coalesces before it is saved. */
export const WEBSITE_DATA_DEBOUNCE_MS = 600;

/** A queued write: the value, and whether the preview must re-render once it has landed. */
type Pending = { value: string; rerender: boolean };
/** A write that has left the queue: its value, and the landed-sequence number once it has landed. */
type Sent = { value: string; landed?: number };

export interface WebsiteDataQueue {
  /**
   * Queue a write on the debounced flush — TYPING, which coalesces per leaf. `rerender`: re-render the
   * preview once it has landed (the page editor does, for any site-wide edit; a slot's contenteditable
   * already shows its own typing, so the slot editor does not).
   */
  queue: (path: string, value: string, opts?: { rerender?: boolean }) => void;
  /**
   * Save these writes NOW — a single deliberate action (a picked image, a popover, an HTML-source
   * save), not keystrokes — and re-render the preview once the queue has drained. Pending typing is
   * flushed along with them, so the re-render shows it too.
   */
  commit: (cells: ReadonlyArray<readonly [path: string, value: string]>) => void;
  /** The newest value this editor holds for a leaf — still queued, else sent and not yet on screen. */
  latest: (path: string) => string | undefined;
  /** A marker for "every write that has landed so far". Take it when a preview render STARTS. */
  landedMark: () => number;
  /** The render started at `mark` is on screen: forget the sent values it reflects (see `latest`). */
  rendered: (mark: number) => void;
}

/**
 * The ONE write path for the site-wide `website.data` store, shared by the page and chrome-slot editors.
 *
 * The preview renders the SAVED store — there is no draft for website.data to ride in, and /preview
 * takes no override for it — so the order of writes and the timing of the re-render ARE the feature:
 *
 *  · Writes go through one chain, in the order they were made. A flush that starts while another is
 *    in flight waits for it, so two writes to one leaf can never land out of order (the older winning).
 *  · The re-render waits until the queue has DRAINED, and happens once: re-rendering on a timer raced
 *    the save and showed the OLD value; re-rendering per flush reloaded twice for one gesture.
 *  · A value that has left the queue is remembered until a render that reflects it is on screen, so the
 *    `</>` view reopened in between seeds from what was saved rather than the stale rendered HTML. It
 *    is then forgotten, so a later change made elsewhere is not masked by our own old write.
 *
 * Unmounting still writes whatever is queued (behind the chain), without callbacks — otherwise the last
 * keystrokes of an edit are lost precisely when the author thinks they are done.
 */
export function useWebsiteDataQueue({
  projectId,
  onError,
  onDrained,
}: {
  projectId: string;
  /** A write failed; the message to show (these auto-save, so nothing else would tell the author). */
  onError: (message: string) => void;
  /** The queue has drained after a write that asked for a re-render landed: re-render the preview. */
  onDrained: () => void;
}): WebsiteDataQueue {
  const pending = useRef(new Map<string, Pending>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  /** Flushes scheduled on the chain and not yet finished. The queue has drained when it reaches 0. */
  const runs = useRef(0);
  /** A write that asked for a re-render has landed since the queue last drained. */
  const rerenderOnDrain = useRef(false);
  const sent = useRef(new Map<string, Sent>());
  const landedSeq = useRef(0);
  const mounted = useRef(true);
  const callbacks = useRef({ onError, onDrained });
  callbacks.current = { onError, onDrained };

  /** Write one batch of cells behind everything already on the chain. */
  const write = useCallback(
    (cells: Array<[string, Pending]>, notify: boolean) => {
      for (const [path, c] of cells) sent.current.set(path, { value: c.value });
      runs.current += 1;
      chain.current = chain.current.then(async () => {
        for (const [path, c] of cells) {
          try {
            await api.setWebsiteData(projectId, path, c.value);
            // Only if nothing newer was sent for this leaf meanwhile — that one still stands.
            if (sent.current.get(path)?.value === c.value) sent.current.set(path, { value: c.value, landed: ++landedSeq.current });
            if (c.rerender) rerenderOnDrain.current = true;
          } catch (err) {
            if (sent.current.get(path)?.value === c.value) sent.current.delete(path);
            if (notify && mounted.current) {
              callbacks.current.onError(err instanceof Error ? `Website data not saved: ${err.message}` : 'Website data not saved');
            }
          }
        }
        runs.current -= 1;
        if (runs.current === 0 && rerenderOnDrain.current) {
          rerenderOnDrain.current = false;
          if (notify && mounted.current) callbacks.current.onDrained();
        }
      });
    },
    [projectId],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const cells = [...pending.current.entries()];
    pending.current.clear();
    if (cells.length > 0) write(cells, true);
  }, [write]);

  const enqueue = (path: string, value: string, rerender: boolean) => {
    // Coalesce per leaf; a re-render asked for by any write to it survives a later one that did not.
    pending.current.set(path, { value, rerender: rerender || (pending.current.get(path)?.rerender ?? false) });
  };

  const queue = useCallback(
    (path: string, value: string, opts?: { rerender?: boolean }) => {
      enqueue(path, value, opts?.rerender ?? false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, WEBSITE_DATA_DEBOUNCE_MS);
    },
    [flush],
  );

  const commit = useCallback(
    (cells: ReadonlyArray<readonly [path: string, value: string]>) => {
      for (const [path, value] of cells) enqueue(path, value, true);
      flush();
    },
    [flush],
  );

  const latest = useCallback((path: string) => pending.current.get(path)?.value ?? sent.current.get(path)?.value, []);
  const landedMark = useCallback(() => landedSeq.current, []);
  const rendered = useCallback((mark: number) => {
    for (const [path, s] of [...sent.current]) if (s.landed !== undefined && s.landed <= mark) sent.current.delete(path);
  }, []);

  // Closing inside the debounce window must not lose the last edit: write it, behind the chain, quietly.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      const cells = [...pending.current.entries()];
      pending.current.clear();
      write(cells, false);
    };
  }, [write]);

  return useMemo(() => ({ queue, commit, latest, landedMark, rendered }), [queue, commit, latest, landedMark, rendered]);
}

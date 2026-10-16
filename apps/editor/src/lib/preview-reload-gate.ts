import { useCallback, useEffect, useMemo, useRef } from 'react';

/** How long the author must have stopped typing in the preview before it may be reloaded under them. */
export const INLINE_EDIT_QUIET_MS = 2000;
/** How often a quiet-but-busy gate looks again for its stores to have finished saving. */
const IDLE_RECHECK_MS = 150;
/** The ticket of a render that started while typing was still unsaved — `admit` never takes it. */
const UNSAVED = -1;

export interface PreviewReloadGate {
  /** The author just typed into the preview (an inline edit reached the editor). */
  noteEdit: () => void;
  /** Ask for a re-render. It runs once typing has paused and every store is idle — never dropped. */
  request: () => void;
  /** A render is starting: the ticket `admit` checks it against. */
  begin: () => number;
  /**
   * The render that started at `ticket` is about to replace the live document. False when it cannot show
   * every keystroke the live document does — typing was still unsaved when it started, or the author has
   * typed since — and swapping it in would wipe them off the screen. A fresh render is requested instead.
   */
  admit: (ticket: number) => boolean;
  /** A document is up. Typing that reached the old one after the last render was admitted asks for another. */
  loaded: () => void;
}

/**
 * When the editor may reload a preview the author types into.
 *
 * The preview is not a read-only view: in content mode its contenteditables ARE the input, and what was
 * typed lives in that document until a save carries it to the server. A reload renders the server's
 * copy, so a reload that lands before the save throws the keystrokes off the screen — and the next edit
 * to that text is read back from the screen, so the save that follows overwrites them for good.
 *
 * So a reload waits until typing has paused AND every store the editor writes to is idle, a render the
 * author typed through is discarded rather than swapped in, and a document that loaded while they were
 * still typing into the old one is re-rendered. A requested reload is deferred, never dropped.
 */
export function usePreviewReloadGate({
  isIdle,
  onReload,
  quietMs = INLINE_EDIT_QUIET_MS,
}: {
  /** Nothing typed is still waiting to be saved, or on its way. */
  isIdle: () => boolean;
  /** Re-render the preview now. */
  onReload: () => void;
  quietMs?: number;
}): PreviewReloadGate {
  const lastEditAt = useRef(Number.NEGATIVE_INFINITY);
  const editSeq = useRef(0);
  const admittedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ isIdle, onReload });
  callbacks.current = { isIdle, onReload };

  const settle = useCallback(() => {
    timer.current = null;
    const wait = quietMs - (Date.now() - lastEditAt.current);
    if (wait > 0) {
      timer.current = setTimeout(settle, wait);
      return;
    }
    if (!callbacks.current.isIdle()) {
      timer.current = setTimeout(settle, IDLE_RECHECK_MS);
      return;
    }
    callbacks.current.onReload();
  }, [quietMs]);

  // An armed gate re-reads the clock and the stores when it fires, so a second request has nothing to add.
  const request = useCallback(() => {
    if (timer.current === null) settle();
  }, [settle]);

  const noteEdit = useCallback(() => {
    editSeq.current += 1;
    lastEditAt.current = Date.now();
  }, []);

  // A render shows the SAVED stores, so it reflects the typing only if all of it had landed when it began —
  // whatever started it (this gate, a draft edit, a mode switch).
  const begin = useCallback(() => (callbacks.current.isIdle() ? editSeq.current : UNSAVED), []);

  const admit = useCallback(
    (ticket: number) => {
      if (ticket === UNSAVED || editSeq.current !== ticket) {
        request();
        return false;
      }
      admittedAt.current = ticket;
      return true;
    },
    [request],
  );

  // Kept, not consumed: `ready` cannot say WHICH document sent it, so each one is checked against the last
  // render admitted. A document whose load a newer one superseded never sends one at all.
  const loaded = useCallback(() => {
    const at = admittedAt.current;
    if (at !== null && at !== editSeq.current) request();
  }, [request]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return useMemo(() => ({ noteEdit, request, begin, admit, loaded }), [noteEdit, request, begin, admit, loaded]);
}

import { useCallback, useState } from 'react';

/**
 * Which drill-in a settings board has open — and WHICH OPENING of it.
 *
 * ★ A sheet outlives its own close. `Modal` plays an exit animation and only then calls `onClose`, so
 * for the length of that animation the board still holds "this sheet is open". With a bare
 * `useState<Key | null>` that made a second click on the same tile a no-op: the state was already that
 * key, nothing re-rendered, and the sheet then finished closing with nothing open. Worse, a click
 * landing in the last instant — the dialog gone, the close not yet applied — was batched WITH that
 * close and won, leaving the old sheet mounted but invisible for good, the page's scroll lock still on.
 *
 * So every `setSheet` is a new opening, counted. `openKey` goes on the sheet as its React `key`, which
 * makes an opening a new INSTANCE: clicking a tile always produces a fresh, visible sheet, whatever the
 * previous one was in the middle of. And `close` closes only the opening it was handed to, so a sheet
 * finishing its exit late cannot close the one that replaced it.
 */
export function useSheet<K extends string>(): {
  /** The open drill-in, or null. */
  sheet: K | null;
  /** Put this on the sheet as `key`: it changes on every opening, including of the same drill-in. */
  openKey: number;
  setSheet: (sheet: K) => void;
  /** Closes the opening this render showed — a no-op once a later opening has replaced it. */
  close: () => void;
} {
  // The count lives in the SAME state as the key and never resets, so a close and an open that React
  // batches together still land on a new number.
  const [state, setState] = useState<{ sheet: K | null; opening: number }>({ sheet: null, opening: 0 });
  const { opening } = state;
  const setSheet = useCallback((sheet: K) => setState((cur) => ({ sheet, opening: cur.opening + 1 })), []);
  const close = useCallback(() => setState((cur) => (cur.opening === opening ? { ...cur, sheet: null } : cur)), [opening]);
  return { sheet: state.sheet, openKey: opening, setSheet, close };
}

// A module-level registry for "the code editor that is currently open".
//
// The System Library is mounted at App level (it stays reachable with no project open), while the
// code page editor lives in a different branch of the tree entirely. Neither is an ancestor of the
// other, so a class the Library wants to insert at the caret cannot travel by props or context.
// The same problem the overlay stack solves the same way (see views/ui/overlay.ts): one module-level
// value, plus a subscription so React components can render against it.
//
// Exactly one sink is active at a time — the code editor registers on mount and clears on unmount.
// A second registration REPLACES the first rather than stacking: there is only ever one page editor,
// and a stack would risk holding a stale unmounted view as the fallback.

type Sink = (text: string) => void;

let sink: Sink | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Make `insert` the active insertion target. Returns the unregister function — call it on unmount.
 *
 * Unregistering only clears the sink if it is still THIS one. Without that guard, a remount whose
 * effects run in the order (new register → old cleanup) would leave the sink null while a live
 * editor is on screen, and the Insert button would go permanently dead.
 */
export function registerCodeInsertSink(insert: Sink): () => void {
  sink = insert;
  notify();
  return () => {
    if (sink === insert) {
      sink = null;
      notify();
    }
  };
}

/** Insert `text` at the open code editor's caret. Returns false when no editor is open. */
export function insertIntoCode(text: string): boolean {
  if (!sink) return false;
  sink(text);
  return true;
}

/** Subscribe/snapshot pair for `useSyncExternalStore`. */
export function subscribeCodeInsertSink(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Whether a code editor is currently open and accepting insertions. */
export function hasCodeInsertSink(): boolean {
  return sink !== null;
}

/** Test seam: drop any registered sink + listeners so suites do not leak state into each other. */
export function resetCodeInsertSink(): void {
  sink = null;
  listeners.clear();
}

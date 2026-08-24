import { useEffect } from 'react';

/**
 * One registry of surfaces holding unsaved edits, and one `beforeunload` guard over all of them.
 *
 * Every editor here already tracks `dirty` and already refuses to CLOSE on it — the source modal, the
 * slot editor, the entry editor, the page editor all confirm before discarding. What none of them
 * guarded was LEAVING: a reload, a tab close, a back-navigation took the work with it silently. The
 * Studio was the sole exception, having grown its own `beforeunload` listener, which is the shape of a
 * convention that never got generalised.
 *
 * So the rule is now uniform and lives in one place: a surface says it is dirty, and every exit from the
 * page is guarded — including `window.location.reload()`, which is what the update banner and the
 * library's chunk-load recovery both call. Those two buttons need no confirm of their own; wiring one
 * into each would double-prompt against the browser's own dialog and still miss the tab-close path.
 *
 * The label is not shown by the browser (it prints its own generic wording) but names the surface for
 * {@link unsavedLabels}, so an in-app caller can say WHICH work is at stake.
 */

/** Dirty surfaces, keyed by an identity token so two instances of one editor can't clobber each other. */
const dirtySurfaces = new Map<symbol, string>();

/** Registered only while something is dirty — an always-on handler would prompt on every navigation. */
let guarding = false;

// Preventing the default is the whole contract; the browser supplies the wording.
const onBeforeUnload = (e: BeforeUnloadEvent): void => e.preventDefault();

function syncGuard(): void {
  const wanted = dirtySurfaces.size > 0;
  if (wanted === guarding) return;
  if (wanted) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
  guarding = wanted;
}

/** Mark a surface dirty until the returned function is called. Prefer {@link useUnsavedWork} in a view. */
export function registerUnsavedWork(label: string): () => void {
  const token = Symbol(label);
  dirtySurfaces.set(token, label);
  syncGuard();
  return () => {
    dirtySurfaces.delete(token);
    syncGuard();
  };
}

/** Is anything holding unsaved edits right now? */
export function hasUnsavedWork(): boolean {
  return dirtySurfaces.size > 0;
}

/** The names of the surfaces holding unsaved edits, deduped, for a message that says what is at stake. */
export function unsavedLabels(): string[] {
  return [...new Set(dirtySurfaces.values())];
}

/**
 * Guard the page while `dirty`. Registers on the way in and releases on unmount, so a modal that closes
 * — or a component that saves — stops guarding without having to remember to.
 */
export function useUnsavedWork(dirty: boolean, label: string): void {
  useEffect(() => {
    if (!dirty) return;
    return registerUnsavedWork(label);
  }, [dirty, label]);
}

/** Test seam: drop every registration (a leaked guard would prompt in unrelated tests). */
export function __resetUnsavedWork(): void {
  dirtySurfaces.clear();
  syncGuard();
}

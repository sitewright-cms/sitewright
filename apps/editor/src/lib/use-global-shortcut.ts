// App-wide keyboard shortcuts.
//
// The editor's existing key handling is all LOCAL — a modal closing on Escape, CodeMirror's own
// undo binding. These are the shortcuts that have to work from anywhere in the app, so they share a
// hook rather than each growing a bespoke listener.
//
// Two rules it enforces that a hand-rolled listener usually forgets — both now scoped to the case
// they were written for, because applied bluntly they silently disabled the shortcuts they guard:
//
//   · NEVER STEAL A KEY THE USER IS TYPING. Only a shortcut with no modifier can do that, so the
//     typing guard applies to those alone. A modified chord (Ctrl+Alt+T) produces no character, and
//     suppressing it inside an <input> or CodeMirror just meant "the reference doesn't open while the
//     cursor is in the code editor" — exactly where an author reaches for a reference.
//
//   · NEVER ACT BEHIND A MODAL. The danger is a shortcut that mutates or navigates the page the user
//     can no longer see. A shortcut that OPENS AN OVERLAY OF ITS OWN is the opposite: it stacks on
//     top, Escape unwinds it first, and the page underneath is untouched. Those opt in with
//     `overOverlays`, and everything else keeps the blanket suppression.
import { useEffect } from 'react';
import { OVERLAY_STACK } from '../views/ui/overlay';

/** A shortcut definition — modifiers plus the key, matched case-insensitively. */
export interface Shortcut {
  key: string;
  /** Ctrl on Windows/Linux, ⌘ on macOS. */
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** True while focus is somewhere the user is composing text and a bare-key shortcut must not steal it. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** A chord with Ctrl/⌘, Alt or Shift can't be produced by typing, so it never competes with text. */
function hasModifier(s: Shortcut): boolean {
  return !!(s.mod || s.alt || s.shift);
}

/** Options for {@link useGlobalShortcut}. */
export interface ShortcutOptions {
  /**
   * `false` unregisters entirely rather than no-oping inside the handler, so a disabled shortcut
   * cannot swallow the key from anything else that wants it. Default `true`.
   */
  enabled?: boolean;
  /**
   * Fire even while a modal/drawer is open. ONLY for a shortcut whose action is to open an overlay
   * that stacks ABOVE the current one — never for one that changes the page behind it.
   */
  overOverlays?: boolean;
}

function matches(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if (!!s.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (!!s.alt !== e.altKey) return false;
  if (!!s.shift !== e.shiftKey) return false;
  return true;
}

/** Fire `onFire` when any of `shortcuts` is pressed. See the header for the two guards. */
export function useGlobalShortcut(shortcuts: Shortcut[], onFire: () => void, opts: ShortcutOptions = {}): void {
  const { enabled = true, overOverlays = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!overOverlays && OVERLAY_STACK.length > 0) return;
      // Matched FIRST so the typing guard can be applied per-shortcut: a bare key is suppressed while
      // composing text, a modified chord is not.
      const hit = shortcuts.find((s) => matches(e, s));
      if (!hit) return;
      if (!hasModifier(hit) && isTypingTarget(e.target)) return;
      e.preventDefault();
      onFire();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `shortcuts` is a literal array at every call site; depending on its JSON keeps the effect from
    // re-subscribing on every render without asking callers to memoise it.
  }, [JSON.stringify(shortcuts), onFire, enabled, overOverlays]);
}

/** Render a shortcut the way the current platform writes it (⌥⌘T vs Ctrl+Alt+T). */
export function shortcutLabel(s: Shortcut): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
  const parts: string[] = [];
  if (s.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (s.alt) parts.push(mac ? '⌥' : 'Alt');
  if (s.shift) parts.push(mac ? '⇧' : 'Shift');
  parts.push(s.key.toUpperCase());
  return parts.join(mac ? '' : '+');
}

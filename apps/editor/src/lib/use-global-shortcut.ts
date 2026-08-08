// App-wide keyboard shortcuts.
//
// The editor's existing key handling is all LOCAL — a modal closing on Escape, CodeMirror's own
// undo binding. This is the first shortcut that has to work from anywhere in the app, so it gets a
// shared hook rather than another bespoke listener.
//
// Two rules it enforces that a hand-rolled listener usually forgets:
//   · never fire while the user is typing (an input, textarea, contentEditable, or CodeMirror), and
//   · never fire while an overlay is open, so a shortcut cannot act behind a modal the user is in.
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

/** True while focus is somewhere the user is composing text and a shortcut must not steal the key. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function matches(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if (!!s.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (!!s.alt !== e.altKey) return false;
  if (!!s.shift !== e.shiftKey) return false;
  return true;
}

/**
 * Fire `onFire` when any of `shortcuts` is pressed.
 *
 * `enabled: false` unregisters entirely rather than no-oping inside the handler, so a disabled
 * shortcut cannot swallow the key from anything else that wants it.
 */
export function useGlobalShortcut(shortcuts: Shortcut[], onFire: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (OVERLAY_STACK.length > 0) return;
      if (!shortcuts.some((s) => matches(e, s))) return;
      e.preventDefault();
      onFire();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `shortcuts` is a literal array at every call site; depending on its JSON keeps the effect from
    // re-subscribing on every render without asking callers to memoise it.
  }, [JSON.stringify(shortcuts), onFire, enabled]);
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

// Color-mode runtime for the editor chrome: light / dark / auto, persisted per-browser and applied by
// stamping `data-theme` (+ `color-scheme`) on <html>. The `dark:` Tailwind variant is rebound in
// styles.css to key off `[data-theme='dark']` (NOT the OS media query), so this attribute is the single
// switch that drives the whole editor's theme.
//
// FOUC: the initial attribute is set by a tiny inline script in index.html (runs before first paint);
// `initColorMode()` (called from main.tsx) re-affirms it and — crucially — wires the OS-change listener
// for `auto`. Keep the two in sync (both default to `auto` and resolve the same way).

import { useCallback, useSyncExternalStore } from 'react';

export type ColorMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key (shares the app-wide `sw:` prefix — see PublishBar.tsx). */
const STORAGE_KEY = 'sw:colorMode';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isColorMode(v: unknown): v is ColorMode {
  return v === 'light' || v === 'dark' || v === 'auto';
}

/** The persisted preference; defaults to `auto`. Guarded — storage may be unavailable (private mode). */
export function getColorMode(): ColorMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isColorMode(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

/** Resolve a mode to the concrete theme actually applied (`auto` → the OS preference). */
export function resolveTheme(mode: ColorMode): ResolvedTheme {
  if (mode !== 'auto') return mode;
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Stamp the resolved theme onto <html> (`data-theme` + native `color-scheme`). */
export function applyTheme(theme: ResolvedTheme): void {
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.style.colorScheme = theme;
}

// --- reactive store -------------------------------------------------------
// A tiny external store so `useColorMode()` re-renders on change. The snapshot is the persisted MODE
// (a stable primitive), so React's Object.is comparison behaves.
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// --- auto (OS) tracking ---------------------------------------------------
let mql: MediaQueryList | null = null;
let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

/** (Re)wire the OS-preference listener — active only while the mode is `auto`. */
function syncAutoListener(mode: ColorMode): void {
  if (mql && mqlHandler) {
    mql.removeEventListener('change', mqlHandler);
    mqlHandler = null;
  }
  if (mode !== 'auto') return;
  try {
    mql = window.matchMedia(DARK_QUERY);
    mqlHandler = (e) => {
      applyTheme(e.matches ? 'dark' : 'light');
      emit(); // re-render consumers (e.g. an "Auto (dark)" hint) on an OS flip
    };
    mql.addEventListener('change', mqlHandler);
  } catch {
    /* matchMedia unavailable */
  }
}

/** Persist + apply a mode, and (re)wire the `auto` OS listener. */
export function setColorMode(mode: ColorMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — the applied theme still holds for this session */
  }
  applyTheme(resolveTheme(mode));
  syncAutoListener(mode);
  emit();
}

/** Cross-tab sync: the `storage` event fires only in OTHER documents, so when another editor tab changes
 *  the persisted mode we re-apply it here (and re-wire the `auto` listener + notify consumers). A `null`
 *  key means `localStorage.clear()`. */
function onStorage(e: StorageEvent): void {
  if (e.key !== STORAGE_KEY && e.key !== null) return;
  const mode = getColorMode();
  applyTheme(resolveTheme(mode));
  syncAutoListener(mode);
  emit();
}

/**
 * Startup: apply the stored mode and wire the `auto` + cross-tab listeners. The inline FOUC script in
 * index.html has already stamped `data-theme` before paint; this re-affirms it (idempotent) and attaches
 * the runtime listeners the static script can't. Call once from main.tsx before rendering.
 */
export function initColorMode(): void {
  const mode = getColorMode();
  applyTheme(resolveTheme(mode));
  syncAutoListener(mode);
  try {
    window.addEventListener('storage', onStorage);
  } catch {
    /* no window (SSR/tests) — cross-tab sync simply doesn't apply */
  }
}

/** React hook for the Appearance switcher: the current mode + the concrete theme + a setter. */
export function useColorMode(): { mode: ColorMode; resolved: ResolvedTheme; setMode: (m: ColorMode) => void } {
  const mode = useSyncExternalStore(subscribe, getColorMode, (): ColorMode => 'auto');
  const setMode = useCallback((m: ColorMode) => setColorMode(m), []);
  return { mode, resolved: resolveTheme(mode), setMode };
}

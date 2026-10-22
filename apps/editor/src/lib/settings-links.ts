import type { SystemSettingsTab } from '../views/InstanceSettings';

/**
 * DEEP LINKS into the two settings surfaces, for a view that tells someone where to set a feature up:
 *
 *   - SYSTEM SETTINGS (instance admins, a modal from the header gear): a tab, and optionally a section on it to scroll
 *     to. App opens it through an {@link OpenSystemSettings} callback, handed only to instance admins — so a view can
 *     tell from the callback alone whether to offer the button.
 *   - a WEBSITE SETTINGS tile (the project's settings board): the project view switches to the tab, then
 *     {@link revealSettingsTile} brings the tile into view once the board has drawn it.
 */

/** A section of System Settings a link can bring into view. */
export type SystemSettingsSection = 'rank-tracking' | 'search-engine-accounts';

export interface SystemSettingsTarget {
  tab: SystemSettingsTab;
  section?: SystemSettingsSection;
}

export type OpenSystemSettings = (target: SystemSettingsTarget) => void;

/** The DOM id each System Settings section carries (InstanceSettings), so a link can scroll to it. */
export const SYSTEM_SETTINGS_SECTION_ID: Readonly<Record<SystemSettingsSection, string>> = {
  'rank-tracking': 'system-settings-rank-tracking',
  'search-engine-accounts': 'system-settings-search-engine-accounts',
};

/** A Website Settings tile a link can bring into view. */
export type WebsiteSettingsTile = 'analytics' | 'search-engines';

/** Switches to Website Settings and, given a tile, brings it into view. */
export type OpenWebsiteSettings = (tile?: WebsiteSettingsTile) => void;

/** Each tile's title: an inline board tile is the group named "<title> tile" (board/Tile.tsx). */
const TILE_TITLE: Readonly<Record<WebsiteSettingsTile, string>> = {
  analytics: 'Analytics',
  'search-engines': 'Search engines',
};

// eslint-disable-next-line security/detect-object-injection -- tile is a WebsiteSettingsTile literal
export const settingsTileSelector = (tile: WebsiteSettingsTile): string => `[role="group"][aria-label="${TILE_TITLE[tile]} tile"]`;

/** How long a revealed section stays outlined. */
const FLASH_MS = 2000;
/** How long {@link revealSettingsTile} waits for the board (it loads the settings first). */
const WAIT_MS = 8000;

/**
 * Scrolls `el` into view and outlines it for a moment (`[data-sw-reveal]` in styles.css), so the eye lands on it.
 * Returns what removes the outline early.
 */
export function revealElement(el: HTMLElement, block: ScrollLogicalPosition = 'center'): () => void {
  // jsdom has no scrollIntoView.
  el.scrollIntoView?.({ block });
  el.setAttribute('data-sw-reveal', '');
  const t = setTimeout(() => el.removeAttribute('data-sw-reveal'), FLASH_MS);
  return () => {
    clearTimeout(t);
    el.removeAttribute('data-sw-reveal');
  };
}

/**
 * Once a Website Settings tile is on the page, scroll it into view and outline it. The board draws only after the
 * settings load, so this watches the document for it, and gives up after a while. Returns a cancel.
 */
export function revealSettingsTile(tile: WebsiteSettingsTile, waitMs: number = WAIT_MS): () => void {
  const selector = settingsTileSelector(tile);
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;
  let unflash: (() => void) | null = null;
  const stopWatching = (): void => {
    observer?.disconnect();
    observer = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const found = (): boolean => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    stopWatching();
    // One frame later: the tab switch's own jump to the top lands first, and the tile has its place in the grid.
    frame = requestAnimationFrame(() => {
      frame = null;
      unflash = revealElement(el);
    });
    return true;
  };
  if (!found()) {
    observer = new MutationObserver(() => {
      if (observer) found();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(stopWatching, waitMs);
  }
  return () => {
    stopWatching();
    if (frame !== null) cancelAnimationFrame(frame);
    unflash?.();
  };
}

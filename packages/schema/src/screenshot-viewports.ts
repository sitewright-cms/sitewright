import { z } from 'zod';

// Server-side SCREENSHOT breakpoints — the named viewports the `preview_page` MCP tool and the
// `POST /preview?screenshot=1` route render at. Shared here (not in apps/api) so the API renderer and
// the MCP tool's `viewports` enum derive from ONE source and can't drift. Widths are CSS px at
// deviceScaleFactor 1 (the display's native resolution = the CSS viewport).
//
// `capHeight` bounds a full-page capture so a pathological/infinite-scroll page can't produce an
// unbounded image — set generously (narrower viewports stack content taller, so they get higher caps)
// so real long-tail pages are captured in full rather than truncated.

export interface ScreenshotViewport {
  /** Human label for pickers/logs. */
  readonly label: string;
  readonly width: number;
  /** Initial viewport height; also the MINIMUM clip height for a short page. */
  readonly height: number;
  /** Maximum full-page clip height (token-cost / infinite-scroll backstop). */
  readonly capHeight: number;
  /** Emulate a touch/mobile device (mobile meta viewport handling). */
  readonly isMobile: boolean;
}

export const SCREENSHOT_VIEWPORTS = {
  wqhd: { label: 'WQHD · 2560', width: 2560, height: 1440, capHeight: 6000, isMobile: false },
  fullhd: { label: 'Full HD · 1920', width: 1920, height: 1080, capHeight: 7000, isMobile: false },
  laptop: { label: 'Laptop · 1440', width: 1440, height: 900, capHeight: 8000, isMobile: false },
  tablet: { label: 'Tablet · 768', width: 768, height: 1024, capHeight: 10000, isMobile: true },
  mobile: { label: 'Mobile · 390', width: 390, height: 844, capHeight: 12000, isMobile: true },
} as const satisfies Record<string, ScreenshotViewport>;

export type ScreenshotViewportName = keyof typeof SCREENSHOT_VIEWPORTS;

/** Registry order (widest → narrowest): wqhd, fullhd, laptop, tablet, mobile. */
export const SCREENSHOT_VIEWPORT_NAMES = Object.keys(SCREENSHOT_VIEWPORTS) as ScreenshotViewportName[];

export const ScreenshotViewportNameSchema = z.enum(
  SCREENSHOT_VIEWPORT_NAMES as [ScreenshotViewportName, ...ScreenshotViewportName[]],
);

/**
 * Everyday words for a breakpoint that aren't the registry's own names. Agents (and people) reach for
 * "desktop"/"phone" far more naturally than "fullhd"/"mobile", and rejecting them just burns a retry —
 * so the MCP tools accept these aliases and fold them onto the canonical name.
 */
export const SCREENSHOT_VIEWPORT_ALIASES: Record<string, ScreenshotViewportName> = {
  desktop: 'fullhd',
  phone: 'mobile',
};

/**
 * A forgiving viewport name for tool input: canonical names pass through, and the common aliases above
 * (case-insensitive) map onto a canonical name before enum validation. Use at the MCP boundary so the
 * canonical {@link ScreenshotViewportNameSchema} — and the renderer — stay strict.
 */
export const LenientScreenshotViewportNameSchema = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const key = v.trim().toLowerCase();
  return SCREENSHOT_VIEWPORT_ALIASES[key] ?? key;
}, ScreenshotViewportNameSchema);

/**
 * Default when the caller doesn't choose — a representative spread across desktop (Full HD), tablet, and
 * mobile, so a plain `preview_page` shows the responsive picture (~3 images). Request specific names (or
 * all five, incl. wqhd/laptop) for a fuller sweep.
 */
export const DEFAULT_SCREENSHOT_VIEWPORTS: readonly ScreenshotViewportName[] = ['fullhd', 'tablet', 'mobile'];

/**
 * The default for a plain `preview_page` (the agent's "let me look" render): desktop + mobile only —
 * two images instead of three, to keep the token cost of design iteration down. The agent can still
 * request `tablet` or all five for a fuller sweep. NOTE: `compare_to_source` (the nativizer fidelity
 * check) keeps the full {@link DEFAULT_SCREENSHOT_VIEWPORTS} — do NOT route it through this.
 */
export const PREVIEW_DEFAULT_VIEWPORTS: readonly ScreenshotViewportName[] = ['fullhd', 'mobile'];

export function isScreenshotViewportName(v: string): v is ScreenshotViewportName {
  return (SCREENSHOT_VIEWPORT_NAMES as readonly string[]).includes(v);
}

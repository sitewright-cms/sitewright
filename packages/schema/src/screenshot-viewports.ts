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
 * Default when the caller doesn't choose — a representative desktop (Full HD) + mobile pair, so a plain
 * `preview_page` stays at ~2 images. Request specific names (or all five) for a full responsive sweep.
 */
export const DEFAULT_SCREENSHOT_VIEWPORTS: readonly ScreenshotViewportName[] = ['fullhd', 'mobile'];

export function isScreenshotViewportName(v: string): v is ScreenshotViewportName {
  return (SCREENSHOT_VIEWPORT_NAMES as readonly string[]).includes(v);
}

import { describe, it, expect } from 'vitest';
import {
  SCREENSHOT_VIEWPORTS,
  SCREENSHOT_VIEWPORT_NAMES,
  DEFAULT_SCREENSHOT_VIEWPORTS,
  ScreenshotViewportNameSchema,
  isScreenshotViewportName,
} from '../src/screenshot-viewports.js';

describe('screenshot viewports registry', () => {
  it('exposes the five named breakpoints, widest → narrowest', () => {
    expect(SCREENSHOT_VIEWPORT_NAMES).toEqual(['wqhd', 'fullhd', 'laptop', 'tablet', 'mobile']);
    // monotonically narrowing widths
    const widths = SCREENSHOT_VIEWPORT_NAMES.map((n) => SCREENSHOT_VIEWPORTS[n].width);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
  });

  it('every viewport caps height ABOVE its base height (so a full page is not pre-truncated)', () => {
    for (const name of SCREENSHOT_VIEWPORT_NAMES) {
      const vp = SCREENSHOT_VIEWPORTS[name];
      expect(vp.capHeight).toBeGreaterThan(vp.height);
      expect(vp.width).toBeGreaterThan(0);
    }
  });

  it('the default set is a non-empty subset of the registry', () => {
    expect(DEFAULT_SCREENSHOT_VIEWPORTS.length).toBeGreaterThan(0);
    for (const n of DEFAULT_SCREENSHOT_VIEWPORTS) expect(SCREENSHOT_VIEWPORT_NAMES).toContain(n);
  });

  it('the zod enum + the type guard accept exactly the registry names', () => {
    for (const n of SCREENSHOT_VIEWPORT_NAMES) {
      expect(ScreenshotViewportNameSchema.safeParse(n).success).toBe(true);
      expect(isScreenshotViewportName(n)).toBe(true);
    }
    expect(ScreenshotViewportNameSchema.safeParse('desktop').success).toBe(false); // the old name is gone
    expect(isScreenshotViewportName('desktop')).toBe(false);
    expect(isScreenshotViewportName('')).toBe(false);
  });
});

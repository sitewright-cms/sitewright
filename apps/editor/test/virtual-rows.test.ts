import { describe, it, expect } from 'vitest';
import { VIRTUAL_ROW_THRESHOLD, visibleRange } from '../src/lib/virtual-rows';

// An 865-page project rendered 905 rows and 42,000 DOM nodes: ~2.9s to open the tab, ~200ms per
// keystroke in the search box, ~1s to come back from a filter (measured in a real browser). Only ~18
// rows are on screen at a time, so the rest exist purely to be scrolled past. These tests pin the
// index arithmetic that decides which rows are real — the part that is wrong-by-one in every
// hand-rolled virtual list.

const RANGE = { rowHeight: 48, viewport: 900, count: 1000, overscan: 5 };

describe('visibleRange', () => {
  it('starts at the top of the list before anything has scrolled', () => {
    const { start, end } = visibleRange({ ...RANGE, scrolled: 0 });
    expect(start).toBe(0);
    // 900px viewport / 48px rows ≈ 19 visible, plus overscan on both sides.
    expect(end).toBeGreaterThanOrEqual(19);
    expect(end).toBeLessThanOrEqual(19 + RANGE.overscan * 2 + 1);
  });

  it('moves the window as the list scrolls under the viewport', () => {
    const { start, end } = visibleRange({ ...RANGE, scrolled: 4800 }); // 100 rows above the fold
    expect(start).toBe(100 - RANGE.overscan);
    expect(end).toBeGreaterThan(100);
  });

  it('★ keeps `overscan` rows rendered on each side, so scrolling never shows a gap', () => {
    const { start, end } = visibleRange({ ...RANGE, scrolled: 4800 });
    expect(start).toBeLessThanOrEqual(100); // rows above the fold stay rendered
    expect(end).toBeGreaterThanOrEqual(100 + Math.ceil(RANGE.viewport / RANGE.rowHeight));
  });

  it('never runs off either end of the list', () => {
    expect(visibleRange({ ...RANGE, scrolled: -500 }).start).toBe(0); // over-scroll bounce
    const atBottom = visibleRange({ ...RANGE, scrolled: 48_000 });
    expect(atBottom.end).toBe(RANGE.count);
    expect(atBottom.start).toBeLessThan(RANGE.count);
    expect(atBottom.start).toBeGreaterThanOrEqual(0);
  });

  it('renders EVERYTHING when the list is shorter than the window', () => {
    const { start, end } = visibleRange({ ...RANGE, count: 4, scrolled: 0 });
    expect(start).toBe(0);
    expect(end).toBe(4);
  });

  it('handles a zero-length list and a nonsense row height without dividing by zero', () => {
    expect(visibleRange({ ...RANGE, count: 0, scrolled: 0 })).toEqual({ start: 0, end: 0 });
    const bad = visibleRange({ ...RANGE, rowHeight: 0, scrolled: 100 });
    expect(bad.start).toBe(0);
    expect(bad.end).toBe(RANGE.count); // fall back to rendering everything rather than nothing
  });

  it('★ always renders at least one row when the list is non-empty', () => {
    // A window that computes to nothing would show an empty list with a full-height scrollbar — the
    // failure that looks exactly like "the data did not load".
    for (const scrolled of [0, 1, 47, 48, 49, 47_999, 48_000, 999_999]) {
      const { start, end } = visibleRange({ ...RANGE, scrolled });
      expect(end, `scrolled=${scrolled}`).toBeGreaterThan(start);
    }
  });

  it('exposes a threshold below which virtualising is not worth the machinery', () => {
    expect(VIRTUAL_ROW_THRESHOLD).toBeGreaterThan(20);
  });
});

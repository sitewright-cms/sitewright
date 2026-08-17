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

// ── The two things the FILE MANAGER needed that the pages list did not ────────────────────────────
//   1. It scrolls an INNER container (the side panel), not the window. A window-scrolled virtualiser
//      is a silent no-op there — the exact failure this feature already shipped once.
//   2. Its grid view lays items out N-per-row, so the window has to move in ROWS, not items.
import { columnsIn, gridRowsFor, itemRangeFor, rowHeightFrom } from '../src/lib/virtual-rows';

describe('columnsIn — how many items share a row', () => {
  it('counts the items that sit at the same offsetTop', () => {
    expect(columnsIn([0, 0, 0, 0, 120, 120, 120, 120])).toBe(4);
    expect(columnsIn([0, 58, 116, 174])).toBe(1); // a plain list: one per row
  });

  it('never returns 0 — an unmeasurable layout must not divide by it', () => {
    expect(columnsIn([])).toBe(1);
    expect(columnsIn([0])).toBe(1);
  });

  it('is not fooled by a LATER row repeating the first row’s top', () => {
    // Only the leading run counts; anything else would over-count on a sub-pixel coincidence.
    expect(columnsIn([0, 0, 90, 90, 0])).toBe(2);
  });
});

describe('rowHeightFrom — the distance between ROWS, not between items', () => {
  it('measures a grid from its distinct rows', () => {
    // 3 columns, rows at 0 / 140 / 280 → 140, NOT the 0 gap between neighbours in a row.
    expect(rowHeightFrom([0, 0, 0, 140, 140, 140, 280, 280, 280], 96)).toBe(140);
  });

  it('measures a plain list the same way', () => {
    expect(rowHeightFrom([0, 58, 116, 174], 40)).toBe(58);
  });

  it('falls back to the given element height when there is only one row', () => {
    expect(rowHeightFrom([0, 0, 0], 96)).toBe(96);
    expect(rowHeightFrom([], 96)).toBe(96);
  });
});

describe('gridRowsFor / itemRangeFor — windowing a grid in whole rows', () => {
  it('converts an item count into a row count', () => {
    expect(gridRowsFor(100, 6)).toBe(17);
    expect(gridRowsFor(96, 6)).toBe(16);
    expect(gridRowsFor(0, 6)).toBe(0);
  });

  it('expands a ROW range back into item indices, clamped to the count', () => {
    expect(itemRangeFor({ start: 2, end: 5 }, 4, 100)).toEqual({ start: 8, end: 20 });
    // The last row is short: the end clamps to the real item count rather than running past it.
    expect(itemRangeFor({ start: 4, end: 5 }, 4, 18)).toEqual({ start: 16, end: 18 });
  });

  it('★ always starts on a row boundary, so the grid stays aligned', () => {
    // If `start` were not a multiple of the column count, every item after the spacer would shift
    // into the wrong column and the layout would visibly jump as you scroll.
    for (const rowStart of [0, 1, 7, 33]) {
      expect(itemRangeFor({ start: rowStart, end: rowStart + 2 }, 6, 10_000).start % 6).toBe(0);
    }
  });
});

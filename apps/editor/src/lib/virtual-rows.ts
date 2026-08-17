import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Window-scrolled row virtualisation for the long editor lists (pages, dataset entries).
 *
 * ★ Why: an 865-page project rendered 905 rows / 42,000 DOM nodes — measured in a real browser at
 * ~2.9s to open the Pages tab, ~200ms per keystroke in the search box and ~1s to come back from a
 * filter, with a 48-54MB JS heap. About 18 rows are on screen at a time; the rest exist only to be
 * scrolled past. Rendering just the visible window plus a small overscan removes the cost without
 * touching the DATA: the full array stays in memory, so reorder, search and key-uniqueness are
 * unaffected — only the `.map()` narrows.
 *
 * The lists scroll the WINDOW (not an inner container), so the range is derived from how far the
 * list's own top has travelled above the viewport.
 */

/** Below this many rows the DOM cost is irrelevant and plain rendering keeps every browser affordance
 *  (Ctrl+F, native scroll-into-view) that virtualising gives up. Also keeps small projects — and every
 *  existing E2E spec — on exactly the code path they had before. */
export const VIRTUAL_ROW_THRESHOLD = 80;

/** Rows kept rendered beyond each edge of the viewport, so a scroll never reveals an empty band. */
const OVERSCAN = 6;

export interface VisibleRangeInput {
  /** Pixels of the list that have scrolled ABOVE the top of the viewport (0 when it starts on screen). */
  scrolled: number;
  /** Viewport height in px. */
  viewport: number;
  /** Measured height of one row, including the gap between rows. */
  rowHeight: number;
  /** Total rows in the list. */
  count: number;
  overscan: number;
}

/**
 * The half-open row range `[start, end)` to render.
 *
 * Defensive by design: a zero/NaN row height (measured before layout settles) renders EVERYTHING
 * rather than nothing — a list that renders nothing behind a full-height scrollbar is indistinguishable
 * from data that failed to load.
 */
export function visibleRange({ scrolled, viewport, rowHeight, count, overscan }: VisibleRangeInput): {
  start: number;
  end: number;
} {
  if (count <= 0) return { start: 0, end: 0 };
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return { start: 0, end: count };
  const above = Math.max(0, scrolled); // over-scroll bounce reports a negative offset
  const first = Math.floor(above / rowHeight) - overscan;
  const visible = Math.ceil(viewport / rowHeight) + overscan * 2;
  const start = Math.min(Math.max(0, first), Math.max(0, count - 1));
  const end = Math.min(count, Math.max(start + 1, start + visible));
  return { start, end };
}

export interface VirtualRows {
  /** Attach to the list element (the `<ul>`) — its position drives the range and its first real row
   *  is what gets measured. */
  listRef: (el: HTMLElement | null) => void;
  start: number;
  end: number;
  /** Spacer height in px to render ABOVE the window, standing in for the skipped rows. */
  padTop: number;
  /** Spacer height in px to render BELOW it. */
  padBottom: number;
  /** False when the list is short enough to render whole (start/end then span everything). */
  active: boolean;
  /** The measured height of one row INCLUDING the gap, or 0 before the first measurement. */
  rowHeight: number;
}

/**
 * Track the visible window of a `count`-row list.
 *
 * The row height is MEASURED from a real row rather than hard-coded: these rows carry badges and
 * chips whose presence varies, and a wrong constant makes the scrollbar lie. The first paint always
 * starts at `start === 0`, so there is always a real row to measure before any spacer exists.
 */
export function useVirtualRows(count: number, enabled = true): VirtualRows {
  const active = enabled && count > VIRTUAL_ROW_THRESHOLD;
  const listEl = useRef<HTMLElement | null>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [range, setRange] = useState({ start: 0, end: count });
  // Stable identity: an inline ref callback is detached and re-attached on every render, which is
  // pure churn on a list that re-renders on every scroll frame.
  const setListEl = useCallback((el: HTMLElement | null) => {
    listEl.current = el;
  }, []);

  /**
   * Measure a real row rather than assume a constant — these rows carry badges and chips whose
   * presence varies, and a wrong height makes the scrollbar lie.
   *
   * ★ Queried from the LIST rather than captured with a per-row ref. A ref on "the first rendered row"
   * has to be re-attached on every re-slice, and getting that wrong fails SILENTLY: the height stays 0,
   * `visibleRange` falls back to rendering everything, and the list looks correct while doing none of
   * the work. (It did exactly that — 905 rows, `hasRow: false`.) The DOM query has no such failure mode.
   */
  const measure = useCallback(() => {
    const rows = listEl.current?.querySelectorAll<HTMLElement>('li[data-virtual-row]');
    if (!rows || rows.length === 0) return;
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    // ★ AVERAGE across the whole rendered window, not one row. These rows carry optional badges
    // (draft / template / inherited / custom code), so heights genuinely differ; sizing the spacers
    // from a single sample makes the error accumulate with scroll distance instead of cancelling out.
    // Re-measured as the window moves, so the estimate tracks whatever region is on screen.
    // `offsetHeight` misses the flex gap between rows; the distance between rows includes it.
    const span = last.offsetTop - first.offsetTop;
    const measured = rows.length > 1 && span > 0 ? span / (rows.length - 1) : first.offsetHeight;
    const next = Math.round(measured);
    // Ignore sub-pixel churn, which would otherwise re-render the list on every scroll frame.
    if (next > 0 && Math.abs(next - rowHeight) >= 1) setRowHeight(next);
  }, [rowHeight]);

  const update = useCallback(() => {
    if (!active) {
      setRange((r) => (r.start === 0 && r.end === count ? r : { start: 0, end: count }));
      return;
    }
    const el = listEl.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const next = visibleRange({
      scrolled: -top,
      viewport: window.innerHeight,
      rowHeight,
      count,
      overscan: OVERSCAN,
    });
    setRange((r) => (r.start === next.start && r.end === next.end ? r : next));
  }, [active, count, rowHeight]);

  /**
   * Measure before paint so the first scroll already has a real height to work from.
   *
   * ★ `range` is in the dependency list, and that is the whole trick. The list mounts EMPTY and fills
   * when the fetch resolves, so on the render where `count` goes 0 → N the rows are NOT in the DOM yet
   * (the window is still the initial {0,0}) — there is nothing to measure. Without re-running after the
   * window changes, the height stays 0 forever, `visibleRange` takes its render-everything fallback,
   * and the list virtualises nothing while looking entirely correct. It did exactly that in a real
   * browser: 865 rows, `hasRow: false`. Converges because `update` returns the SAME range object when
   * nothing moved, so the effect stops re-firing.
   */
  useLayoutEffect(() => {
    measure();
    update();
  }, [measure, update, count, range]);

  useEffect(() => {
    if (!active) return;
    const onScroll = (): void => update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [active, update]);

  const start = active ? range.start : 0;
  const end = active ? range.end : count;
  return {
    listRef: setListEl,
    start,
    end,
    padTop: active ? start * rowHeight : 0,
    padBottom: active ? Math.max(0, count - end) * rowHeight : 0,
    rowHeight,
    active: active && rowHeight > 0,
  };
}

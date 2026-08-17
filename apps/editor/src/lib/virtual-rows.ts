import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Row virtualisation for the long editor lists (pages, dataset entries, the file manager).
 *
 * ★ Why: an 865-page project rendered 905 rows / 42,000 DOM nodes — measured in a real browser at
 * ~2.9s to open the Pages tab, ~200ms per keystroke in the search box and ~1s to come back from a
 * filter, with a 48-54MB JS heap. The file manager was worse: 3,000 assets rendered 75,686 nodes and
 * 3,000 `<img>` elements. About 18 rows are on screen at a time; the rest exist only to be scrolled
 * past. Rendering just the visible window plus a small overscan removes the cost without touching the
 * DATA: the full array stays in memory, so reorder, search and key-uniqueness are unaffected — only
 * the `.map()` narrows.
 *
 * Two things the file manager needed that the pages list did not:
 *
 * ★ It scrolls an INNER container (the side panel's `overflow-auto` body), not the window. SCROLL
 *   EVENTS DO NOT BUBBLE, so the plain window listener this hook used never fired there at all: the
 *   window froze at its initial range and the panel scrolled to reveal reserved blank space. That had
 *   been true of the DATASET ENTRIES list since virtualisation shipped, unnoticed because nothing
 *   covered it. Fixed by capturing (below); the host is also DETECTED so the window is sized by the
 *   panel rather than the whole viewport.
 * ★ Its grid view lays items out N-per-row, so the window has to move in whole ROWS. `perRow` is
 *   measured from the DOM (the grid is responsive: 2 / 4 / 6 columns), never assumed.
 */

/** Below this many rows the DOM cost is irrelevant and plain rendering keeps every browser affordance
 *  (Ctrl+F, native scroll-into-view) that virtualising gives up. Also keeps small projects — and every
 *  existing E2E spec — on exactly the code path they had before. */
export const VIRTUAL_ROW_THRESHOLD = 80;

/** Rows kept rendered beyond each edge of the viewport, so a scroll never reveals an empty band. */
const OVERSCAN = 6;

/**
 * How many rendered items to read geometry from per measurement.
 *
 * ★ Bounded on purpose. The very first paint renders the WHOLE list (the window has not narrowed yet),
 * so an unbounded read touches every row — and reading N `offsetTop`s to derive one row height and one
 * column count is waste no matter how fast the browser is. A few rows past the viewport is already more
 * than the average needs; the cap is what keeps the first paint from scaling with the list.
 */
const MEASURE_SAMPLE = 60;

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

/**
 * How many items share the FIRST row, from the rendered items' `offsetTop`s in document order.
 *
 * Only the leading run counts. A later row that happens to repeat the first row's top (sub-pixel
 * rounding, a re-ordered fragment) would otherwise inflate the column count, and an over-counted
 * `perRow` skips real rows — the window would land past where the author is looking.
 */
export function columnsIn(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  const first = tops[0]!;
  let n = 0;
  for (const top of tops) {
    if (top !== first) break;
    n += 1;
  }
  return Math.max(1, n);
}

/**
 * The distance between successive ROWS, from the rendered items' `offsetTop`s.
 *
 * ★ Measured across DISTINCT tops, not between neighbouring items: in a grid the neighbours in one row
 * are 0px apart vertically, so an item-to-item average would report a row height near zero and the
 * spacers would collapse. Averaging over every rendered row also cancels the sub-pixel error that would
 * otherwise accumulate with scroll distance. Falls back to one element's height when a single row is
 * rendered (nothing to measure a distance against).
 */
export function rowHeightFrom(tops: readonly number[], fallbackHeight: number): number {
  const distinct = [...new Set(tops)].sort((a, b) => a - b);
  if (distinct.length < 2) return Math.round(fallbackHeight);
  return Math.round((distinct[distinct.length - 1]! - distinct[0]!) / (distinct.length - 1));
}

/** How many ROWS `count` items occupy at `perRow` per row. */
export function gridRowsFor(count: number, perRow: number): number {
  return Math.ceil(count / Math.max(1, Math.trunc(perRow)));
}

/**
 * A row range expanded back into item indices.
 *
 * ★ `start` is always a multiple of `perRow`. If it were not, every item after the spacer would land in
 * the wrong column and the grid would visibly jump as you scroll.
 */
export function itemRangeFor(rows: { start: number; end: number }, perRow: number, count: number): { start: number; end: number } {
  const per = Math.max(1, Math.trunc(perRow));
  return { start: Math.min(count, rows.start * per), end: Math.min(count, rows.end * per) };
}

/**
 * The nearest ancestor that actually scrolls this element vertically, or `null` for the window.
 *
 * ★ Returning `null` is not a failure mode — the caller then measures against the viewport, which is
 * correct for a page-scrolled list and merely LOOSE for a panel-scrolled one (the window comes out a
 * little larger than needed). So a missed host costs some extra rows, never correctness.
 *
 * ★ The overflow check alone is not enough. A `overflow-x-auto` wrapper (the file list has one, so a
 * narrow drawer scrolls the table sideways instead of crushing the Name column) computes `overflow-y`
 * to `auto` as well, per CSS — picking it would wire the virtualiser to a container that never scrolls
 * vertically. Requiring real vertical overflow tells the two apart.
 */
export function scrollHostOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

export interface VirtualRowsOptions {
  /**
   * True when the items flow in a GRID (several per row). The column count is measured from the DOM,
   * because the grid is responsive — assuming it is how a virtualiser silently mis-windows at one
   * breakpoint and looks fine at the rest.
   */
  grid?: boolean;
}

export interface VirtualRows {
  /** Attach to the element that CONTAINS the rows (`<ul>`, `<tbody>`, the grid `<div>`) — its position
   *  drives the range and its rendered rows are what get measured. */
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
  /** Measured items per row — 1 for a list, the grid's current column count otherwise. */
  perRow: number;
}

/**
 * Track the visible window of a `count`-row list.
 *
 * The row height is MEASURED from a real row rather than hard-coded: these rows carry badges and
 * chips whose presence varies, and a wrong constant makes the scrollbar lie. The first paint always
 * starts at `start === 0`, so there is always a real row to measure before any spacer exists.
 */
export function useVirtualRows(count: number, enabled = true, opts?: VirtualRowsOptions): VirtualRows {
  const active = enabled && count > VIRTUAL_ROW_THRESHOLD;
  const isGrid = opts?.grid === true;
  const listEl = useRef<HTMLElement | null>(null);
  /** The scrolling ancestor, re-detected whenever the rendered set changes (never per scroll frame). */
  const host = useRef<HTMLElement | null>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [perRow, setPerRow] = useState(1);
  /** ROW indices (not item indices) — a grid row holds `perRow` of them. */
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
    // ANY element, not `li`: the file manager's list view is a real `<table>`, so its rows are `<tr>`.
    const rows = listEl.current?.querySelectorAll<HTMLElement>('[data-virtual-row]');
    if (!rows || rows.length === 0) return;
    const sample = [...rows].slice(0, MEASURE_SAMPLE);
    const tops = sample.map((r) => r.offsetTop);
    // ★ AVERAGE across the whole rendered window, not one row. These rows carry optional badges
    // (draft / template / inherited / custom code), so heights genuinely differ; sizing the spacers
    // from a single sample makes the error accumulate with scroll distance instead of cancelling out.
    // Re-measured as the window moves, so the estimate tracks whatever region is on screen.
    // `offsetHeight` misses the gap between rows; the distance between rows includes it.
    const nextHeight = rowHeightFrom(tops, rows[0]!.offsetHeight);
    // Ignore sub-pixel churn, which would otherwise re-render the list on every scroll frame.
    if (nextHeight > 0 && Math.abs(nextHeight - rowHeight) >= 1) setRowHeight(nextHeight);
    const nextPerRow = isGrid ? columnsIn(tops) : 1;
    if (nextPerRow !== perRow) setPerRow(nextPerRow);
    host.current = scrollHostOf(listEl.current);
  }, [rowHeight, perRow, isGrid]);

  const update = useCallback(() => {
    if (!active) {
      setRange((r) => (r.start === 0 && r.end === count ? r : { start: 0, end: count }));
      return;
    }
    const el = listEl.current;
    if (!el) return;
    // Relative to whatever actually scrolls: the panel body when there is one, else the viewport.
    const scroller = host.current;
    const top = el.getBoundingClientRect().top - (scroller ? scroller.getBoundingClientRect().top : 0);
    const next = visibleRange({
      scrolled: -top,
      viewport: scroller ? scroller.clientHeight : window.innerHeight,
      rowHeight,
      count: gridRowsFor(count, perRow),
      overscan: OVERSCAN,
    });
    setRange((r) => (r.start === next.start && r.end === next.end ? r : next));
  }, [active, count, rowHeight, perRow]);

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
    // ★ `capture: true`, and that is not a detail. SCROLL EVENTS DO NOT BUBBLE, so a plain window-level
    // listener never fires for a scroll inside a container — a list in a side panel froze its window at
    // the initial range and scrolling the panel revealed the reserved blank space instead of rows.
    // Measured: with the capturing listener removed, the file list stays pinned to its first row however
    // far the panel scrolls. Capturing also means a re-detected host needs no re-subscription.
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });

    // ★ A resize must RE-MEASURE, not just recompute. The grid is responsive (2 / 4 / 6 across), so a
    // width change alters `perRow` — and `update()` alone would not notice: the row height is fixed, the
    // scroll offset is unchanged, so it returns the SAME range, `setRange` bails out, `range`'s identity
    // never changes and the layout effect that owns `measure()` never re-fires. `perRow` would stay at
    // the old column count and every tile after a spacer would land in the wrong column.
    const onResize = (): void => {
      measure();
      update();
    };
    window.addEventListener('resize', onResize);
    // The panel can also change width without the WINDOW resizing (a drawer opening beside it), which
    // `resize` would miss entirely.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    if (observer && listEl.current) observer.observe(listEl.current);

    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [active, update, measure]);

  const totalRows = gridRowsFor(count, perRow);
  const items = active ? itemRangeFor(range, perRow, count) : { start: 0, end: count };
  return {
    listRef: setListEl,
    start: items.start,
    end: items.end,
    padTop: active ? range.start * rowHeight : 0,
    padBottom: active ? Math.max(0, totalRows - range.end) * rowHeight : 0,
    rowHeight,
    perRow,
    active: active && rowHeight > 0,
  };
}

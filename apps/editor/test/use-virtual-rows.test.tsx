import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useVirtualRows } from '../src/lib/virtual-rows';

// visibleRange's arithmetic is unit-tested on its own. What THIS pins is the wiring — measuring a real
// row, feeding it back through state, and actually narrowing the rendered set.
//
// ★ It exists because the first implementation looked right, typechecked, passed every other test, and
// virtualised NOTHING: the row height stayed 0, so `visibleRange` took its render-everything fallback
// and the list behaved exactly as before while appearing to be virtualised. A silent no-op is the
// failure mode this feature has, so it needs a test that asserts the DOM actually shrank.

const ROW_H = 58; // row + flex gap
const VIEWPORT = 900;
const LIST_TOP = 232; // the list starts below the header, as it does in the real editor

function List({ count }: { count: number }) {
  const virt = useVirtualRows(count);
  const rows = Array.from({ length: count }, (_, i) => i).slice(virt.start, virt.end);
  return (
    <ul ref={virt.listRef as (el: HTMLUListElement | null) => void} data-testid="list">
      {virt.padTop > 0 && <li data-testid="pad-top" style={{ height: virt.padTop }} />}
      {rows.map((i) => (
        <li key={i} data-virtual-row="" data-testid="row">
          row {i}
        </li>
      ))}
      {virt.padBottom > 0 && <li data-testid="pad-bottom" style={{ height: virt.padBottom }} />}
    </ul>
  );
}

/** jsdom does no layout, so the geometry the hook reads is stubbed to a realistic list. */
function stubGeometry(): void {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(VIEWPORT);
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    const rows = [...(this.parentElement?.children ?? [])].filter((c) => c.hasAttribute('data-virtual-row'));
    const idx = rows.indexOf(this);
    return idx < 0 ? 0 : idx * ROW_H;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW_H);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = this.getAttribute('data-testid') === 'list' ? LIST_TOP - scrolledPx : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

let scrolledPx = 0;

beforeEach(() => {
  scrolledPx = 0;
  stubGeometry();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const rowCount = () => screen.queryAllByTestId('row').length;

describe('useVirtualRows', () => {
  it('★ renders only the visible window of a long list, not every row', async () => {
    render(<List count={865} />);
    // A viewport of 900px over 58px rows is ~16 rows, plus overscan on each side.
    expect(rowCount()).toBeGreaterThan(0);
    expect(rowCount()).toBeLessThan(40);
    expect(rowCount()).toBeGreaterThanOrEqual(16);
  });

  it('reserves the skipped height below, so the scrollbar still spans the whole list', () => {
    render(<List count={865} />);
    const pad = screen.getByTestId('pad-bottom');
    // 865 rows at 58px ≈ 50k px; the rendered window accounts for the rest.
    expect(Number.parseInt(pad.style.height, 10)).toBeGreaterThan(40_000);
  });

  it('renders EVERY row for a list under the threshold (small projects keep the old behaviour)', () => {
    render(<List count={12} />);
    expect(rowCount()).toBe(12);
    expect(screen.queryByTestId('pad-top')).toBeNull();
    expect(screen.queryByTestId('pad-bottom')).toBeNull();
  });

  it('moves the window on scroll, and reserves the skipped height ABOVE it', async () => {
    render(<List count={865} />);
    const before = screen.getAllByTestId('row')[0]!.textContent;

    scrolledPx = 5800; // 100 rows down
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(screen.getAllByTestId('row')[0]!.textContent).not.toBe(before);
    expect(Number.parseInt(screen.getByTestId('pad-top').style.height, 10)).toBeGreaterThan(4_000);
    expect(rowCount()).toBeLessThan(40);
  });

  it('★ measures once the rows ARRIVE, not only when the component mounts', async () => {
    // The list mounts EMPTY and fills when the fetch resolves. The first implementation only measured
    // on mount and when `count` changed: by the time count went 0 → 865 the rows were not in the DOM
    // yet (the window was still {0,0}), the height stayed 0, and nothing ever re-measured. It rendered
    // all 865 rows and looked fine. This is that exact sequence.
    const { rerender } = render(<List count={0} />);
    expect(rowCount()).toBe(0);

    rerender(<List count={865} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(rowCount(), 'the window must narrow once the rows exist').toBeLessThan(40);
    expect(rowCount()).toBeGreaterThan(0);
  });

  it('renders everything rather than nothing when the row height cannot be measured', () => {
    // A list whose rows have no measurable height must not collapse to an empty list behind a
    // full-height scrollbar — that is indistinguishable from "the data failed to load".
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(0);
    render(<List count={200} />);
    expect(rowCount()).toBe(200);
  });
});

// ── What the FILE MANAGER needed on top ──────────────────────────────────────────────────────────

const COLS = 4;
const GRID_ROW_H = 140;
/** Mutable so a test can reflow the grid to a different breakpoint. */
let columns = COLS;

/** A grid: COLS items share each row, so the window has to move in whole rows. */
function Grid({ count }: { count: number }) {
  const virt = useVirtualRows(count, true, { grid: true });
  const items = Array.from({ length: count }, (_, i) => i).slice(virt.start, virt.end);
  return (
    <div ref={virt.listRef as (el: HTMLDivElement | null) => void} data-testid="list">
      {virt.padTop > 0 && <div data-testid="pad-top" style={{ height: virt.padTop }} />}
      {items.map((i) => (
        <div key={i} data-virtual-row="" data-testid="cell">
          cell {i}
        </div>
      ))}
      {virt.padBottom > 0 && <div data-testid="pad-bottom" style={{ height: virt.padBottom }} />}
      <span data-testid="perRow">{virt.perRow}</span>
    </div>
  );
}

describe('useVirtualRows — grid layout', () => {
  beforeEach(() => {
    columns = COLS;
    vi.restoreAllMocks();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(VIEWPORT);
    // `columns` cells share each row top.
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      const cells = [...(this.parentElement?.children ?? [])].filter((c) => c.hasAttribute('data-virtual-row'));
      const idx = cells.indexOf(this);
      return idx < 0 ? 0 : Math.floor(idx / columns) * GRID_ROW_H;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(GRID_ROW_H);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this.getAttribute('data-testid') === 'list' ? LIST_TOP - scrolledPx : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });

  it('★ measures the column count instead of assuming it', () => {
    render(<Grid count={600} />);
    expect(screen.getByTestId('perRow').textContent).toBe(String(COLS));
  });

  it('★ narrows a 600-item grid to the visible rows', () => {
    render(<Grid count={600} />);
    const cells = screen.queryAllByTestId('cell').length;
    // ~7 rows of 4 fit a 900px viewport at 140px rows, plus 6 rows of overscan each side → ~19 rows.
    expect(cells).toBeGreaterThan(0);
    expect(cells).toBeLessThan(600 / 4);
    expect(cells % COLS, 'a partial row would mean the window is not row-aligned').toBe(0);
  });

  it('★ starts the window on a ROW boundary, so cells never shift columns', async () => {
    render(<Grid count={600} />);
    scrolledPx = 140 * 37 + 55; // mid-row on purpose
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    const first = Number(screen.queryAllByTestId('cell')[0]!.textContent!.replace('cell ', ''));
    expect(first % COLS, 'a window starting mid-row would shift every cell into the wrong column').toBe(0);
  });

  it('★ RE-MEASURES the column count when the layout resizes', async () => {
    // The grid is responsive (2 / 4 / 6 across). A width change alters perRow — and a resize handler
    // that only recomputes the range would not notice: the row height is fixed and the scroll offset is
    // unchanged, so it returns the SAME range, setRange bails out, and the effect that owns measure()
    // never re-fires. perRow would stay at the old count and every tile after a spacer would land in
    // the wrong column.
    const { rerender } = render(<Grid count={600} />);
    expect(screen.getByTestId('perRow').textContent).toBe(String(COLS));

    columns = 2; // the viewport crossed a breakpoint; CSS reflowed, nothing else changed
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    rerender(<Grid count={600} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('perRow').textContent, 'a stale perRow misaligns every tile').toBe('2');
  });

  it('reserves height in ROWS, not items — 600 cells at 4 across is 150 rows', () => {
    render(<Grid count={600} />);
    const padBottom = Number.parseInt(screen.getByTestId('pad-bottom').style.height, 10);
    // 750 rows x 140px ≈ 105,000px; the rendered window accounts for the difference.
    expect(padBottom).toBeGreaterThan(18_000);
    expect(padBottom, 'measuring per ITEM would reserve 4x too much').toBeLessThan(600 * GRID_ROW_H);
  });
});

describe('useVirtualRows — an inner scroll container', () => {
  // The file manager lives in a side panel whose body is the scroller. A window-scrolled virtualiser
  // reads a viewport that never moves there: it renders everything, forever, and looks correct.
  const HOST_H = 600;
  let hostScrollTop = 0;

  function Panel({ count }: { count: number }) {
    const virt = useVirtualRows(count);
    const rows = Array.from({ length: count }, (_, i) => i).slice(virt.start, virt.end);
    return (
      <div data-testid="host" style={{ overflowY: 'auto', height: HOST_H }}>
        <ul ref={virt.listRef as (el: HTMLUListElement | null) => void} data-testid="list">
          {rows.map((i) => (
            <li key={i} data-virtual-row="" data-testid="row">
              row {i}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  beforeEach(() => {
    hostScrollTop = 0;
    vi.restoreAllMocks();
    // A viewport TALLER than the host: if the hook read the window it would render far more rows.
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(4000);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      const rows = [...(this.parentElement?.children ?? [])].filter((c) => c.hasAttribute('data-virtual-row'));
      const idx = rows.indexOf(this);
      return idx < 0 ? 0 : idx * ROW_H;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW_H);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-testid') === 'host' ? HOST_H : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-testid') === 'host' ? 50_000 : 0;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const id = this.getAttribute('data-testid');
      const top = id === 'list' ? -hostScrollTop : 0; // the host itself sits at 0
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });

  it('★ sizes the window from the CONTAINER, not the window', () => {
    render(<Panel count={865} />);
    const rows = screen.queryAllByTestId('row').length;
    // 600px host / 58px rows ≈ 11 rows + overscan. A window-sized read (4000px) would render ~80.
    expect(rows).toBeGreaterThan(0);
    expect(rows, 'reading window.innerHeight here would render far more').toBeLessThan(40);
  });

  it('★ follows the CONTAINER scrolling, not the page', async () => {
    render(<Panel count={865} />);
    const before = screen.getAllByTestId('row')[0]!.textContent;
    hostScrollTop = 58 * 200;
    await act(async () => {
      screen.getByTestId('host').dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(screen.getAllByTestId('row')[0]!.textContent).not.toBe(before);
  });
});

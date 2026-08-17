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

import { describe, it, expect } from 'vitest';
import { dropTargetAt, type RowBand } from '../src/lib/drag-drop';

/**
 * The bug these cover: a drop was only accepted while the pointer was over a ROW, so the gap between
 * rows, the virtualiser's spacers and the space past the last row silently rejected it and the browser
 * snapped the dragged row back. Every position over the list must now resolve to an insertion point.
 */
const rows = (...bands: [string, number, number][]): RowBand[] =>
  bands.map(([id, top, bottom]) => ({ id, top, bottom }));

// Three 20px rows with a 4px gap between them, as `flex flex-col gap-1` lays them out.
const LIST = rows(['a', 0, 20], ['b', 24, 44], ['c', 48, 68]);

describe('dropTargetAt', () => {
  it('has no answer for an empty list — there is nothing to order against', () => {
    expect(dropTargetAt([], 10)).toBeNull();
  });

  it('places before a row when the pointer is in its upper half', () => {
    expect(dropTargetAt(LIST, 4)).toEqual({ id: 'a', pos: 'before' });
    expect(dropTargetAt(LIST, 28)).toEqual({ id: 'b', pos: 'before' });
  });

  it('places after a row when the pointer is in its lower half', () => {
    // Past a's midpoint, the first row whose midpoint is still below the pointer is b — the same
    // position as "after a", expressed against the row below.
    expect(dropTargetAt(LIST, 16)).toEqual({ id: 'b', pos: 'before' });
  });

  it('★ resolves a release in the GAP between two rows — the dead zone that ate the drop', () => {
    // 20..24 belongs to no row at all. It must still land at the a|b boundary.
    expect(dropTargetAt(LIST, 22)).toEqual({ id: 'b', pos: 'before' });
    expect(dropTargetAt(LIST, 46)).toEqual({ id: 'c', pos: 'before' });
  });

  it('★ resolves a release PAST the last row to the end of the list', () => {
    expect(dropTargetAt(LIST, 200)).toEqual({ id: 'c', pos: 'after' });
    expect(dropTargetAt(LIST, 60)).toEqual({ id: 'c', pos: 'after' }); // c's own lower half
  });

  it('★ resolves a release ABOVE the list to the top', () => {
    expect(dropTargetAt(LIST, -50)).toEqual({ id: 'a', pos: 'before' });
  });

  it('handles a single row by halves', () => {
    const one = rows(['only', 0, 20]);
    expect(dropTargetAt(one, 4)).toEqual({ id: 'only', pos: 'before' });
    expect(dropTargetAt(one, 16)).toEqual({ id: 'only', pos: 'after' });
  });

  it('reads only the rows it is given, so a virtualised window is enough', () => {
    // The window holds rows 40..42 of a long list; the spacers stand in for the rest.
    const win = rows(['r40', 800, 820], ['r41', 824, 844]);
    expect(dropTargetAt(win, 806)).toEqual({ id: 'r40', pos: 'before' });
    expect(dropTargetAt(win, 900)).toEqual({ id: 'r41', pos: 'after' });
  });
});

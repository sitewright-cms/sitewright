import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildGrid,
  tableContext,
  runTableOp,
  tableRows,
  setColumnWidth,
  setRowHeight,
  setTableWidth,
  columnWidth,
} from '../src/lib/rich-table-dom';

/** Mount `html` in a contentEditable and put the caret inside the element matching `caret`. */
function mount(html: string, caret = 'td, th'): HTMLElement {
  document.body.innerHTML = '';
  const editable = document.createElement('div');
  editable.contentEditable = 'true';
  editable.innerHTML = html;
  document.body.appendChild(editable);
  const target = editable.querySelector(caret);
  if (target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return editable;
}

/** Compact readable shape of a table: one string per row, cells joined by `|`, spans marked. */
function shape(editable: HTMLElement): string[] {
  const table = editable.querySelector('table')!;
  return tableRows(table).map((tr) =>
    Array.from(tr.children)
      .map((c) => {
        const cs = c.getAttribute('colspan');
        const rs = c.getAttribute('rowspan');
        const marks = `${cs ? `+c${cs}` : ''}${rs ? `+r${rs}` : ''}`;
        return `${c.tagName.toLowerCase()}:${c.textContent?.trim() ?? ''}${marks}`;
      })
      .join('|'),
  );
}

const SIMPLE =
  '<table><thead><tr><th>H1</th><th>H2</th></tr></thead>' +
  '<tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildGrid', () => {
  it('maps a plain table to coordinates', () => {
    const el = mount(SIMPLE);
    const grid = buildGrid(el.querySelector('table')!);
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(3);
    expect(grid.slots[1]![0]!.textContent).toBe('a');
    expect(grid.anchors.get(grid.slots[2]![1]!)).toEqual({ r: 2, c: 1 });
  });

  it('places a colspan cell across every column it covers', () => {
    const el = mount('<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>');
    const grid = buildGrid(el.querySelector('table')!);
    expect(grid.slots[0]![0]).toBe(grid.slots[0]![1]);
    expect(grid.width).toBe(2);
  });

  it('places a rowspan cell into the rows below it, shifting its neighbours right', () => {
    const el = mount('<table><tbody><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>');
    const grid = buildGrid(el.querySelector('table')!);
    expect(grid.slots[1]![0]!.textContent).toBe('tall');
    expect(grid.slots[1]![1]!.textContent).toBe('c'); // 'c' is the SECOND column, not the first
  });

  it('ignores a table nested inside a cell', () => {
    const el = mount('<table><tbody><tr><td><table><tbody><tr><td>inner</td></tr></tbody></table></td></tr></tbody></table>');
    expect(tableRows(el.querySelector('table')!)).toHaveLength(1);
  });
});

describe('tableContext', () => {
  it('finds the caret’s cell and its coordinates', () => {
    const el = mount(SIMPLE, 'tbody tr:nth-child(2) td:nth-child(2)');
    const ctx = tableContext(el)!;
    expect(ctx.cell.textContent).toBe('d');
    expect([ctx.r, ctx.c]).toEqual([2, 1]);
  });
  it('returns null when the caret is outside any table', () => {
    const el = mount('<p>plain</p>', 'p');
    expect(tableContext(el)).toBeNull();
  });
  it('returns null when there is no selection at all', () => {
    const el = mount(SIMPLE);
    window.getSelection()!.removeAllRanges();
    expect(tableContext(el)).toBeNull();
  });
});

describe('insert row', () => {
  it('inserts above the caret’s row, in the same section', () => {
    const el = mount(SIMPLE, 'tbody tr:first-child td');
    expect(runTableOp(el, 'row-above')).toBe(true);
    expect(shape(el)).toEqual(['th:H1|th:H2', 'td:|td:', 'td:a|td:b', 'td:c|td:d']);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('inserts below the caret’s row', () => {
    const el = mount(SIMPLE, 'tbody tr:first-child td');
    expect(runTableOp(el, 'row-below')).toBe(true);
    expect(shape(el)).toEqual(['th:H1|th:H2', 'td:a|td:b', 'td:|td:', 'td:c|td:d']);
  });

  it('keeps a header row’s cells as <th> when inserting into it', () => {
    const el = mount(SIMPLE, 'thead th');
    runTableOp(el, 'row-above');
    expect(shape(el)[0]).toBe('th:|th:');
    expect(el.querySelectorAll('thead tr')).toHaveLength(2);
  });

  it('stretches a rowspan that crosses the insertion boundary instead of cutting it', () => {
    const el = mount(
      '<table><tbody><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
      'tbody tr:first-child td:nth-child(2)',
    );
    runTableOp(el, 'row-below');
    expect(shape(el)).toEqual(['td:tall+r3|td:b', 'td:', 'td:c']);
  });
});

describe('insert column', () => {
  it('inserts to the left of the caret’s column in every row', () => {
    const el = mount(SIMPLE, 'tbody tr:first-child td:nth-child(2)');
    expect(runTableOp(el, 'col-left')).toBe(true);
    expect(shape(el)).toEqual(['th:H1|th:|th:H2', 'td:a|td:|td:b', 'td:c|td:|td:d']);
  });

  it('inserts to the right of the caret’s column', () => {
    const el = mount(SIMPLE, 'tbody tr:first-child td:first-child');
    runTableOp(el, 'col-right');
    expect(shape(el)).toEqual(['th:H1|th:|th:H2', 'td:a|td:|td:b', 'td:c|td:|td:d']);
  });

  it('stretches a colspan that crosses the boundary rather than splitting it', () => {
    const el = mount(
      '<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>',
      'tbody tr:nth-child(2) td:first-child',
    );
    runTableOp(el, 'col-right');
    expect(shape(el)).toEqual(['td:wide+c3', 'td:a|td:|td:b']);
  });
});

describe('delete row / column', () => {
  it('removes the caret’s row', () => {
    const el = mount(SIMPLE, 'tbody tr:first-child td');
    expect(runTableOp(el, 'row-delete')).toBe(true);
    expect(shape(el)).toEqual(['th:H1|th:H2', 'td:c|td:d']);
  });

  it('drops an emptied section with the row', () => {
    const el = mount(SIMPLE, 'thead th');
    runTableOp(el, 'row-delete');
    expect(el.querySelector('thead')).toBeNull();
  });

  it('shortens a rowspan that crossed the deleted row', () => {
    const el = mount(
      '<table><tbody><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
      'tbody tr:nth-child(2) td',
    );
    runTableOp(el, 'row-delete');
    expect(shape(el)).toEqual(['td:tall|td:b']);
  });

  it('re-anchors a spanning cell that started in the deleted row', () => {
    const el = mount(
      '<table><tbody><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
      'tbody tr:first-child td:nth-child(2)',
    );
    runTableOp(el, 'row-delete');
    expect(shape(el)).toEqual(['td:tall|td:c']); // content preserved, span reduced to 1
  });

  it('removes the caret’s column', () => {
    const el = mount(SIMPLE, 'tbody tr:first-child td:nth-child(2)');
    expect(runTableOp(el, 'col-delete')).toBe(true);
    expect(shape(el)).toEqual(['th:H1', 'td:a', 'td:c']);
  });

  it('narrows a colspan rather than deleting the merged cell', () => {
    const el = mount(
      '<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>',
      'tbody tr:nth-child(2) td:first-child',
    );
    runTableOp(el, 'col-delete');
    expect(shape(el)).toEqual(['td:wide', 'td:b']);
  });

  it('removes the matching <col> so a colgroup stays aligned', () => {
    const el = mount(
      '<table><colgroup><col style="width: 40px"><col style="width: 80px"></colgroup>' +
        '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
      'td:first-child',
    );
    runTableOp(el, 'col-delete');
    const cols = el.querySelectorAll('col');
    expect(cols).toHaveLength(1);
    expect(cols[0]!.getAttribute('style')).toContain('80px');
  });

  it('deletes the whole table when the last row or column goes', () => {
    const one = mount('<table><tbody><tr><td>only</td></tr></tbody></table>', 'td');
    runTableOp(one, 'row-delete');
    expect(one.querySelector('table')).toBeNull();

    const two = mount('<table><tbody><tr><td>only</td></tr></tbody></table>', 'td');
    runTableOp(two, 'col-delete');
    expect(two.querySelector('table')).toBeNull();
  });
});

describe('header row toggle', () => {
  it('turns a header row into body cells and folds it into tbody', () => {
    const el = mount(SIMPLE, 'tbody td');
    expect(runTableOp(el, 'header-row')).toBe(true);
    expect(el.querySelector('thead')).toBeNull();
    expect(shape(el)[0]).toBe('td:H1|td:H2');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('promotes the first body row into a thead with scoped <th>s', () => {
    const el = mount('<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>', 'td');
    runTableOp(el, 'header-row');
    expect(el.querySelectorAll('thead th')).toHaveLength(2);
    expect(el.querySelector('thead th')!.getAttribute('scope')).toBe('col');
    expect(shape(el)).toEqual(['th:a|th:b', 'td:c|td:d']);
  });

  it('round-trips', () => {
    const el = mount(SIMPLE, 'tbody td');
    runTableOp(el, 'header-row');
    runTableOp(el, 'header-row');
    expect(shape(el)).toEqual(['th:H1|th:H2', 'td:a|td:b', 'td:c|td:d']);
  });
});

describe('merge and split', () => {
  function selectCells(el: HTMLElement, from: string, to: string): void {
    const range = document.createRange();
    range.setStart(el.querySelector(from)!, 0);
    range.setEnd(el.querySelector(to)!, 1);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it('merges a selected run of cells into the top-left one, keeping their text', () => {
    const el = mount(SIMPLE);
    selectCells(el, 'tbody tr:first-child td:first-child', 'tbody tr:first-child td:nth-child(2)');
    expect(runTableOp(el, 'merge-cells')).toBe(true);
    expect(shape(el)[1]).toBe('td:a b+c2');
  });

  it('is a no-op with only one cell selected', () => {
    const el = mount(SIMPLE, 'tbody td');
    expect(runTableOp(el, 'merge-cells')).toBe(false);
  });

  it('splits a merged cell back into single slots', () => {
    const el = mount('<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>', 'td');
    expect(runTableOp(el, 'split-cell')).toBe(true);
    expect(shape(el)).toEqual(['td:wide|td:', 'td:a|td:b']);
  });

  it('splits a rowspan back into the rows it covered', () => {
    const el = mount('<table><tbody><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>', 'td');
    runTableOp(el, 'split-cell');
    expect(shape(el)).toEqual(['td:tall|td:b', 'td:|td:c']);
  });

  it('is a no-op on a cell that spans nothing', () => {
    const el = mount(SIMPLE, 'tbody td');
    expect(runTableOp(el, 'split-cell')).toBe(false);
  });
});

describe('delete table and reset sizes', () => {
  it('removes the table', () => {
    const el = mount(`<p>before</p>${SIMPLE}`, 'td');
    expect(runTableOp(el, 'table-delete')).toBe(true);
    expect(el.querySelector('table')).toBeNull();
    expect(el.textContent).toContain('before');
  });

  it('strips dragged sizes but keeps other allowed styles', () => {
    const el = mount(
      '<table style="width: 400px; table-layout: fixed"><tbody>' +
        '<tr style="height: 40px"><td style="width: 120px; text-align: center">a</td></tr></tbody></table>',
      'td',
    );
    expect(runTableOp(el, 'reset-sizes')).toBe(true);
    const table = el.querySelector('table')!;
    expect(table.hasAttribute('style')).toBe(false);
    expect(el.querySelector('tr')!.hasAttribute('style')).toBe(false);
    expect(el.querySelector('td')!.getAttribute('style')).toBe('text-align: center');
  });
});

describe('unknown ops and missing context', () => {
  it('returns false for an id it does not implement', () => {
    const el = mount(SIMPLE, 'td');
    expect(runTableOp(el, 'nope')).toBe(false);
  });
  it('returns false when the caret is not in a table', () => {
    const el = mount('<p>x</p>', 'p');
    expect(runTableOp(el, 'row-above')).toBe(false);
  });
});

describe('sizing helpers', () => {
  it('writes a column width onto the first row’s cell and pins the layout', () => {
    const el = mount(SIMPLE);
    const table = el.querySelector('table')!;
    setColumnWidth(table, 1, 180);
    expect(table.getAttribute('style')).toContain('table-layout: fixed');
    expect(el.querySelector('thead th:nth-child(2)')!.getAttribute('style')).toContain('width: 180px');
  });

  it('clamps a column width to the minimum and the ceiling', () => {
    const el = mount(SIMPLE);
    const table = el.querySelector('table')!;
    setColumnWidth(table, 0, 2);
    expect(el.querySelector('thead th')!.getAttribute('style')).toContain('width: 32px');
    setColumnWidth(table, 0, 99999);
    expect(el.querySelector('thead th')!.getAttribute('style')).toContain('width: 4000px');
  });

  it('writes a row height and a table width', () => {
    const el = mount(SIMPLE);
    const table = el.querySelector('table')!;
    setRowHeight(table, 1, 48);
    setTableWidth(table, 520);
    expect(el.querySelector('tbody tr')!.getAttribute('style')).toContain('height: 48px');
    expect(table.getAttribute('style')).toContain('width: 520px');
  });

  it('reads a declared column width back', () => {
    const el = mount(SIMPLE);
    const table = el.querySelector('table')!;
    setColumnWidth(table, 0, 140);
    expect(columnWidth(table, 0)).toBe(140);
  });

  it('ignores an out-of-range column or row index', () => {
    const el = mount(SIMPLE);
    const table = el.querySelector('table')!;
    setColumnWidth(table, 9, 100);
    setRowHeight(table, 9, 100);
    expect(table.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('caret survival across ops', () => {
  /** The cell the selection currently sits in, or null. */
  function caretCell(el: HTMLElement): string | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: HTMLElement | null =
      sel.getRangeAt(0).startContainer.nodeType === 1
        ? (sel.getRangeAt(0).startContainer as HTMLElement)
        : sel.getRangeAt(0).startContainer.parentElement;
    while (node && node !== el) {
      if (node.tagName === 'TD' || node.tagName === 'TH') return node.textContent;
      node = node.parentElement;
    }
    return null;
  }

  it('keeps the caret inside the table after deleting the row it was in', () => {
    // Delete the row you are standing in and the caret is left on detached nodes — the toolbar reverts
    // to "insert a table" and the next op is unreachable, because the selection never CHANGES so nothing
    // recomputes. Clicking the same spot does not recover it.
    const el = mount(SIMPLE, 'tbody tr:first-child td');
    runTableOp(el, 'row-delete');
    expect(tableContext(el)).not.toBeNull();
    expect(caretCell(el)).toBe('c'); // the row that took its place
  });

  it('keeps the caret inside the table after deleting the column it was in', () => {
    const el = mount(SIMPLE, 'tbody tr:first-child td:nth-child(2)');
    runTableOp(el, 'col-delete');
    expect(tableContext(el)).not.toBeNull();
    expect(caretCell(el)).toBe('a');
  });

  it('leaves a surviving caret exactly where the author put it', () => {
    const el = mount(SIMPLE, 'tbody tr:nth-child(2) td:nth-child(2)');
    runTableOp(el, 'row-above');
    expect(caretCell(el)).toBe('d'); // not yanked to the start of the table
  });

  it('does not try to place a caret after the table is deleted', () => {
    const el = mount(SIMPLE, 'tbody td');
    expect(runTableOp(el, 'table-delete')).toBe(true);
    expect(tableContext(el)).toBeNull();
  });

  it('clamps to the last surviving cell when the deleted row was the last one', () => {
    const el = mount(SIMPLE, 'tbody tr:nth-child(2) td:nth-child(2)');
    runTableOp(el, 'row-delete');
    expect(tableContext(el)).not.toBeNull();
    expect(caretCell(el)).toBe('b'); // clamped up into the row above
  });
});

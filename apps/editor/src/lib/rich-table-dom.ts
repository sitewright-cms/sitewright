// Table structure editing for the rich-text `contentEditable` surfaces. The OPERATION MANIFEST lives in
// @sitewright/blocks (`RICH_TABLE_OPS`) so both toolbars offer the same menu; this module is the DOM half
// for the editor SPA. The on-page bridge (preview-bridge.ts) mirrors these same ops in vanilla JS for the
// sandboxed-preview realm — keep the two in step.
//
// Everything is driven off a GRID MODEL rather than the raw `<tr>`/`<td>` tree, because `colspan`/`rowspan`
// mean the two disagree: the third `<td>` of a row is not the third COLUMN once anything above it spans. All
// the ops address (row, column) coordinates and map back to elements through that model, which is what keeps
// "insert column left" from tearing a merged cell in half.
import {
  RICH_TABLE_MIN_COL,
  RICH_TABLE_MIN_ROW,
  RICH_TABLE_STARTER,
  clampTableDim,
  getStyleDecl,
  setStyleDecl,
} from '@sitewright/blocks';

type Cell = HTMLTableCellElement;

/** The grid model of one table: `slots[r][c]` is the cell OCCUPYING that coordinate (the same element
 *  appears in every slot it spans), plus each cell's anchor coordinate and the overall dimensions. */
export interface TableGrid {
  readonly rows: readonly HTMLTableRowElement[];
  readonly slots: readonly (Cell | undefined)[][];
  readonly anchors: ReadonlyMap<Cell, { r: number; c: number }>;
  readonly width: number;
  readonly height: number;
}

/** Where the caret currently is, in grid terms. */
export interface TableContext {
  readonly table: HTMLTableElement;
  readonly cell: Cell;
  readonly row: HTMLTableRowElement;
  readonly grid: TableGrid;
  readonly r: number;
  readonly c: number;
}

const isCell = (n: Element): n is Cell => n.tagName === 'TD' || n.tagName === 'TH';
const span = (cell: Cell, attr: 'colspan' | 'rowspan'): number => {
  const n = parseInt(cell.getAttribute(attr) ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
/** Write a span attribute, dropping it at 1 so the markup stays as clean as what the toolbar inserts. */
function setSpan(cell: Cell, attr: 'colspan' | 'rowspan', n: number): void {
  if (n > 1) cell.setAttribute(attr, String(n));
  else cell.removeAttribute(attr);
}

/** Every `<tr>` belonging to `table` itself (not to a table nested inside one of its cells). */
export function tableRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table);
}

/** Build the grid model. Cells are placed into the first free slot of their row, then occupy their full
 *  colspan × rowspan rectangle — the standard HTML table layout algorithm, minus the parts (like column
 *  groups) that cannot change which element sits at a coordinate. */
export function buildGrid(table: HTMLTableElement): TableGrid {
  const rows = tableRows(table);
  const slots: (Cell | undefined)[][] = rows.map(() => []);
  const anchors = new Map<Cell, { r: number; c: number }>();
  rows.forEach((tr, r) => {
    let c = 0;
    for (const child of Array.from(tr.children)) {
      if (!(child instanceof Element) || !isCell(child)) continue;
      while (slots[r]![c]) c += 1;
      const cs = span(child, 'colspan');
      const rs = span(child, 'rowspan');
      anchors.set(child, { r, c });
      for (let dr = 0; dr < rs && r + dr < rows.length; dr += 1) {
        for (let dc = 0; dc < cs; dc += 1) slots[r + dr]![c + dc] = child;
      }
      c += cs;
    }
  });
  const width = slots.reduce((m, row) => Math.max(m, row.length), 0);
  return { rows, slots, anchors, width, height: rows.length };
}

/** Walk up from `node` to the enclosing `<td>`/`<th>` inside `editable`, or null. */
function cellAbove(node: Node | null, editable: HTMLElement): Cell | null {
  if (!node || !editable.contains(node)) return null;
  let el: HTMLElement | null = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  while (el && el !== editable) {
    if (isCell(el as Element)) return el as Cell;
    el = el.parentElement;
  }
  return null;
}

/** The `<td>`/`<th>` the selection starts in, within `editable`, or null.
 *
 *  `startContainer` FIRST, not `commonAncestorContainer`: dragging across two cells puts the common
 *  ancestor on the `<tr>`, which is in no cell at all — so keying off it would report "not in a table"
 *  exactly when the author has selected the cells they want to merge. */
export function currentCell(editable: HTMLElement): Cell | null {
  const sel = editable.ownerDocument.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return cellAbove(range.startContainer, editable) ?? cellAbove(range.commonAncestorContainer, editable);
}

/** The caret's full table context, or null when the selection is not inside a table in `editable`. Drives
 *  BOTH the toolbar button's active state and every op below. */
export function tableContext(editable: HTMLElement): TableContext | null {
  const cell = currentCell(editable);
  const table = cell?.closest('table');
  if (!cell || !table || !editable.contains(table)) return null;
  const grid = buildGrid(table);
  const at = grid.anchors.get(cell);
  if (!at) return null;
  const row = cell.closest('tr');
  if (!row) return null;
  return { table, cell, row, grid, r: at.r, c: at.c };
}

/** Replace a cell with the same cell under a different tag (td ⇄ th), keeping attributes and children. */
function retagCell(cell: Cell, tag: 'td' | 'th'): Cell {
  if (cell.tagName.toLowerCase() === tag) return cell;
  const next = cell.ownerDocument.createElement(tag) as Cell;
  for (const attr of Array.from(cell.attributes)) next.setAttribute(attr.name, attr.value);
  while (cell.firstChild) next.appendChild(cell.firstChild);
  cell.replaceWith(next);
  return next;
}

/** A fresh empty cell matching `like`'s tag — an inserted row/column should not silently change a header
 *  row into body cells. `<br>` inside so the cell has a caret position and does not collapse to nothing. */
function newCell(doc: Document, like: Cell): Cell {
  const cell = doc.createElement(like.tagName.toLowerCase()) as Cell;
  if (like.tagName === 'TH' && like.hasAttribute('scope')) cell.setAttribute('scope', like.getAttribute('scope')!);
  cell.appendChild(doc.createElement('br'));
  return cell;
}

/** Insert `cell` into `row` at grid column `col`, using the grid to find the right DOM position (the row's
 *  own cells are not in column order once anything above it spans rows). */
function insertAtColumn(row: HTMLTableRowElement, grid: TableGrid, col: number, cell: Cell): void {
  for (const child of Array.from(row.children)) {
    if (!(child instanceof Element) || !isCell(child)) continue;
    const at = grid.anchors.get(child);
    if (at && at.c >= col) {
      row.insertBefore(cell, child);
      return;
    }
  }
  row.appendChild(cell);
}

/** The nearest section (`thead`/`tbody`/`tfoot`) a row lives in, or the table itself. */
const sectionOf = (row: HTMLTableRowElement): Element => row.parentElement ?? row;

function insertRow(ctx: TableContext, side: 'above' | 'below'): void {
  const { table, grid, r } = ctx;
  const doc = table.ownerDocument;
  // The boundary the new row opens: `above` splits before row r, `below` after it. A cell that spans ACROSS
  // that boundary is stretched by one instead of being cut, which is what keeps a merged cell merged.
  const upper = side === 'above' ? r - 1 : r;
  const lower = upper + 1;
  const tr = doc.createElement('tr');
  const stretched = new Set<Cell>();
  for (let c = 0; c < grid.width; c += 1) {
    const above = upper >= 0 ? grid.slots[upper]?.[c] : undefined;
    const below = lower < grid.height ? grid.slots[lower]?.[c] : undefined;
    if (above && above === below) {
      if (!stretched.has(above)) {
        stretched.add(above);
        setSpan(above, 'rowspan', span(above, 'rowspan') + 1);
      }
      continue; // the stretched cell already covers this column in the new row
    }
    // Model the new cell on whatever occupies this column in the reference row, so an inserted row keeps a
    // header row's `<th>`s as `<th>`s. Every new cell spans exactly one slot.
    tr.appendChild(newCell(doc, grid.slots[r]?.[c] ?? ctx.cell));
  }
  const ref = grid.rows[r]!;
  if (side === 'above') sectionOf(ref).insertBefore(tr, ref);
  else sectionOf(ref).insertBefore(tr, ref.nextSibling);
}

function insertColumn(ctx: TableContext, side: 'left' | 'right'): void {
  const { grid, c, cell } = ctx;
  const doc = ctx.table.ownerDocument;
  // Column boundary: `left` opens before column c, `right` after the cell's full colspan.
  const boundary = side === 'left' ? c : c + span(cell, 'colspan');
  const stretched = new Set<Cell>();
  grid.rows.forEach((row, r) => {
    const left = boundary > 0 ? grid.slots[r]?.[boundary - 1] : undefined;
    const right = boundary < grid.width ? grid.slots[r]?.[boundary] : undefined;
    if (left && left === right) {
      if (!stretched.has(left)) {
        stretched.add(left);
        setSpan(left, 'colspan', span(left, 'colspan') + 1);
      }
      return;
    }
    const model = grid.slots[r]?.[Math.min(boundary, grid.width - 1)] ?? grid.slots[r]?.[0];
    // A row that is entirely covered by rowspans from above owns no cell to model or to insert before.
    if (!model) return;
    insertAtColumn(row, grid, boundary, newCell(doc, model));
  });
}

function deleteRow(ctx: TableContext): void {
  const { table, grid, r } = ctx;
  if (grid.height <= 1) {
    table.remove();
    return;
  }
  const row = grid.rows[r]!;
  const next = grid.rows[r + 1];
  const handled = new Set<Cell>();
  for (let c = 0; c < grid.width; c += 1) {
    const cell = grid.slots[r]?.[c];
    if (!cell || handled.has(cell)) continue;
    handled.add(cell);
    const at = grid.anchors.get(cell)!;
    const rs = span(cell, 'rowspan');
    if (at.r === r && rs > 1 && next) {
      // Anchored in the row being removed but still spanning below it: re-anchor one row down rather than
      // taking its content with the row.
      setSpan(cell, 'rowspan', rs - 1);
      insertAtColumn(next, grid, at.c, cell);
    } else if (at.r < r) {
      setSpan(cell, 'rowspan', rs - 1); // spans across from above → one row shorter
    }
  }
  const section = sectionOf(row);
  row.remove();
  if (section !== table && section.children.length === 0) section.remove();
}

function deleteColumn(ctx: TableContext): void {
  const { table, grid, c } = ctx;
  if (grid.width <= 1) {
    table.remove();
    return;
  }
  const handled = new Set<Cell>();
  for (let r = 0; r < grid.height; r += 1) {
    const cell = grid.slots[r]?.[c];
    if (!cell || handled.has(cell)) continue;
    handled.add(cell);
    const cs = span(cell, 'colspan');
    if (cs > 1) setSpan(cell, 'colspan', cs - 1);
    else cell.remove();
  }
  // A `<colgroup>` carries per-column widths, so it has to lose the same column.
  const col = Array.from(table.querySelectorAll('colgroup > col'))[c];
  col?.remove();
  if (tableRows(table).every((tr) => tr.children.length === 0)) table.remove();
}

function toggleHeaderRow(ctx: TableContext): void {
  const { table, grid } = ctx;
  const first = grid.rows[0];
  if (!first) return;
  const doc = table.ownerDocument;
  const cells = Array.from(first.children).filter((n): n is Cell => n instanceof Element && isCell(n));
  const isHeader = cells.length > 0 && cells.every((x) => x.tagName === 'TH');
  if (isHeader) {
    for (const x of cells) retagCell(x, 'td').removeAttribute('scope');
    let body = table.querySelector(':scope > tbody');
    if (!body) {
      body = doc.createElement('tbody');
      table.insertBefore(body, table.firstChild);
    }
    const head = first.parentElement;
    body.insertBefore(first, body.firstChild);
    if (head && head !== body && head.tagName === 'THEAD' && head.children.length === 0) head.remove();
  } else {
    for (const x of cells) retagCell(x, 'th').setAttribute('scope', 'col');
    let head = table.querySelector(':scope > thead');
    if (!head) {
      head = doc.createElement('thead');
      table.insertBefore(head, table.firstChild);
    }
    const body = first.parentElement;
    head.appendChild(first);
    if (body && body !== head && body.children.length === 0) body.remove();
  }
}

/** The cells of `table` the current selection touches — a caret gives one, a drag across cells gives the
 *  run between them. Used by merge. */
export function selectedCells(editable: HTMLElement, table: HTMLTableElement): Cell[] {
  const sel = editable.ownerDocument.defaultView?.getSelection();
  const all = Array.from(table.querySelectorAll('td, th')).filter(
    (x): x is Cell => x.closest('table') === table,
  );
  if (!sel || sel.rangeCount === 0) return [];
  const range = sel.getRangeAt(0);
  const hit = all.filter((x) => range.intersectsNode(x));
  if (hit.length > 1) return hit;
  const one = currentCell(editable);
  return one ? [one] : [];
}

/** Grow a selection rectangle until every cell that overlaps it is fully inside — a merge that cut a
 *  spanning cell in half would produce a table no browser can lay out. */
function closedRect(grid: TableGrid, cells: readonly Cell[]): { r0: number; c0: number; r1: number; c1: number } | null {
  let r0 = Infinity;
  let c0 = Infinity;
  let r1 = -1;
  let c1 = -1;
  for (const cell of cells) {
    const at = grid.anchors.get(cell);
    if (!at) continue;
    r0 = Math.min(r0, at.r);
    c0 = Math.min(c0, at.c);
    r1 = Math.max(r1, at.r + span(cell, 'rowspan') - 1);
    c1 = Math.max(c1, at.c + span(cell, 'colspan') - 1);
  }
  if (r1 < 0) return null;
  for (let pass = 0; pass < grid.width + grid.height; pass += 1) {
    let grew = false;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const cell = grid.slots[r]?.[c];
        const at = cell ? grid.anchors.get(cell) : undefined;
        if (!cell || !at) continue;
        const nr1 = at.r + span(cell, 'rowspan') - 1;
        const nc1 = at.c + span(cell, 'colspan') - 1;
        if (at.r < r0) { r0 = at.r; grew = true; }
        if (at.c < c0) { c0 = at.c; grew = true; }
        if (nr1 > r1) { r1 = nr1; grew = true; }
        if (nc1 > c1) { c1 = nc1; grew = true; }
      }
    }
    if (!grew) break;
  }
  return { r0, c0, r1, c1 };
}

function mergeCells(editable: HTMLElement, ctx: TableContext): boolean {
  const picked = selectedCells(editable, ctx.table);
  if (picked.length < 2) return false;
  const rect = closedRect(ctx.grid, picked);
  if (!rect) return false;
  const anchor = ctx.grid.slots[rect.r0]?.[rect.c0];
  if (!anchor) return false;
  const absorbed = new Set<Cell>();
  for (let r = rect.r0; r <= rect.r1; r += 1) {
    for (let c = rect.c0; c <= rect.c1; c += 1) {
      const cell = ctx.grid.slots[r]?.[c];
      if (cell && cell !== anchor) absorbed.add(cell);
    }
  }
  if (absorbed.size === 0) return false;
  for (const cell of absorbed) {
    // Keep the words: a merge that silently discarded the other cells' content would be a data-loss bug
    // dressed up as a formatting command.
    while (cell.firstChild) {
      const node = cell.firstChild;
      if (node.nodeType === 3 && !node.textContent?.trim()) node.remove();
      else {
        anchor.appendChild(anchor.ownerDocument.createTextNode(' '));
        anchor.appendChild(node);
      }
    }
    cell.remove();
  }
  setSpan(anchor, 'colspan', rect.c1 - rect.c0 + 1);
  setSpan(anchor, 'rowspan', rect.r1 - rect.r0 + 1);
  return true;
}

function splitCell(ctx: TableContext): boolean {
  const { cell, grid, r, c } = ctx;
  const cs = span(cell, 'colspan');
  const rs = span(cell, 'rowspan');
  if (cs === 1 && rs === 1) return false;
  setSpan(cell, 'colspan', 1);
  setSpan(cell, 'rowspan', 1);
  const doc = ctx.table.ownerDocument;
  for (let dr = 0; dr < rs; dr += 1) {
    const row = grid.rows[r + dr];
    if (!row) continue;
    for (let dc = 0; dc < cs; dc += 1) {
      if (dr === 0 && dc === 0) continue; // the cell itself keeps the top-left slot
      insertAtColumn(row, grid, c + dc, newCell(doc, cell));
    }
  }
  return true;
}

/** Strip every dragged size from a table — the escape hatch when column widths have been dragged into a
 *  corner. Removes the sizing declarations only; any other allowed style on the element stays. */
function resetSizes(table: HTMLTableElement): void {
  const targets: HTMLElement[] = [table, ...Array.from(table.querySelectorAll<HTMLElement>('col, tr, td, th'))];
  for (const el of targets) {
    let style = el.getAttribute('style');
    for (const prop of ['width', 'height', 'table-layout']) style = setStyleDecl(style, prop, null);
    if (style) el.setAttribute('style', style);
    else el.removeAttribute('style');
  }
}

/** Collapse the selection into the start of `cell`. */
function placeCaret(editable: HTMLElement, cell: Cell): void {
  const doc = cell.ownerDocument;
  const sel = doc.defaultView?.getSelection();
  if (!sel) return;
  editable.focus();
  const range = doc.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Put the caret back into the table after an op that removed the cell it was in.
 *
 * Without this the toolbar silently reverts to "insert a table" the moment you delete the row or column
 * you were standing in — the caret is left pointing at detached nodes, so the next op is unreachable and
 * even clicking the same spot does not recover it (the selection never CHANGES, so nothing recomputes).
 * A caret that survived is left exactly where the author put it.
 */
function restoreCaret(editable: HTMLElement, table: HTMLTableElement, r: number, c: number): void {
  if (!table.isConnected || tableContext(editable)) return;
  const grid = buildGrid(table);
  if (grid.height === 0 || grid.width === 0) return;
  const cell =
    grid.slots[Math.min(r, grid.height - 1)]?.[Math.min(c, grid.width - 1)] ?? grid.slots[0]?.[0];
  if (cell) placeCaret(editable, cell);
}

/**
 * Run one table operation by its `RICH_TABLE_OPS` id against the caret's table. Returns true when the
 * document changed (the caller emits + refreshes the toolbar) and false for a no-op — "merge" with a single
 * cell selected, "split" on a cell that spans nothing, or a caret outside any table.
 */
export function runTableOp(editable: HTMLElement, opId: string): boolean {
  const ctx = tableContext(editable);
  if (!ctx) return false;
  const changed = applyTableOp(editable, ctx, opId);
  // `table-delete` has nowhere to put a caret; every other op keeps the author inside the table so the
  // menu stays usable for a second command.
  if (changed && opId !== 'table-delete') restoreCaret(editable, ctx.table, ctx.r, ctx.c);
  return changed;
}

function applyTableOp(editable: HTMLElement, ctx: TableContext, opId: string): boolean {
  switch (opId) {
    case 'row-above':
      insertRow(ctx, 'above');
      return true;
    case 'row-below':
      insertRow(ctx, 'below');
      return true;
    case 'col-left':
      insertColumn(ctx, 'left');
      return true;
    case 'col-right':
      insertColumn(ctx, 'right');
      return true;
    case 'row-delete':
      deleteRow(ctx);
      return true;
    case 'col-delete':
      deleteColumn(ctx);
      return true;
    case 'header-row':
      toggleHeaderRow(ctx);
      return true;
    case 'merge-cells':
      return mergeCells(editable, ctx);
    case 'split-cell':
      return splitCell(ctx);
    case 'reset-sizes':
      resetSizes(ctx.table);
      return true;
    case 'table-delete':
      ctx.table.remove();
      return true;
    default:
      return false;
  }
}

/** Insert the starter table at the caret. Kept here (rather than in rich-dom) so every table concern lives
 *  in one module; `rich-dom` re-exports it for the toolbar's existing call site. */
export function insertStarterTable(editable: HTMLElement): void {
  editable.focus();
  try {
    editable.ownerDocument.execCommand('insertHTML', false, RICH_TABLE_STARTER);
  } catch {
    /* jsdom / unsupported — no-op */
  }
}

// --- Drag-to-resize ----------------------------------------------------------------------------

/**
 * Set a column's width. Widths live on the FIRST ROW's cell for that column (plus `table-layout: fixed` on
 * the table) rather than on a `<colgroup>`: a colgroup would have to be created and kept in sync with every
 * insert/delete op, where a first-row cell is already maintained by them. `table-layout: fixed` is what makes
 * the browser honour the number instead of treating it as a hint.
 */
export function setColumnWidth(table: HTMLTableElement, index: number, px: number): void {
  const grid = buildGrid(table);
  const cell = grid.slots[0]?.[index];
  const width = clampTableDim(px, RICH_TABLE_MIN_COL);
  if (!cell || width === null) return;
  table.setAttribute('style', setStyleDecl(table.getAttribute('style'), 'table-layout', 'fixed'));
  cell.setAttribute('style', setStyleDecl(cell.getAttribute('style'), 'width', `${width}px`));
}

/** Set a row's height (on the `<tr>`). */
export function setRowHeight(table: HTMLTableElement, index: number, px: number): void {
  const row = tableRows(table)[index];
  const height = clampTableDim(px, RICH_TABLE_MIN_ROW);
  if (!row || height === null) return;
  row.setAttribute('style', setStyleDecl(row.getAttribute('style'), 'height', `${height}px`));
}

/** Set the whole table's width. */
export function setTableWidth(table: HTMLTableElement, px: number): void {
  const width = clampTableDim(px, RICH_TABLE_MIN_COL * 2);
  if (width === null) return;
  table.setAttribute('style', setStyleDecl(table.getAttribute('style'), 'width', `${width}px`));
}

/** The current width of a column, read back from the first row's cell (or measured), for a drag start. */
export function columnWidth(table: HTMLTableElement, index: number): number {
  const grid = buildGrid(table);
  const cell = grid.slots[0]?.[index];
  if (!cell) return RICH_TABLE_MIN_COL;
  const declared = parseFloat(getStyleDecl(cell.getAttribute('style'), 'width'));
  if (Number.isFinite(declared) && declared > 0) return declared;
  return cell.getBoundingClientRect().width || RICH_TABLE_MIN_COL;
}

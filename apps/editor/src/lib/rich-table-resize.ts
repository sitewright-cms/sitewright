// Drag-to-resize for tables inside a rich-text `contentEditable`: column boundaries, row boundaries, and
// the table's own right edge. Imperative (a body-level overlay + direct DOM writes during the drag) so a
// drag never triggers a React re-render — the same shape as `image-resize.ts`, and mirrored in vanilla JS
// by the on-page bridge (preview-bridge.ts).
//
// Sizes are written as inline `width`/`height`, which the sanitizer allows on table elements ONLY and
// gates to a bounded px/% literal (RICH_TABLE_SIZE_RE). A dragged width is an arbitrary number, so it is
// the one thing the toolbars cannot express as a utility class.
import { RICH_TABLE_GRIP, RICH_TABLE_MIN_COL, RICH_TABLE_MIN_ROW, getStyleDecl, setStyleDecl } from '@sitewright/blocks';
import { buildGrid, columnWidth, setColumnWidth, setRowHeight, setTableWidth, tableRows } from './rich-table-dom';

/** What the pointer is currently hovering a grip for. */
type Target =
  | { kind: 'col'; table: HTMLTableElement; index: number; x: number; top: number; height: number }
  | { kind: 'row'; table: HTMLTableElement; index: number; y: number; left: number; width: number }
  | { kind: 'table'; table: HTMLTableElement; x: number; top: number; height: number };

/**
 * With `table-layout: fixed`, a column with no declared width shares whatever is left over — so dragging
 * ONE column silently reflows every other one. Pinning the measured widths first (once, on the first drag)
 * makes a drag change only the column under the cursor, which is what the author is asking for.
 */
function pinColumnWidths(table: HTMLTableElement): void {
  const grid = buildGrid(table);
  const first = grid.slots[0];
  if (!first) return;
  const seen = new Set<Element>();
  for (let c = 0; c < grid.width; c += 1) {
    const cell = first[c];
    if (!cell || seen.has(cell)) continue;
    seen.add(cell);
    if (getStyleDecl(cell.getAttribute('style'), 'width')) continue; // author already sized this one
    const w = Math.round(cell.getBoundingClientRect().width);
    if (w > 0) cell.setAttribute('style', setStyleDecl(cell.getAttribute('style'), 'width', `${w}px`));
  }
  table.setAttribute('style', setStyleDecl(table.getAttribute('style'), 'table-layout', 'fixed'));
}

/** The vertical grip lines of a table: the right edge of each column, in viewport x. The LAST entry is the
 *  table's own right edge, which resizes the whole table rather than a column. */
function columnEdges(table: HTMLTableElement): { x: number; index: number }[] {
  const grid = buildGrid(table);
  const first = grid.rows[0];
  if (!first) return [];
  const out: { x: number; index: number }[] = [];
  let col = 0;
  for (const child of Array.from(first.children)) {
    if (!(child instanceof HTMLTableCellElement)) continue;
    const cs = Math.max(1, parseInt(child.getAttribute('colspan') ?? '1', 10) || 1);
    col += cs;
    out.push({ x: child.getBoundingClientRect().right, index: col - 1 });
  }
  return out;
}

/** Which grip (if any) the pointer is within `RICH_TABLE_GRIP` px of. Columns win over rows, so the corner
 *  where both meet resizes the column — the more common intent, and the row edge is reachable anywhere else
 *  along its length. */
function gripAt(editable: HTMLElement, x: number, y: number): Target | null {
  const el = editable.ownerDocument.elementFromPoint(x, y);
  const table = el instanceof Element ? (el.closest('table') as HTMLTableElement | null) : null;
  if (!table || !editable.contains(table)) return null;
  const tr = table.getBoundingClientRect();
  if (y < tr.top - RICH_TABLE_GRIP || y > tr.bottom + RICH_TABLE_GRIP) return null;

  const edges = columnEdges(table);
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    if (Math.abs(x - edge.x) > RICH_TABLE_GRIP) continue;
    // The last edge IS the table's right border — dragging it resizes the whole table.
    if (i === edges.length - 1 && Math.abs(edge.x - tr.right) <= RICH_TABLE_GRIP) {
      return { kind: 'table', table, x: edge.x, top: tr.top, height: tr.height };
    }
    return { kind: 'col', table, index: edge.index, x: edge.x, top: tr.top, height: tr.height };
  }

  const rows = tableRows(table);
  for (let i = 0; i < rows.length; i += 1) {
    const rect = rows[i]!.getBoundingClientRect();
    if (Math.abs(y - rect.bottom) <= RICH_TABLE_GRIP) {
      return { kind: 'row', table, index: i, y: rect.bottom, left: tr.left, width: tr.width };
    }
  }
  return null;
}

/**
 * Attach table resizing to `editable`. Returns a cleanup that removes the listeners + the overlay.
 * `onResize` fires once per completed drag (the field re-emits its HTML then, not on every mouse move).
 */
export function attachTableResize(editable: HTMLElement, onResize: () => void): () => void {
  const doc = editable.ownerDocument;
  let hover: Target | null = null;
  let drag: { target: Target; from: number; start: number } | null = null;

  // The grip indicator: a thin line under the cursor along the edge being dragged.
  const line = doc.createElement('div');
  line.style.cssText = 'position:fixed;z-index:2147483000;background:#6366f1;display:none;pointer-events:none;border-radius:1px';
  doc.body.appendChild(line);

  function showLine(t: Target): void {
    line.style.display = 'block';
    if (t.kind === 'row') {
      line.style.left = `${t.left}px`;
      line.style.top = `${t.y - 1}px`;
      line.style.width = `${t.width}px`;
      line.style.height = '2px';
    } else {
      line.style.left = `${t.x - 1}px`;
      line.style.top = `${t.top}px`;
      line.style.width = '2px';
      line.style.height = `${t.height}px`;
    }
  }
  function hideLine(): void {
    line.style.display = 'none';
  }

  function onMove(e: MouseEvent): void {
    if (drag) {
      const delta = (drag.target.kind === 'row' ? e.clientY : e.clientX) - drag.from;
      const { target } = drag;
      if (target.kind === 'col') setColumnWidth(target.table, target.index, drag.start + delta);
      else if (target.kind === 'row') setRowHeight(target.table, target.index, drag.start + delta);
      else setTableWidth(target.table, drag.start + delta);
      const next = { ...target } as Target;
      if (next.kind === 'row') next.y = e.clientY;
      else next.x = e.clientX;
      showLine(next);
      e.preventDefault();
      return;
    }
    hover = gripAt(editable, e.clientX, e.clientY);
    if (hover) {
      showLine(hover);
      editable.style.cursor = hover.kind === 'row' ? 'row-resize' : 'col-resize';
    } else {
      hideLine();
      editable.style.cursor = '';
    }
  }

  function onDown(e: MouseEvent): void {
    const target = gripAt(editable, e.clientX, e.clientY);
    if (!target) return;
    // Swallow the mousedown: without this the browser starts a text selection from the cell border and the
    // drag paints a selection across the table instead of resizing it.
    e.preventDefault();
    e.stopPropagation();
    if (target.kind === 'col') pinColumnWidths(target.table);
    const start =
      target.kind === 'col'
        ? columnWidth(target.table, target.index)
        : target.kind === 'row'
          ? Math.max(RICH_TABLE_MIN_ROW, tableRows(target.table)[target.index]?.getBoundingClientRect().height ?? RICH_TABLE_MIN_ROW)
          : Math.max(RICH_TABLE_MIN_COL * 2, target.table.getBoundingClientRect().width);
    drag = { target, from: target.kind === 'row' ? e.clientY : e.clientX, start };
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseup', onUp, true);
  }

  function onUp(): void {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseup', onUp, true);
    if (drag) {
      drag = null;
      onResize();
    }
    hideLine();
    editable.style.cursor = '';
  }

  editable.addEventListener('mousemove', onMove);
  editable.addEventListener('mouseleave', hideLine);
  editable.addEventListener('mousedown', onDown, true);

  return () => {
    editable.removeEventListener('mousemove', onMove);
    editable.removeEventListener('mouseleave', hideLine);
    editable.removeEventListener('mousedown', onDown, true);
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseup', onUp, true);
    editable.style.cursor = '';
    line.remove();
    hover = null;
  };
}

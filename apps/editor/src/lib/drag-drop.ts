/**
 * Drop-target geometry for the editor's drag-to-reorder lists.
 *
 * ★ Why this exists: a drop used to be accepted only while the pointer was over a ROW, because only
 * the rows called `preventDefault()` on `dragover` — and HTML5 drag and drop permits a drop only when
 * the LAST dragover was default-prevented. Every other pixel of the list was a dead zone: the `gap-1`
 * between rows, the virtualiser's padding spacers, and the empty space past the last row. Releasing
 * there produced no `drop` event at all — the browser played its snap-back animation and the row
 * returned to where it started, which reads as "the drag randomly doesn't work".
 *
 * The fix is to make the whole LIST the drop surface and resolve the pointer to a row here, so a
 * release anywhere over the list lands somewhere sensible.
 */

/** One row's vertical extent, in the pointer's coordinate space (viewport px, as getBoundingClientRect). */
export interface RowBand {
  id: string;
  top: number;
  bottom: number;
}

/** A resolved insertion point: place the dragged row before or after `id`. */
export interface DropTarget {
  id: string;
  pos: 'before' | 'after';
}

/**
 * Where a release at `clientY` should insert, given the rows currently rendered.
 *
 * Walks the rows in DOM order and takes the first whose MIDPOINT is below the pointer — so a pointer
 * inside a row resolves by half, and a pointer in the gap between two rows resolves to the boundary
 * between them (the two answers "after the upper" and "before the lower" are the same position, and
 * this returns the latter). Past the last midpoint there is no row left to sit before, so the drop
 * goes to the end. Empty list → null: there is nothing to order against.
 *
 * Virtualised lists pass only the rows in the window, which is correct — the pointer cannot be over a
 * row that is not rendered, and the spacers stand in for the rest of the scroll height.
 */
export function dropTargetAt(rows: readonly RowBand[], clientY: number): DropTarget | null {
  if (rows.length === 0) return null;
  for (const r of rows) {
    if (clientY < (r.top + r.bottom) / 2) return { id: r.id, pos: 'before' };
  }
  return { id: rows[rows.length - 1]!.id, pos: 'after' };
}

/**
 * The row bands of a list element, in DOM order. Rows opt in by carrying their id in `data-drag-row`;
 * spacers and other children are ignored, so a virtualised list needs no special case.
 *
 * `eligible` filters to the rows this particular drag may land on — the pages list refuses some
 * targets (Home is pinned, a page cannot be dropped into another locale's subtree or onto its own
 * descendant). An ineligible row is not merely "no-op on drop": it must not be considered when
 * resolving the pointer either, or the nearest legal row would never win.
 */
export function rowBands(list: Element, eligible?: (id: string) => boolean): RowBand[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-drag-row]'))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.dragRow ?? '', top: r.top, bottom: r.bottom };
    })
    .filter((b) => b.id !== '' && (eligible === undefined || eligible(b.id)));
}

/** The drop target for a drag event over `list`, resolved from the pointer's own position. */
export function dropTargetForEvent(list: Element, clientY: number, eligible?: (id: string) => boolean): DropTarget | null {
  return dropTargetAt(rowBands(list, eligible), clientY);
}

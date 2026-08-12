import { useState, type DragEvent } from 'react';

/** Anything this hook can order: a row list keyed by a stable id. */
interface Row {
  id: string;
}

/**
 * Drag-to-reorder for a keyed row list, with a keyboard path.
 *
 * Extracted from the pattern SocialProfilesEditor established, because the shop editor needs it TWICE
 * (channels, and each channel's order fields) and copying a splice-and-index dance three times is how the
 * three copies drift apart.
 *
 * HTML5 drag-and-drop is pointer-only — there is no keyboard equivalent, and a list that can only be
 * reordered with a mouse is unusable for anyone driving the editor from the keyboard. So `move()` is not a
 * nicety: it is the accessible half of the feature, surfaced as the ↑/↓ buttons every row renders.
 */
export function useReorder<T extends Row>(rows: readonly T[], onChange: (rows: T[]) => void) {
  const [dragId, setDragId] = useState<string | null>(null);

  const apply = (from: number, to: number) => {
    if (from < 0 || to < 0 || from === to || to >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };

  /** Drop `sourceId` at `targetId`'s position. */
  const reorder = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    apply(
      rows.findIndex((r) => r.id === sourceId),
      rows.findIndex((r) => r.id === targetId),
    );
  };

  /** Nudge one row by `delta` (-1 up, +1 down) — the keyboard equivalent of a drag. */
  const move = (id: string, delta: number) => {
    const from = rows.findIndex((r) => r.id === id);
    apply(from, from + delta);
  };

  /**
   * Spread onto each row's container. `stopPropagation` on drop matters for NESTED lists: an order-field
   * row sits inside a channel row, and without it a field drop would bubble up and reorder the channels too.
   */
  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      setDragId(id);
    },
    onDragEnd: () => setDragId(null),
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.stopPropagation();
      if (dragId) reorder(dragId, id);
      setDragId(null);
    },
  });

  return { dragId, dragProps, move };
}

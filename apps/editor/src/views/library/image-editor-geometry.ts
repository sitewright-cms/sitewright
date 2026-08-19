/**
 * The geometry behind the Image Editor: turning a picture, and the rectangle cut out of it.
 *
 * Kept OUT of the component and free of the DOM so it can be tested directly. Every one of these is
 * an off-by-one waiting to happen — a crop that drifts by a pixel per rotation, a box that escapes
 * its image at the edge, a handle drag that inverts the rectangle when it crosses its own origin —
 * and none of that is visible in a screenshot until an author saves the wrong pixels.
 */

/** Clockwise turn currently applied in the editor. */
export type Turn = 0 | 90 | 180 | 270;

/** A crop box in the pixel coordinates of the image AS TURNED (what the author sees). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The size the image presents at a given turn — the quarter-turns transpose it. */
export function turnedSize(natural: Size, turn: Turn): Size {
  return turn === 90 || turn === 270
    ? { width: natural.height, height: natural.width }
    : { width: natural.width, height: natural.height };
}

/** Add a quarter-turn, wrapping at a full revolution. */
export function addTurn(turn: Turn, delta: 90 | -90): Turn {
  return (((turn + delta) % 360) + 360) % 360 as Turn;
}

/**
 * Carry a crop box through a quarter-turn so it keeps covering the SAME PART OF THE PICTURE.
 *
 * Without this, rotating after selecting silently re-aims the selection: the box stays where it is
 * on screen while the image moves underneath it, and the author saves a region they never chose.
 * `size` is the image size BEFORE the turn.
 */
export function rotateRect(rect: Rect, size: Size, delta: 90 | -90): Rect {
  return delta === 90
    ? { x: size.height - (rect.y + rect.h), y: rect.x, w: rect.h, h: rect.w }
    : { x: rect.y, y: size.width - (rect.x + rect.w), w: rect.h, h: rect.w };
}

/** Round a rect to whole pixels — the transform endpoint rejects fractions. */
export function roundRect(rect: Rect): Rect {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  return { x, y, w: Math.round(rect.x + rect.w) - x, h: Math.round(rect.y + rect.h) - y };
}

/**
 * Force a rect inside `size`, keeping it non-empty.
 *
 * Clamps the ORIGIN first and the extent second, so a box dragged past an edge slides back in rather
 * than growing a negative side. A rect larger than the image collapses to the image.
 */
export function clampRect(rect: Rect, size: Size): Rect {
  const w = Math.max(1, Math.min(rect.w, size.width));
  const h = Math.max(1, Math.min(rect.h, size.height));
  const x = Math.max(0, Math.min(rect.x, size.width - w));
  const y = Math.max(0, Math.min(rect.y, size.height - h));
  return { x, y, w, h };
}

/**
 * Build a rect from two dragged corners, in either direction.
 *
 * Dragging up-left from the start point is the natural way to select the top-left of a photo, and it
 * produces negative extents — normalising here is what stops the box inverting mid-drag.
 */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** Which part of a crop box a pointer grabbed. */
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

/** Apply a handle drag, normalising so a corner dragged past its opposite flips instead of inverting. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, size: Size): Rect {
  if (handle === 'move') return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, size);
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const nx = handle === 'nw' || handle === 'sw' ? left + dx : left;
  const ny = handle === 'nw' || handle === 'ne' ? top + dy : top;
  const fx = handle === 'ne' || handle === 'se' ? right + dx : right;
  const fy = handle === 'sw' || handle === 'se' ? bottom + dy : bottom;
  const next = rectFromPoints(
    Math.max(0, Math.min(nx, size.width)),
    Math.max(0, Math.min(ny, size.height)),
    Math.max(0, Math.min(fx, size.width)),
    Math.max(0, Math.min(fy, size.height)),
  );
  return clampRect(next, size);
}

/** The scale that fits `size` inside `pane` without ever enlarging it past 1:1. */
export function fitScale(size: Size, pane: Size): number {
  if (size.width <= 0 || size.height <= 0) return 1;
  return Math.min(pane.width / size.width, pane.height / size.height, 1);
}

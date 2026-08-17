import { useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent } from 'react';

/**
 * Long-press = right-click, for touch.
 *
 * ★ The hard part is not the timer, it is telling a deliberate hold apart from THE START OF A SCROLL.
 * On a list every scroll begins as a finger resting on a row, so a naive timer opens the menu whenever
 * someone flicks the page. A movement threshold is what separates the two: a finger that travels more
 * than a few pixels was scrolling, and the press is cancelled.
 */

/** How long the finger must stay down. Matches the platform convention (Android ~500ms, iOS ~500ms). */
export const LONG_PRESS_MS = 500;

/** Movement tolerated before it counts as a scroll rather than a hold — a steady finger is never still. */
export const LONG_PRESS_SLOP_PX = 10;

export interface LongPressHandlers {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

/**
 * Handlers that call `onLongPress(clientX, clientY)` when a single finger is held still on the element.
 * Spread onto the element; the coordinates are where the finger went down, which is where a context
 * menu should appear.
 */
export function useLongPress(onLongPress: (clientX: number, clientY: number) => void): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Held in a ref so a re-rendered parent passing a fresh callback never restarts a press in flight.
  const handler = useRef(onLongPress);
  handler.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  // A press left armed after unmount would fire into a dead component.
  useEffect(() => cancel, [cancel]);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      cancel();
      // More than one finger is a pinch/zoom, not a press.
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      origin.current = { x: t.clientX, y: t.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        const at = origin.current;
        origin.current = null;
        if (at) handler.current(at.x, at.y);
      }, LONG_PRESS_MS);
    },
    [cancel],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      const at = origin.current;
      if (!at || timer.current === null) return;
      const t = e.touches[0];
      if (!t) return;
      const moved = Math.abs(t.clientX - at.x) > LONG_PRESS_SLOP_PX || Math.abs(t.clientY - at.y) > LONG_PRESS_SLOP_PX;
      if (moved) cancel(); // the list is scrolling under the finger
    },
    [cancel],
  );

  return { onTouchStart, onTouchMove, onTouchEnd: cancel, onTouchCancel: cancel };
}

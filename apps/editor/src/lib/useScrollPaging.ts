import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';

/**
 * Infinite-scroll paging for a long filtered list: render the first `page` items, then append another
 * `page` each time the scroll container nears its bottom — so the user can scroll through ALL entries
 * instead of hitting a hard cap. Call `reset()` when the filter/search query changes to jump back to
 * the first page; spread `onScroll` onto the scrollable container and attach `ref` to it; slice the
 * list to `visible`.
 *
 * `ref` powers AUTO-FILL: if a page renders without overflowing its container (e.g. 50 small icons that
 * fit exactly on a tall screen), there's no scrollbar to grab — so we keep loading until the content
 * overflows or the list is exhausted. Without this the user would be stranded on the first page.
 */
export function useScrollPaging(total: number, page = 50) {
  const [visible, setVisible] = useState(page);
  const ref = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => setVisible(page), [page]);
  const grow = useCallback(() => setVisible((v) => (v < total ? v + page : v)), [total, page]);

  const onScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) grow();
    },
    [grow],
  );

  // Auto-fill: a laid-out container that isn't overflowing can't be scrolled, so load the next page
  // until it does (or we run out). Guard on clientHeight > 0 so a not-yet-measured/hidden container
  // doesn't load the whole list at once.
  useEffect(() => {
    const el = ref.current;
    if (el && el.clientHeight > 0 && visible < total && el.scrollHeight <= el.clientHeight) grow();
  }, [visible, total, grow]);

  return { visible, reset, onScroll, ref };
}

import { useCallback, useState, type UIEvent } from 'react';

/**
 * Infinite-scroll paging for a long filtered list: render the first `page` items, then append another
 * `page` each time the scroll container nears its bottom — so the user can scroll through ALL entries
 * instead of hitting a hard cap. Call `reset()` when the filter/search query changes to jump back to
 * the first page; spread `onScroll` onto the scrollable container; slice the list to `visible`.
 */
export function useScrollPaging(total: number, page = 50) {
  const [visible, setVisible] = useState(page);
  const reset = useCallback(() => setVisible(page), [page]);
  const onScroll = useCallback(
    (e: UIEvent<HTMLElement>) => {
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
        setVisible((v) => (v < total ? v + page : v));
      }
    },
    [total, page],
  );
  return { visible, reset, onScroll };
}

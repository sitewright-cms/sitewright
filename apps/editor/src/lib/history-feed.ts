import type { ProjectRevisionPage, ProjectRevisionRow } from '../api';

/**
 * The pure half of the History feed: how pages of rows combine.
 *
 * The server orders the feed by (revisionAt DESC, id DESC) and pages it with a keyset cursor, so a page
 * fetched later never repeats an earlier one. What the CLIENT has to get right is the other direction:
 * history keeps arriving at the TOP while someone scrolls, and the live refresh re-reads that top.
 */

/** The rows loaded so far — always a contiguous run from the newest row down — and where the next page starts. */
export interface FeedRows {
  items: ProjectRevisionRow[];
  /** The next page's cursor, or null when the loaded rows already reach the end of the feed. */
  cursor: string | null;
}

/** True when `a` comes AFTER `b` in the feed: older, or the same instant with a smaller id (the server's tie-break). */
export function comesAfter(a: Pick<ProjectRevisionRow, 'revisionAt' | 'id'>, b: Pick<ProjectRevisionRow, 'revisionAt' | 'id'>): boolean {
  const ta = Date.parse(a.revisionAt);
  const tb = Date.parse(b.revisionAt);
  if (ta !== tb) return ta < tb;
  return a.id < b.id;
}

/** The next page appended. A row already present is not repeated (defensive: the keyset never sends one). */
export function appendPage(prev: FeedRows, page: ProjectRevisionPage): FeedRows {
  const have = new Set(prev.items.map((r) => r.id));
  return { items: [...prev.items, ...page.items.filter((r) => !have.has(r.id))], cursor: page.nextCursor };
}

/**
 * A freshly read FIRST page (`head`) merged over the rows already loaded.
 *
 * ★ The loaded rows may run hundreds deep, and re-reading all of them per live event is the request storm
 * the editor has already been bitten by. So only the head is re-read and stitched on top, which is safe
 * ONLY while the two overlap: if more new rows arrived than one page holds, the rows between the head's
 * last row and the old first row were never read, and stitching would silently skip them. In that case
 * the old rows are dropped and paging resumes from the head's cursor — the list may get shorter, but it
 * never has a hole.
 */
export function mergeHead(prev: FeedRows, head: ProjectRevisionPage): FeedRows {
  // A head with no next page IS the whole feed for this filter.
  if (head.nextCursor === null) return { items: head.items, cursor: null };
  const last = head.items[head.items.length - 1];
  const first = prev.items[0];
  if (!last || !first || comesAfter(first, last)) return { items: head.items, cursor: head.nextCursor };
  const inHead = new Set(head.items.map((r) => r.id));
  // Same id → the head's copy wins (a coalesced save moves its row to the top with a new time).
  const tail = prev.items.filter((r) => !inHead.has(r.id) && comesAfter(r, last));
  return tail.length === 0 ? { items: head.items, cursor: head.nextCursor } : { items: [...head.items, ...tail], cursor: prev.cursor };
}

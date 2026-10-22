import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProjectRevisionQuery, type ProjectRevisionRow } from '../api';
import { appendPage, mergeHead } from './history-feed';
import { useProjectEvents } from './use-project-events';
import { useSingleFlight } from './single-flight';

/** What the History view filters by. Empty strings mean "no filter". */
export interface HistoryFilters {
  kind: string;
  op: string;
  /** The (already debounced) name search. */
  q: string;
}

export interface HistoryFeed {
  /** The rows loaded so far, or null before anything has loaded (or after the first page failed). */
  items: ProjectRevisionRow[] | null;
  /** The first page for the CURRENT filters is in flight; `items` may still show the previous filters. */
  loading: boolean;
  /** Why the first page failed, or null. */
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  /** The last next-page read failed. Scroll-loading stops until `loadMore` is called again by hand. */
  moreFailed: boolean;
  /**
   * Under the Created filter or a search: since when this project's history marks creations (ISO), or
   * null if it never has; undefined when the server was not asked (any other filter).
   */
  createdSince: string | null | undefined;
  loadMore: () => void;
  /** Re-read the newest rows and stitch them on top (after a restore). */
  refresh: () => Promise<void>;
  /** Read the first page again (after it failed). */
  retry: () => void;
}

interface FeedState {
  /** Which filter change this state belongs to. A response for an older generation is dropped. */
  gen: number;
  /** The query EVERY read of this generation uses — kept with the cursor so the two can never mix. */
  query: ProjectRevisionQuery;
  items: ProjectRevisionRow[] | null;
  cursor: string | null;
  loading: boolean;
  error: string | null;
  /** The cursor a next-page read is in flight from. */
  pending: string | null;
  moreFailed: boolean;
  createdSince: string | null | undefined;
}

/** Bursts of change events (a bulk edit sends one per item) collapse into one re-read of the head. */
const EVENT_SETTLE_MS = 500;
/** The kinds the server keeps history for (its REVISIONED_KINDS); a change to anything else adds no row. */
const HISTORY_KINDS: ReadonlySet<string> = new Set(['page', 'template', 'snippet', 'translation', 'dataset', 'entry', 'form', 'imagemap', 'settings']);

const queryFor = (f: HistoryFilters, limit: number): ProjectRevisionQuery => ({
  ...(f.kind ? { kind: f.kind } : {}),
  ...(f.op ? { op: f.op } : {}),
  ...(f.q ? { q: f.q } : {}),
  limit,
});

const errorText = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'Could not load the history');

/**
 * The project-wide History feed: the first page for the current filters, the next page on demand, and a
 * live re-read of the newest rows whenever content changes.
 *
 * ★ Every read can answer out of order, so each is tagged with the GENERATION (one per filter change)
 * and the CURSOR it started from, and is applied only if both still hold. A search typed while a page is
 * loading therefore never gets the previous search's rows appended to it, and a page read from a cursor
 * that a live refresh has since replaced is dropped instead of being stitched onto the wrong rows.
 */
export function useHistoryFeed(projectId: string, filters: HistoryFilters, pageSize = 50): HistoryFeed {
  const genRef = useRef(0);
  const [state, setState] = useState<FeedState>({
    gen: 0,
    query: queryFor(filters, pageSize),
    items: null,
    cursor: null,
    loading: true,
    error: null,
    pending: null,
    moreFailed: false,
    createdSince: undefined,
  });
  // The latest state for event handlers and the scroll trigger, which outlive the render they came from.
  const latest = useRef(state);
  latest.current = state;
  const [attempt, setAttempt] = useState(0);
  const { kind, op, q } = filters;

  useEffect(() => {
    const gen = ++genRef.current;
    const query = queryFor({ kind, op, q }, pageSize);
    // Keep the rows on screen while the new filter loads (no flash of "Loading…" per keystroke), but
    // drop the cursor: the old filter's next page must not be fetched any more.
    setState((prev) => ({ ...prev, gen, query, cursor: null, loading: true, error: null, pending: null, moreFailed: false, createdSince: undefined }));
    api.listProjectRevisions(projectId, query).then(
      (page) =>
        setState((prev) =>
          // `loading` already false → a live refresh of this generation answered first, and it is newer.
          prev.gen !== gen || !prev.loading ? prev : { ...prev, items: page.items, cursor: page.nextCursor, loading: false, createdSince: page.createdSince },
        ),
      (err: unknown) =>
        setState((prev) => (prev.gen !== gen || !prev.loading ? prev : { ...prev, items: null, cursor: null, loading: false, error: errorText(err) })),
    );
  }, [projectId, kind, op, q, pageSize, attempt]);

  const loadMore = useCallback(() => {
    const { gen, query, cursor, loading, pending } = latest.current;
    if (!cursor || loading || pending === cursor) return;
    // Claimed synchronously: a second trigger in the same tick (scroll + click) must not read it twice.
    latest.current = { ...latest.current, pending: cursor, moreFailed: false };
    setState((prev) => (prev.gen !== gen ? prev : { ...prev, pending: cursor, moreFailed: false }));
    api.listProjectRevisions(projectId, { ...query, cursor }).then(
      (page) =>
        setState((prev) => {
          if (prev.gen !== gen) return prev;
          const settled = { ...prev, pending: prev.pending === cursor ? null : prev.pending };
          // The rows this page continues from were replaced meanwhile (a live refresh restarted the list).
          if (prev.cursor !== cursor || !prev.items) return settled;
          return { ...settled, ...appendPage({ items: prev.items, cursor: prev.cursor }, page) };
        }),
      () =>
        setState((prev) => {
          if (prev.gen !== gen) return prev;
          const settled = { ...prev, pending: prev.pending === cursor ? null : prev.pending };
          // Only a failure of the page the list is waiting for pauses scroll-loading — not one whose rows a
          // live refresh has since replaced.
          return prev.cursor === cursor ? { ...settled, moreFailed: true } : settled;
        }),
    );
  }, [projectId]);

  // One head read in flight at a time; events that arrive meanwhile collapse into one trailing read.
  const refresh = useSingleFlight(async () => {
    const { gen, query } = latest.current;
    // Live refresh is an enhancement: a failed read leaves the list as it was.
    const head = await api.listProjectRevisions(projectId, query).catch(() => null);
    if (!head) return;
    setState((prev) => {
      if (prev.gen !== gen) return prev;
      const createdSince = head.createdSince === undefined ? prev.createdSince : head.createdSince;
      if (prev.loading || !prev.items) return { ...prev, items: head.items, cursor: head.nextCursor, loading: false, error: null, createdSince };
      return { ...prev, ...mergeHead({ items: prev.items, cursor: prev.cursor }, head), createdSince };
    });
  });

  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useProjectEvents(projectId, (change) => {
    // Media, folders and credentials have no history — an upload burst must not re-read this feed.
    if (!HISTORY_KINDS.has(change.kind)) return;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => void refresh(), EVENT_SETTLE_MS);
  });
  useEffect(() => () => clearTimeout(settle.current), []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    items: state.items,
    loading: state.loading,
    error: state.error,
    hasMore: state.cursor !== null,
    loadingMore: state.pending !== null && state.pending === state.cursor,
    moreFailed: state.moreFailed,
    createdSince: state.createdSince,
    loadMore,
    refresh,
    retry,
  };
}

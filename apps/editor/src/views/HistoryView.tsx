import { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { RotateCcw, FileSearch, Info } from 'lucide-react';
import { api, type Project, type ProjectRevisionRow } from '../api';
import { useDialogs } from './ui/Dialogs';
import { useToast } from './ui/Toast';
import { SearchField } from './ui/SearchField';
import { glassCard } from '../theme';
import { when, OP_PILL, OP_FILTERS, authorLabel, KIND_LABEL } from './revision-format';
import { Tooltip } from './ui/Tooltip';
import { RevisionDetailsModal } from './RevisionDetailsModal';
import { useHistoryFeed } from '../lib/use-history-feed';
import { legacyCreatedNote } from '../lib/history-feed';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { scrollHostOf, useVirtualRows } from '../lib/virtual-rows';

/** Rows per read. The list renders only what is on screen, so this sizes REQUESTS, not the DOM. */
const PAGE = 50;
/** The server refuses a longer search; the field stops there too. */
const MAX_SEARCH = 200;
const SEARCH_SETTLE_MS = 300;

/**
 * A row's entrance: a short fade-and-rise, staggered within its PAGE and capped, so the first rows of a
 * long list are not kept waiting behind the fiftieth. Off once the list is virtualised — rows then mount
 * and unmount as they scroll in and out, and replaying an entrance on every scroll is noise.
 */
const rowEntrance = (index: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring' as const, stiffness: 320, damping: 30, delay: Math.min(index % PAGE, 12) * 0.035 },
});
const KIND_FILTERS = ['page', 'template', 'snippet', 'translation', 'dataset', 'entry', 'form', 'imagemap', 'settings'];
// `pr-8`, not a symmetric `px-2.5`: a native <select> paints its own chevron INSIDE its box, so equal
// padding leaves the longest value ("All content", "Dataset Entry") touching the arrow.
const selectCls =
  'min-w-0 flex-1 sm:flex-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2.5 pr-8 py-1.5 text-sm text-slate-600 dark:text-slate-300 shadow-sm [&>option]:bg-white [&>option]:text-slate-800 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100';
const rowButtonCls =
  'inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 transition hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-default disabled:opacity-40';

/**
 * Project-wide revision activity feed (the History nav tab). Lists every revision across all content
 * (pages, datasets, entries, settings, …) newest-first — searchable by name and filterable by kind/action,
 * together — with non-destructive Restore per row, including DELETED items (a tombstone row
 * restores/recreates the entity). The per-editor History buttons remain the in-context shortcut; this
 * is the global log + restore-deleted home.
 *
 * Long histories are virtualised like the Pages list, and the next page loads as the end scrolls into
 * view; the search and paging run on the server, so they cover the whole history, not the loaded rows.
 */
export function HistoryView({ project }: { project: Project }) {
  const { confirm, dialog } = useDialogs();
  const toast = useToast();
  const [kind, setKind] = useState('');
  const [op, setOp] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), SEARCH_SETTLE_MS);
  const feed = useHistoryFeed(project.id, { kind, op, q }, PAGE);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [detailsOf, setDetailsOf] = useState<ProjectRevisionRow | null>(null);
  const items = feed.items ?? [];
  const virt = useVirtualRows(items.length);
  const windowRows = items.slice(virt.start, virt.end);
  const legacyNote = feed.loading ? null : legacyCreatedNote({ op, q, createdSince: feed.createdSince, items });

  const restore = async (r: ProjectRevisionRow) => {
    const ok = await confirm({
      title: 'Restore this version?',
      message: `Restore ${KIND_LABEL[r.kind] ?? r.kind} "${r.label}" to its version from ${when(r.revisionAt)} (${authorLabel(r)})${r.op === 'delete' ? ' — this recreates the deleted item' : ''}. Reversible — the current version stays in history.`,
      confirmLabel: 'Restore',
      danger: false,
    });
    if (!ok) return;
    setRestoringId(r.id);
    try {
      await api.restoreRevision(project.id, r.kind, r.entityId, r.id, r.dataset);
      toast.show('Revision restored', 'success');
      await feed.refresh();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Restore failed', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">History</h2>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search by name"
            ariaLabel="Search history by name"
            maxLength={MAX_SEARCH}
            className="w-full sm:w-60"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by content type" className={selectCls}>
            <option value="">All content</option>
            {KIND_FILTERS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
          <select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Filter by action" className={selectCls}>
            {OP_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {legacyNote && (
        <p role="note" className="-mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{legacyNote}</span>
        </p>
      )}

      {feed.error ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center text-sm text-rose-600 dark:text-rose-300">
          <p>Could not load the history: {feed.error}</p>
          <button type="button" onClick={feed.retry} className={rowButtonCls}>
            Try again
          </button>
        </div>
      ) : feed.items === null ? (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading history…</p>
      ) : items.length === 0 ? (
        feed.loading ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Searching…</p>
        ) : (
          <EmptyHistory q={q} filtered={kind !== '' || op !== ''} />
        )
      ) : (
        <MotionConfig reducedMotion="user">
          <ul
            ref={virt.listRef as (el: HTMLUListElement | null) => void}
            aria-busy={feed.loading}
            className={`flex flex-col gap-2 transition-opacity ${feed.loading ? 'opacity-60' : ''}`}
          >
            {virt.padTop > 0 && <li aria-hidden style={{ height: virt.padTop }} />}
            {windowRows.map((r, windowIndex) => (
              <HistoryRow
                key={r.id}
                row={r}
                index={virt.start + windowIndex}
                animate={!virt.active}
                restoring={restoringId === r.id}
                restoreDisabled={restoringId !== null}
                onDetails={() => setDetailsOf(r)}
                onRestore={() => void restore(r)}
              />
            ))}
            {virt.padBottom > 0 && <li aria-hidden style={{ height: virt.padBottom }} />}
          </ul>
        </MotionConfig>
      )}

      {items.length > 0 && !feed.error && !feed.loading && (
        <FeedFooter
          shown={items.length}
          hasMore={feed.hasMore}
          loadingMore={feed.loadingMore}
          paused={feed.moreFailed}
          failed={feed.moreFailed}
          filtered={q !== '' || kind !== '' || op !== ''}
          onLoadMore={feed.loadMore}
        />
      )}
      {detailsOf && <RevisionDetailsModal projectId={project.id} row={detailsOf} onClose={() => setDetailsOf(null)} />}
      {dialog}
    </div>
  );
}

function EmptyHistory({ q, filtered }: { q: string; filtered: boolean }) {
  return (
    <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
      {q
        ? `Nothing in the history is named like “${q}”${filtered ? ' with these filters' : ''}.`
        : filtered
          ? 'No changes match these filters.'
          : 'No changes recorded yet.'}
    </p>
  );
}

function HistoryRow({
  row: r,
  index,
  animate,
  restoring,
  restoreDisabled,
  onDetails,
  onRestore,
}: {
  row: ProjectRevisionRow;
  index: number;
  animate: boolean;
  restoring: boolean;
  restoreDisabled: boolean;
  onDetails: () => void;
  onRestore: () => void;
}) {
  const pill = OP_PILL[r.op];
  return (
    <motion.li
      data-virtual-row=""
      {...(animate ? rowEntrance(index) : { initial: false })}
      className={`${glassCard} flex items-center gap-2 px-3 py-3 text-sm sm:gap-3 sm:px-4`}
    >
      {/* One width for every status, so the names line up in a column whichever word is beside them. */}
      <span className={`shrink-0 rounded-lg sm:min-w-[5.25rem] px-1.5 py-0.5 text-center text-[11px] font-medium ${pill.cls}`}>{pill.label}</span>
      <div className="min-w-0 flex-1">
        {/* ★ `max-w-full` + `min-w-0`: the tooltip host is `inline-flex`, so it grew to the full name and
            the row's buttons were pushed off a phone screen instead of the name being cut short. */}
        <Tooltip tip={new Date(r.revisionAt).toLocaleString()} className="max-w-full">
          <div className="min-w-0 truncate text-slate-700 dark:text-slate-200">
            <span className="text-slate-500 dark:text-slate-400">{KIND_LABEL[r.kind] ?? r.kind} · </span>
            <span className="font-medium">{r.label}</span>
          </div>
        </Tooltip>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">
          {authorLabel(r)} · {when(r.revisionAt)}
          {r.note ? ` · ${r.note}` : ''}
        </div>
      </div>
      {/* Icon-only below `sm`: on a phone the two labelled buttons left the name ~50px. */}
      <button type="button" onClick={onDetails} aria-label={`See what changed in ${r.label}`} className={rowButtonCls}>
        <FileSearch className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Details</span>
      </button>
      <button type="button" disabled={restoreDisabled} onClick={onRestore} aria-label={`Restore ${r.label}`} className={rowButtonCls}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">{restoring ? 'Restoring…' : 'Restore'}</span>
      </button>
    </motion.li>
  );
}

/**
 * The end of the list: how many rows are loaded, and — while there are more — a real "Load more" button
 * that ALSO loads by itself as it nears the viewport.
 *
 * ★ The button is the mechanism and scroll-loading the enhancement: keyboard users are never stranded,
 * a failed read waits for a click instead of retrying in a loop, and a browser without
 * IntersectionObserver (jsdom is one) simply keeps the button.
 */
function FeedFooter({
  shown,
  hasMore,
  loadingMore,
  paused,
  failed,
  filtered,
  onLoadMore,
}: {
  shown: number;
  hasMore: boolean;
  loadingMore: boolean;
  paused: boolean;
  failed: boolean;
  filtered: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef(onLoadMore);
  trigger.current = onLoadMore;

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore || paused || loadingMore || typeof IntersectionObserver === 'undefined') return;
    // ★ The root is whatever SCROLLS the list — the viewport for the page-scrolled tab, a panel if this
    // ever moves into one. With the default root, a sentinel inside an overflow container is clipped by
    // it and never reports as intersecting: the observer arms cleanly and simply never fires.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) trigger.current();
    }, { root: scrollHostOf(target), rootMargin: '0px 0px 600px 0px' });
    io.observe(target);
    return () => io.disconnect();
    // Re-armed after every page: a fresh observer reports the sentinel's CURRENT state, so a page that
    // did not fill the screen loads the next one instead of waiting for a scroll that cannot happen.
  }, [shown, hasMore, paused, loadingMore]);

  const noun = shown === 1 ? 'change' : 'changes';
  return (
    <div className="flex flex-col items-center gap-2 pb-4" aria-live="polite">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {hasMore ? `Showing ${shown} ${noun} so far` : shown === 1 ? `The only ${filtered ? 'matching ' : ''}change` : `All ${shown} ${filtered ? 'matching ' : ''}${noun} shown`}
      </p>
      {hasMore && (
        <button
          ref={sentinel}
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-40"
        >
          {loadingMore ? 'Loading…' : failed ? 'Could not load more — try again' : 'Load more'}
        </button>
      )}
    </div>
  );
}

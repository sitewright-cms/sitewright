import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectRevisionPage, ProjectRevisionQuery, ProjectRevisionRow } from '../src/api';
import type { ContentChange } from '../src/lib/use-project-events';

const listProjectRevisions = vi.fn<(projectId: string, q: ProjectRevisionQuery) => Promise<ProjectRevisionPage>>();
vi.mock('../src/api', () => ({
  api: {
    listProjectRevisions: (projectId: string, q: ProjectRevisionQuery) => listProjectRevisions(projectId, q),
    restoreRevision: vi.fn(),
  },
}));

// The live stream is pushed by hand: the module that owns the EventSource is replaced.
const live = vi.hoisted(() => ({ emit: null as ((c: ContentChange) => void) | null }));
vi.mock('../src/lib/use-project-events', () => ({
  useProjectEvents: (_projectId: string, listener: (c: ContentChange) => void) => {
    live.emit = listener;
  },
}));

import { HistoryView } from '../src/views/HistoryView';

const project = { id: 'p', name: 'P', slug: 'p', role: 'owner' as const };
const T0 = Date.UTC(2026, 9, 1, 12);

function row(n: number, over: Partial<ProjectRevisionRow> = {}): ProjectRevisionRow {
  return {
    id: `r${String(n).padStart(4, '0')}`,
    kind: 'page',
    entityId: `e${n}`,
    dataset: '',
    label: `Item ${n}`,
    op: 'put',
    actor: 'user',
    note: null,
    revisionAt: new Date(T0 - n * 1000).toISOString(),
    author: { userId: 'u', email: 'a@example.test', isYou: true },
    ...over,
  };
}
const rows = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => row(from + i));
const page = (items: ProjectRevisionRow[], nextCursor: string | null = null): ProjectRevisionPage => ({ items, nextCursor });

/** A response the test answers when IT chooses — to put two reads out of order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const lastQuery = () => listProjectRevisions.mock.calls[listProjectRevisions.mock.calls.length - 1]![1];
const rowNames = () => screen.queryAllByRole('listitem').filter((li) => li.hasAttribute('data-virtual-row')).map((li) => li.textContent ?? '');

beforeEach(() => {
  listProjectRevisions.mockReset();
  live.emit = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe('HistoryView — the words', () => {
  it('says Created / Updated / Restored / Deleted, and "Dataset Entry" for an entry', async () => {
    listProjectRevisions.mockResolvedValue(
      page([
        row(1, { op: 'create', label: 'New page' }),
        row(2, { op: 'put', label: 'Edited page' }),
        row(3, { op: 'restore', kind: 'entry', dataset: 'team', label: 'Anna' }),
        row(4, { op: 'delete', kind: 'entry', dataset: 'team', label: 'Ben' }),
      ]),
    );
    render(<HistoryView project={project} />);
    const list = await screen.findByRole('list');
    const rowsShown = within(list).getAllByRole('listitem');
    expect(rowsShown.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Created\s*Page · New page/),
      expect.stringMatching(/^Updated\s*Page · Edited page/),
      expect.stringMatching(/^Restored\s*Dataset Entry · Anna/),
      expect.stringMatching(/^Deleted\s*Dataset Entry · Ben/),
    ]);
    expect(within(list).queryByText('Saved')).toBeNull();
  });

  it('offers the same words as filters — and the filter values are still the stored ones', async () => {
    listProjectRevisions.mockResolvedValue(page([row(1)]));
    render(<HistoryView project={project} />);
    await screen.findByRole('list');
    const action = screen.getByRole('combobox', { name: 'Filter by action' });
    expect(within(action).getAllByRole('option').map((o) => o.textContent)).toEqual(['All actions', 'Created', 'Updated', 'Restored', 'Deleted']);
    const kind = screen.getByRole('combobox', { name: 'Filter by content type' });
    expect(within(kind).getByRole('option', { name: 'Dataset Entry' })).toHaveValue('entry');
    expect(within(kind).queryByRole('option', { name: 'Entry' })).toBeNull();

    fireEvent.change(action, { target: { value: 'create' } });
    fireEvent.change(kind, { target: { value: 'entry' } });
    await waitFor(() => expect(lastQuery()).toEqual({ kind: 'entry', op: 'create', limit: 50 }));
  });
});

describe('HistoryView — older history under the Created filter', () => {
  it('explains that creations before a date show as Updated (the server says since when)', async () => {
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 3)));
    render(<HistoryView project={project} />);
    await screen.findByRole('list');
    expect(screen.queryByRole('note')).toBeNull();

    const since = new Date(T0 - 2000).toISOString();
    listProjectRevisions.mockResolvedValueOnce({ ...page([row(1, { op: 'create', label: 'New page' })]), createdSince: since });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by action' }), { target: { value: 'create' } });
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(`History marks new items “Created” from ${new Date(since).toLocaleDateString()} on.`);
    expect(note).toHaveTextContent('Items created before then show as “Updated”.');
  });
});

describe('HistoryView — search', () => {
  it('searches the SERVER by name once typing settles, combined with the filters', async () => {
    listProjectRevisions.mockResolvedValue(page(rows(0, 3)));
    render(<HistoryView project={project} />);
    await screen.findByRole('list');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by content type' }), { target: { value: 'page' } });
    await waitFor(() => expect(lastQuery()).toEqual({ kind: 'page', limit: 50 }));

    listProjectRevisions.mockResolvedValue(page([row(9, { label: 'About us' })]));
    const search = screen.getByRole('searchbox', { name: 'Search history by name' });
    expect(search).toHaveAttribute('maxLength', '200');
    fireEvent.change(search, { target: { value: 'a' } });
    fireEvent.change(search, { target: { value: 'ab' } });
    fireEvent.change(search, { target: { value: ' about ' } });
    await waitFor(() => expect(lastQuery()).toEqual({ kind: 'page', q: 'about', limit: 50 }));
    // Debounced: the half-typed terms were never sent.
    expect(listProjectRevisions.mock.calls.some(([, q]) => q.q === 'a' || q.q === 'ab')).toBe(false);
    await waitFor(() => expect(rowNames()).toEqual([expect.stringContaining('About us')]));

    listProjectRevisions.mockResolvedValue(page([]));
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing in the history is named like “zzz” with these filters.')).toBeInTheDocument();
  });

  it('★ a slower answer for an OLDER search never replaces the newer one', async () => {
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 2)));
    render(<HistoryView project={project} />);
    await screen.findByRole('list');
    const search = screen.getByRole('searchbox', { name: 'Search history by name' });

    const older = deferred<ProjectRevisionPage>();
    const newer = deferred<ProjectRevisionPage>();
    listProjectRevisions.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    fireEvent.change(search, { target: { value: 'ab' } });
    await waitFor(() => expect(lastQuery().q).toBe('ab'));
    fireEvent.change(search, { target: { value: 'abc' } });
    await waitFor(() => expect(lastQuery().q).toBe('abc'));

    await act(async () => newer.resolve(page([row(5, { label: 'abc result' })])));
    await act(async () => older.resolve(page([row(6, { label: 'ab STALE' })], 'stale-cursor')));
    expect(rowNames()).toEqual([expect.stringContaining('abc result')]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull(); // the stale cursor was not adopted either
  });

  it('★ an older search answering FIRST is not shown, and does not block the newer answer', async () => {
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 2)));
    render(<HistoryView project={project} />);
    await screen.findByRole('list');
    const search = screen.getByRole('searchbox', { name: 'Search history by name' });

    const older = deferred<ProjectRevisionPage>();
    const newer = deferred<ProjectRevisionPage>();
    listProjectRevisions.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    fireEvent.change(search, { target: { value: 'ab' } });
    await waitFor(() => expect(lastQuery().q).toBe('ab'));
    fireEvent.change(search, { target: { value: 'abc' } });
    await waitFor(() => expect(lastQuery().q).toBe('abc'));

    await act(async () => older.resolve(page([row(6, { label: 'ab STALE' })])));
    expect(rowNames().some((n) => n.includes('ab STALE'))).toBe(false);
    await act(async () => newer.resolve(page([row(5, { label: 'abc result' })])));
    expect(rowNames()).toEqual([expect.stringContaining('abc result')]);
  });
});

/** A hand-driven IntersectionObserver: the test decides when the sentinel "comes into view". */
function installObserver() {
  const observers: Array<{ cb: IntersectionObserverCallback; targets: Element[] }> = [];
  class FakeObserver {
    private readonly entry: { cb: IntersectionObserverCallback; targets: Element[] };
    constructor(cb: IntersectionObserverCallback) {
      this.entry = { cb, targets: [] };
      observers.push(this.entry);
    }
    observe(el: Element) {
      this.entry.targets.push(el);
    }
    disconnect() {
      this.entry.targets = [];
    }
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
  return {
    /** Scroll the sentinel into view: every live observer watching it reports an intersection. */
    reveal: () => {
      for (const o of observers) {
        for (const target of o.targets) o.cb([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    },
  };
}

describe('HistoryView — loading more on scroll', () => {
  it('loads the next page when the end of the list scrolls into view, until there is no more', async () => {
    const io = installObserver();
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 50), 'c1')).mockResolvedValueOnce(page(rows(50, 60), null));
    render(<HistoryView project={project} />);
    expect(await screen.findByText('Showing 50 changes so far')).toBeInTheDocument();
    expect(listProjectRevisions).toHaveBeenCalledTimes(1);

    await act(async () => io.reveal());
    await waitFor(() => expect(lastQuery()).toEqual({ limit: 50, cursor: 'c1' }));
    expect(await screen.findByText('All 60 changes shown')).toBeInTheDocument();
    expect(rowNames()).toHaveLength(60);
    expect(new Set(rowNames()).size).toBe(60);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    await act(async () => io.reveal());
    expect(listProjectRevisions).toHaveBeenCalledTimes(2); // the end is the end
  });

  it('the Load more button works without scrolling (and where IntersectionObserver is missing)', async () => {
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 50), 'c1')).mockResolvedValueOnce(page(rows(50, 51), null));
    render(<HistoryView project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('All 51 changes shown')).toBeInTheDocument();
    expect(lastQuery()).toEqual({ limit: 50, cursor: 'c1' });
  });

  it('★ a next page that answers after the filter changed is dropped, not appended to the new list', async () => {
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 50), 'c1'));
    render(<HistoryView project={project} />);
    const more = deferred<ProjectRevisionPage>();
    listProjectRevisions.mockReturnValueOnce(more.promise);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(lastQuery().cursor).toBe('c1'));

    listProjectRevisions.mockResolvedValueOnce(page([row(100, { op: 'delete', label: 'Removed thing' })]));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by action' }), { target: { value: 'delete' } });
    await waitFor(() => expect(rowNames()).toEqual([expect.stringContaining('Removed thing')]));

    await act(async () => more.resolve(page(rows(50, 60), null)));
    expect(rowNames()).toEqual([expect.stringContaining('Removed thing')]);
    expect(screen.getByText('The only matching change')).toBeInTheDocument();
  });

  it('a failed next page stops scroll-loading until the user asks again', async () => {
    const io = installObserver();
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 50), 'c1')).mockRejectedValueOnce(new Error('429'));
    render(<HistoryView project={project} />);
    await screen.findByText('Showing 50 changes so far');
    await act(async () => io.reveal());
    const retry = await screen.findByRole('button', { name: 'Could not load more — try again' });
    await act(async () => io.reveal());
    expect(listProjectRevisions).toHaveBeenCalledTimes(2); // no retry loop from the observer

    listProjectRevisions.mockResolvedValueOnce(page(rows(50, 52), null));
    fireEvent.click(retry);
    expect(await screen.findByText('All 52 changes shown')).toBeInTheDocument();
  });

  it('new history arriving live is stitched on top without dropping the pages already loaded', async () => {
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 50), 'c1')).mockResolvedValueOnce(page(rows(50, 60), null));
    render(<HistoryView project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByText('All 60 changes shown');

    const fresh = row(-1, { op: 'create', label: 'Just created' });
    listProjectRevisions.mockResolvedValueOnce(page([fresh, ...rows(0, 49)], 'head-cursor'));
    await act(async () => live.emit?.({ kind: 'page', entityId: 'x', op: 'put' }));
    await waitFor(() => expect(screen.getByText('All 61 changes shown')).toBeInTheDocument(), { timeout: 3000 });
    expect(lastQuery()).toEqual({ limit: 50 }); // only the head was re-read
    const names = rowNames();
    expect(names[0]).toContain('Just created');
    expect(new Set(names).size).toBe(61);
  });
});

describe('HistoryView — live refresh scope', () => {
  it('a change to something without history (a media upload) does not re-read the feed', async () => {
    listProjectRevisions.mockResolvedValue(page(rows(0, 3)));
    render(<HistoryView project={project} />);
    await screen.findByRole('list');
    expect(listProjectRevisions).toHaveBeenCalledTimes(1);
    await act(async () => live.emit?.({ kind: 'media', entityId: 'a1', op: 'put' }));
    await new Promise((r) => setTimeout(r, 900));
    expect(listProjectRevisions).toHaveBeenCalledTimes(1);
    await act(async () => live.emit?.({ kind: 'entry', entityId: 'e1', op: 'put', scope: 'team' }));
    await waitFor(() => expect(listProjectRevisions).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });
});

describe('HistoryView — virtual scrolling', () => {
  it('★ renders only the visible window of a long history, not every row', async () => {
    // jsdom does no layout: stub the geometry the virtualiser reads (the same model as its own test).
    const ROW_H = 72;
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.hasAttribute('data-virtual-row')) return 0;
      let idx = 0;
      for (let prev = this.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.hasAttribute('data-virtual-row')) idx += 1;
      }
      return idx * ROW_H;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW_H);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this.tagName === 'UL' ? 120 : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    // The list mounts EMPTY and fills when the read answers — the sequence that once left it un-virtualised.
    listProjectRevisions.mockResolvedValueOnce(page(rows(0, 100), 'c1')).mockResolvedValueOnce(page(rows(100, 200), null));
    render(<HistoryView project={project} />);
    await screen.findByText('Showing 100 changes so far');
    await waitFor(() => expect(rowNames().length).toBeLessThan(40));
    expect(rowNames().length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('All 200 changes shown');
    await waitFor(() => expect(rowNames().length).toBeLessThan(40));
  });
});

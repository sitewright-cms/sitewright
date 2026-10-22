import { describe, it, expect } from 'vitest';
import type { ProjectRevisionRow } from '../src/api';
import { appendPage, comesAfter, mergeHead } from '../src/lib/history-feed';

const T0 = Date.UTC(2026, 9, 1, 12);

/** Row `n` is `n` seconds older than T0, so a larger n comes LATER in the feed. */
function row(n: number, id = `r${String(n).padStart(3, '0')}`, at = T0 - n * 1000): ProjectRevisionRow {
  return {
    id,
    kind: 'page',
    entityId: `e${n}`,
    dataset: '',
    label: `Item ${n}`,
    op: 'put',
    actor: 'user',
    note: null,
    revisionAt: new Date(at).toISOString(),
    author: { userId: 'u', email: 'a@example.test', isYou: true },
  };
}
const ids = (rows: ProjectRevisionRow[]) => rows.map((r) => r.id);
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => row(from + i));

describe('comesAfter — the server order: newest first, ties by id descending', () => {
  it('orders by time, and by id within one millisecond', () => {
    expect(comesAfter(row(2), row(1))).toBe(true);
    expect(comesAfter(row(1), row(2))).toBe(false);
    expect(comesAfter(row(0, 'a', T0), row(0, 'b', T0))).toBe(true);
    expect(comesAfter(row(0, 'b', T0), row(0, 'a', T0))).toBe(false);
  });
});

describe('appendPage', () => {
  it('appends the next page, takes its cursor, and never repeats a row', () => {
    const next = appendPage({ items: range(0, 3), cursor: 'c1' }, { items: [row(2), ...range(3, 5)], nextCursor: null });
    expect(ids(next.items)).toEqual(ids(range(0, 5)));
    expect(next.cursor).toBeNull();
  });
});

describe('mergeHead — a re-read of the newest rows stitched over what is loaded', () => {
  it('a head with no next page is the whole feed', () => {
    const merged = mergeHead({ items: range(0, 80), cursor: 'old' }, { items: range(0, 3), nextCursor: null });
    expect(ids(merged.items)).toEqual(ids(range(0, 3)));
    expect(merged.cursor).toBeNull();
  });

  it('keeps the loaded rows below an OVERLAPPING head, and the cursor that continues them', () => {
    // 120 rows loaded; two new rows arrive; the head is the 50 newest.
    const loaded = range(0, 120);
    const fresh = [row(-2), row(-1)];
    const head = { items: [...fresh, ...range(0, 48)], nextCursor: 'head-cursor' };
    const merged = mergeHead({ items: loaded, cursor: 'after-119' }, head);
    expect(ids(merged.items)).toEqual(ids([...fresh, ...loaded]));
    expect(merged.cursor).toBe('after-119');
  });

  it('a row the head brings to the top (a coalesced save) appears once, at its new place', () => {
    const loaded = range(0, 60);
    const moved = { ...row(30), revisionAt: new Date(T0 + 5000).toISOString() };
    const head = { items: [moved, ...range(0, 30), ...range(31, 50)], nextCursor: 'h' };
    const merged = mergeHead({ items: loaded, cursor: null }, head);
    expect(merged.items.filter((r) => r.id === moved.id)).toHaveLength(1);
    expect(merged.items[0]!.id).toBe(moved.id);
    expect(merged.items).toHaveLength(60);
  });

  it('★ drops the loaded rows when more arrived than one head holds — a hole is never stitched over', () => {
    // 70 new rows since the last read: the head (50) does not reach the old first row, so 20 rows in
    // between were never read. Keeping the old rows below would skip them silently.
    const loaded = range(0, 100);
    const head = { items: range(-70, -20), nextCursor: 'after-head' };
    const merged = mergeHead({ items: loaded, cursor: 'after-99' }, head);
    expect(ids(merged.items)).toEqual(ids(range(-70, -20)));
    expect(merged.cursor).toBe('after-head');
  });

  it('when everything loaded lies inside the head, paging continues from the head', () => {
    const merged = mergeHead({ items: range(0, 10), cursor: 'stale' }, { items: [row(-1), ...range(0, 49)], nextCursor: 'h' });
    expect(merged.items).toHaveLength(50);
    expect(merged.cursor).toBe('h');
  });
});

import { describe, expect, it } from 'vitest';
import { sortRows, type SortColumns } from '../src/views/stats/table-sort';

/** Statistics tables sort by a clicked column: numbers, texts, and rows with no value (a "—"). */

interface Row {
  name: string;
  n: number | null;
}
type Key = 'name' | 'n';
const columns: SortColumns<Row, Key> = { name: { value: (r) => r.name, first: 'asc' }, n: { value: (r) => r.n, first: 'desc' } };
const names = (rows: Row[]): string[] => rows.map((r) => r.name);

describe('sortRows', () => {
  const rows: Row[] = [
    { name: 'b', n: 2 },
    { name: 'none', n: null },
    { name: 'a', n: 10 },
    { name: 'c', n: 2 },
  ];

  it('sorts numbers either way, with a row that has no value LAST in both', () => {
    expect(names(sortRows(rows, columns, { key: 'n', dir: 'desc' }))).toEqual(['a', 'b', 'c', 'none']);
    expect(names(sortRows(rows, columns, { key: 'n', dir: 'asc' }))).toEqual(['b', 'c', 'a', 'none']);
  });

  it('keeps equal rows in the order they came, whichever way the column runs', () => {
    // b and c are both 2: b came first, so it stays first in both orders.
    expect(names(sortRows(rows, columns, { key: 'n', dir: 'asc' })).slice(0, 2)).toEqual(['b', 'c']);
    expect(names(sortRows(rows, columns, { key: 'n', dir: 'desc' })).slice(1, 3)).toEqual(['b', 'c']);
  });

  it('sorts texts by their digits’ value, ignoring case', () => {
    const texts: Row[] = ['page 10', 'Page 2', 'apple', 'page 1'].map((name) => ({ name, n: 0 }));
    expect(names(sortRows(texts, columns, { key: 'name', dir: 'asc' }))).toEqual(['apple', 'page 1', 'Page 2', 'page 10']);
    expect(names(sortRows(texts, columns, { key: 'name', dir: 'desc' }))).toEqual(['page 10', 'Page 2', 'page 1', 'apple']);
  });

  it('orders Infinity after every number, and two of them as equal', () => {
    const ranked: Row[] = [
      { name: 'unranked-1', n: Infinity },
      { name: 'third', n: 3 },
      { name: 'unranked-2', n: Infinity },
    ];
    expect(names(sortRows(ranked, columns, { key: 'n', dir: 'asc' }))).toEqual(['third', 'unranked-1', 'unranked-2']);
    expect(names(sortRows(ranked, columns, { key: 'n', dir: 'desc' }))).toEqual(['unranked-1', 'unranked-2', 'third']);
  });

  it('does not change the rows it was given', () => {
    const before = names(rows);
    sortRows(rows, columns, { key: 'n', dir: 'desc' });
    expect(names(rows)).toEqual(before);
  });
});

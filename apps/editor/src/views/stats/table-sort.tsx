import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/**
 * Sortable statistics tables: click a column's header to sort by it, click it again to flip the order. Each table
 * opens on the order the server already sends, and says so on that column's header.
 */

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/**
 * What a column sorts by: a number or a text per row, or null for a row that has none (a "—"). `first` is the order
 * the first click gives — the best first: the most clicks, position 1, A to Z.
 */
export interface SortColumn<R> {
  value: (row: R) => number | string | null;
  first: SortDir;
}

export type SortColumns<R, K extends string> = Record<K, SortColumn<R>>;

/** Digits by their value ("page 2" before "page 10"), and case and accents ignored. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a: number | string, b: number | string): number {
  if (typeof a === 'string' || typeof b === 'string') return collator.compare(String(a), String(b));
  return a < b ? -1 : a > b ? 1 : 0; // not `a - b`: Infinity - Infinity is NaN
}

/**
 * `rows` in the order `sort` asks for. A row with no value is last in BOTH orders, so flipping a column never fills
 * the top with dashes. Equal rows keep the order they came in, whichever way the column runs.
 */
export function sortRows<R, K extends string>(rows: readonly R[], columns: SortColumns<R, K>, { key, dir }: SortState<K>): R[] {
  // eslint-disable-next-line security/detect-object-injection -- key is a typed column name
  const { value } = columns[key];
  const flip = dir === 'asc' ? 1 : -1;
  return rows
    .map((row) => ({ row, v: value(row) }))
    .sort((a, b) => (a.v === null ? (b.v === null ? 0 : 1) : b.v === null ? -1 : flip * compare(a.v, b.v)))
    .map(({ row }) => row);
}

/**
 * A table's sort: the column and order it shows, and the header click that changes it. The columns name the
 * column type (`NoInfer`): read from `initial`, it would be just the one column the table opens on.
 */
export function useTableSort<R, K extends string>(columns: SortColumns<R, K>, initial: SortState<NoInfer<K>>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  // eslint-disable-next-line security/detect-object-injection -- key is a typed column name
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: columns[key].first }));
  return { sort, toggle };
}

/** `aria-sort` for a header: only the sorted column carries one. */
const ariaSort = (active: boolean, dir: SortDir): 'ascending' | 'descending' | undefined => (active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined);

/**
 * A column header that sorts its table. The button fills the cell, so the whole header is the target. The arrow
 * shows the order of the sorted column; from `xl` up the other columns show a faint up-and-down arrow, so they read
 * as sortable too. Narrower, only the sorted column has one: in the rankings the faint arrows took their width from
 * the keyword column, which wrapped two-word keywords at 390px and made the table 838px tall instead of 638px at
 * 768px, and 398px instead of 378px at 1024px (measured; at 1280px it is the same). The one arrow still says the
 * table sorts, and a click re-orders every row anyway.
 * A right-aligned (number) column puts the arrow before its label, keeping the label over its numbers.
 */
export function SortHeader<K extends string>({
  column,
  sort,
  onSort,
  className = '',
  align = 'left',
  children,
}: {
  column: K;
  sort: SortState<K>;
  onSort: (column: K) => void;
  className?: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  const arrow = <Icon className={`h-3 w-3 shrink-0 ${active ? '' : 'text-slate-300 max-xl:hidden dark:text-slate-600'}`} aria-hidden />;
  return (
    <th scope="col" className={className} aria-sort={ariaSort(active, sort.dir)}>
      <button
        type="button"
        // `flex`, not `inline-flex`: an inline box sits on the text's baseline and made the header row 2px taller
        // (measured). A button does not inherit text-transform (the browser resets it): `[text-transform:inherit]`
        // keeps the header's own case. Font, weight, spacing and colour inherit already (Tailwind's preflight).
        className={`sw-brand-focus-visible flex w-full items-center gap-1 rounded [text-transform:inherit] hover:text-slate-700 dark:hover:text-slate-200 ${align === 'right' ? 'justify-end' : ''} ${active ? 'text-slate-700 dark:text-slate-200' : ''}`}
        onClick={() => onSort(column)}
      >
        {align === 'right' && arrow}
        <span className="truncate">{children}</span>
        {align === 'left' && arrow}
      </button>
    </th>
  );
}

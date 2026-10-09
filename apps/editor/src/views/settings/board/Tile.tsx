import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { accentChip } from '../../../theme';
import { cardVariants } from '../motion';
import { SectionHelp } from '../../ui/SectionHelp';
import { budget, type TileStatus } from './summaries';

/**
 * The settings BOARD's building blocks.
 *
 * A board is a fixed set of named bands; each band is a 12-column row of tiles whose positions are
 * authored, never reflowed by content — so a tile is always where the operator left it. Three tile
 * behaviours, chosen by how much there is to configure:
 *  - OPEN    the whole tile is a button that drills into the section's existing form;
 *  - MAP     the picture is the control — each part carries its own state and opens its own editor;
 *  - INLINE  one or two controls live on the tile itself.
 * Every list on a tile is built from fixed-height rows with a budget (see {@link BudgetRows}), so a tile's
 * height comes from the design and never from the data.
 */

/** Column spans. Literal class strings, so Tailwind's scanner sees every one of them. */
const SPAN = {
  c3: 'lg:col-span-3',
  c4: 'lg:col-span-4',
  c5: 'lg:col-span-5',
  c6: 'lg:col-span-6',
  c8: 'lg:col-span-8',
} as const;
const MD_SPAN = { 3: 'md:col-span-3', 6: 'md:col-span-6' } as const;

export type TileSpan = keyof typeof SPAN;

/** One fixed row's height and the gap between rows. Rows honour the editor's 14px type floor. */
const ROW_H = 30;
const ROW_GAP = 6;
const rowsHeight = (n: number): number => n * ROW_H + Math.max(0, n - 1) * ROW_GAP;

/** A band: its title, then a 12-column row of tiles. No rule above it and no subtitle — the title and
 *  the space between bands do the separating. */
export function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="px-0.5 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200">{title}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">{children}</div>
    </section>
  );
}

/** The state vocabulary: a dot (filled, hollow or absent) and a short label. */
export function TileStateBadge({ status, id }: { status: TileStatus; id?: string }) {
  const tone = {
    set: 'text-slate-500 dark:text-slate-400',
    default: 'text-slate-500 dark:text-slate-400',
    attention: 'font-semibold text-amber-700 dark:text-amber-400',
    na: 'italic text-slate-500 dark:text-slate-400',
  }[status.kind];
  const dot = {
    set: 'bg-emerald-500',
    default: 'border-[1.5px] border-slate-400 dark:border-slate-500',
    attention: 'bg-amber-500',
    na: '',
  }[status.kind];
  return (
    <span id={id} className={`inline-flex min-w-0 items-center gap-1.5 text-xs tabular-nums ${tone}`} data-state={status.kind}>
      {status.kind !== 'na' && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
      <span className="truncate pr-1">{status.label}</span>
    </span>
  );
}

interface TileProps {
  title: string;
  icon: ReactNode;
  status: TileStatus;
  span: TileSpan;
  /** Span on the 6-column (medium) board. */
  md?: 3 | 6;
  /** Spans two rows on the 12-column board (the document map). */
  tall?: boolean;
  /** OPEN behaviour: the whole tile becomes one button that runs this. */
  onOpen?: () => void;
  /** A control in the head — the enable switch of an opt-in section. Not allowed with `onOpen`. */
  control?: ReactNode;
  /** A "?" help bubble in the head. Not allowed with `onOpen` (a button can't hold a button) — an open
   *  tile carries its help in the sheet it opens instead. */
  help?: string;
  /** An opt-in that is off: the body recedes, the tile keeps its slot. */
  off?: boolean;
  children: ReactNode;
}

/**
 * One tile. Its head is a fixed height with the title and the state STACKED, so a state label growing
 * from "Plain" to "8 set" can never wrap the title and push the body down.
 */
export function Tile({ title, icon, status, span, md = 6, tall = false, onOpen, control, help, off = false, children }: TileProps) {
  // The state is the tile's DESCRIPTION: the accessible name stays the stable "Open <title>", and a screen
  // reader still hears "5 of 6 set" / "Needs production URL" after it.
  const stateId = useId();
  const frame =
    `group flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white/80 shadow-xl shadow-slate-900/5 backdrop-blur-3xl ` +
    `dark:bg-slate-900/80 dark:shadow-black/20 ${SPAN[span]} ${MD_SPAN[md]} ${tall ? 'lg:row-span-2' : ''} ` +
    (onOpen
      ? 'border-white/50 text-left transition hover:border-indigo-400/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-white/10 dark:hover:border-indigo-400/60'
      : 'border-white/50 dark:border-white/10');
  const head = (
    <span
      className={`flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/70 px-4 transition-colors dark:border-slate-700/70 ${
        off ? 'bg-slate-100/40 dark:bg-white/5' : 'bg-slate-100/70 dark:bg-white/10'
      } ${onOpen ? 'group-hover:bg-white/85 dark:group-hover:bg-white/20' : ''}`}
    >
      <span className={off ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-300/70 text-slate-500 dark:bg-slate-700 dark:text-slate-400' : `${accentChip} shrink-0`} aria-hidden>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate pr-1 text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</span>
          {help && <SectionHelp tip={help} />}
        </span>
        <TileStateBadge status={status} id={stateId} />
      </span>
      {control && <span className="flex shrink-0 items-center">{control}</span>}
      {onOpen && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-indigo-500" />}
    </span>
  );
  const body = <span className={`flex min-w-0 flex-1 flex-col gap-3 p-4 transition-opacity ${off ? 'opacity-50' : ''}`}>{children}</span>;

  if (onOpen) {
    return (
      <motion.button type="button" variants={cardVariants} onClick={onOpen} aria-label={`Open ${title}`} aria-describedby={stateId} className={`waves-effect ${frame}`}>
        {head}
        {body}
      </motion.button>
    );
  }
  return (
    // "<title> tile", not the bare title: an inline tile's control is often labelled with the very same
    // words (the Content width tile's select is "Content width"), and two elements answering to one
    // label is ambiguous for assistive tech and for anything that finds controls by name.
    <motion.div variants={cardVariants} className={frame} role="group" aria-label={`${title} tile`} aria-describedby={stateId}>
      {head}
      {body}
    </motion.div>
  );
}

/** A plain text row. */
export function Row({ label, value, mono = false, title }: { label: ReactNode; value?: ReactNode; mono?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={`flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 text-sm text-slate-700 dark:border-slate-700/70 dark:bg-white/5 dark:text-slate-200 ${
        mono ? 'font-mono text-xs' : ''
      }`}
      style={{ height: ROW_H }}
    >
      <span className={value === undefined ? 'min-w-0 flex-1 truncate pr-1' : 'shrink-0'}>{label}</span>
      {value !== undefined && <span className="min-w-0 flex-1 truncate pr-1 text-right tabular-nums text-slate-500 dark:text-slate-400">{value}</span>}
    </span>
  );
}

/** The overflow row: "+N more", optionally naming what is hidden. */
export function MoreRow({ count, extra, onClick }: { count: number; extra?: string; onClick?: () => void }) {
  const content = (
    <>
      <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">+{count}</span>
      <span className="min-w-0 flex-1 truncate pr-1">more{extra ? ` · ${extra}` : ''}</span>
    </>
  );
  const cls =
    'flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-lg border border-dashed border-slate-300 px-2.5 text-left text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition hover:border-indigo-400`} style={{ height: ROW_H }} title={extra}>
      {content}
    </button>
  ) : (
    <span className={cls} style={{ height: ROW_H }} title={extra}>
      {content}
    </span>
  );
}

/**
 * A row that OPENS something — a map part. Same height as every other row so it sits in a budget.
 * `ariaLabel` lets an existing accessible name (e.g. "Edit shop settings") survive the move onto a tile.
 */
export function PartRow({ label, value, onClick, ariaLabel, disabled = false }: { label: string; value?: string; onClick: () => void; ariaLabel?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="waves-effect flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg border border-indigo-300/70 bg-indigo-50/70 px-2.5 text-left text-sm text-slate-800 transition hover:border-indigo-500 disabled:pointer-events-none disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-400 dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-slate-100 dark:hover:border-indigo-400"
      style={{ height: ROW_H }}
    >
      <span className="shrink-0 font-medium">{label}</span>
      {value !== undefined && <span className="min-w-0 flex-1 truncate pr-1 text-right text-slate-500 dark:text-slate-400">{value}</span>}
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-indigo-500" />
    </button>
  );
}

/** A fixed-height block of `n` rows; anything inside is laid out top-down and never grows the tile. */
export function RowBlock({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col overflow-hidden" style={{ height: rowsHeight(n), gap: ROW_GAP }}>
      {children}
    </span>
  );
}

/** The designed empty state: fills its whole budget with one sentence about what goes there. */
export function EmptyRows({ n, children }: { n: number; children: ReactNode }) {
  return (
    <RowBlock n={n}>
      <span className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 px-3 text-center text-sm leading-snug text-slate-500 dark:border-slate-600 dark:text-slate-400">
        {children}
      </span>
    </RowBlock>
  );
}

/**
 * A list on a budget: up to `n` rows; past that, `n-1` rows and a "+N more" row. Empty fills the same
 * height with `empty`. So a tile with 2 entries and one with 148 are exactly the same size.
 */
export function BudgetRows<T>({
  items,
  n,
  render,
  empty,
  extra,
}: {
  items: readonly T[];
  n: number;
  render: (item: T, index: number) => ReactNode;
  empty: ReactNode;
  /** What the hidden rows are, for the "+N more" row (e.g. "12 use 302"). */
  extra?: string;
}) {
  if (items.length === 0) return <EmptyRows n={n}>{empty}</EmptyRows>;
  const { shown, more } = budget(items, n);
  return (
    <RowBlock n={n}>
      {shown.map(render)}
      {more > 0 && <MoreRow count={more} extra={extra} />}
    </RowBlock>
  );
}

/** A key/value pair line for a tile summary (label column, then a truncating value). */
export function KV({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'muted' | 'warn' }) {
  const valueTone = {
    normal: 'text-slate-700 dark:text-slate-200',
    muted: 'text-slate-400 dark:text-slate-500',
    warn: 'font-semibold text-amber-700 dark:text-amber-400',
  }[tone];
  return (
    <span className="flex min-w-0 items-baseline gap-3 text-sm">
      <span className="w-20 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`min-w-0 flex-1 truncate pr-1 ${valueTone}`} title={value}>
        {value}
      </span>
    </span>
  );
}

/** Two lines of muted text, always exactly two lines tall. */
export function Note({ children }: { children: ReactNode }) {
  return <span className="line-clamp-2 block h-[2.6em] text-sm leading-[1.3] text-slate-500 dark:text-slate-400">{children}</span>;
}

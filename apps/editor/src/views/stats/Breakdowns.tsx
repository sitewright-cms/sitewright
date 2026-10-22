import type { ReactNode } from 'react';
import { useState } from 'react';
import { X } from 'lucide-react';
import type { SiteStats, StatsDevice } from '@sitewright/schema';
import { BOT_LABELS, countryFlag, countryName, fmt, longDay, pct, SOURCE_LABELS } from './format';

/** A titled panel inside the Statistics tab. `action` sits at the right of its heading. */
export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5" aria-label={title}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
        {action && <span className="flex flex-wrap items-center gap-2">{action}</span>}
      </header>
      {children}
    </section>
  );
}

/** One row of a breakdown: a label, a proportional bar behind it, and the numbers. `muted`: a remainder, not an item. */
function BarRow({
  label,
  value,
  share,
  detail,
  onClick,
  active,
  muted,
}: {
  label: ReactNode;
  value: string;
  share: number;
  detail?: string;
  onClick?: () => void;
  active?: boolean;
  muted?: boolean;
}) {
  const inner = (
    <>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 rounded-md ${muted ? 'bg-slate-400/15 dark:bg-slate-400/15' : active ? 'bg-indigo-500/25' : 'bg-indigo-500/10 dark:bg-indigo-400/15'}`}
        style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }}
      />
      <span className={`relative min-w-0 flex-1 ${muted ? 'italic text-slate-500 dark:text-slate-400' : 'truncate'}`}>{label}</span>
      {detail && <span className="relative shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{detail}</span>}
      <span className={`relative w-14 shrink-0 text-right font-semibold tabular-nums ${muted ? 'text-slate-500 dark:text-slate-400' : ''}`}>{value}</span>
    </>
  );
  const cls = 'relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200';
  return onClick ? (
    <button type="button" className={`${cls} transition hover:bg-slate-100 dark:hover:bg-white/10`} onClick={onClick} aria-pressed={active}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">{children}</p>;

/** A quiet line under a list: what it does not show, so a short list is not read as the whole. */
const Footnote = ({ children }: { children: ReactNode }) => <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{children}</p>;

export const DEVICE_LABELS: Record<StatsDevice, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };

/**
 * An active filter, with the button that clears it. Shown above the figures AND on every tile the filter applies
 * to, so nobody reads a filtered tile as the whole site. Every copy carries the same name and clears the filter
 * everywhere. `compact` shows the value alone (the KPI cards are narrow); its button keeps the full name.
 */
export function FilterChip({ label, value, onClear, compact }: { label: string; value?: string; onClear: () => void; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-indigo-300/70 bg-indigo-50 text-indigo-800 dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-indigo-200 ${compact ? 'py-0 pl-2 pr-0.5 text-xs' : 'py-0.5 pl-3 pr-1 text-sm'}`}
    >
      <span className="max-w-[10rem] truncate">{compact && value ? value : label}</span>
      <button type="button" className="shrink-0 rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-500/20" aria-label={`Clear ${label}`} onClick={onClear}>
        <X className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      </button>
    </span>
  );
}

/** The active device and country filters, and how to clear each — every tile gets them, to show what it applies. */
export interface ActiveFilters {
  device?: StatsDevice;
  country?: string;
  clearDevice: () => void;
  clearCountry: () => void;
}

/**
 * A tile's filter pills: one per active filter the tile APPLIES. An active filter it cannot apply gets a quiet
 * note instead (`note`, or "Any device" / "All countries" / "All visitors"), so a tile never looks filtered when
 * it is not — nor unfiltered when it is.
 */
export function TileFilters({ filters, cannot = [], note, compact }: { filters: ActiveFilters; cannot?: Array<'device' | 'country'>; note?: string; compact?: boolean }) {
  const { device, country } = filters;
  const skipDevice = Boolean(device) && cannot.includes('device');
  const skipCountry = Boolean(country) && cannot.includes('country');
  const quiet = note && (skipDevice || skipCountry) ? note : skipDevice && skipCountry ? 'All visitors' : skipDevice ? 'Any device' : skipCountry ? 'All countries' : null;
  if (!device && !country) return null;
  return (
    <>
      {/* eslint-disable-next-line security/detect-object-injection -- device is a typed StatsDevice */}
      {device && !skipDevice && <FilterChip label={`Device: ${DEVICE_LABELS[device]}`} value={DEVICE_LABELS[device]} onClear={filters.clearDevice} compact={compact} />}
      {country && !skipCountry && <FilterChip label={`Country: ${countryName(country)}`} value={countryName(country)} onClear={filters.clearCountry} compact={compact} />}
      {quiet && <span className="text-xs text-slate-500 dark:text-slate-400">{quiet}</span>}
    </>
  );
}

/**
 * What a filtered list's remainder row holds, in words: rows under the minimum count (so nobody can be picked
 * out), and — when the period starts before it — the days before the device × country breakdown began.
 */
function remainderNote(breakdown: NonNullable<SiteStats['breakdown']>, from: string, unit: 'views' | 'visitors'): string {
  const min = breakdown.minCount;
  const what = unit === 'views' ? `Pages viewed fewer than ${min} times` : `Sources with fewer than ${min} visitors`;
  const before = breakdown.since > from ? ` Visits before ${longDay(breakdown.since)} are not broken down by device and country at all.` : '';
  return `${what} under this filter are not listed, so no single visit can be picked out; they are counted in the last line.${before}`;
}

/** A filter matched by fewer visitors than the minimum count lists nothing from the breakdown (see STATS_MIN_COUNT). */
function ThinNote({ breakdown, what }: { breakdown: NonNullable<SiteStats['breakdown']>; what: string }) {
  return (
    <Empty>
      Fewer than {breakdown.minCount} visitors match this filter, so no {what} are listed — a list this small could single someone out.
    </Empty>
  );
}

export function DevicesPanel({ stats, filters, onDevice }: { stats: SiteStats; filters: ActiveFilters; onDevice: (d: StatsDevice | undefined) => void }) {
  const total = stats.devices.reduce((n, d) => n + d.visitors, 0);
  const { device } = filters;
  return (
    <Panel title="Devices" action={<TileFilters filters={filters} />}>
      <div className="flex flex-col gap-1">
        {stats.devices.map((d) => (
          <BarRow
            key={d.device}
            label={DEVICE_LABELS[d.device]}
            value={pct(d.visitors, total)}
            detail={`${fmt(d.visitors)} visitors`}
            share={total ? d.visitors / total : 0}
            active={device === d.device}
            onClick={() => onDevice(device === d.device ? undefined : d.device)}
          />
        ))}
      </div>
    </Panel>
  );
}

const COUNTRIES_SHOWN = 10;

export function CountriesPanel({ stats, filters, onCountry }: { stats: SiteStats; filters: ActiveFilters; onCountry: (c: string | undefined) => void }) {
  const [all, setAll] = useState(false);
  const total = stats.countries.reduce((n, c) => n + c.visitors, 0);
  const rows = all ? stats.countries : stats.countries.slice(0, COUNTRIES_SHOWN);
  const { country } = filters;
  return (
    <Panel
      title="Countries"
      action={
        <>
          <TileFilters filters={filters} />
          {stats.countries.length > COUNTRIES_SHOWN && (
            <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${stats.countries.length}`}
            </button>
          )}
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>No visitors yet.</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((c) => (
            <BarRow
              key={c.country}
              label={
                <>
                  <span aria-hidden className="mr-1.5">{countryFlag(c.country)}</span>
                  {countryName(c.country)}
                </>
              }
              value={fmt(c.visitors)}
              detail={pct(c.visitors, total)}
              share={total ? c.visitors / total : 0}
              active={country === c.country}
              onClick={() => onCountry(country === c.country ? undefined : c.country)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Under a filter: human pageviews per page, then what the breakdown could not place. */
export function PagesPanel({ stats, filters }: { stats: SiteStats; filters: ActiveFilters }) {
  const bd = stats.breakdown;
  const rest = bd?.pages ?? 0;
  const max = Math.max(1, rest, ...stats.pages.map((p) => p.views));
  return (
    <Panel title="Top pages" action={<TileFilters filters={filters} />}>
      {bd?.thin && rest > 0 ? (
        <ThinNote breakdown={bd} what="pages" />
      ) : stats.pages.length === 0 && rest === 0 ? (
        <Empty>No pageviews yet.</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {stats.pages.slice(0, 15).map((p) => (
            <BarRow key={p.path} label={<span className="font-mono text-xs">{p.path}</span>} value={fmt(p.views)} detail={p.botViews ? `${fmt(p.botViews)} bot` : undefined} share={p.views / max} />
          ))}
          {rest > 0 && bd && <BarRow label={`Fewer than ${bd.minCount} views each, or not broken down`} value={fmt(rest)} share={rest / max} muted />}
        </div>
      )}
      {rest > 0 && bd && !bd.thin && <Footnote>{remainderNote(bd, stats.from, 'views')}</Footnote>}
    </Panel>
  );
}

export function SourcesPanel({ stats, filters }: { stats: SiteStats; filters: ActiveFilters }) {
  const bd = stats.breakdown;
  const rest = bd?.sources ?? 0;
  const total = stats.sources.reduce((n, s) => n + s.visitors, 0) + rest;
  return (
    <Panel title="Sources" action={<TileFilters filters={filters} />}>
      {bd?.thin && rest > 0 ? (
        <ThinNote breakdown={bd} what="sources" />
      ) : stats.sources.length === 0 && rest === 0 ? (
        <Empty>No visitors yet.</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {stats.sources.slice(0, 15).map((s) => (
            <BarRow
              key={`${s.source}:${s.host}`}
              label={
                <>
                  {s.host || (s.source === 'direct' ? 'Direct' : `Other ${SOURCE_LABELS[s.source].toLowerCase()} sites`)}
                  {s.host && <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">{SOURCE_LABELS[s.source]}</span>}
                </>
              }
              value={fmt(s.visitors)}
              detail={pct(s.visitors, total)}
              share={total ? s.visitors / total : 0}
            />
          ))}
          {rest > 0 && bd && (
            <BarRow label={`Fewer than ${bd.minCount} visitors each, or not broken down`} value={fmt(rest)} detail={pct(rest, total)} share={total ? rest / total : 0} muted />
          )}
        </div>
      )}
      {rest > 0 && bd && !bd.thin && <Footnote>{remainderNote(bd, stats.from, 'visitors')}</Footnote>}
    </Panel>
  );
}

/** Bots have a country but no device: the device filter does not reach them, and the tile says so. */
export function BotsPanel({ stats, filters }: { stats: SiteStats; filters: ActiveFilters }) {
  const total = stats.botViews;
  return (
    <Panel title="Bots" action={<TileFilters filters={filters} cannot={['device']} note="Any device (bots have none)" />}>
      {stats.bots.length === 0 ? (
        <Empty>No bot traffic.</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {stats.bots.map((b) => (
            <BarRow key={b.class} label={BOT_LABELS[b.class]} value={fmt(b.views)} detail={pct(b.views, total)} share={total ? b.views / total : 0} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * `visitors` is the visitor count for a conversion rate — omitted when the goals are not all broken down by the
 * active filter (it would compare a part with a whole). Under a DEVICE filter the rates are approximate: a form's
 * device is read from the browser that sent it, without the page's own hints.
 */
export function GoalsPanel({ stats, filters, visitors }: { stats: SiteStats; filters: ActiveFilters; visitors?: number }) {
  const bd = stats.breakdown;
  const max = Math.max(1, ...stats.goals.map((g) => g.count));
  const rest = bd?.goals ?? 0;
  const unlisted = bd?.goalsUnlisted ?? 0;
  const rate = (n: number): string | undefined => (visitors ? `${filters.device ? '≈ ' : ''}${pct(n, visitors)} of visitors` : undefined);
  return (
    <Panel title="Goals" action={<TileFilters filters={filters} />}>
      {bd?.thin && bd.goalCount !== 0 ? (
        <ThinNote breakdown={bd} what="forms" />
      ) : stats.goals.length === 0 && unlisted === 0 ? (
        <Empty>{rest > 0 ? 'None broken down for this filter.' : 'No form submissions in this period.'}</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {stats.goals.map((g) => (
            <BarRow key={g.goal} label={g.label} value={fmt(g.count)} detail={rate(g.count)} share={g.count / max} />
          ))}
          {unlisted !== 0 && bd && (
            <BarRow
              label={`Other forms, fewer than ${bd.minCount} each`}
              value={unlisted === 'few' ? `< ${bd.minCount}` : fmt(unlisted)}
              share={unlisted === 'few' ? 0 : unlisted / max}
              muted
            />
          )}
        </div>
      )}
      {unlisted !== 0 && bd && !bd.thin && (
        <Footnote>Under a filter, a form sent fewer than {bd.minCount} times is not named, so no single submission can be matched to a visitor.</Footnote>
      )}
      {rest > 0 && bd && (
        <Footnote>
          {fmt(rest)} form {rest === 1 ? 'submission' : 'submissions'} in this period {rest === 1 ? 'is' : 'are'} not broken down by device or country
          {bd.since > stats.from ? ` (recorded before ${longDay(bd.since)})` : ''}, so {rest === 1 ? 'it is' : 'they are'} in no filter.
        </Footnote>
      )}
      {filters.device && bd && (stats.goals.length > 0 || unlisted !== 0) && (
        <Footnote>
          A form’s device is read from the browser that sent it, which can differ from how the page read it (an iPad asking for the desktop site
          counts as desktop here), so these figures are approximate.
        </Footnote>
      )}
    </Panel>
  );
}

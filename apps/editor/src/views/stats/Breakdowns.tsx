import type { ReactNode } from 'react';
import { useState } from 'react';
import { X } from 'lucide-react';
import type { SiteStats, StatsDevice } from '@sitewright/schema';
import { BOT_LABELS, countryFlag, countryName, fmt, pct, SOURCE_LABELS } from './format';

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

/** One row of a breakdown: a label, a proportional bar behind it, and the numbers. */
function BarRow({ label, value, share, detail, onClick, active }: { label: ReactNode; value: string; share: number; detail?: string; onClick?: () => void; active?: boolean }) {
  const inner = (
    <>
      <span aria-hidden className={`absolute inset-y-0 left-0 rounded-md ${active ? 'bg-indigo-500/25' : 'bg-indigo-500/10 dark:bg-indigo-400/15'}`} style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="relative shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{detail}</span>}
      <span className="relative w-14 shrink-0 text-right font-semibold tabular-nums">{value}</span>
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

export const DEVICE_LABELS: Record<StatsDevice, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };

/**
 * An active filter, with the button that clears it. Shown above the figures AND in the section the filter
 * belongs to, so a filter set in one panel is visible from the others. The two copies carry the same name
 * and do the same thing; each sits in its own labelled region.
 */
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-300/70 bg-indigo-50 py-0.5 pl-3 pr-1 text-sm text-indigo-800 dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-indigo-200">
      {label}
      <button type="button" className="rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-500/20" aria-label={`Clear ${label}`} onClick={onClear}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

export function DevicesPanel({ stats, device, onDevice }: { stats: SiteStats; device?: StatsDevice; onDevice: (d: StatsDevice | undefined) => void }) {
  const total = stats.devices.reduce((n, d) => n + d.visitors, 0);
  return (
    // eslint-disable-next-line security/detect-object-injection -- device is a typed StatsDevice
    <Panel title="Devices" action={device && <FilterChip label={`Device: ${DEVICE_LABELS[device]}`} onClear={() => onDevice(undefined)} />}>
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

export function CountriesPanel({ stats, country, onCountry }: { stats: SiteStats; country?: string; onCountry: (c: string | undefined) => void }) {
  const [all, setAll] = useState(false);
  const total = stats.countries.reduce((n, c) => n + c.visitors, 0);
  const rows = all ? stats.countries : stats.countries.slice(0, COUNTRIES_SHOWN);
  return (
    <Panel
      title="Countries"
      action={
        (country || stats.countries.length > COUNTRIES_SHOWN) && (
          <>
            {country && <FilterChip label={`Country: ${countryName(country)}`} onClear={() => onCountry(undefined)} />}
            {stats.countries.length > COUNTRIES_SHOWN && (
              <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setAll(!all)}>
                {all ? 'Show fewer' : `Show all ${stats.countries.length}`}
              </button>
            )}
          </>
        )
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

export function PagesPanel({ stats }: { stats: SiteStats }) {
  const max = Math.max(1, ...stats.pages.map((p) => p.views));
  return (
    <Panel title="Top pages">
      {stats.pages.length === 0 ? (
        <Empty>No pageviews yet.</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {stats.pages.slice(0, 15).map((p) => (
            <BarRow key={p.path} label={<span className="font-mono text-xs">{p.path}</span>} value={fmt(p.views)} detail={p.botViews ? `${fmt(p.botViews)} bot` : undefined} share={p.views / max} />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function SourcesPanel({ stats }: { stats: SiteStats }) {
  const total = stats.sources.reduce((n, s) => n + s.visitors, 0);
  return (
    <Panel title="Sources">
      {stats.sources.length === 0 ? (
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
        </div>
      )}
    </Panel>
  );
}

export function BotsPanel({ stats }: { stats: SiteStats }) {
  const total = stats.botViews;
  return (
    <Panel title="Bots">
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

/** `visitors` is the unfiltered visitor count for a conversion rate — omitted while a filter is on, because goals are not split by device or country. */
export function GoalsPanel({ stats, visitors }: { stats: SiteStats; visitors?: number }) {
  const max = Math.max(1, ...stats.goals.map((g) => g.count));
  return (
    <Panel title="Goals">
      {stats.goals.length === 0 ? (
        <Empty>No form submissions in this period.</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {stats.goals.map((g) => (
            <BarRow key={g.goal} label={g.label} value={fmt(g.count)} detail={visitors ? `${pct(g.count, visitors)} of visitors` : undefined} share={g.count / max} />
          ))}
        </div>
      )}
    </Panel>
  );
}

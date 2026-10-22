import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Loader2, Search } from 'lucide-react';
import {
  SEARCH_PERFORMANCE_PERIODS,
  type SearchPerformanceDay,
  type SearchPerformanceFigures,
  type SearchPerformancePeriod,
  type SearchPerformanceRow,
  type SearchPerformanceView as View,
  type WebmasterService,
} from '@sitewright/schema';
import { api } from '../../api';
import { accentChip, glassCard, gradientHover, gradientSurface } from '../../theme';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { Panel } from './Breakdowns';
import { useChartTip } from './ChartTip';
import { fmt, longDay, shortDay } from './format';

/**
 * SEARCH PERFORMANCE — how the site does in Google and Bing search, from the platform's own Search Console and Bing
 * Webmaster accounts (verified in Website settings → Search engines): clicks, impressions, click-through rate and
 * average position, per day and for the top searches and pages, against the period before. The client sees it too.
 */

const ENGINE: Record<WebmasterService, string> = { google: 'Google', bing: 'Bing' };

/** The period the view opens on (the Statistics tab asks for it ahead, so it is ready when the view opens). */
export const SEARCH_PERFORMANCE_DEFAULT_DAYS: SearchPerformancePeriod = 28;
const percent = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);
const position = (v: number | null): string => (v === null ? '—' : v.toFixed(1));
const message = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'The search numbers could not be read');

/** A page's address as a path on the site, when it is on the site. */
function pathOf(url: string, siteUrl: string): string {
  return url.startsWith(siteUrl) ? `/${url.slice(siteUrl.length)}` : url;
}

/** The change against the period before: up is better for everything but the position, where lower is better. */
function Change({ now, before, lowerIsBetter = false, format }: { now: number | null; before: number | null | undefined; lowerIsBetter?: boolean; format: (n: number) => string }) {
  if (now === null || before === null || before === undefined || before === 0 || now === before) return null;
  const up = now > before;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
      <Icon className="h-3 w-3" aria-hidden />
      <span className="sr-only">{up ? 'up' : 'down'} from</span> {format(before)} before
    </span>
  );
}

function Kpi({ label, value, change }: { label: string; value: string; change?: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
      {change && <div className="mt-0.5">{change}</div>}
    </div>
  );
}

/** Impressions per day as light bars, clicks as a line over them (each on its own scale, as Search Console does). */
function SearchChart({ daily }: { daily: SearchPerformanceDay[] }) {
  const tip = useChartTip();
  const { hide } = tip;
  useEffect(() => hide(), [daily, hide]);
  const W = 720;
  const H = 160;
  const maxImpr = Math.max(1, ...daily.map((d) => d.impressions));
  const maxClicks = Math.max(1, ...daily.map((d) => d.clicks));
  const slot = W / Math.max(1, daily.length);
  const gap = slot > 6 ? Math.min(4, slot * 0.2) : 0;
  const bar = Math.max(0.5, slot - gap);
  const line = daily.map((d, i) => `${i === 0 ? 'M' : 'L'}${(i + 0.5) * slot},${H - 2 - (d.clicks / maxClicks) * (H - 8)}`).join(' ');
  const clicks = daily.reduce((n, d) => n + d.clicks, 0);
  const impressions = daily.reduce((n, d) => n + d.impressions, 0);
  const label = daily.length
    ? `Clicks and impressions per day from ${shortDay(daily[0]!.date)} to ${shortDay(daily[daily.length - 1]!.date)}: ${fmt(clicks)} clicks, ${fmt(impressions)} impressions`
    : 'No days with search data';
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={label}>
        {daily.map((d, i) => {
          const h = (d.impressions / maxImpr) * (H - 4);
          const x = i * slot + gap / 2;
          return (
            <g
              key={d.date}
              data-day={d.date}
              onMouseEnter={(e) =>
                tip.showAt(e.currentTarget.lastElementChild ?? e.currentTarget, [
                  longDay(d.date),
                  `${fmt(d.clicks)} click${d.clicks === 1 ? '' : 's'}`,
                  `${fmt(d.impressions)} impression${d.impressions === 1 ? '' : 's'}`,
                  ...(d.impressions ? [`${percent(d.clicks / d.impressions)} click-through`] : []),
                ])
              }
              onMouseLeave={tip.hide}
            >
              <rect x={x} y={0} width={bar} height={H} fill="transparent" />
              <rect x={x} y={H - h} width={bar} height={h} rx={bar > 4 ? 2 : 0} className="fill-sky-200 dark:fill-sky-900" />
            </g>
          );
        })}
        {daily.length > 1 && <path d={line} fill="none" strokeWidth={2.5} vectorEffect="non-scaling-stroke" className="stroke-indigo-600 dark:stroke-indigo-300" pointerEvents="none" />}
      </svg>
      {tip.bubble}
      {daily.length > 0 && (
        <figcaption className="mt-1 flex justify-between text-xs tabular-nums text-slate-500 dark:text-slate-400">
          <span>{shortDay(daily[0]!.date)}</span>
          <span>{shortDay(daily[daily.length - 1]!.date)}</span>
        </figcaption>
      )}
      <p className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded bg-indigo-600 dark:bg-indigo-300" /> Clicks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-sky-200 dark:bg-sky-900" /> Impressions
        </span>
      </p>
    </figure>
  );
}

/** The top searches or pages: on a phone the key, clicks and impressions; the rate and position from `sm` up. */
function TopTable({ title, keyLabel, rows, keyOf }: { title: string; keyLabel: string; rows: SearchPerformanceRow[]; keyOf: (r: SearchPerformanceRow) => string }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">Nothing in this period yet.</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              <th scope="col" className="pb-2 pr-2">
                {keyLabel}
              </th>
              <th scope="col" className="w-16 pb-2 text-right">
                Clicks
              </th>
              <th scope="col" className="w-24 pb-2 text-right">
                Impressions
              </th>
              <th scope="col" className="w-14 pb-2 text-right max-sm:hidden">
                CTR
              </th>
              <th scope="col" className="w-16 pb-2 text-right max-sm:hidden">
                Position
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-slate-200/70 text-slate-700 dark:border-white/10 dark:text-slate-200">
                <td className="py-1.5 pr-2">
                  {/* The whole search or address in the editor's tooltip: the cell cuts a long one off. The tooltip's
                      host is inline-flex, so it takes the cell's width and the text inside it truncates. */}
                  <Tooltip tip={r.key} className="flex w-full min-w-0">
                    <span className="min-w-0 truncate">{keyOf(r)}</span>
                  </Tooltip>
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums">{fmt(r.clicks)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(r.impressions)}</td>
                <td className="py-1.5 text-right tabular-nums max-sm:hidden">{percent(r.ctr)}</td>
                <td className="py-1.5 text-right tabular-nums max-sm:hidden">{position(r.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** The shape of the numbers while the first answer is on its way: the same boxes, pulsing. */
function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden data-testid="search-performance-skeleton">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="mt-2.5 h-7 w-16 rounded-md" />
            <Skeleton className="mt-2 h-3 w-24 rounded" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
        <Skeleton className="h-3 w-48 rounded" />
        <Skeleton className="mt-3 h-40 w-full rounded-lg" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1].map((t) => (
          <div key={t} className="flex flex-col gap-2.5 rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
            <Skeleton className="h-3 w-28 rounded" />
            {[0, 1, 2, 3, 4].map((r) => (
              <Skeleton key={r} className={`h-4 rounded ${r % 2 ? 'w-4/5' : 'w-full'}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SearchPerformanceView({ projectId, services }: { projectId: string; services: WebmasterService[] }) {
  const [service, setService] = useState<WebmasterService>(services[0] ?? 'google');
  const [days, setDays] = useState<SearchPerformancePeriod>(SEARCH_PERFORMANCE_DEFAULT_DAYS);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Newest request wins: a slow answer for the previous choice must not overwrite the current one.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSearchPerformance(projectId, service, days);
      if (mine === seq.current) setView(res);
    } catch (err) {
      if (mine === seq.current) {
        setView(null);
        setError(message(err));
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [projectId, service, days]);

  useEffect(() => {
    void load();
  }, [load]);
  // A search engine that stopped having data (switched off) is not kept selected.
  useEffect(() => {
    if (services.length && !services.includes(service)) setService(services[0]!);
  }, [services, service]);

  const totals: SearchPerformanceFigures | undefined = view?.totals;
  const before = view?.previous;
  const empty = view && view.totals.impressions === 0 && view.daily.length === 0;
  return (
    <section className={`${glassCard} overflow-hidden`} aria-labelledby="search-performance-heading">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 bg-slate-100/70 px-5 py-3 dark:border-slate-700/70 dark:bg-white/10">
        <span className={accentChip} aria-hidden>
          <Search className="h-4 w-4" />
        </span>
        <h2 id="search-performance-heading" className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          Search performance
        </h2>
        {/* On a phone the line goes under the title, so the spinner keeps its place beside it. */}
        <span className="text-sm text-slate-500 max-sm:order-last max-sm:basis-full dark:text-slate-400">How often the site is shown and clicked in search results</span>
        {/* The search engines take a second or two to answer: the title bar says something is coming. */}
        <span role="status" className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {loading && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400" aria-hidden />
              <span className="max-sm:sr-only">Asking {ENGINE[service]}…</span>
            </>
          )}
        </span>
      </header>
      <div className="flex flex-col gap-4 p-5" aria-busy={loading}>
        <div className="flex flex-wrap items-center gap-2">
          {services.length > 1 && (
            <div role="radiogroup" aria-label="Search engine" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/10">
              {services.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={service === s}
                  className={`rounded-lg px-2.5 py-1 text-sm font-medium transition ${service === s ? gradientSurface : `text-slate-600 dark:text-slate-300 ${gradientHover}`}`}
                  onClick={() => setService(s)}
                >
                  {ENGINE[s]}
                </button>
              ))}
            </div>
          )}
          <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/10">
            {SEARCH_PERFORMANCE_PERIODS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                className={`rounded-lg px-2.5 py-1 text-sm font-medium transition ${days === d ? gradientSurface : `text-slate-600 dark:text-slate-300 ${gradientHover}`}`}
                onClick={() => setDays(d)}
              >
                {d} days
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-300/70 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </p>
        )}
        {empty && (
          <p role="note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
            {ENGINE[view.service]} has no searches for this site in this period yet. A newly verified site takes a few days to show data.
          </p>
        )}

        {loading && !view && !error && <SearchSkeleton />}
        {view && totals && (
          // The numbers on screen while another search engine or period loads are the previous choice's: dimmed.
          <div className={`flex flex-col gap-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Clicks" value={fmt(totals.clicks)} change={<Change now={totals.clicks} before={before?.clicks} format={fmt} />} />
              <Kpi label="Impressions" value={fmt(totals.impressions)} change={<Change now={totals.impressions} before={before?.impressions} format={fmt} />} />
              <Kpi label="Click-through rate" value={percent(totals.ctr)} change={<Change now={totals.ctr} before={before?.ctr} format={(n) => percent(n)} />} />
              <Kpi
                label="Average position"
                value={position(totals.position)}
                change={<Change now={totals.position} before={before?.position} lowerIsBetter format={(n) => position(n)} />}
              />
            </div>
            <Panel title="Clicks and impressions per day">
              <SearchChart daily={view.daily} />
            </Panel>
            <div className="grid gap-4 xl:grid-cols-2">
              <TopTable title="Top searches" keyLabel="Search" rows={view.queries} keyOf={(r) => r.key} />
              <TopTable title="Top pages" keyLabel="Page" rows={view.pages} keyOf={(r) => pathOf(r.key, view.siteUrl)} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {view.service === 'google'
                ? 'From the platform’s Google Search Console. The newest days can still change. '
                : 'From the platform’s Bing Webmaster Tools. Bing updates searches and pages once a week, and gives no overall position. '}
              Read {new Date(view.fetchedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}; asked again at most once an hour.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

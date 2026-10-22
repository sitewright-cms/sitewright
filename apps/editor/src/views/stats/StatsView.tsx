import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Download, RefreshCw, Settings } from 'lucide-react';
import type { SiteStats, StatsDevice } from '@sitewright/schema';
import { api, downloadStatsCsv, type Project } from '../../api';
import type { OpenWebsiteSettings } from '../../lib/settings-links';
import { accentChip, ghostButton, glassCard, gradientHover, gradientSurface, primaryButton } from '../../theme';
import { DailyChart } from './DailyChart';
import { BotsPanel, CountriesPanel, DEVICE_LABELS, DevicesPanel, FilterChip, GoalsPanel, PagesPanel, Panel, SourcesPanel } from './Breakdowns';
import { WorldMap } from './WorldMap';
import { countryName, fmt, pct, rangeDays, STATS_RANGES, type StatsRangeId } from './format';

/** How often an open Statistics tab refreshes while it shows today. */
const REFRESH_MS = 60_000;

const CSV_TABLES = [
  { table: 'traffic', label: 'Traffic (day, kind, device, country)' },
  { table: 'pages', label: 'Pages' },
  { table: 'sources', label: 'Sources' },
  { table: 'goals', label: 'Goals' },
] as const;

/**
 * The project's STATISTICS tab: the built-in, cookieless visit counter (see analytics/engine.ts on the server).
 *
 * Everything here is a daily total. Clicking a device or a country filters the human figures by it; the two
 * filters combine. The tab refreshes itself once a minute while the range includes today.
 */
export function StatsView({ project, onOpenSettings }: { project: Project; onOpenSettings?: OpenWebsiteSettings }) {
  const [range, setRange] = useState<StatsRangeId>('30d');
  const [device, setDevice] = useState<StatsDevice | undefined>();
  const [country, setCountry] = useState<string | undefined>();
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  // Newest request wins: a slow answer for the previous range must not overwrite the current one.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await api.getStats(project.id, { ...rangeDays(range), ...(device ? { device } : {}), ...(country ? { country } : {}) });
      if (mine !== seq.current) return;
      setStats(res);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : 'Could not load the statistics');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [project.id, range, device, country]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every range ends today, so every range is live: refresh while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const { from, to } = rangeDays(range);
  const filtered = Boolean(device || country);
  const goals = stats?.goals.reduce((n, g) => n + g.count, 0) ?? 0;
  const allViews = (stats?.human.views ?? 0) + (stats?.botViews ?? 0);

  return (
    <section className={`${glassCard} overflow-hidden`} aria-labelledby="stats-heading">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 bg-slate-100/70 px-5 py-3 dark:border-slate-700/70 dark:bg-white/10">
        <span className={accentChip} aria-hidden>
          <BarChart3 className="h-4 w-4" />
        </span>
        <h2 id="stats-heading" className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          Statistics
        </h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">Visits counted by the platform, without cookies</span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className={ghostButton} onClick={() => void load()} aria-label="Refresh statistics" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
          <span className="relative">
            <button type="button" className={ghostButton} aria-expanded={csvOpen} aria-haspopup="menu" onClick={() => setCsvOpen(!csvOpen)}>
              <Download className="h-4 w-4" aria-hidden /> CSV
            </button>
            {csvOpen && (
              <span role="menu" className="absolute right-0 z-20 mt-1 flex w-64 flex-col rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-slate-900">
                {CSV_TABLES.map((t) => (
                  <button
                    key={t.table}
                    type="button"
                    role="menuitem"
                    className="rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                    onClick={() => {
                      setCsvOpen(false);
                      downloadStatsCsv(project.id, from, to, t.table);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </span>
            )}
          </span>
        </span>
      </header>

      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/10">
            {STATS_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={range === r.id}
                className={`rounded-lg px-2.5 py-1 text-sm font-medium transition ${range === r.id ? gradientSurface : `text-slate-600 dark:text-slate-300 ${gradientHover}`}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          {/* eslint-disable-next-line security/detect-object-injection -- device is a typed StatsDevice */}
          {device && <FilterChip label={`Device: ${DEVICE_LABELS[device]}`} onClear={() => setDevice(undefined)} />}
          {country && <FilterChip label={`Country: ${countryName(country)}`} onClear={() => setCountry(undefined)} />}
        </div>

        {stats && !stats.enabled && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              Statistics are off for this site. Turn them on in Website Settings → Analytics, then deploy: the next deploy adds the counter to every page.
            </span>
            {onOpenSettings && (
              <button type="button" className={primaryButton} onClick={() => onOpenSettings('analytics')}>
                <Settings className="h-4 w-4" aria-hidden /> Open Website Settings
              </button>
            )}
          </div>
        )}
        {stats?.enabled && stats.notice === 'no-public-url' && (
          <p role="note" className="rounded-lg border border-sky-300/70 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
            This site is also deployed to another host, but this platform has no public address (SW_PUBLIC_URL), so pages
            there have nowhere to report visits and are published without the counter. Only visits to the locally hosted
            site are counted. An administrator can set the public address.
          </p>
        )}
        {stats?.enabled && stats.human.views === 0 && stats.botViews === 0 && goals === 0 && (
          <p role="note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
            No visits in this period yet. The counter goes onto the pages when the site is deployed, so deploy once after
            switching statistics on.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-rose-300/70 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </p>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Visitors" value={fmt(stats.human.visitors)} />
              <Kpi label="Pageviews" value={fmt(stats.human.views)} hint={stats.human.visitors ? `${(stats.human.views / stats.human.visitors).toFixed(1)} per visitor` : undefined} />
              <Kpi label="Bot pageviews" value={fmt(stats.botViews)} hint={allViews ? `${pct(stats.botViews, allViews)} of all traffic` : undefined} />
              <Kpi label="Goals" value={fmt(goals)} hint={!filtered && stats.human.visitors ? `${pct(goals, stats.human.visitors)} of visitors` : undefined} />
            </div>
            <Panel title="Pageviews per day">
              <DailyChart daily={stats.daily} />
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
              <DevicesPanel stats={stats} device={device} onDevice={setDevice} />
              <CountriesPanel stats={stats} country={country} onCountry={setCountry} />
            </div>
            <WorldMap
              countries={stats.countries}
              selected={country}
              onSelect={setCountry}
              filter={country && <FilterChip label={`Country: ${countryName(country)}`} onClear={() => setCountry(undefined)} />}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <PagesPanel stats={stats} />
              <SourcesPanel stats={stats} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <BotsPanel stats={stats} />
              <GoalsPanel stats={stats} visitors={filtered ? undefined : stats.human.visitors} />
            </div>
          </>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
          <span>
            Days are UTC. A visitor is counted once a day; bots are counted as pageviews.
            {filtered && ' Device and country filters apply to human visitors only.'}
          </span>
          {/* Required by the DB-IP Lite licence (CC BY 4.0) wherever its results are shown. */}
          <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-slate-200">
            IP Geolocation by DB-IP
          </a>
        </footer>
      </div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div role="group" aria-label={label} className="rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

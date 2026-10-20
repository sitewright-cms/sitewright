import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Pause, Play, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import type { ProjectRankings, RankKeywordView, RankStatus } from '@sitewright/schema';
import { api, type Project } from '../../api';
import { dangerButton, ghostButton, gradientHover, gradientSurface } from '../../theme';
import { useDialogs } from '../ui/Dialogs';
import { Tooltip } from '../ui/Tooltip';
import { Panel } from './Breakdowns';
import { RankChart, RankSparkline, positionText } from './RankChart';
import { AddKeywordsForm, RankSettingsForm, placeLabel } from './RankSetup';
import { longDay, rangeDays, type StatsRangeId } from './format';

/**
 * SEARCH RANKINGS — where the site appears in Google for the keywords the agency tracks.
 *
 * Everyone on the project reads it. Agency staff (the server says so with `canManage`) also see the setup, the
 * keyword form, "Check now", and why checks may not be running.
 */

const RANGES: ReadonlyArray<{ id: StatsRangeId; label: string }> = [
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '12m', label: '12 months' },
];

const STATUS_TEXT: Record<Exclude<RankStatus, 'ok'>, string> = {
  'no-provider':
    'No rank-tracking provider is set up, so nothing is checked. An instance admin can add one in System Settings → Integrations.',
  'budget-reached': "This month's rank-tracking budget is used up. Checks resume on the 1st, or an instance admin can raise the budget.",
  'provider-error': 'The provider refused the last checks. An instance admin can see why in System Settings → Integrations.',
};

/** `https://www.example.com/services/` → `/services/`; another host is shown whole. */
function pagePath(url: string, domain: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return host === domain ? `${u.pathname}${u.search}` : `${host}${u.pathname}`;
  } catch {
    return url;
  }
}

function Change({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="text-slate-400 dark:text-slate-500">{value === 0 ? '±0' : '—'}</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${up ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
      {up ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden />}
      <span className="sr-only">{up ? 'up' : 'down'}</span>
      {Math.abs(value)}
    </span>
  );
}

function Position({ k }: { k: RankKeywordView }) {
  if (!k.latest) return <span className="text-sm text-slate-500 dark:text-slate-400">{k.pending ? 'Checking…' : 'Not checked yet'}</span>;
  if (k.latest.position === null) return <span className="text-sm text-slate-500 dark:text-slate-400">Not in top {k.latest.depth}</span>;
  return <span className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{k.latest.position}</span>;
}

export function RankingsView({
  project,
  initial,
  onLoaded,
}: {
  project: Project;
  initial?: ProjectRankings | null;
  /** Each fresh answer, so the parent's copy (its first answer for the next visit) stays current. */
  onLoaded?: (r: ProjectRankings) => void;
}) {
  const { confirm, dialog } = useDialogs();
  const [range, setRange] = useState<StatsRangeId>('90d');
  const [data, setData] = useState<ProjectRankings | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await api.getRankings(project.id, rangeDays(range));
      if (mine !== seq.current) return;
      setData(res);
      setError(null);
      onLoaded?.(res);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : 'Could not load the rankings');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // `onLoaded` is the parent's setter wrapper; a new identity must not refetch.
  }, [project.id, range]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkNow(): Promise<void> {
    setChecking(true);
    setNotice(null);
    try {
      const r = await api.checkRankingsNow(project.id);
      setNotice(
        r.sent > 0
          ? `Sent ${r.sent} check${r.sent === 1 ? '' : 's'}. Results usually arrive within minutes; this page shows them on refresh.`
          : r.status === 'ok'
            ? 'Every keyword was already checked today.'
            : STATUS_TEXT[r.status],
      );
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not start the check');
    } finally {
      setChecking(false);
    }
  }

  async function togglePause(k: RankKeywordView): Promise<void> {
    try {
      await api.setRankKeywordPaused(project.id, k.id, !k.paused);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the keyword');
    }
  }

  async function remove(k: RankKeywordView): Promise<void> {
    const ok = await confirm({
      title: 'Remove keyword',
      message: `Stop tracking “${k.keyword}” and delete its history?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeRankKeyword(project.id, k.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the keyword');
    }
  }

  const manage = data?.canManage ?? false;
  const tracking = data?.tracking ?? null;
  // The range the DATA is for: while a new range loads, the old answer is still drawn on its own axis.
  const { from, to } = data ? { from: data.from, to: data.to } : rangeDays(range);
  const lastChecked = data?.keywords.reduce<string | null>((max, k) => (k.latest && (!max || k.latest.checkedAt > max) ? k.latest.checkedAt : max), null);
  const suggested = project.siteUrl ? project.siteUrl.replace(/^https?:\/\//, '').split('/')[0] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Rankings period" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/10">
          {RANGES.map((r) => (
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
        {tracking && (
          <span className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">{tracking.domain}</span> · checked {tracking.schedule} · top {tracking.depth}
            {lastChecked && ` · last result ${longDay(lastChecked.slice(0, 10))}`}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Tooltip tip="Refresh">
            <button type="button" className={ghostButton} onClick={() => void load()} aria-label="Refresh rankings" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </Tooltip>
          {manage && tracking && (data?.keywords.length ?? 0) > 0 && (
            <button type="button" className={ghostButton} onClick={() => void checkNow()} disabled={checking}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          )}
          {manage && tracking && (
            <button type="button" className={ghostButton} aria-expanded={setupOpen} onClick={() => setSetupOpen(!setupOpen)}>
              <Settings2 className="h-4 w-4" aria-hidden /> Setup
            </button>
          )}
        </span>
      </div>

      {manage && data?.status && data.status !== 'ok' && (
        <p role="status" className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {STATUS_TEXT[data.status]}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-sky-300/70 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-rose-300/70 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </p>
      )}

      {data && !tracking && !manage && (
        <p role="note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
          Search rankings are not tracked for this site yet.
        </p>
      )}

      {data && manage && (!tracking || setupOpen) && (
        <Panel title={tracking ? 'Tracking setup' : 'Set up rank tracking'}>
          {!tracking && (
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Choose the domain whose positions are tracked, then add keywords. Each keyword is one paid check a day or a week, as
              scheduled, and the instance's monthly budget caps the total.
            </p>
          )}
          <RankSettingsForm
            projectId={project.id}
            current={tracking}
            suggestedDomain={suggested}
            onSaved={() => {
              setSetupOpen(false);
              void load();
            }}
          />
        </Panel>
      )}

      {data && manage && tracking && (
        <details className="group rounded-xl border border-slate-200/70 bg-white/60 dark:border-white/10 dark:bg-white/5" open={data.keywords.length === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-200">
            <ChevronRight className="h-4 w-4 transition group-open:rotate-90" aria-hidden /> Add keywords
          </summary>
          <div className="border-t border-slate-200/70 p-4 dark:border-white/10">
            <AddKeywordsForm
              projectId={project.id}
              defaultCountry={data.keywords[0]?.location.countryCode}
              onAdded={(message) => {
                setNotice(`${message} They are checked on the next pass, or now with “Check now”.`);
                void load();
              }}
            />
          </div>
        </details>
      )}

      {data && tracking && data.keywords.length === 0 && !manage && (
        <p role="note" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
          No keywords are tracked yet.
        </p>
      )}

      {data && data.keywords.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 dark:border-white/10">
          <table className="w-full text-sm md:min-w-[640px]">
            <caption className="sr-only">Tracked keywords and where the site ranks for each</caption>
            <thead className="bg-slate-100/70 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2">Keyword</th>
                <th scope="col" className="px-3 py-2">Position</th>
                <th scope="col" className="px-3 py-2">Change</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">Best</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">Trend</th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">Page</th>
                {manage && <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.keywords.map((k) => (
                <KeywordRow
                  key={k.id}
                  k={k}
                  domain={tracking?.domain ?? ''}
                  depth={k.latest?.depth ?? tracking?.depth ?? 100}
                  open={open === k.id}
                  onToggle={() => setOpen(open === k.id ? null : k.id)}
                  manage={manage}
                  onPause={() => void togglePause(k)}
                  onRemove={() => void remove(k)}
                  from={from}
                  to={to}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Positions are Google's ordinary (organic) results, 1 being the first; ads, maps and answer boxes are not counted. Days are UTC.
      </p>
    </div>
  );
}

function KeywordRow({
  k,
  domain,
  depth,
  open,
  onToggle,
  manage,
  onPause,
  onRemove,
  from,
  to,
}: {
  k: RankKeywordView;
  domain: string;
  depth: number;
  open: boolean;
  onToggle: () => void;
  manage: boolean;
  onPause: () => void;
  onRemove: () => void;
  from: string;
  to: string;
}) {
  const cols = manage ? 7 : 6;
  // The place first; its region and country only where there is room for them.
  const [place, ...within] = placeLabel(k.location.name).split(', ');
  const region = within.join(', ');
  return (
    <>
      <tr className={`border-t border-slate-200/70 dark:border-white/10 ${k.paused ? 'opacity-60' : ''}`}>
        <td className="px-3 py-2">
          <button type="button" className="flex items-start gap-1.5 text-left" aria-expanded={open} onClick={onToggle}>
            <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition ${open ? '' : '-rotate-90'}`} aria-hidden />
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{k.keyword}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {place}
                {region && <span className="hidden sm:inline">, {region}</span>} · {k.device === 'mobile' ? 'Mobile' : 'Desktop'} · {k.languageCode}
                {k.paused && ' · paused'}
              </span>
            </span>
          </button>
        </td>
        <td className="px-3 py-2">
          <Position k={k} />
        </td>
        <td className="px-3 py-2">
          <Change value={k.change} />
        </td>
        <td className="hidden px-3 py-2 tabular-nums text-slate-700 md:table-cell dark:text-slate-200">{k.best ?? '—'}</td>
        <td className="hidden px-3 py-2 md:table-cell">
          <RankSparkline series={k.series} depth={depth} />
        </td>
        <td className="hidden max-w-[16rem] px-3 py-2 md:table-cell">
          {k.latest?.url ? (
            <a href={k.latest.url} target="_blank" rel="noopener noreferrer" className="block truncate text-slate-700 underline decoration-slate-300 hover:decoration-slate-500 dark:text-slate-200">
              {pagePath(k.latest.url, domain)}
            </a>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">—</span>
          )}
        </td>
        {manage && (
          <td className="px-3 py-2">
            <span className="flex justify-end gap-1">
              <Tooltip tip={k.paused ? 'Resume checking' : 'Pause: keep the history, stop checking'}>
                <button type="button" className={ghostButton} aria-label={k.paused ? `Resume ${k.keyword}` : `Pause ${k.keyword}`} onClick={onPause}>
                  {k.paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
                </button>
              </Tooltip>
              <Tooltip tip="Remove, with its history">
                <button type="button" className={dangerButton} aria-label={`Remove ${k.keyword}`} onClick={onRemove}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </Tooltip>
            </span>
          </td>
        )}
      </tr>
      {open && (
        <tr className="border-t border-slate-200/40 dark:border-white/5">
          <td colSpan={cols} className="px-3 py-3">
            {k.series.length > 0 ? (
              <RankChart keyword={k.keyword} series={k.series} from={from} to={to} depth={depth} />
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No finished checks in this period.</p>
            )}
            {k.latest && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Latest: {positionText(k.latest.position, k.latest.depth)} on {longDay(k.latest.day)}
                {k.best !== null && ` · best in this period: ${k.best}`}
                {k.latest.url && (
                  <>
                    {' · page: '}
                    <a href={k.latest.url} target="_blank" rel="noopener noreferrer" className="break-all underline">
                      {pagePath(k.latest.url, domain)}
                    </a>
                  </>
                )}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

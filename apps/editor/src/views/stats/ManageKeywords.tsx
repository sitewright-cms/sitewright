import { useId, useState } from 'react';
import { ChevronRight, Pause, Play, Search, Trash2 } from 'lucide-react';
import type { RankKeywordView } from '@sitewright/schema';
import { api } from '../../api';
import { dangerButton, ghostButton, glassInput } from '../../theme';
import { useDialogs } from '../ui/Dialogs';
import { SectionHelp } from '../ui/SectionHelp';
import { Tooltip } from '../ui/Tooltip';
import { AddKeywordsForm, placeLabel } from './RankSetup';

/**
 * MANAGE KEYWORDS — the one place a keyword's lifecycle happens: adding it, pausing and resuming it, removing it
 * with its history, and checking every keyword now. Rendered for agency staff only (the server's `canManage`);
 * the results table beside it is read-only for everyone. The server refuses every one of these writes to a
 * client or a token whatever the editor shows.
 */

/** Past this many keywords the list gets a filter: 500 rows are a lot to scan for the one to pause. */
const FILTER_FROM = 8;

export function ManageKeywords({
  projectId,
  keywords,
  checking,
  onCheckNow,
  onChanged,
  onNotice,
}: {
  projectId: string;
  keywords: readonly RankKeywordView[];
  checking: boolean;
  onCheckNow: () => void;
  /** A keyword was added, paused, resumed or removed: the rankings are read again (resolves once they are). */
  onChanged: () => void | Promise<void>;
  onNotice: (message: string) => void;
}) {
  const { confirm, dialog } = useDialogs();
  // Open while there is nothing tracked yet — adding the first keywords is the next step. Afterwards it stays as
  // the user leaves it: adding a keyword must not fold the section away under them.
  const [open, setOpen] = useState(keywords.length === 0);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();
  const headingId = useId();

  const paused = keywords.filter((k) => k.paused).length;
  // Only while its input is shown: a filter left behind when the list shrinks below the threshold would hide rows
  // with no way to clear it.
  const filterable = keywords.length > FILTER_FROM;
  const needle = filterable ? filter.trim().toLowerCase() : '';
  const shown = needle ? keywords.filter((k) => k.keyword.toLowerCase().includes(needle)) : keywords;

  async function togglePause(k: RankKeywordView): Promise<void> {
    setBusy(k.id);
    setError(null);
    try {
      await api.setRankKeywordPaused(projectId, k.id, !k.paused);
      // The row stays busy until the list is read again: before that it still shows the old state, and a second
      // click would send the same change (or remove a keyword that is already gone).
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the keyword');
    } finally {
      setBusy(null);
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
    setBusy(k.id);
    setError(null);
    try {
      await api.removeRankKeyword(projectId, k.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the keyword');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white/60 dark:border-white/10 dark:bg-white/5" aria-labelledby={headingId}>
      {dialog}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h3 id={headingId} className="text-sm font-bold text-slate-700 dark:text-slate-200">
          <button type="button" className="inline-flex items-center gap-2" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
            <ChevronRight className={`h-4 w-4 transition ${open ? 'rotate-90' : ''}`} aria-hidden />
            Manage keywords
          </button>
        </h3>
        <SectionHelp tip="Agency staff only. Add keywords, pause one (it keeps its history and costs nothing), or remove one with its history. Each active keyword is one paid check per scheduled day or week." />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {keywords.length === 0 ? 'none tracked yet' : `${keywords.length} tracked${paused ? `, ${paused} paused` : ''}`}
        </span>
        {keywords.length > 0 && (
          <span className="ml-auto">
            <Tooltip tip="Check every active keyword now (each at most once a day)">
              <button type="button" className={ghostButton} onClick={onCheckNow} disabled={checking}>
                {checking ? 'Checking…' : 'Check now'}
              </button>
            </Tooltip>
          </span>
        )}
      </div>

      {open && (
        <div id={bodyId} className="flex flex-col gap-5 border-t border-slate-200/70 p-4 dark:border-white/10">
          {keywords.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tracked keywords</h4>
                {filterable && (
                  <label className="relative w-full sm:w-64">
                    <span className="sr-only">Filter keywords</span>
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input className={`${glassInput} pl-8`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter keywords" />
                  </label>
                )}
              </div>
              {error && (
                <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
                  {error}
                </p>
              )}
              <ul aria-label="Keywords to manage" className="max-h-96 divide-y divide-slate-200/70 overflow-y-auto rounded-lg border border-slate-200/70 dark:divide-white/10 dark:border-white/10">
                {shown.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className={`min-w-0 flex-1 ${k.paused ? 'opacity-60' : ''}`}>
                      <span className="font-medium text-slate-800 dark:text-slate-100">{k.keyword}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {placeLabel(k.location.name)} · {k.device === 'mobile' ? 'Mobile' : 'Desktop'} · {k.languageCode}
                      </span>
                    </span>
                    {k.paused && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">Paused</span>
                    )}
                    <span className="flex gap-1">
                      <Tooltip tip={k.paused ? 'Resume checking' : 'Pause: keep the history, stop checking'}>
                        <button
                          type="button"
                          className={ghostButton}
                          aria-label={k.paused ? `Resume ${k.keyword}` : `Pause ${k.keyword}`}
                          disabled={busy === k.id}
                          onClick={() => void togglePause(k)}
                        >
                          {k.paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
                        </button>
                      </Tooltip>
                      <Tooltip tip="Remove, with its history">
                        <button type="button" className={dangerButton} aria-label={`Remove ${k.keyword}`} disabled={busy === k.id} onClick={() => void remove(k)}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </Tooltip>
                    </span>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No keyword matches “{filter.trim()}”.</li>}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Add keywords</h4>
            <AddKeywordsForm
              projectId={projectId}
              defaultCountry={keywords[0]?.location.countryCode}
              onAdded={(message) => {
                onNotice(`${message} They are checked on the next pass, or now with “Check now”.`);
                void onChanged();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

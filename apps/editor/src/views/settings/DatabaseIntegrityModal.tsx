import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Info, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import {
  api,
  ApiError,
  type DatabaseIntegrityReport,
  type IntegrityAction,
  type IntegrityIssue,
  type IntegrityProgress,
} from '../../api';
import { Modal } from '../ui/Modal';
import { useDialogs } from '../ui/Dialogs';
import { glassCard, glassPanel, glassInput, primaryButton, ghostButton } from '../../theme';

/**
 * Database integrity: run a whole-database sweep for rows that EXIST but cannot be REACHED, and offer
 * the narrow set of repairs that are safe for what it finds.
 *
 * The scan is READ-ONLY and streams one frame per check, so the operator sees which check is running
 * rather than an indefinite spinner. Repairs are never automatic: each is an explicit click, destructive
 * ones are confirmed, and the report is re-run afterwards so what is shown always reflects the database
 * rather than a stale snapshot.
 */

const SEVERITY: Record<string, { icon: typeof XCircle; cls: string; label: string }> = {
  error: { icon: XCircle, cls: 'text-rose-600 dark:text-rose-400', label: 'Error' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400', label: 'Warning' },
  info: { icon: Info, cls: 'text-sky-600 dark:text-sky-400', label: 'Info' },
};

/** Orders issues worst-first so the thing that matters is never below the fold. */
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

function IssueCard({
  issue,
  datasetChoices,
  onRun,
  busy,
}: {
  issue: IntegrityIssue;
  /** Live dataset slugs in the issue's project — the targets for "move to an existing dataset". */
  datasetChoices: string[];
  onRun: (issue: IntegrityIssue, action: IntegrityAction, targetDataset?: string) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const sev = SEVERITY[issue.severity] ?? SEVERITY.info!;
  const Icon = sev.icon;

  return (
    <li className={`${glassPanel} p-3`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${sev.cls}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {issue.projectSlug ?? 'Instance'}
            </span>
            <code className="rounded bg-slate-100 px-1 text-[11px] text-slate-600 dark:bg-white/10 dark:text-slate-300">{issue.code}</code>
            <span className="text-xs text-slate-500 dark:text-slate-400">{issue.count} affected</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{issue.detail}</p>

          {issue.sample.length > 0 && (
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              <ChevronDown className={`h-3 w-3 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
              {open ? 'Hide' : 'Show'} affected ids
            </button>
          )}
          {open && (
            <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {issue.sample.join(', ')}
              {issue.count > issue.sample.length && ` … and ${issue.count - issue.sample.length} more`}
            </p>
          )}

          {issue.actions.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-2">
              {issue.actions.map((action) => (
                <div key={action.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {action.id === 'reassign_entries' && (
                      <select
                        aria-label={`Target dataset for ${issue.subject}`}
                        className={`${glassInput} w-44 py-1 text-xs`}
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                      >
                        <option value="">Choose a dataset…</option>
                        {datasetChoices.map((slug) => (
                          <option key={slug} value={slug}>
                            {slug}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      disabled={busy || (action.id === 'reassign_entries' && !target)}
                      onClick={() => void onRun(issue, action, target || undefined)}
                      className={
                        action.destructive
                          ? 'inline-flex items-center rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10'
                          : `${ghostButton} py-1 text-xs`
                      }
                    >
                      {action.label}
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{action.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function DatabaseIntegrityModal({ onClose }: { onClose: () => void }) {
  const { confirm, dialog } = useDialogs();
  const [progress, setProgress] = useState<IntegrityProgress | null>(null);
  const [report, setReport] = useState<DatabaseIntegrityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Live dataset slugs per project, for the "move to an existing dataset" picker.
  const [datasets, setDatasets] = useState<Record<string, string[]>>({});
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError(null);
    setProgress(null);
    setReport(null);
    await api.checkDatabaseIntegrity(
      {
        onProgress: setProgress,
        onDone: (r) => setReport(r),
        onError: (m) => setError(m),
      },
      controller.signal,
    );
    setRunning(false);
  }, []);

  // Scan on open — the operator asked for a check by opening this, so make them click once, not twice.
  useEffect(() => {
    void run();
    return () => abort.current?.abort();
  }, [run]);

  // Fetch dataset slugs for every project that has a re-assignable issue, so the picker has real targets.
  useEffect(() => {
    const needed = [...new Set((report?.issues ?? []).filter((i) => i.actions.some((a) => a.id === 'reassign_entries')).map((i) => i.projectId))];
    for (const pid of needed) {
      if (!pid || datasets[pid]) continue;
      void api
        .listDatasets(pid)
        .then((res) => setDatasets((prev) => ({ ...prev, [pid]: res.items.map((d) => d.slug).filter(Boolean) })))
        .catch(() => setDatasets((prev) => ({ ...prev, [pid]: [] })));
    }
  }, [report, datasets]);

  async function onRun(issue: IntegrityIssue, action: IntegrityAction, targetDataset?: string) {
    if (!issue.projectId) return;
    if (action.destructive) {
      const ok = await confirm({
        title: action.label,
        message: `${action.detail}\n\nThis affects ${issue.count} row(s) in “${issue.projectSlug}”.`,
        confirmLabel: action.label,
      });
      if (!ok) return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await api.repairIntegrity({ action: action.id, projectId: issue.projectId, subject: issue.subject, targetDataset });
      setNote(res.message);
      // Re-scan rather than patching local state: the repair may have resolved OTHER issues too
      // (recreating a dataset also un-strands its history), and a stale list invites acting on it.
      await run();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'the repair could not be applied');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'database-integrity-report.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  const pct = progress ? Math.round((progress.step / progress.total) * 100) : 0;
  const issues = [...(report?.issues ?? [])].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.count - a.count,
  );

  return (
    <Modal title="Database integrity" size="lg" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        {/* ---- Progress (streamed, one frame per check) */}
        {running && (
          <div className={`${glassCard} p-4`}>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {progress ? progress.label : 'Starting…'}
              {progress?.project && <span className="text-slate-500 dark:text-slate-400">· {progress.project}</span>}
            </div>
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Integrity check progress"
            >
              <div className="sw-brand-gradient h-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {progress ? `Check ${progress.step} of ${progress.total}` : 'Reading the database…'}
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>
        )}
        {note && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{note}</p>
        )}

        {report && !running && (
          <>
            {/* ---- Verdict */}
            <div className={`${glassCard} flex flex-wrap items-center gap-3 p-4`}>
              {report.ok ? (
                <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {report.ok ? 'No integrity problems found' : `${issues.length} issue${issues.length === 1 ? '' : 's'} found`}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {report.checks.length} checks over {report.projectsScanned} project{report.projectsScanned === 1 ? '' : 's'} in{' '}
                  {(report.durationMs / 1000).toFixed(1)}s
                </p>
              </div>
              <button type="button" className={`${ghostButton}`} onClick={download}>
                <Download className="h-4 w-4" aria-hidden /> Report
              </button>
              <button type="button" className={primaryButton} disabled={busy} onClick={() => void run()}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Re-check
              </button>
            </div>

            {/* ---- What ran. Shown even when clean, so "no issues" is evidence rather than an absence. */}
            <details className={`${glassCard} p-3`}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                Checks performed ({report.checks.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {report.checks.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs">
                    {c.status === 'ok' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden />
                    )}
                    <span className="flex-1 text-slate-600 dark:text-slate-300">{c.label}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {c.scanned.toLocaleString()} scanned
                      {c.issueCount > 0 && ` · ${c.issueCount} issue${c.issueCount === 1 ? '' : 's'}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>

            {/* ---- Findings + their actions */}
            {issues.length > 0 && (
              <ul className="flex flex-col gap-2">
                {issues.map((issue, i) => (
                  <IssueCard
                    key={`${issue.code}-${issue.projectId ?? 'x'}-${issue.subject}-${i}`}
                    issue={issue}
                    datasetChoices={issue.projectId ? (datasets[issue.projectId] ?? []) : []}
                    onRun={onRun}
                    busy={busy}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {dialog}
    </Modal>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Info, Loader2, RefreshCw, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import {
  api,
  ApiError,
  INTEGRITY_REPAIR_BATCH_MAX,
  type DatabaseIntegrityReport,
  type IntegrityAction,
  type IntegrityActionInput,
  type IntegrityBatchResult,
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
 * rather than an indefinite spinner. Repairs are never automatic: each is an explicit click (one issue,
 * or "Fix all issues" after a confirmation that lists everything it will do), destructive ones are
 * confirmed, and the report is re-run afterwards so what is shown always reflects the database rather
 * than a stale snapshot.
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

type PlannedFix = { issue: IntegrityIssue; action: IntegrityAction; projectId: string };

/**
 * What "Fix all issues" will do, and what it will leave alone.
 *
 * ★ AN ISSUE'S ACTIONS ARE ALTERNATIVES, NOT A LIST. Orphaned entries offer "Recreate the dataset",
 * "Move to an existing dataset" and "Delete the entries" — running all three would recreate, move and
 * then delete the same rows. So this picks exactly ONE per issue: the first the server marks
 * `unattended`. The server lists alternatives conservative-first and withholds that mark from any action
 * that needs an input nobody can default (which dataset to move to) or that has a gentler alternative
 * (deleting entries "Recreate the dataset" could bring back) — so the policy lives beside the actions.
 *
 * Every issue lands in exactly one bucket, and the confirmation names all three, so Fix all never
 * quietly does less than it says:
 *  - `auto`: repaired — those that add or re-point first, then those that remove;
 *  - `decide`: has repairs, none of them safe to choose unattended;
 *  - `unfixable`: nothing this screen can do (file damage, an unparseable row, a duplicate slug).
 * INFO findings are by design (a deleted project keeping its slug) and belong to none of them.
 */
export function fixPlan(issues: IntegrityIssue[]): { auto: PlannedFix[]; decide: IntegrityIssue[]; unfixable: IntegrityIssue[] } {
  const auto: PlannedFix[] = [];
  const decide: IntegrityIssue[] = [];
  const unfixable: IntegrityIssue[] = [];
  for (const issue of issues) {
    if (issue.severity === 'info') continue;
    const action = issue.actions.find((a) => a.unattended);
    // Every repair acts inside one project; an instance-wide finding (file damage, a dangling foreign
    // key) has none to offer.
    if (action && issue.projectId) auto.push({ issue, action, projectId: issue.projectId });
    else if (issue.actions.length > 0 && issue.projectId) decide.push(issue);
    else unfixable.push(issue);
  }
  // Recreating a dataset in this same run makes the history stranded under its slug reachable again,
  // so deleting that history would destroy exactly what the recreate just rescued.
  const recreated = new Set(auto.filter((f) => f.action.id === 'recreate_dataset').map((f) => `${f.issue.projectId}:${f.issue.subject}`));
  const planned = auto.filter((f) => !(f.action.id === 'delete_orphan_history' && recreated.has(`${f.issue.projectId}:${f.issue.subject}`)));
  // Stable: repairs that add or re-point run before anything that removes.
  planned.sort((a, b) => Number(a.action.destructive) - Number(b.action.destructive));
  return { auto: planned, decide, unfixable };
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Send `fixes` to the batch endpoint `size` at a time, in order, and return one result per fix.
 *
 * A request that FAILS stops the run: no later chunk is sent, and that chunk plus every one after it is
 * reported as not applied, with the reason. A refusal from the server (signed out, rate-limited, already
 * running) means the chunk did not run either; with NO answer it may have — say so, and let the re-scan
 * that follows show what actually happened. A failure of ONE repair inside a request that succeeded is
 * the server's per-item result and does not stop the run.
 */
export async function runRepairBatches(
  fixes: PlannedFix[],
  send: (repairs: IntegrityActionInput[]) => Promise<{ results: IntegrityBatchResult[] }>,
  size: number = INTEGRITY_REPAIR_BATCH_MAX,
): Promise<IntegrityBatchResult[]> {
  const step = Math.max(1, Math.trunc(size)); // a zero/fractional size must not loop forever
  const results: IntegrityBatchResult[] = [];
  for (let i = 0; i < fixes.length; i += step) {
    const chunk = fixes.slice(i, i + step);
    try {
      const res = await send(chunk.map(({ issue, action, projectId }) => ({ action: action.id, projectId, subject: issue.subject })));
      results.push(...res.results);
    } catch (err) {
      const error = err instanceof ApiError ? err.message : 'no answer from the server — the re-check shows what was applied';
      for (const { issue, action, projectId } of fixes.slice(i)) results.push({ action: action.id, projectId, subject: issue.subject, ok: false, error });
      break;
    }
  }
  return results;
}

/**
 * The note shown after Fix all: what was repaired, what was not and why (the first five, by subject),
 * and how many issues the plan deliberately left alone — so the operator never has to infer any of it
 * from the re-scan alone.
 */
export function repairSummary(
  results: IntegrityBatchResult[],
  leftAlone: { decide: number; unfixable: number },
): { tone: 'ok' | 'warn'; text: string } {
  const done = results.filter((r) => r.ok);
  const failed = results.filter((r): r is Extract<IntegrityBatchResult, { ok: false }> => !r.ok);
  return {
    tone: failed.length > 0 ? 'warn' : 'ok',
    text: [
      done.length > 0 ? `Repaired ${n(done.length, 'issue')}.` : 'Nothing was repaired.',
      failed.length > 0
        ? `${failed.length} could not be applied — ${failed
            .slice(0, 5)
            .map((f) => `${f.subject}: ${f.error}`)
            .join('; ')}${failed.length > 5 ? ` … and ${failed.length - 5} more` : ''}`
        : '',
      leftAlone.decide > 0 ? `${leftAlone.decide} left for you to decide on.` : '',
      leftAlone.unfixable > 0 ? `${leftAlone.unfixable} cannot be fixed from here.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/** One confirmation line per KIND of repair, so a report with fifty findings stays readable. */
function planLines(fixes: PlannedFix[]): string[] {
  const groups = new Map<string, PlannedFix[]>();
  for (const f of fixes) groups.set(f.action.id, [...(groups.get(f.action.id) ?? []), f]);
  return [...groups.values()].map((group) => {
    const { action } = group[0]!;
    const rows = group.reduce((sum, f) => sum + f.issue.count, 0);
    const where =
      group.length === 1
        ? `${group[0]!.issue.projectSlug} (${n(rows, 'row')})`
        : `${n(group.length, 'issue')}, ${n(rows, 'row')} across ${n(new Set(group.map((f) => f.issue.projectId)).size, 'project')}`;
    const undo = action.destructive ? (action.reversible ? ' · restorable from History' : ' · cannot be undone') : '';
    return `${action.label} — ${where}${undo}`;
  });
}

/** One titled list in the Fix all confirmation. */
function PlanSection({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section>
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export function DatabaseIntegrityModal({
  onClose,
  batchSize = INTEGRITY_REPAIR_BATCH_MAX,
}: {
  onClose: () => void;
  /** Most repairs per Fix all request. The server's cap; injectable so batching can be exercised
   *  without rendering hundreds of findings. */
  batchSize?: number;
}) {
  const { confirm, dialog } = useDialogs();
  const [progress, setProgress] = useState<IntegrityProgress | null>(null);
  const [report, setReport] = useState<DatabaseIntegrityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
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
        message: (
          <div className="flex flex-col gap-2">
            <p>{action.detail}</p>
            <p>
              This affects {issue.count} row(s) in “{issue.projectSlug}”.
            </p>
          </div>
        ),
        confirmLabel: action.label,
      });
      if (!ok) return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await api.repairIntegrity({ action: action.id, projectId: issue.projectId, subject: issue.subject, targetDataset });
      setNote({ tone: 'ok', text: res.message });
      // Re-scan rather than patching local state: the repair may have resolved OTHER issues too
      // (recreating a dataset also un-strands its history), and a stale list invites acting on it.
      await run();
    } catch (err) {
      setNote({ tone: 'warn', text: err instanceof ApiError ? err.message : 'the repair could not be applied' });
    } finally {
      setBusy(false);
    }
  }

  /** Apply every unattended repair in `fixPlan` — in batches, not one request each — then re-scan ONCE. */
  async function fixAll() {
    const { auto, decide, unfixable } = fixPlan(issues);
    if (auto.length === 0) return;
    const repairs = auto.filter((f) => !f.action.destructive);
    const removals = auto.filter((f) => f.action.destructive);
    const ok = await confirm({
      title: `Fix ${n(auto.length, 'issue')}?`,
      message: (
        <div className="flex flex-col gap-3">
          {repairs.length > 0 && <PlanSection title="Repairs — nothing is removed" lines={planLines(repairs)} />}
          {removals.length > 0 && <PlanSection title="Removals" lines={planLines(removals)} />}
          {decide.length > 0 && (
            <p>
              {n(decide.length, 'issue')} need{decide.length === 1 ? 's' : ''} a decision and will be LEFT ALONE — the repair on offer
              needs a dataset you choose, deletes something a gentler one could keep, or gives up what a restore would bring back. Run
              those individually.
            </p>
          )}
          {unfixable.length > 0 && <p>{n(unfixable.length, 'issue')} cannot be fixed from here — each one says what to do instead.</p>}
        </div>
      ),
      confirmLabel: 'Fix them',
    });
    if (!ok) return;

    setBusy(true);
    setNote(null);
    const results = await runRepairBatches(auto, (repairs) => api.repairIntegrityBatch(repairs), batchSize);
    setBusy(false);
    setNote(repairSummary(results, { decide: decide.length, unfixable: unfixable.length }));
    await run();
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
  // INFO findings are by design, not problems: listed, but neither counted nor offered to Fix all.
  const problems = issues.filter((i) => i.severity !== 'info');
  const notes = issues.length - problems.length;
  const plan = fixPlan(issues);

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
          <p
            role="status"
            className={
              note.tone === 'ok'
                ? 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
            }
          >
            {note.text}
          </p>
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
              {/* A floor on the verdict's width: on a phone the buttons wrap BELOW it instead of squeezing
                  it to one word per line. */}
              <div className="min-w-[11rem] flex-1">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {problems.length === 0 ? 'No integrity problems found' : `${n(problems.length, 'issue')} found`}
                  {notes > 0 && <span className="font-normal text-slate-500 dark:text-slate-400"> · {n(notes, 'note')}</span>}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {report.checks.length} checks over {report.projectsScanned} project{report.projectsScanned === 1 ? '' : 's'} in{' '}
                  {(report.durationMs / 1000).toFixed(1)}s
                </p>
              </div>
              <button type="button" className={`${ghostButton}`} onClick={download}>
                <Download className="h-4 w-4" aria-hidden /> Report
              </button>
              {problems.length > 0 && (
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy || plan.auto.length === 0}
                  aria-describedby={plan.auto.length === 0 ? 'integrity-fix-all-none' : undefined}
                  onClick={() => void fixAll()}
                >
                  <Wrench className="h-4 w-4" aria-hidden /> Fix all issues{plan.auto.length > 0 && ` (${plan.auto.length})`}
                </button>
              )}
              <button type="button" className={ghostButton} disabled={busy} onClick={() => void run()}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Re-check
              </button>
              {problems.length > 0 && plan.auto.length === 0 && (
                <p id="integrity-fix-all-none" className="basis-full text-xs text-slate-500 dark:text-slate-400">
                  None of these can be fixed automatically: each needs a decision or cannot be repaired from here. See each issue below.
                </p>
              )}
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

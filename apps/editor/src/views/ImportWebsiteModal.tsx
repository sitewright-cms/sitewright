import { useEffect, useRef, useState } from 'react';
import { Globe, Upload, Loader2, CircleCheck, TriangleAlert, FileUp, Sparkles, Bot } from 'lucide-react';
import { api, type ImportProgressEvent, type ImportReport } from '../api';
import { Modal } from './ui/Modal';
import { glassInput, primaryButton } from '../theme';

interface ImportWebsiteModalProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  /** Called from the report step's "Open project" CTA — navigate to / refresh the project. */
  onImported: () => void;
}

type Mode = 'url' | 'upload';
type Step = 'source' | 'running' | 'report';

/** A human, per-step line for a streamed progress event (the scrolling detail log). */
function progressLine(e: ImportProgressEvent): string {
  switch (e.phase) {
    case 'crawl':
      return `Crawling — ${e.fetched ?? 0} page${(e.fetched ?? 0) === 1 ? '' : 's'} fetched${e.url ? ` · ${e.url}` : ''}`;
    case 'host-media': {
      const count = e.total ? ` ${e.done ?? 0}/${e.total}` : '';
      return `Importing image${count}${e.detail ? ` · ${e.detail}` : '…'}`;
    }
    case 'transform': {
      if (!e.done) return e.detail ?? `Converting ${e.total ?? ''} page${e.total === 1 ? '' : 's'}…`;
      return `Converting page ${e.done}/${e.total ?? '?'}${e.detail ? ` · ${e.detail}` : ''}`;
    }
    case 'assemble':
      return e.detail ?? 'Laying the foundation…';
    default:
      return e.detail ?? e.phase;
  }
}

/** The headline phase + determinate-bar fraction for the current step. */
function phaseSummary(e: ImportProgressEvent): { label: string; done?: number; total?: number } {
  switch (e.phase) {
    case 'crawl': return { label: 'Crawling pages', done: e.fetched };
    case 'host-media': return { label: 'Importing images', done: e.done, total: e.total };
    case 'transform': return { label: 'Building the foundation', done: e.done, total: e.total };
    case 'assemble': return { label: 'Saving content' };
    default: return { label: e.phase };
  }
}

export function ImportWebsiteModal({ projectId, projectName, onClose, onImported }: ImportWebsiteModalProps) {
  const [mode, setMode] = useState<Mode>('url');
  const [step, setStep] = useState<Step>('source');
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(50);
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<{ id: number; text: string }[]>([]);
  const [prog, setProg] = useState<{ label: string; done?: number; total?: number } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lineSeq = useRef(0);

  // If the modal is force-unmounted mid-import (e.g. a session expiry tears down the tree, bypassing
  // onBeforeClose), abort the stream so the SSE connection doesn't linger.
  useEffect(() => () => abortRef.current?.abort(), []);

  const valid = mode === 'url' ? /^https:\/\/\S+/i.test(url.trim()) : file !== null;

  function pushLine(text: string): void {
    // Keep a short tail (stable ids so React diffs an append+evict, not a relabel of every row).
    setLines((prev) => [...prev, { id: lineSeq.current++, text }].slice(-8));
  }

  function start(): void {
    if (!valid || step === 'running') return;
    setStep('running');
    setError(null);
    setLines([]);
    setProg(null);
    const abort = new AbortController();
    abortRef.current = abort;
    const handlers = {
      onProgress: (e: ImportProgressEvent) => { pushLine(progressLine(e)); setProg(phaseSummary(e)); },
      onDone: (r: ImportReport) => {
        setReport(r);
        setStep('report');
      },
      onError: (message: string) => {
        setError(message);
        setStep('source'); // keep the entered URL/file so the user can retry
      },
    };
    // Both routes run the foundation pipeline (api appends ?foundation=1): native theme/fonts/chrome
    // + assets, foreign CSS/JS discarded — the deterministic INGEST half of the AI-clone pipeline.
    if (mode === 'url') void api.importWebsiteStream(projectId, { url: url.trim(), maxPages }, handlers, abort.signal);
    else if (file) void api.importUploadStream(projectId, file, handlers, abort.signal);
  }

  const busy = step === 'running';

  function onSave(): void {
    if (busy) return; // the footer button is disabled while a stream runs
    if (step === 'source') start();
    else onImported(); // report → open the project
  }

  const saveLabel = step === 'report' ? 'Open project' : step === 'running' ? 'Cloning…' : 'Clone with AI';

  return (
    <Modal
      title="Clone a website with AI"
      titleExtra={<span className="truncate text-xs font-normal text-slate-400 dark:text-slate-500">→ {projectName}</span>}
      size="lg"
      onClose={onClose}
      onSave={onSave}
      saveLabel={saveLabel}
      saving={busy}
      saveDisabled={step === 'source' && !valid}
      onBeforeClose={() => {
        // Closing mid-stream aborts it (the server stops on the dropped connection).
        if (busy) abortRef.current?.abort();
        return true;
      }}
    >
      <div className="flex flex-col gap-4 p-5">
        {step === 'source' && (
          <>
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode('url')} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${mode === 'url' ? `${primaryButton} border-transparent` : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                <Globe className="h-4 w-4" /> Crawl a URL
              </button>
              <button type="button" onClick={() => setMode('upload')} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${mode === 'upload' ? `${primaryButton} border-transparent` : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                <Upload className="h-4 w-4" /> Upload a bundle
              </button>
            </div>

            {mode === 'url' ? (
              <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); start(); }}>
                <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
                  Website URL
                  <input aria-label="Website URL" type="url" inputMode="url" placeholder="https://example.com" className={`mt-1.5 font-normal ${glassInput}`} value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
                  <span className="mt-1 font-normal text-[11px] text-slate-400 dark:text-slate-500">A public https URL. We crawl same-origin pages and import what we find.</span>
                </label>
                <label className="flex w-40 flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
                  Max pages
                  <input aria-label="Max pages" type="number" min={1} max={200} className={`mt-1.5 font-normal ${glassInput}`} value={maxPages} onChange={(e) => setMaxPages(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
                </label>
                <input type="submit" hidden />
              </form>
            ) : (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/60 dark:bg-white/5 px-4 py-8 text-center transition hover:border-slate-400">
                <FileUp className="h-7 w-7 text-slate-400 dark:text-slate-500" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{file ? file.name : 'Choose a .zip site export or a single .html file'}</span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">The bundle is converted offline — nothing is fetched.</span>
                <input type="file" accept=".zip,.html,.htm,application/zip,text/html" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}

            <p className="flex items-start gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-900 dark:text-indigo-200">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>We lay a <strong>native foundation</strong> — your brand colors, fonts, navigation and footer rebuilt with Sitewright primitives (the original's CSS &amp; scripts are discarded). Your AI assistant then authors each page on top of it.</span>
            </p>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}

        {busy && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {prog?.label ?? 'Cloning'}…
              </span>
              {prog?.total ? <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{prog.done ?? 0}/{prog.total}</span>
                : prog?.done ? <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{prog.done}</span> : null}
            </div>
            {/* Determinate bar when the phase reports a total; otherwise an indeterminate sweep. */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              {prog?.total
                ? <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${Math.round(100 * Math.min(1, (prog.done ?? 0) / prog.total))}%` }} />
                : <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-400" />}
            </div>
            <ul className="flex flex-col gap-1 rounded-xl bg-slate-50 dark:bg-white/5 p-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {lines.length === 0 ? <li>Starting…</li> : lines.map((l) => <li key={l.id} className="truncate">{l.text}</li>)}
            </ul>
          </div>
        )}

        {step === 'report' && report && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
              <CircleCheck className="h-5 w-5" /> Foundation ready — {report.pagesImported} page{report.pagesImported === 1 ? '' : 's'} imported
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Pages imported" value={`${report.pagesImported} of ${report.pagesFound} found`} />
              <Stat label="Images self-hosted" value={String(report.mediaSelfHosted)} />
              <Stat label="Scripts stripped" value={String(report.scriptsDropped)} />
              <Stat label="Native chrome" value={report.chromeExtracted ? 'nav + footer rebuilt' : 'kept per-page'} />
            </dl>
            {report.truncated && (
              <p className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                <TriangleAlert className="h-4 w-4 shrink-0" /> A crawl limit was reached — some pages may be missing. Raise “Max pages” or re-run to capture more.
              </p>
            )}
            {report.warnings.length > 0 && (
              <details className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300">{report.warnings.length} note{report.warnings.length === 1 ? '' : 's'}</summary>
                <ul className="max-h-40 list-disc overflow-auto px-6 pb-3 text-[11px] text-slate-500 dark:text-slate-400">
                  {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
            {/* NEXT STEP — handoff to the user's AI assistant (via MCP). This block is the seam where a
                future in-app AI agent / "AI runner" container would drive the authoring itself; for now
                it guides the user to their own connected assistant. */}
            <NextStepAuthorWithAI pages={report.pagesImported} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Post-clone guidance: the native foundation is in place; the per-page authoring is done by an AI agent
 * through the Sitewright MCP toolset. Today that's the user's OWN connected assistant (the handoff
 * below). A later iteration can replace this with an in-app trigger that runs the authoring agents
 * inside the platform (or a dedicated AI-runner container) — same place, same intent.
 */
function NextStepAuthorWithAI({ pages }: { pages: number }) {
  return (
    <div className="rounded-lg bg-indigo-50 dark:bg-indigo-500/10 px-3 py-3 text-[11px] text-indigo-900 dark:text-indigo-200">
      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold">
        <Bot className="h-4 w-4" /> Author with AI
      </p>
      <p>
        The foundation (theme, fonts, navigation, footer, assets) is set and the {pages} page
        {pages === 1 ? '' : 's'} are imported as a faithful reference. Open the project, then ask your
        connected AI assistant to <strong>“author the imported pages”</strong> — it rebuilds each one as
        native Sitewright components on top of the foundation, render-checking against the original.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
      <dt className="text-[11px] text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
}

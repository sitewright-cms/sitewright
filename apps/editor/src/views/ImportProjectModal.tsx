import { useEffect, useRef, useState } from 'react';
import { Loader2, CircleCheck, FileUp, PackageOpen } from 'lucide-react';
import { api, type ImportProgressEvent, type ProjectImportReport, type Project } from '../api';
import { Modal } from './ui/Modal';

interface ImportProjectModalProps {
  onClose: () => void;
  /** Called from the report step's "Open project" CTA with the freshly-created project. */
  onImported: (project: Project) => void;
}

type Step = 'source' | 'running' | 'report';

/** A human line for a streamed progress event (the scrolling detail log). */
function progressLine(e: ImportProgressEvent): string {
  switch (e.phase) {
    case 'validate': return 'Validating the archive…';
    case 'allocate': return e.detail ?? 'Creating the project…';
    case 'content': return 'Importing content…';
    case 'media': return e.detail ?? 'Restoring media…';
    default: return e.detail ?? e.phase;
  }
}

export function ImportProjectModal({ onClose, onImported }: ImportProjectModalProps) {
  const [step, setStep] = useState<Step>('source');
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<{ id: number; text: string }[]>([]);
  const [report, setReport] = useState<ProjectImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lineSeq = useRef(0);

  // Abort the stream if the modal is force-unmounted mid-import (e.g. session expiry).
  useEffect(() => () => abortRef.current?.abort(), []);

  function pushLine(text: string): void {
    const id = lineSeq.current;
    lineSeq.current += 1; // advance OUTSIDE the updater (no side effects in a state updater)
    setLines((prev) => [...prev, { id, text }].slice(-8));
  }

  function start(): void {
    if (!file || step === 'running') return;
    setStep('running');
    setError(null);
    setLines([]);
    const abort = new AbortController();
    abortRef.current = abort;
    void api.importProjectZipStream(
      file,
      {
        onProgress: (e) => pushLine(progressLine(e)),
        onDone: (r) => {
          setReport(r);
          setStep('report');
        },
        onError: (message) => {
          setError(message);
          setStep('source'); // keep the chosen file so the user can retry
        },
      },
      abort.signal,
    );
  }

  const busy = step === 'running';

  function onSave(): void {
    if (busy) return;
    if (step === 'source') start();
    else if (report) onImported({ id: report.projectId, name: report.name, slug: report.slug, role: 'owner' });
  }

  const saveLabel = step === 'report' ? 'Open project' : step === 'running' ? 'Importing…' : 'Import';

  return (
    <Modal
      title="Import a project"
      size="lg"
      onClose={onClose}
      onSave={onSave}
      saveLabel={saveLabel}
      saving={busy}
      saveDisabled={step === 'source' && !file}
      onBeforeClose={() => {
        if (busy) abortRef.current?.abort();
        return true;
      }}
    >
      <div className="flex flex-col gap-4 p-5">
        {step === 'source' && (
          <>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center transition hover:border-slate-400">
              <FileUp className="h-7 w-7 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">{file ? file.name : 'Choose a Sitewright project export (.zip)'}</span>
              <span className="text-[11px] text-slate-400">Creates a brand-new project — your existing projects are untouched.</span>
              <input type="file" accept=".zip,application/zip" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <p className="flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-900">
              <PackageOpen className="mt-0.5 h-4 w-4 shrink-0" />
              <span>The archive's content, media and settings are restored into a new project. Deploy targets and SMTP credentials are not included — reconfigure them after importing.</span>
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </>
        )}

        {busy && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" /> Importing…
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-400" />
            </div>
            <ul className="flex flex-col gap-1 rounded-xl bg-slate-50 p-3 font-mono text-[11px] text-slate-500">
              {lines.length === 0 ? <li>Starting…</li> : lines.map((l) => <li key={l.id} className="truncate">{l.text}</li>)}
            </ul>
          </div>
        )}

        {step === 'report' && report && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
              <CircleCheck className="h-5 w-5" /> Imported “{report.name}”
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="New slug" value={report.slug} />
              <Stat label="Entities imported" value={String(report.imported)} />
              <Stat label="Media files" value={String(report.media)} />
            </dl>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

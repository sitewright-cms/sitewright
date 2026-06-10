import { useEffect, useRef, useState } from 'react';
import { api, type DeployTargetView, type Project } from '../../api';
import { Modal } from '../ui/Modal';

type Status =
  | { kind: 'running'; phase: 'connecting' | 'uploading'; index: number; total: number; file?: string }
  | { kind: 'done'; files: number; protocol: string }
  | { kind: 'error'; message: string };

/**
 * Streams a deploy of a SAVED target to its external server, showing live per-file progress (a
 * DaisyUI progress bar + spinner), the final result, and errors. On success it links to the
 * configured production URL — or warns that none is set (so sitemap.xml / robots.txt are skipped).
 */
export function DeployModal({ project, target, onClose }: { project: Project; target: DeployTargetView; onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'running', phase: 'connecting', index: 0, total: 0 });
  const [siteUrl, setSiteUrl] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  // Resolve the production URL (for the success link / no-URL warning).
  useEffect(() => {
    let alive = true;
    api
      .getSettings(project.id)
      .then((r) => alive && setSiteUrl(r.item.website?.siteUrl))
      .catch(() => {
        /* settings unreadable → treat as no production URL */
      });
    return () => {
      alive = false;
    };
  }, [project.id]);

  // Start the streaming deploy on open; abort it if the modal is closed mid-flight.
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    abortRef.current = ac;
    void api.deployTargetStream(
      project.id,
      target.id,
      {
        onProgress: (e) =>
          alive && setStatus({ kind: 'running', phase: e.phase === 'done' ? 'uploading' : e.phase, index: e.index, total: e.total, file: e.file }),
        onDone: (d) => alive && setStatus({ kind: 'done', files: d.files, protocol: d.protocol }),
        onError: (message) => alive && setStatus({ kind: 'error', message }),
      },
      ac.signal,
    );
    return () => {
      alive = false;
      ac.abort();
    };
  }, [project.id, target.id]);

  const running = status.kind === 'running';
  const pct = running && status.total > 0 ? Math.round((status.index / status.total) * 100) : undefined;

  return (
    <Modal title={`Deploy to ${target.name}`} size="md" onClose={onClose} saveLabel="Close">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Uploading the published site to <span className="font-medium text-slate-700">{target.protocol.toUpperCase()}@{target.host}</span>
          {target.remoteDir ? <span className="text-slate-400"> · {target.remoteDir}</span> : null}
        </p>

        {running && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <span className="loading loading-spinner loading-sm text-indigo-600" aria-hidden />
              {status.phase === 'connecting' ? 'Connecting…' : `Uploading ${status.index}/${status.total || '…'}`}
            </div>
            {/* Determinate once the file count is known; indeterminate while connecting. */}
            <progress
              className="progress progress-primary w-full"
              {...(pct !== undefined ? { value: status.index, max: status.total } : {})}
              aria-label="Deploy progress"
            />
            {status.file && <p className="truncate font-mono text-[11px] text-slate-400" title={status.file}>{status.file}</p>}
          </div>
        )}

        {status.kind === 'done' && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <span aria-hidden>✓</span> Deployed {status.files} files via {status.protocol.toUpperCase()}.
            </p>
            {siteUrl ? (
              <a
                href={siteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700"
              >
                Open production site ↗
              </a>
            ) : (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                Website Production URL is not configured: sitemap.xml and robots.txt will not be generated. Configure a
                production URL in website settings.
              </p>
            )}
          </div>
        )}

        {status.kind === 'error' && (
          <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{status.message}</p>
        )}
      </div>
    </Modal>
  );
}

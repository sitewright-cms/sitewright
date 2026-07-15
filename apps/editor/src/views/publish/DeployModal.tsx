import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { api, type DeployTargetView, type Project } from '../../api';
import { Modal } from '../ui/Modal';

type Strategy = 'tar' | 'files';

type Status =
  | { kind: 'running'; phase: string; index: number; total: number; file?: string; skipped?: number; strategy?: Strategy; bytes?: number; elapsedMs?: number }
  | { kind: 'done'; protocol: string; files?: number; uploaded?: number; skipped?: number; removed?: number; strategy?: Strategy; bytes?: number; elapsedMs?: number; branch?: string; commit?: string }
  | { kind: 'error'; message: string };

/** Human label for a progress phase — FTP/SFTP per-file, or git's coarse phases. */
function phaseLabel(s: Extract<Status, { kind: 'running' }>, target: DeployTargetView): string {
  switch (s.phase) {
    case 'connecting':
      return 'Connecting…';
    case 'checking':
      return 'Checking target & changes…';
    case 'preparing':
      return 'Preparing the build…';
    case 'committing':
      return 'Committing…';
    case 'pushing':
      return `Pushing to ${target.branch ?? 'the branch'}…`;
    default:
      return `Uploading ${s.index}/${s.total || '…'}`;
  }
}

/** Human byte size (B / KB / MB / GB) — 1-decimal below 10, whole above. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** Human duration (ms / s). */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

/** Throughput label (e.g. "0.6 MB/s"), or null when not yet meaningful. */
function formatRate(bytes: number, ms: number): string | null {
  if (ms <= 0 || bytes <= 0) return null;
  return `${formatBytes(Math.round(bytes / (ms / 1000)))}/s`;
}

/** The transfer mode line: protocol + (for FTP/SFTP) the bulk strategy. */
function transferMode(protocol: string, strategy?: Strategy): string {
  const proto = protocol.toUpperCase();
  if (!strategy) return proto;
  return `${proto} · ${strategy === 'tar' ? 'tar stream' : 'per-file'}`;
}

/** The success headline for an FTP/SFTP deploy — uploaded vs total + skipped/removed counts. */
function deployedSummary(s: Extract<Status, { kind: 'done' }>): string {
  const uploaded = s.uploaded ?? s.files ?? 0;
  const total = s.files ?? uploaded;
  const parts = [s.skipped ? `Deployed ${uploaded} of ${total} files` : `Deployed ${uploaded} file${uploaded === 1 ? '' : 's'}`];
  if (s.skipped) parts.push(`${s.skipped} unchanged`);
  if (s.removed) parts.push(`${s.removed} removed`);
  return `${parts.join(' · ')}.`;
}

/** A one-line transfer diagnostics readout: mode · size · time · rate (only what's known). */
function diagnosticsLine(protocol: string, strategy: Strategy | undefined, bytes: number, elapsedMs: number | undefined, withDuration: boolean): string {
  const parts = [transferMode(protocol, strategy)];
  if (bytes > 0) parts.push(formatBytes(bytes) + (withDuration && elapsedMs ? ` in ${formatDuration(elapsedMs)}` : ''));
  const rate = elapsedMs ? formatRate(bytes, elapsedMs) : null;
  if (rate) parts.push(rate);
  return parts.join(' · ');
}

/**
 * Streams a deploy of a SAVED target, showing live progress, transfer diagnostics (mode + speed),
 * the final result, and errors. FTP/SFTP show a determinate per-file bar plus the transfer mode
 * (tar fast-path vs per-file) and throughput; a `git` target shows its coarse phases (prepare →
 * commit → push) and, on success, the pushed branch. On success it links to the configured
 * production URL.
 */
export function DeployModal({ project, target, onClose }: { project: Project; target: DeployTargetView; onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'running', phase: target.protocol === 'git' ? 'preparing' : 'connecting', index: 0, total: 0 });
  const [siteUrl, setSiteUrl] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const isGit = target.protocol === 'git';

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
          alive &&
          setStatus({ kind: 'running', phase: e.phase, index: e.index ?? 0, total: e.total ?? 0, file: e.file, skipped: e.skipped, strategy: e.strategy, bytes: e.bytes, elapsedMs: e.elapsedMs }),
        onDone: (d) =>
          alive &&
          setStatus({ kind: 'done', protocol: d.protocol, files: d.files, uploaded: d.uploaded, skipped: d.skipped, removed: d.removed, strategy: d.strategy, bytes: d.bytes, elapsedMs: d.elapsedMs, branch: d.branch, commit: d.commit }),
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
  // Determinate only once we're actually uploading with a known total; connecting/checking and git
  // phases show an indeterminate (animated) bar rather than a stuck-at-zero one.
  const pct = running && status.phase === 'uploading' && status.total > 0 ? Math.round((status.index / status.total) * 100) : undefined;
  const showRunningDiag = running && !isGit && (!!status.strategy || (status.bytes ?? 0) > 0);
  const showDoneDiag = status.kind === 'done' && status.protocol !== 'git' && (!!status.strategy || (status.bytes ?? 0) > 0);

  return (
    <Modal title={`Deploy to ${target.name}`} size="md" onClose={onClose} saveLabel="Close">
      <div className="space-y-4 p-5">
        <p className="text-xs text-slate-500">
          {isGit ? (
            <>
              Committing the published site to <span className="font-medium text-slate-700">{target.branch}</span>
              <span className="text-slate-400"> · {target.repoUrl}</span>
            </>
          ) : (
            <>
              Uploading the published site to <span className="font-medium text-slate-700">{target.protocol.toUpperCase()}@{target.host}</span>
              {target.remoteDir ? <span className="text-slate-400"> · {target.remoteDir}</span> : null}
            </>
          )}
        </p>

        {running && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <span className="loading loading-spinner loading-sm text-indigo-600" aria-hidden />
              {phaseLabel(status, target)}
            </div>
            {/* Determinate once the file count is known; indeterminate otherwise (git / connecting). */}
            <progress
              className="progress progress-primary w-full"
              {...(pct !== undefined ? { value: status.index, max: status.total } : {})}
              aria-label="Deploy progress"
            />
            {status.file && <p className="truncate font-mono text-[11px] text-slate-400" title={status.file}>{status.file}</p>}
            {showRunningDiag && (
              <p className="text-[11px] font-medium text-slate-500">{diagnosticsLine(target.protocol, status.strategy, status.bytes ?? 0, status.elapsedMs, false)}</p>
            )}
          </div>
        )}

        {status.kind === 'done' && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" />
              {status.protocol === 'git'
                ? `Pushed to ${status.branch ?? 'the branch'}${status.commit ? ` · ${status.commit.slice(0, 7)}` : ''}.`
                : deployedSummary(status)}
            </p>
            {showDoneDiag && (
              <p className="text-xs text-slate-500">{diagnosticsLine(status.protocol, status.strategy, status.bytes ?? 0, status.elapsedMs, true)}</p>
            )}
            {siteUrl ? (
              <a
                href={siteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700"
              >
                Open production site <ExternalLink className="h-3.5 w-3.5" />
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

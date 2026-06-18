import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Download } from 'lucide-react';
import { api, eventsUrl, type DeployTargetView, type Project, type Release } from '../api';
import { AgentDetailsModal } from './AgentDetailsModal';
import { AgentIndicator } from './AgentIndicator';
import { DeployModal } from './publish/DeployModal';
import { buildPreviewUrl } from '../lib/preview-target';
import { useToast } from './ui/Toast';

/** Eye glyph for the "Preview" (browse the live draft site). */
function PreviewIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Server/upload glyph for the Deploy action. */
function DeployIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  );
}

/** Where a deploy target sends the site (the dropdown sub-label). */
function targetWhere(t: DeployTargetView): string {
  if (t.protocol === 'local') return 'Local Hosting · /sites/';
  if (t.protocol === 'git') return `Git · ${t.branch ?? ''}`;
  return `${t.protocol.toUpperCase()}@${t.host ?? ''}`;
}

/**
 * The header DEPLOY control. An always-on split button: the primary action deploys the last-used (or
 * default) target in one click; the ▾ opens a dropdown listing every target (click to deploy) plus
 * "Add a target…" and "Download .zip". With no targets, the button opens the config modal. A `local`
 * target is published to Local Hosting (built + served at /sites/); a remote target streams an upload.
 */
export function PublishBar({
  project,
  onOpenDeploy,
  refreshSignal = 0,
}: {
  project: Project;
  /** Open the deploy-targets modal (to add/manage targets). */
  onOpenDeploy?: () => void;
  /** Bumped by the parent when targets change, so the list + default stay current. */
  refreshSignal?: number;
}) {
  const [release, setRelease] = useState<Release | null>(null);
  const [url, setUrl] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  const [previewToken, setPreviewToken] = useState<string | undefined>(undefined);
  const [localHosting, setLocalHosting] = useState(false); // a `local` target exists → served at /sites/
  const [targets, setTargets] = useState<DeployTargetView[]>([]);
  const [deploying, setDeploying] = useState<DeployTargetView | null>(null); // → the streaming DeployModal (remote)
  const [agentActive, setAgentActive] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentActiveRef = useRef(false);

  // The most-recently-deployed target (per project), so the split button's primary action repeats it.
  const lastKey = `sw:lastDeployTarget:${project.id}`;
  const [lastTargetId, setLastTargetId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(lastKey);
    } catch {
      return null;
    }
  });
  const rememberTarget = useCallback(
    (id: string) => {
      setLastTargetId(id);
      try {
        localStorage.setItem(lastKey, id);
      } catch {
        /* storage unavailable — the in-memory value still works for this session */
      }
    },
    [lastKey],
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const loadConnections = useCallback(() => {
    api
      .listAgentConnections(project.id)
      .then((r) => mountedRef.current && setConnectionCount(r.items.length))
      .catch(() => {
        /* transient / not yet permitted — keep the last known count */
      });
  }, [project.id]);
  const loadConnectionsRef = useRef(loadConnections);
  loadConnectionsRef.current = loadConnections;

  const loadStatus = useCallback(() => {
    api
      .publishStatus(project.id)
      .then((res) => {
        if (!mountedRef.current) return;
        setRelease(res.release);
        setUrl(res.url);
        setDirty(res.dirty);
        setPreviewToken(res.previewToken);
        setLocalHosting(!!res.localHosting);
      })
      .catch(() => {
        /* no published site yet, or transient */
      });
  }, [project.id]);

  useEffect(() => {
    let active = true;
    loadStatus();
    api
      .listDeployTargets(project.id)
      .then((res) => active && setTargets(res.items))
      .catch(() => active && setTargets([]));
    return () => {
      active = false;
    };
  }, [project.id, refreshSignal, loadStatus]);

  useEffect(() => {
    loadConnections();
    const t = setInterval(loadConnections, 30_000);
    return () => clearInterval(t);
  }, [loadConnections]);

  // Any content change means there are unpublished changes (drives the green "changes to deploy" hint).
  useEffect(() => {
    const source = new EventSource(eventsUrl(project.id), { withCredentials: true });
    source.addEventListener('content', (e) => {
      setDirty(true);
      let actor: string | undefined;
      try {
        actor = (JSON.parse((e as MessageEvent).data) as { actor?: string }).actor;
      } catch {
        /* non-JSON payload — ignore */
      }
      if (actor === 'agent') {
        if (!agentActiveRef.current) loadConnectionsRef.current();
        agentActiveRef.current = true;
        setAgentActive(true);
        if (agentTimer.current) clearTimeout(agentTimer.current);
        agentTimer.current = setTimeout(() => {
          agentActiveRef.current = false;
          setAgentActive(false);
          agentTimer.current = null;
          loadConnectionsRef.current();
        }, 12_000);
      }
    });
    return () => {
      source.close();
      if (agentTimer.current) clearTimeout(agentTimer.current);
    };
  }, [project.id]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Deploy to Local Hosting (build the site + serve it at /sites/) via the publish action.
  async function publishLocal() {
    setBusy(true);
    try {
      const res = await api.publish(project.id);
      setRelease(res.release);
      setUrl(res.url);
      setDirty(res.dirty);
      setLocalHosting(true);
      toast.show(`Published to Local Hosting · ${res.release.routes} page${res.release.routes === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'publish failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Deploy to a chosen target: a `local` target publishes locally; a remote target streams an upload.
  function deployTo(target: DeployTargetView) {
    setMenuOpen(false);
    rememberTarget(target.id);
    if (target.protocol === 'local') {
      void publishLocal();
    } else {
      setDeploying(target);
    }
  }

  // The target the primary button deploys: last-used → the local target → the first target.
  const defaultTarget =
    targets.find((t) => t.id === lastTargetId) ?? targets.find((t) => t.protocol === 'local') ?? targets[0] ?? null;

  const published = release !== null;
  // "View live" opens the served site; shown only when local hosting is configured + published + clean.
  const showView = published && !dirty && localHosting && !!url;
  const viewUrl = url && previewToken ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(previewToken)}` : url;
  const btnBase =
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700';

  return (
    <div className="flex items-center gap-2">
      <AgentIndicator
        state={agentActive ? 'working' : connectionCount > 0 ? 'idle' : 'none'}
        count={connectionCount}
        onClick={() => setAgentModalOpen(true)}
      />
      {/* Always-on Preview: browse the live site with the latest (saved) changes — no publish needed. */}
      <button
        onClick={() =>
          window.open(buildPreviewUrl(window.location.origin, window.location.pathname, project.id), '_blank', 'noopener')
        }
        title="Preview the live site with your latest changes — no publish needed"
        aria-label="Preview the live site"
        className={btnBase}
      >
        <PreviewIcon />
        Preview
      </button>

      {showView && (
        <a href={viewUrl} target="_blank" rel="noreferrer" title="View your live (served) site" aria-label="View the live site" className={btnBase}>
          <ExternalLink className="h-4 w-4" />
          View live
        </a>
      )}

      {/* DEPLOY — split button (no targets → opens the config modal). */}
      <div className="relative" ref={menuRef}>
        {targets.length === 0 ? (
          <button onClick={() => onOpenDeploy?.()} title="Set up where to deploy your site" aria-label="Deploy" className={btnBase}>
            <DeployIcon />
            Deploy
          </button>
        ) : (
          <div className="inline-flex">
            <button
              onClick={() => defaultTarget && deployTo(defaultTarget)}
              disabled={busy || !defaultTarget}
              title={defaultTarget ? `Deploy to ${defaultTarget.name}` : 'Deploy'}
              aria-label={defaultTarget ? `Deploy to ${defaultTarget.name}` : 'Deploy'}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-l-md border px-3 py-1.5 text-sm font-bold transition disabled:opacity-50 ${
                dirty
                  ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-400 hover:text-indigo-700'
              }`}
            >
              <DeployIcon />
              {busy ? 'Deploying…' : `Deploy to ${defaultTarget?.name ?? ''}`}
              {dirty && <span aria-hidden className="ml-0.5 h-1.5 w-1.5 rounded-full bg-white/90" />}
            </button>
            <button
              aria-label="Choose a deploy target"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className={`inline-flex cursor-pointer items-center rounded-r-md border border-l-0 px-1.5 py-1.5 transition ${
                dirty
                  ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-400'
              }`}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        )}

        {menuOpen && (
          <div role="menu" className="absolute right-0 z-10 mt-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Deploy to…</p>
            {targets.map((t) => (
              <button
                key={t.id}
                role="menuitem"
                onClick={() => deployTo(t)}
                disabled={busy}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.protocol === 'local' ? 'bg-emerald-500' : 'bg-indigo-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">{targetWhere(t)}</span>
                </span>
              </button>
            ))}
            <div className="my-1 border-t border-slate-100" />
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onOpenDeploy?.();
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              + Add a target…
            </button>
            <a
              role="menuitem"
              href={api.archiveUrl(project.id)}
              aria-label="Download site zip"
              className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download .zip
            </a>
          </div>
        )}
      </div>

      {agentModalOpen && (
        <AgentDetailsModal
          projectId={project.id}
          onChanged={loadConnections}
          onClose={() => {
            setAgentModalOpen(false);
            loadConnections();
          }}
        />
      )}
      {deploying && (
        <DeployModal
          project={project}
          target={deploying}
          onClose={() => {
            setDeploying(null);
            loadStatus();
          }}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, eventsUrl, type Project, type Release } from '../api';
import { AgentDetailsModal } from './AgentDetailsModal';
import { AgentIndicator } from './AgentIndicator';

/** Cloud-upload glyph for the publish action. */
function PublishIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 13V5m0 0L7 8m3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 13.5A3.5 3.5 0 0 1 5.5 6.6 4.5 4.5 0 0 1 14 7a3 3 0 0 1 1 5.83" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Eye glyph for the post-publish "Preview" (view the live published site). */
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

/**
 * Compact publish control (top-right): a single Publish button — GREEN only when there are
 * unpublished changes (`dirty`), neutral otherwise — with the secondary actions (view, download,
 * deploy) tucked behind a "…" menu so the header stays focused on the one primary action.
 */
export function PublishBar({
  project,
  onOpenDeploy,
  refreshSignal = 0,
}: {
  project: Project;
  /** Open the Publish & Deploy modal on its Deploy tab (the header overflow owns the modal). */
  onOpenDeploy?: () => void;
  /** Bumped by the parent when publish settings change, so the preview-token URL stays current. */
  refreshSignal?: number;
}) {
  const [release, setRelease] = useState<Release | null>(null);
  const [url, setUrl] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewToken, setPreviewToken] = useState<string | undefined>(undefined);
  const [hasTarget, setHasTarget] = useState(false); // a saved deploy target exists → show a Deploy button
  const [agentActive, setAgentActive] = useState(false); // an agent edited within the lull window (working)
  const [connectionCount, setConnectionCount] = useState(0); // live agent connections (sessions + PATs)
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentActiveRef = useRef(false); // mirrors agentActive for rising-edge detection in the SSE closure

  // The header indicator reflects active connections; poll lightly so a freshly-authorized or expired
  // session reconciles without a reload (owner-gated endpoint — PublishBar only renders for owners).
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

  useEffect(() => {
    let active = true;
    api
      .publishStatus(project.id)
      .then((res) => {
        if (!active) return;
        setRelease(res.release);
        setUrl(res.url);
        setDirty(res.dirty);
      })
      .catch(() => {
        /* no published site yet, or transient — Publish still works */
      });
    // The preview-token gate (if any) must be reflected in the View/Preview link.
    api
      .getSettings(project.id)
      .then((res) => active && setPreviewToken(res.item.website?.previewToken))
      .catch(() => {
        /* settings unreadable → no token gate to honor */
      });
    // A configured deploy target surfaces a prominent Deploy button next to Preview.
    api
      .listDeployTargets(project.id)
      .then((res) => active && setHasTarget(res.items.length > 0))
      .catch(() => active && setHasTarget(false));
    return () => {
      active = false;
    };
  }, [project.id, refreshSignal]);

  // Agent connections: load on mount and reconcile every 30s (covers a connect/expiry with no edit event).
  useEffect(() => {
    loadConnections();
    const t = setInterval(loadConnections, 30_000);
    return () => clearInterval(t);
  }, [loadConnections]);

  // Any content change (this user, or another channel via the SSE bus) means there are now
  // unpublished changes — flip back to the green Publish button (out of the "Preview" state).
  useEffect(() => {
    const source = new EventSource(eventsUrl(project.id), { withCredentials: true });
    source.addEventListener('content', (e) => {
      setDirty(true);
      // Flag "an agent is editing" when the change came from a bearer/MCP write; clear after a lull.
      let actor: string | undefined;
      try {
        actor = (JSON.parse((e as MessageEvent).data) as { actor?: string }).actor;
      } catch {
        /* non-JSON payload — ignore */
      }
      if (actor === 'agent') {
        // Rising edge (idle/none → working): a (possibly new) agent just acted — reconcile the count.
        if (!agentActiveRef.current) loadConnectionsRef.current();
        agentActiveRef.current = true;
        setAgentActive(true);
        if (agentTimer.current) clearTimeout(agentTimer.current);
        agentTimer.current = setTimeout(() => {
          agentActiveRef.current = false;
          setAgentActive(false);
          agentTimer.current = null;
          // Working → idle: re-check whether the connection is still live (e.g. revoked elsewhere).
          loadConnectionsRef.current();
        }, 12_000);
      }
    });
    return () => {
      source.close();
      if (agentTimer.current) clearTimeout(agentTimer.current);
    };
  }, [project.id]);

  // Close the actions menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.publish(project.id);
      setRelease(res.release);
      setUrl(res.url);
      setDirty(res.dirty); // false right after a successful publish
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish failed');
    } finally {
      setBusy(false);
    }
  }

  const published = release !== null;
  // After a clean publish the primary action becomes "Preview" (open the live site); it reverts to
  // the green "Publish" the moment there are unpublished changes (dirty) or nothing is published yet.
  const showPreview = published && !dirty;
  // When a preview token gates the site, the View/Preview link must carry it.
  const viewUrl = url && previewToken ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(previewToken)}` : url;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {showPreview && url ? (
          <a
            href={viewUrl}
            target="_blank"
            rel="noreferrer"
            title="View your published site"
            aria-label="Preview the published site"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700"
          >
            <PreviewIcon />
            Preview
          </a>
        ) : (
          <button
            onClick={publish}
            disabled={busy}
            title={dirty ? 'You have unpublished changes' : 'Publish your site'}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${
              dirty
                ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400'
            }`}
          >
            <PublishIcon />
            {busy ? 'Publishing…' : 'Publish'}
            {dirty && <span aria-hidden className="ml-0.5 h-1.5 w-1.5 rounded-full bg-white/90" />}
          </button>
        )}

        {/* A configured deploy target gets a prominent Deploy button (opens the Deploy settings tab,
            where the streaming deploy modal is launched). */}
        {published && hasTarget && onOpenDeploy && (
          <button
            onClick={onOpenDeploy}
            title="Deploy the published site to your server"
            aria-label="Deploy the published site"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700"
          >
            <DeployIcon />
            Deploy
          </button>
        )}

        {published && (
          <div className="relative" ref={menuRef}>
            <button
              aria-label="Publish actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-600 hover:border-slate-400"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              >
                {url && (
                  <a
                    role="menuitem"
                    href={viewUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View published site"
                    className="block cursor-pointer px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    View site ↗
                  </a>
                )}
                <a
                  role="menuitem"
                  href={api.archiveUrl(project.id)}
                  aria-label="Download site zip"
                  className="block cursor-pointer px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Download .zip
                </a>
                <button
                  role="menuitem"
                  onClick={() => {
                    onOpenDeploy?.();
                    setMenuOpen(false);
                  }}
                  className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  Deploy…
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <AgentIndicator
        state={agentActive ? 'working' : connectionCount > 0 ? 'idle' : 'none'}
        count={connectionCount}
        onClick={() => setAgentModalOpen(true)}
      />
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
      {release && (
        <span className="text-[11px] text-slate-400">
          {dirty ? 'Unpublished changes' : `Published · ${release.routes} pages`}
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

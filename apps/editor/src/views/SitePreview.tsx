import { useCallback, useEffect, useRef, useState } from 'react';
import { api, eventsUrl, previewSiteUrl } from '../api';
import type { PreviewTarget } from '../lib/preview-target';

/** Coalesce a burst of edits into one reload/navigate. */
const CHANGE_DEBOUNCE_MS = 250;
/** How long after an agent edit the pill stays in the "working" state (matches the header indicator). */
const WORKING_LULL_MS = 12_000;
/** Reconcile the connection count periodically (covers a connect/expiry with no edit event). */
const PRESENCE_POLL_MS = 30_000;

/**
 * The always-on whole-site PREVIEW shell (opened via `?preview=projectId`). A same-origin,
 * authenticated page that embeds the project's live DRAFT site in a SANDBOXED iframe and:
 *   - subscribes to the change stream and RELOADS the shown page on any edit (from any channel),
 *   - AUTO-NAVIGATES to a page an agent just created/edited (resolved via `/preview-locate`),
 *   - shows a minimal "agent connected / working" pill — and NOTHING else (no editor chrome).
 *
 * The sandboxed child can't be inspected cross-origin, so its injected runtime postMessages its
 * location here; this shell tracks that to reload the RIGHT page and to update the tab title.
 */
export function SitePreview({ target }: { target: PreviewTarget }) {
  const { projectId } = target;
  // The route currently shown in the iframe (reported by the child runtime) — drives reload targeting.
  const currentPath = useRef<string>(target.path);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState(() => previewSiteUrl(projectId, target.path));
  const [connectedCount, setConnectedCount] = useState(0);
  const [working, setWorking] = useState(false);
  const workingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigate the embedded iframe to a preview route (home = '').
  const go = useCallback(
    (path: string) => {
      currentPath.current = path;
      setSrc(previewSiteUrl(projectId, path));
    },
    [projectId],
  );

  // Reload the page currently shown. The src must differ from the last value or the iframe won't
  // refetch — a cache-busting param forces it (the route also sends `no-store`).
  const reloadCurrent = useCallback(() => {
    const base = previewSiteUrl(projectId, currentPath.current);
    setSrc(`${base}${base.includes('?') ? '&' : '?'}r=${Date.now()}`);
  }, [projectId]);

  // A content change landed: navigate to the changed page if it resolves to a navigable route
  // (covers "agent created/edited page X"); otherwise just reload the current page (global edits).
  const onChange = useCallback(
    async (entityId: string | undefined) => {
      if (entityId) {
        try {
          const { path } = await api.previewLocate(projectId, entityId);
          if (path !== null) {
            if (path !== currentPath.current) go(path);
            else reloadCurrent();
            return;
          }
        } catch {
          /* locate failed → fall through to a plain reload */
        }
      }
      reloadCurrent();
    },
    [projectId, go, reloadCurrent],
  );

  // Subscribe to the change stream: debounce, track the agent "working" state, then reload/navigate.
  useEffect(() => {
    const source = new EventSource(eventsUrl(projectId), { withCredentials: true });
    let handle: ReturnType<typeof setTimeout> | undefined;
    let lastEntity: string | undefined;
    source.addEventListener('content', (e) => {
      let data: { entityId?: string; actor?: string } = {};
      try {
        data = JSON.parse((e as MessageEvent).data) as { entityId?: string; actor?: string };
      } catch {
        /* non-JSON payload — ignore */
      }
      lastEntity = data.entityId;
      if (data.actor === 'agent') {
        setWorking(true);
        if (workingTimer.current) clearTimeout(workingTimer.current);
        workingTimer.current = setTimeout(() => setWorking(false), WORKING_LULL_MS);
      }
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => void onChange(lastEntity), CHANGE_DEBOUNCE_MS);
    });
    return () => {
      if (handle) clearTimeout(handle);
      if (workingTimer.current) clearTimeout(workingTimer.current);
      source.close();
    };
  }, [projectId, onChange]);

  // The child runtime reports the iframe's location so we can target reloads + title the tab.
  useEffect(() => {
    const prefix = `/projects/${projectId}/preview-site/`;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; path?: string; title?: string } | null;
      if (!d || d.source !== 'sitewright-preview-site' || d.type !== 'location') return;
      if (typeof d.path === 'string' && d.path.startsWith(prefix)) {
        currentPath.current = d.path.slice(prefix.length).replace(/\/+$/, '');
      }
      if (typeof d.title === 'string' && d.title) document.title = `Preview · ${d.title}`;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [projectId]);

  // Agent presence count (member-safe): load on mount + reconcile periodically.
  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .agentPresence(projectId)
        .then((r) => active && setConnectedCount(r.connected))
        .catch(() => {
          /* transient — keep the last known count */
        });
    load();
    const t = setInterval(load, PRESENCE_POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [projectId]);

  const showPill = working || connectedCount > 0;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <iframe
        ref={iframeRef}
        title="Site preview"
        src={src}
        // Author content runs (true WYSIWYG) but stays opaque-origin — it can't reach this
        // shell's authenticated session. Matches the API route's own `sandbox` CSP.
        sandbox="allow-scripts"
        className="h-full w-full border-0"
      />
      {showPill && (
        // pointer-events-none so the indicator never intercepts clicks meant for the preview.
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm ring-1 ${
              working ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200'
            }`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${working ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`}
            />
            {working ? 'Agent working…' : `Agent connected${connectedCount > 1 ? ` · ${connectedCount}` : ''}`}
          </span>
        </div>
      )}
    </div>
  );
}

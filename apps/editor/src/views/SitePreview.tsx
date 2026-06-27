import { useCallback, useEffect, useRef, useState } from 'react';
import { api, eventsUrl, previewUrlFrom } from '../api';
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
 *   - offers a "copy link" for the SHARE-ABLE preview URL, and a minimal agent presence pill.
 *
 * The iframe loads the draft via a SIGNED path (`/preview/<id>/<sig>/…`) fetched once from the API:
 * the signature gates the draft, so the sandboxed (cookieless) frame can NAVIGATE between pages —
 * a session cookie would be dropped on in-frame navigation, but the sig rides in every relative link.
 * The sandboxed child can't be inspected cross-origin, so its injected runtime postMessages its
 * location here; this shell tracks that to reload the RIGHT page and update the tab title.
 */
export function SitePreview({ target }: { target: PreviewTarget }) {
  const { projectId } = target;
  // The route currently shown in the iframe (reported by the child runtime) — drives reload targeting.
  const currentPath = useRef<string>(target.path);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The SIGNED preview base (`/preview/<id>/<sig>/`), fetched once; the iframe src + nav build on it.
  const [base, setBase] = useState<string | null>(null);
  const baseRef = useRef<string | null>(null);
  const [src, setSrc] = useState('');
  const [connectedCount, setConnectedCount] = useState(0);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const workingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the signed base on mount, then load the initial route into the iframe.
  useEffect(() => {
    let active = true;
    api
      .previewBase(projectId)
      .then((r) => {
        if (!active) return;
        baseRef.current = r.base;
        setBase(r.base);
        setSrc(previewUrlFrom(r.base, target.path));
      })
      .catch(() => {
        /* preview unavailable (e.g. feature off) — the shell stays blank */
      });
    return () => {
      active = false;
    };
  }, [projectId, target.path]);

  // This shell fills the window (the iframe owns all scrolling), but the app-wide
  // `html{scrollbar-gutter:stable}` (styles.css) still reserves an empty gutter strip beside the
  // iframe's own scrollbar. Drop it while the preview is mounted; restore it on the way out.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.scrollbarGutter;
    html.style.scrollbarGutter = 'auto';
    return () => {
      html.style.scrollbarGutter = prev;
    };
  }, []);

  // Navigate the embedded iframe to a preview route (home = '').
  const go = useCallback((path: string) => {
    if (!baseRef.current) return;
    currentPath.current = path;
    setSrc(previewUrlFrom(baseRef.current, path));
  }, []);

  // Reload the page currently shown. The src must differ from the last value or the iframe won't
  // refetch — a cache-busting param forces it (the route also sends `no-store`).
  const reloadCurrent = useCallback(() => {
    if (!baseRef.current) return;
    const b = previewUrlFrom(baseRef.current, currentPath.current);
    setSrc(`${b}${b.includes('?') ? '&' : '?'}r=${Date.now()}`);
  }, []);

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

  // The child runtime reports the iframe's location so we can target reloads + title the tab. The
  // reported pathname is under the signed base; strip it back to a bare route.
  useEffect(() => {
    if (!base) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; path?: string; title?: string } | null;
      if (!d || d.source !== 'sitewright-preview-site' || d.type !== 'location') return;
      if (typeof d.path === 'string' && d.path.startsWith(base)) {
        currentPath.current = d.path.slice(base.length).replace(/\/+$/, '');
      }
      if (typeof d.title === 'string' && d.title) document.title = `Preview · ${d.title}`;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [base]);

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

  // The share-able preview URL (absolute) — resolve the iframe URL against this origin so it stays
  // correct whether the API is same-origin (relative) or a separate origin (absolute via VITE_API_BASE).
  const shareUrl = base ? new URL(previewUrlFrom(base, ''), window.location.origin).href : '';
  const copyShareUrl = () => {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const showPill = working || connectedCount > 0;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      {src && (
        <iframe
          ref={iframeRef}
          title="Site preview"
          src={src}
          // Author content runs (true WYSIWYG) but stays opaque-origin — it can't reach this
          // shell's authenticated session. Matches the API route's own `sandbox` CSP.
          sandbox="allow-scripts"
          className="h-full w-full border-0"
        />
      )}
      {base && (
        <button
          onClick={copyShareUrl}
          title={shareUrl}
          className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-slate-900/70 px-2.5 py-1 text-[11px] font-medium text-white opacity-60 shadow-sm backdrop-blur transition hover:opacity-100"
        >
          {copied ? 'Link copied' : 'Copy preview link'}
        </button>
      )}
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

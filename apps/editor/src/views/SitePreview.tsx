import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { PREVIEW_SANDBOX_ATTR } from '@sitewright/schema';
import { PreviewSkeleton } from './editor/PreviewSkeleton';
import { PreviewProgressPill } from './editor/PreviewProgressPill';
import { api, eventsUrl, previewUrlFrom } from '../api';
import { AgentDrawer } from './AgentDrawer';
import type { PreviewTarget } from '../lib/preview-target';
import { useIsMobile } from '../lib/use-is-mobile';

/** Coalesce a burst of edits into one reload/navigate. */
const CHANGE_DEBOUNCE_MS = 250;
/** How long after an agent edit the pill stays in the "working" state (matches the header indicator). */
const WORKING_LULL_MS = 12_000;
/** Reconcile the connection count periodically (covers a connect/expiry with no edit event). */
const PRESENCE_POLL_MS = 30_000;
/** How long the copy-link button reads "Copied!" before reverting. */

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
  // False until the embedded draft has painted once — drives the loading skeleton below.
  const [everLoaded, setEverLoaded] = useState(false);
  // What the draft build is doing while we wait for that first paint.
  const [progress, setProgress] = useState<{ phase?: string; done?: number; total?: number }>({});
  // Pages the draft build could not render. Each still serves an error document in place, so the
  // preview is current everywhere else — this is what tells the author about a page they are not on.
  const [pageFailures, setPageFailures] = useState<Array<{ page: string; path: string; message: string }>>([]);
  const [failuresDismissed, setFailuresDismissed] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const [working, setWorking] = useState(false);
  const workingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The on-page AI assistant: available only when configured (platform or per-project) + the user can write.
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Phone-sized viewport: the drawer covers the FAB rather than sitting beside it (see the FAB below).
  const isMobile = useIsMobile();
  // Live turn status lifted from the drawer, so the AI button animates while it thinks/works.
  const [agentActivity, setAgentActivity] = useState<'idle' | 'thinking' | 'working'>('idle');

  useEffect(() => {
    let active = true;
    api
      .agentStatus(projectId)
      .then((s) => active && setAgentEnabled(s.enabled))
      .catch(() => {}); // status is best-effort — no assistant button on failure
    return () => {
      active = false;
    };
  }, [projectId]);

  // Fetch the signed base on mount, then load the initial route into the iframe.
  useEffect(() => {
    let active = true;
    api
      .previewBase(projectId)
      .then((r) => {
        if (!active) return;
        baseRef.current = r.base;
        setBase(r.base);
        setPageFailures(r.pageFailures ?? []);
        setSrc(previewUrlFrom(r.base, target.path));
      })
      .catch(() => {
        /* preview unavailable (e.g. feature off) — the shell stays blank */
      });
    return () => {
      active = false;
    };
  }, [projectId, target.path]);

  // Narrate the wait. `previewBase` above blocks for the WHOLE draft build, so it can never report
  // its own progress — this is a second, non-blocking read of the same build's phase. It runs only
  // until the iframe's first paint, and stops on the first failure so an older instance without the
  // endpoint degrades to the plain skeleton instead of polling a 404 forever.
  useEffect(() => {
    if (everLoaded) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = (): void => {
      // Narration must never be able to take the preview down with it — hence the try as well as the
      // catch: a synchronous throw here would escape into React's commit phase and unmount the shell.
      try {
        api
          .previewProgress(projectId)
          .then((p) => {
            if (!active) return;
            setProgress(p.building ? { phase: p.phase, done: p.done, total: p.total } : {});
            timer = setTimeout(tick, 700);
          })
          .catch(() => {
            /* endpoint unavailable — keep the skeleton, drop the narration */
          });
      } catch {
        /* same */
      }
    };
    tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, everLoaded]);

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

  // Re-read the build's page failures whenever content changes: the edit that just landed may be the
  // one that broke a page — or the one that fixed it. One call per debounced burst; the endpoint
  // brings the draft up to date before answering, so this is never a stale answer.
  const refreshFailures = useCallback(() => {
    api
      .previewBase(projectId)
      .then((r) => {
        setPageFailures(r.pageFailures ?? []);
        setFailuresDismissed(false);
      })
      .catch(() => {}); // best-effort: the banner just doesn't update
  }, [projectId]);

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
      handle = setTimeout(() => {
        void onChange(lastEntity);
        refreshFailures();
      }, CHANGE_DEBOUNCE_MS);
    });
    return () => {
      if (handle) clearTimeout(handle);
      if (workingTimer.current) clearTimeout(workingTimer.current);
      source.close();
    };
  }, [projectId, onChange, refreshFailures]);

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

  const showPill = working || connectedCount > 0;

  // The failure banner owns the top strip while it is up, so the two chips step down out of its way.
  const bannerUp = pageFailures.length > 0 && !failuresDismissed;

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-white">
      {/* Opening a project and going straight to the preview can take a while: the shell first fetches
          the signed base (which brings the draft build up to date — a whole-site render on a cold
          project), and only then does the iframe start fetching a page. Both steps used to sit behind
          a plain white screen with nothing to say the preview was coming. Cover them with the same
          page-shaped skeleton the editor's preview pane uses, until the iframe's FIRST real load. Later
          reloads (per-edit refresh) keep the last frame instead — re-skeletoning would strobe. */}
      {!everLoaded && (
        <div role="status" className="absolute inset-0 z-30 bg-white">
          <PreviewSkeleton />
          <span className="sr-only">Loading the site preview…</span>
        </div>
      )}
      {/* …and NAME the step, because the skeleton alone cannot distinguish "a second away" from
          "re-encoding 300 images". Only while the first frame is still missing. */}
      {!everLoaded && <PreviewProgressPill phase={progress.phase} done={progress.done} total={progress.total} />}
      {src && (
        <iframe
          ref={iframeRef}
          title="Site preview"
          src={src}
          onLoad={() => setEverLoaded(true)}
          // Author content runs (true WYSIWYG) but stays opaque-origin — it can't reach this
          // shell's authenticated session. SHARED with the API route's own `sandbox` CSP: the two
          // lists intersect, so a token missing from either side is silently lost.
          sandbox={PREVIEW_SANDBOX_ATTR}
          className="h-full w-full border-0"
        />
      )}
      {bannerUp && (
        <div className="absolute inset-x-3 top-3 z-20 rounded-xl bg-red-600/95 px-4 py-2.5 text-white shadow-lg backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 text-[12px] leading-5">
              <p className="font-bold">
                {pageFailures.length === 1
                  ? '1 page could not be rendered'
                  : `${pageFailures.length} pages could not be rendered`}{' '}
                <span className="font-normal opacity-90">
                  — every other page in this preview is up to date.
                </span>
              </p>
              {pageFailures.slice(0, 3).map((f) => (
                <p key={f.page} className="truncate opacity-90">
                  <code className="rounded bg-black/25 px-1">{f.path}</code> {f.message}
                </p>
              ))}
              {pageFailures.length > 3 && <p className="opacity-75">…and {pageFailures.length - 3} more.</p>}
            </div>
            <button
              type="button"
              onClick={() => setFailuresDismissed(true)}
              className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-bold text-white/80 hover:bg-white/15 hover:text-white"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {showPill && (
        // pointer-events-none so the indicator never intercepts clicks meant for the preview.
        <div className={`pointer-events-none absolute right-3 z-10 ${bannerUp ? 'top-24' : 'top-3'}`}>
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
      {/* ONE persistent, prominent bottom-LEFT FAB: always shown when the assistant is available
          (click toggles the drawer), and it doubles as the live status indicator during a turn —
          with a pulsing halo while the agent is thinking/working, VISIBLE even with the drawer
          closed (closing no longer stops the turn). Bottom-left so it never sits under the drawer.

          ON MOBILE it hides while the drawer is OPEN. The "never sits under the drawer" geometry is a
          desktop fact: the drawer is 26rem beside a wide page, but on a phone it covers 92vw, so the
          FAB would be buried under it — a control you cannot see, pulsing a status you cannot read.
          The status it carries is not lost: AgentDrawer's own header shows the same live state, which
          is the surface actually in front of the user once the drawer is up. */}
      {agentEnabled && !(isMobile && drawerOpen) && (
        <div className="absolute bottom-6 left-6 z-[62]">
          {/* Pulsing halo — only while a turn is active (thinking/working). */}
          {agentActivity !== 'idle' && (
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 animate-ping rounded-full ${agentActivity === 'working' ? 'bg-emerald-400/60' : 'bg-indigo-400/60'}`}
            />
          )}
          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label={agentActivity === 'working' ? 'AI is working' : agentActivity === 'thinking' ? 'AI is thinking' : drawerOpen ? 'Close the AI assistant' : 'Open the AI assistant'}
            className="sw-brand-gradient relative inline-flex items-center gap-2.5 rounded-full px-5 py-3 text-base font-semibold text-white shadow-xl ring-2 ring-white/40 transition hover:brightness-110"
          >
            {agentActivity === 'working' ? (
              <span aria-hidden className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-white" />
              </span>
            ) : agentActivity === 'thinking' ? (
              <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            {agentActivity === 'working' ? 'AI is working…' : agentActivity === 'thinking' ? 'AI is thinking…' : 'AI Assistant'}
          </button>
        </div>
      )}
      {agentEnabled && (
        <AgentDrawer
          projectId={projectId}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          getPath={() => currentPath.current}
          onStatusChange={setAgentActivity}
        />
      )}
    </div>
  );
}

import { useState } from 'react';

interface PreviewPaneProps {
  /** URL of the sandboxed preview document (served under `CSP: sandbox`). */
  src: string;
  loading: boolean;
  error: string | null;
  /** Accessible name for the preview iframe — distinguishes contexts (e.g. "Preview" for the
   *  source editor vs "Live preview" for the client/live panes). Defaults to "Live preview". */
  title?: string;
}

/**
 * Renders the live preview in a sandboxed iframe loaded via `src` from the
 * preview-document endpoint.
 *
 * Why `src` (not `srcDoc`): a `srcDoc` document inherits the editor page's CSP
 * (`default-src 'self'`, no inline-script), which would block the interactive
 * components' inlined JS. Loading via `src` lets the document use its OWN response
 * CSP — the endpoint serves it under `Content-Security-Policy: sandbox
 * allow-scripts`, an OPAQUE origin, so component scripts run (true WYSIWYG) yet
 * cannot reach the editor's `window`, cookies, or session. `sandbox="allow-scripts"`
 * on the iframe is belt-and-suspenders; `allow-same-origin` must NEVER be added.
 */
export function PreviewPane({ src, loading, error, title = 'Live preview' }: PreviewPaneProps) {
  // The iframe paints blank-white while it fetches/renders its document. Cover it with an
  // animated skeleton until its FIRST real load completes (`about:blank` doesn't count), so
  // the pane never flashes empty. Subsequent reloads keep the last frame + the "updating…"
  // pill instead of re-skeletoning (that would strobe on live-preview's per-edit refresh).
  // `everLoaded` is intentionally NOT reset on `src` change: each consumer mounts a fresh
  // PreviewPane per page/target (the editor modal and LivePreview both remount), so a new
  // page gets a new instance — and `src` only swaps in place for refreshes of the SAME page.
  const [everLoaded, setEverLoaded] = useState(false);
  const showSkeleton = !everLoaded && !error;
  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-white/50 bg-white/40 p-1 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
      {error && (
        <div role="alert" className="absolute inset-x-1 top-1 z-10 rounded-t-xl bg-rose-50/90 px-3 py-2 text-xs text-rose-700 backdrop-blur-sm">
          Preview error: {error}
        </div>
      )}
      <iframe
        title={title}
        aria-label={title}
        sandbox="allow-scripts"
        src={src || 'about:blank'}
        onLoad={() => {
          if (src) setEverLoaded(true);
        }}
        className="h-full w-full rounded-xl border border-white/60 bg-white"
      />
      {showSkeleton && (
        <div role="status" className="absolute inset-1">
          <div aria-hidden className="skeleton h-full w-full rounded-xl" />
          <span className="sr-only">Loading preview…</span>
        </div>
      )}
      {loading && everLoaded && (
        <span className="absolute bottom-3 right-4 rounded-lg bg-white/80 px-2 py-0.5 text-xs text-slate-500 shadow-sm backdrop-blur-sm">
          updating…
        </span>
      )}
    </div>
  );
}

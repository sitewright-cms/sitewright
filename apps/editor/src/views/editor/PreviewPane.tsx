interface PreviewPaneProps {
  /** URL of the sandboxed preview document (served under `CSP: sandbox`). */
  src: string;
  loading: boolean;
  error: string | null;
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
export function PreviewPane({ src, loading, error }: PreviewPaneProps) {
  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-white/50 bg-white/40 p-1 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
      {error && (
        <div role="alert" className="absolute inset-x-1 top-1 z-10 rounded-t-xl bg-rose-50/90 px-3 py-2 text-xs text-rose-700 backdrop-blur-sm">
          Preview error: {error}
        </div>
      )}
      <iframe
        title="Live preview"
        aria-label="Live preview"
        sandbox="allow-scripts"
        src={src || 'about:blank'}
        className="h-full w-full rounded-xl border border-white/60 bg-white"
      />
      {loading && (
        <span className="absolute bottom-3 right-4 rounded-lg bg-white/80 px-2 py-0.5 text-xs text-slate-500 shadow-sm backdrop-blur-sm">
          updating…
        </span>
      )}
    </div>
  );
}

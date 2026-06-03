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
    <div className="relative h-full">
      {error && (
        <div role="alert" className="absolute inset-x-0 top-0 z-10 bg-red-50 px-3 py-2 text-xs text-red-700">
          Preview error: {error}
        </div>
      )}
      <iframe
        title="Live preview"
        aria-label="Live preview"
        sandbox="allow-scripts"
        src={src || 'about:blank'}
        className="h-full w-full rounded-lg border border-slate-200 bg-white"
      />
      {loading && (
        <span className="absolute bottom-2 right-3 rounded bg-white/80 px-2 py-0.5 text-xs text-slate-400">
          updating…
        </span>
      )}
    </div>
  );
}

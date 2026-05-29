interface PreviewPaneProps {
  html: string;
  loading: boolean;
  error: string | null;
}

/**
 * Renders the server-produced preview HTML in a fully sandboxed iframe. The
 * `sandbox=""` attribute blocks scripts, forms and same-origin access, so even
 * if hostile content slipped past escaping it cannot execute — the preview is
 * pure styled markup.
 */
export function PreviewPane({ html, loading, error }: PreviewPaneProps) {
  return (
    <div className="relative h-full">
      {error && (
        <div className="absolute inset-x-0 top-0 z-10 bg-red-50 px-3 py-2 text-xs text-red-700">
          Preview error: {error}
        </div>
      )}
      <iframe
        title="Live preview"
        aria-label="Live preview"
        sandbox=""
        srcDoc={html}
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

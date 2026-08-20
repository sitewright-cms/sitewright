import { useState, type RefObject } from 'react';
import { PREVIEW_SANDBOX_ATTR } from '@sitewright/schema';
import { PreviewSkeleton } from './PreviewSkeleton';

interface PreviewPaneProps {
  /** URL of the sandboxed preview document (served under `CSP: sandbox`). */
  src: string;
  loading: boolean;
  error: string | null;
  /** Accessible name for the preview iframe — distinguishes contexts (e.g. "Preview" for the
   *  source editor vs "Live preview" for the client/live panes). Defaults to "Live preview". */
  title?: string;
  /** Exposes the iframe element so the parent can reach `contentWindow` (the editor↔preview
   *  postMessage bridge: validate `event.source`, post scrollTo/setMode). */
  iframeRef?: RefObject<HTMLIFrameElement>;
  /** Drop the frosted card frame (border + 1-unit gutter + the iframe's own hairline) so the
   *  document meets the pane edge. The page editor wants this: there the preview IS the surface,
   *  and the gutter reads as a grey ring drawn around the site rather than as chrome. The slot
   *  editor and the live-preview panel keep the frame — both sit ON a page next to other cards. */
  frameless?: boolean;
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
 * cannot reach the editor's `window`, cookies, or session. The iframe's own `sandbox` is
 * belt-and-suspenders and must MATCH the response CSP's token list, or the stricter of the two
 * silently wins — so both come from the SHARED {@link PREVIEW_SANDBOX_ATTR}/`PREVIEW_SANDBOX_CSP`
 * pair rather than two hand-kept literals. `allow-same-origin` must NEVER be added.
 */
export function PreviewPane({ src, loading, error, title = 'Live preview', iframeRef, frameless }: PreviewPaneProps) {
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
    <div
      // ★ Frameless drops the BORDER and the frosted tint, but keeps the 1-unit gutter and paints it
      // WHITE — the iframe is white too, so the gutter is invisible and the ring is gone.
      //
      // Removing the padding as well was the obvious version and it was wrong: it changes the iframe's
      // geometry, and with it where a click into the frame lands. It cost an in-place rich edit — a
      // click aimed at an editable region hit the document body instead, so the region never took
      // focus and the toolbar's execCommand silently did nothing. Cosmetics are not worth moving the
      // hit targets of the surface people type into.
      className={
        frameless
          ? // FRAMELESS: no gutter at all. The page editor's preview IS the working surface, so any
            // padding reads as a grey ring drawn around the site rather than as chrome around a card.
            'relative h-full overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-900/5'
          : 'relative h-full overflow-hidden rounded-2xl border border-white/50 bg-white/40 p-1 shadow-xl shadow-slate-900/5 backdrop-blur-xl'
      }
    >
      {error && (
        <div
          role="alert"
          className={`absolute z-10 rounded-t-xl bg-rose-50/90 px-3 py-2 text-xs text-rose-700 backdrop-blur-sm ${
            frameless ? 'inset-x-0 top-0' : 'inset-x-1 top-1'
          }`}
        >
          Preview error: {error}
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={title}
        aria-label={title}
        sandbox={PREVIEW_SANDBOX_ATTR}
        src={src || 'about:blank'}
        onLoad={() => {
          if (src) setEverLoaded(true);
        }}
        // Frameless: match the container's radius, or the document's square corners sit inside a
        // rounded box and the mismatch reads as a sliver of background.
        className={frameless ? 'h-full w-full rounded-2xl bg-white' : 'h-full w-full rounded-xl border border-white/60 bg-white'}
      />
      {showSkeleton && (
        <div role="status" className={frameless ? 'absolute inset-0' : 'absolute inset-1'}>
          <PreviewSkeleton />
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

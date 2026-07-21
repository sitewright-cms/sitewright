import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

/** Eye glyph — opens the rendered snippet preview on hover/focus. */
function EyeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const CARD_W = 400;
const CARD_H = 300;
const HEADER_H = 28;

/** The floating preview card: a sandboxed iframe of the server-rendered snippet, portalled to body
 *  (so the bottom rail's `overflow` can't clip it) and fixed-positioned above (or below) its anchor. */
function PreviewCard({
  anchor,
  url,
  label,
  onEnter,
  onLeave,
  onClose,
}: {
  anchor: HTMLElement;
  url: string;
  label: string;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const rect = anchor.getBoundingClientRect();
  // Prefer above the eye (the rail sits at the bottom of the screen); flip below if there's no room.
  const above = rect.top > CARD_H + 16;
  const top = above ? Math.max(8, rect.top - CARD_H - 8) : rect.bottom + 8;
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - CARD_W / 2, window.innerWidth - CARD_W - 8));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-label={`${label} preview`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ position: 'fixed', top, left, width: CARD_W, height: CARD_H, zIndex: 80 }}
      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-2.5" style={{ height: HEADER_H }}>
        <span className="truncate font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <button type="button" aria-label="Close preview" onClick={onClose} className="text-slate-400 dark:text-slate-500 transition hover:text-slate-700 dark:hover:text-slate-200">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="relative" style={{ height: CARD_H - HEADER_H }}>
        {!loaded && <div className="absolute inset-0 grid place-items-center text-xs text-slate-400 dark:text-slate-500">Rendering…</div>}
        {/* The server already serves this under `CSP: sandbox allow-scripts` (opaque origin); the
            iframe `sandbox` attribute is belt-and-suspenders — scripts run, but it can't reach the
            editor's origin/cookies. */}
        <iframe
          title={`${label} preview`}
          src={url}
          onLoad={() => setLoaded(true)}
          sandbox="allow-scripts"
          className="h-full w-full border-0 bg-white"
        />
      </div>
    </div>,
    document.body,
  );
}

const OPEN_DELAY = 220;
const CLOSE_GRACE = 140;

/**
 * An eye button that reveals a live, server-rendered preview of a snippet on hover (or keyboard
 * focus). The preview is a sandboxed iframe of the snippet rendered with the project's brand styling
 * (see the `/projects/:id/snippets/:sid/preview` route). A short open delay avoids firing on a
 * pass-over; a close grace lets the pointer travel from the eye onto the card without it vanishing.
 */
export function SnippetPreviewButton({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };
  const scheduleOpen = () => {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_GRACE);
  };
  const keepOpen = () => {
    clearTimers();
    setOpen(true);
  };
  useEffect(() => () => clearTimers(), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Preview ${label}`}
        title={`Preview ${label}`}
        aria-expanded={open}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={keepOpen}
        onBlur={scheduleClose}
        onClick={() => (open ? setOpen(false) : keepOpen())}
        className="shrink-0 rounded-md px-1.5 py-1 text-slate-400 dark:text-slate-500 transition hover:bg-slate-100 dark:hover:bg-white/10 hover:text-indigo-600 dark:hover:text-indigo-400"
      >
        <EyeIcon />
      </button>
      {open && btnRef.current && (
        <PreviewCard anchor={btnRef.current} url={url} label={label} onEnter={keepOpen} onLeave={scheduleClose} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Tab-cycle selector for the focus trap. */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);

/** Close (×) glyph from the platform icon vocabulary. */
function CloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
/** Save (✓) glyph — confirms + persists. */
function SaveIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const SIZES = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-6xl h-[90vh]',
} as const;

interface ModalProps {
  title: string;
  onClose: () => void;
  /** When provided, the header shows a SAVE icon button that calls this. */
  onSave?: () => void;
  saving?: boolean;
  /** Accessible label for the save button (default "Save"). */
  saveLabel?: string;
  size?: keyof typeof SIZES;
  children: ReactNode;
  /** Optional left-aligned extra header content (e.g. a hint, a path, a toggle). */
  headerExtra?: ReactNode;
}

/**
 * The platform's global modal: a frosted panel over a blurred backdrop, portalled to <body> so it
 * overlays everything. The header carries the title plus icon buttons — CLOSE (×) always, and SAVE
 * (✓) when `onSave` is given. Escape and a backdrop click both close it; focus moves into the panel
 * on open. Sized via `size` ('md'|'lg'|'xl'|'full').
 */
export function Modal({ title, onClose, onSave, saving = false, saveLabel = 'Save', size = 'lg', children, headerExtra }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Stabilise the handlers so the keydown effect only re-binds when `saving` flips — inline
  // onClose/onSave from call sites change identity every render and would otherwise churn the
  // listener (briefly unregistering ⌘S between renders).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Mount-only: lock body scroll, move focus into the panel, and trap Tab inside the dialog.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const panel = panelRef.current;
    const onTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener('keydown', onTrap);
    return () => {
      panel?.removeEventListener('keydown', onTrap);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Global shortcuts: Escape closes, Cmd/Ctrl+S saves (when wired and not already saving).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (onSaveRef.current && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving) onSaveRef.current!();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        // Backdrop click (not a click inside the panel) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div aria-hidden className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex w-full ${SIZES[size]} max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-2xl outline-none backdrop-blur-xl`}
      >
        <header className="flex items-center gap-3 border-b border-slate-200/70 px-5 py-3">
          <h2 id={titleId} className="flex-1 truncate text-sm font-semibold text-slate-800">{title}</h2>
          {headerExtra}
          {onSave && (
            <button
              type="button"
              aria-label={saveLabel}
              title={`${saveLabel} (${IS_MAC ? '⌘' : 'Ctrl+'}S)`}
              disabled={saving}
              onClick={onSave}
              className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-sky-500 p-2 text-white shadow-lg shadow-indigo-600/30 transition hover:shadow-indigo-600/40 disabled:opacity-60"
            >
              <SaveIcon />
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
            className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

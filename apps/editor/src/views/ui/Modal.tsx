import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FOCUSABLE, OVERLAY_STACK } from './overlay';
import { InSidePanel, SidePanelHold } from './SidePanel';
import { Tooltip } from './Tooltip';

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
  full: 'max-w-5xl h-[82vh]',
  /** Near-fullscreen workbench (the page editor): wide + tall (90vh) for maximum editing room. The
   *  bottom side-panel rails are nudged up (z above the modal) so they stay visible over it. */
  screen: 'max-w-none h-[90vh]',
} as const;

// Modals share the OVERLAY_STACK (see ./overlay) with Drawers so Escape/⌘S act on the TOP
// overlay only — Esc unwinds one at a time (e.g. a dialog over a drawer over the page editor).

interface ModalProps {
  title: string;
  onClose: () => void;
  /** When provided, the header shows a SAVE icon button that calls this. */
  onSave?: () => void;
  saving?: boolean;
  /** Disables the SAVE button + the ⌘/Ctrl+S shortcut (e.g. nothing to save yet). */
  saveDisabled?: boolean;
  /** Accessible label for the save button (default "Save"). */
  saveLabel?: string;
  size?: keyof typeof SIZES;
  children: ReactNode;
  /** Optional content pinned to the START of the header, BEFORE the title (e.g. a mode toggle). */
  headerLeft?: ReactNode;
  /** Optional inline content shown right after the title text (e.g. a path / status badges). */
  titleExtra?: ReactNode;
  /** Center the title block in the space between `headerLeft` and the right-side actions. */
  centerTitle?: boolean;
  /** Optional extra header content shown just BEFORE the Save/Close actions (right side). */
  headerExtra?: ReactNode;
  /**
   * Guard consulted on EVERY close request (×, Escape, backdrop) before the modal animates
   * out. Return false (or a Promise resolving false) to abort — e.g. when there are unsaved
   * changes, show a confirm and only allow the close if the user discards. Absent → always
   * allowed. This is how a modal stays open on a stray backdrop click while it's dirty.
   */
  onBeforeClose?: () => boolean | Promise<boolean>;
}

/**
 * The platform's global modal: a frosted panel over a blurred backdrop, portalled to <body> so it
 * overlays everything. The header carries the title plus icon buttons — CLOSE (×) always, and SAVE
 * (✓) when `onSave` is given. Escape and a backdrop click both close it (the backdrop is ignored
 * when `dirty`); focus moves into the panel on open. It fades+rises in on open and fades+drops out
 * on close (reduced-motion → a plain fade). Sized via `size` ('md'|'lg'|'xl'|'full').
 */
export function Modal({ title, onClose, onSave, saving = false, saveDisabled = false, saveLabel = 'Save', size = 'lg', children, headerLeft, titleExtra, centerTitle = false, headerExtra, onBeforeClose }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduce = useReducedMotion();
  // Local visibility drives the exit animation: a confirmed close flips this to false, the
  // panel plays its fade-out-down, and AnimatePresence's onExitComplete then calls the parent's
  // onClose (which unmounts us). So callers keep the simple `{open && <Modal onClose=…/>}` shape.
  const [visible, setVisible] = useState(true);
  const onBeforeCloseRef = useRef(onBeforeClose);
  onBeforeCloseRef.current = onBeforeClose;
  const closing = useRef(false);
  // Ask the parent's guard first; only then start the exit. `closing` is latched BEFORE the
  // await so a second trigger arriving while an async confirm is open can't re-enter (which
  // would orphan the first confirm promise); it's released again only if the close is vetoed
  // or the guard throws — so the modal stays usable.
  const requestClose = async () => {
    if (closing.current) return;
    closing.current = true;
    let ok = true;
    try {
      ok = (await onBeforeCloseRef.current?.()) ?? true;
    } catch {
      ok = false; // a throwing guard keeps the modal open rather than closing on error
    }
    if (!ok) {
      closing.current = false;
      return;
    }
    setVisible(false);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  // Stabilise the handlers so the keydown effect only re-binds when `saving` flips — inline
  // onClose/onSave from call sites change identity every render and would otherwise churn the
  // listener (briefly unregistering ⌘S between renders).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const saveDisabledRef = useRef(saveDisabled);
  saveDisabledRef.current = saveDisabled;
  // Identity token on the modal stack (see OVERLAY_STACK above).
  const stackId = useRef<object>({});
  // A modal opened from WITHIN a side panel must sit above the panel layer (z-60/61); a normal
  // modal sits below the panel tabs so they stay visible over it.
  const elevated = useContext(InSidePanel);
  // While this (panel-owned) modal lives, pin the panel open so it can't collapse behind us.
  const panelHold = useContext(SidePanelHold);
  useEffect(() => {
    if (!elevated || !panelHold) return;
    panelHold.hold();
    return () => panelHold.release();
  }, [elevated, panelHold]);

  // Mount-only: register on the modal stack (top = shortcut owner).
  useEffect(() => {
    const id = stackId.current;
    OVERLAY_STACK.push(id);
    return () => {
      const at = OVERLAY_STACK.indexOf(id);
      if (at !== -1) OVERLAY_STACK.splice(at, 1);
    };
  }, []);

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
  // Only the TOP modal on the stack reacts, so stacked modals unwind one Esc at a time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (OVERLAY_STACK[OVERLAY_STACK.length - 1] !== stackId.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        void requestCloseRef.current();
      }
      if (onSaveRef.current && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        // preventDefault even when disabled — the browser's own "save page" dialog
        // must never appear over the editor.
        e.preventDefault();
        if (!saving && !saveDisabledRef.current) onSaveRef.current!();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving]);

  return createPortal(
    // When `visible` flips false the panel/back-drop play their exit, then onExitComplete →
    // the parent's onClose (which unmounts this Modal).
    <AnimatePresence onExitComplete={() => onCloseRef.current()}>
      {visible && (
        <div
          // Gutters (px/pb) keep the panel clear of the screen edges so the side-panel tabs peek
          // out around it; `z` puts panel-owned dialogs above the panels, normal modals below them.
          className={`fixed inset-0 flex items-center justify-center px-14 pb-12 pt-4 ${elevated ? 'z-[70]' : 'z-50'}`}
          role="presentation"
          onMouseDown={(e) => {
            // Backdrop click (not a click inside the panel) requests a close; the parent's
            // onBeforeClose guard can veto it (e.g. unsaved changes).
            if (e.target === e.currentTarget) void requestClose();
          }}
        >
          {/* pointer-events-none so the backdrop never intercepts the click meant for the
              container above (real browsers hit-test the topmost element). */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={`relative flex w-full ${SIZES[size]} ${size === 'screen' ? 'max-h-[calc(100vh-4rem)]' : 'max-h-[82vh]'} flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-2xl outline-none backdrop-blur-xl`}
          >
            <header className="flex items-center gap-3 border-b border-slate-200/70 px-5 py-3">
              {headerLeft}
              <div className={`flex min-w-0 flex-1 items-center gap-2 ${centerTitle ? 'justify-center' : ''}`}>
                <h2 id={titleId} className="truncate text-sm font-bold text-slate-800">{title}</h2>
                {titleExtra}
              </div>
              {headerExtra}
              {onSave && (
                <Tooltip tip={`${saveLabel} (${IS_MAC ? '⌘' : 'Ctrl+'}S)`} side="bottom">
                  <button
                    type="button"
                    aria-label={saveLabel}
                    disabled={saving || saveDisabled}
                    onClick={onSave}
                    className="waves-effect waves-light inline-flex cursor-pointer items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-sky-500 p-2 text-white shadow-lg shadow-indigo-600/30 transition hover:shadow-indigo-600/40 disabled:opacity-60"
                  >
                    <SaveIcon />
                  </button>
                </Tooltip>
              )}
              <Tooltip tip="Close (Esc)" side="bottom">
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => void requestClose()}
                  className="waves-effect inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <CloseIcon />
                </button>
              </Tooltip>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

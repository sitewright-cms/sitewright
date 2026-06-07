import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FOCUSABLE, OVERLAY_STACK } from './overlay';

/** Close (×) glyph (matches Modal). */
function CloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

const WIDTHS = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' } as const;

interface DrawerProps {
  title: string;
  onClose: () => void;
  /** Drawer width tier (default 'lg'). */
  width?: keyof typeof WIDTHS;
  children: ReactNode;
  /** Optional extra header content (right-aligned, before the close button). */
  headerExtra?: ReactNode;
}

/**
 * A right-anchored slide-in panel, portalled to <body>. Shares the OVERLAY_STACK with Modal so
 * Escape acts on the TOP overlay only (a dialog opened over the drawer closes first). Like Modal it
 * locks body scroll, traps Tab inside the panel, and plays a slide-out on close via AnimatePresence.
 * Use for a persistent side workbench (e.g. the file manager); use Modal for a centered task dialog.
 */
export function Drawer({ title, onClose, width = 'lg', children, headerExtra }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stackId = useRef<object>({});

  // Register on the shared overlay stack (top = the Escape owner).
  useEffect(() => {
    const id = stackId.current;
    OVERLAY_STACK.push(id);
    return () => {
      const at = OVERLAY_STACK.indexOf(id);
      if (at !== -1) OVERLAY_STACK.splice(at, 1);
    };
  }, []);

  // Lock body scroll, move focus into the panel, trap Tab inside the drawer.
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

  // Escape closes — but only when this drawer is the TOP overlay (a modal/dialog over it wins).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (OVERLAY_STACK[OVERLAY_STACK.length - 1] !== stackId.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        setVisible(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <AnimatePresence onExitComplete={() => onCloseRef.current()}>
      {visible && (
        <div className="fixed inset-0 z-50" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setVisible(false)}>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className={`absolute right-0 top-0 flex h-full w-full ${WIDTHS[width]} flex-col overflow-hidden border-l border-white/60 bg-white/95 shadow-2xl outline-none backdrop-blur-xl`}
          >
            <header className="flex items-center gap-3 border-b border-slate-200/70 px-5 py-3">
              <h2 id={titleId} className="flex-1 truncate text-sm font-semibold text-slate-800">{title}</h2>
              {headerExtra}
              <button
                type="button"
                aria-label="Close"
                title="Close (Esc)"
                onClick={() => setVisible(false)}
                className="waves-effect inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              >
                <CloseIcon />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

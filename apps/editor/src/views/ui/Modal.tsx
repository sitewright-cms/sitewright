import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FOCUSABLE, OVERLAY_STACK } from './overlay';
import { InSidePanel, SidePanelHold } from './SidePanel';
import { Tooltip } from './Tooltip';
import { saveSurface } from '../../theme';
import { useIsMobile } from '../../lib/use-is-mobile';

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
  /** Wider than xl but WITHOUT a forced height (unlike `full`) — for content-sized modals that need
   *  more horizontal room (e.g. a multi-column picker). */
  '2xl': 'max-w-6xl',
  full: 'max-w-5xl h-[82dvh]',
  /** The SVG Studio workbench — wider than `full` (three columns: tree · canvas · settings) + tall. */
  studio: 'max-w-[92rem] h-[88dvh]',
  /** Near-fullscreen workbench (the page editor): wide + tall (90dvh) for maximum editing room. The
   *  bottom side-panel rails are nudged up (z above the modal) so they stay visible over it. */
  screen: 'max-w-none h-[90dvh]',
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
  /**
   * Whether a modal rendered INSIDE a SidePanel pins that panel open behind it (default true).
   *
   * Set false for a modal that can also be opened from outside the panel — e.g. by a global keyboard
   * shortcut — so opening it does not drag the drawer open as a side effect. Elevation above the
   * panel layer is unaffected; only the hold is skipped.
   */
  pinPanel?: boolean;
  children: ReactNode;
  /** Optional content pinned to the START of the header, BEFORE the title (e.g. a mode toggle). */
  headerLeft?: ReactNode;
  /** Optional inline content shown right after the title text (e.g. a path / status badges). */
  titleExtra?: ReactNode;
  /**
   * Optional content UNDER the title — a caption or a link out of this modal. Absent leaves the header
   * exactly as it was (one centred row); present stacks the title and this, so a subtitle cannot shift
   * the layout of every other modal.
   */
  titleBelow?: ReactNode;
  /**
   * Replaces the rendered title TEXT with a control (e.g. a picker that switches what the modal is
   * editing). `title` is still required and becomes the dialog's accessible name via a visually-hidden
   * heading — the control's own label is about choosing, not about naming the dialog.
   */
  titleControl?: ReactNode;
  /**
   * Render the title as a visually-hidden heading only. For a header so tight that the name of the
   * thing has to give way to the CONTROLS acting on it — the page editor on a phone, where the page
   * being edited is the only thing on screen and so needs no label, but a screen reader still needs
   * the dialog to have an accessible name. Never a way to ship a dialog with no name at all.
   */
  titleHidden?: boolean;
  /** Center the title block in the space between `headerLeft` and the right-side actions. */
  centerTitle?: boolean;
  /** Optional extra header content shown just BEFORE the Save/Close actions (right side). */
  headerExtra?: ReactNode;
  /**
   * Force the ELEVATED layer (normally reserved for a modal opened from inside a SidePanel).
   *
   * For a dialog reached by a GLOBAL SHORTCUT: it can be summoned while the page editor — itself a
   * modal — is open, and at equal z-index the winner is whichever portal happens to be later in the
   * document. "Whichever mounted last" is true today and is not a rule anything enforces, so the
   * elevation is stated instead of relied upon. Elevation only; the panel HOLD is still governed by
   * `pinPanel`, and outside a panel there is no panel to hold.
   */
  elevate?: boolean;
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
 * when `dirty`); focus moves into the panel on open. It fades+drops in from the top on open and
 * fades+rises out to the top on close (reduced-motion → a plain fade). Sized via `size`
 * ('md'|'lg'|'xl'|'full').
 */
export function Modal({ title, onClose, onSave, saving = false, saveDisabled = false, saveLabel = 'Save', size = 'lg', pinPanel = true, elevate = false, children, headerLeft, titleExtra, titleBelow, titleControl, titleHidden = false, centerTitle = false, headerExtra, onBeforeClose }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduce = useReducedMotion();
  // Below `sm` every modal becomes a BOTTOM SHEET (see the panel's className) — the `size` key is
  // ignored there, because "how wide" has one answer on a phone.
  const isMobile = useIsMobile();
  // Local visibility drives the exit animation: a confirmed close flips this to false, the
  // panel plays its fade-out-up (rises toward the top), and AnimatePresence's onExitComplete then
  // calls the parent's onClose (which unmounts us). So callers keep the simple
  // `{open && <Modal onClose=…/>}` shape.
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
  const elevated = useContext(InSidePanel) || elevate;

  /**
   * The panel's SHAPE — a centred card on desktop, a bottom sheet on a phone.
   *
   * On mobile the `size` key is dropped entirely: `max-w-2xl` and friends answer "how wide should this
   * be on a big screen", and on a 412px phone every answer is "all of it". What survives is the height
   * question, and it has two cases:
   *
   *   · The TALL sizes exist because their content lays itself out against a fixed-height parent (the
   *     page editor's body is `flex h-full flex-col` — with an auto-height sheet its `h-full` resolves
   *     against nothing and the whole editor collapses to the height of its toolbar). Those get `h-full`.
   *   · Everything else stays CONTENT-SIZED and merely capped, so a two-line confirm is a small sheet
   *     rather than a full-screen one. `max-h-full` is 100% of the wrapper's CONTENT box — i.e. already
   *     minus the `pb-12` gutter that keeps the bottom rail tabs peeking out below the sheet.
   *
   * Square bottom corners on purpose: the sheet is anchored to the bottom edge, and rounding a corner
   * that sits against the edge of the screen just puts two slivers of backdrop where nothing can go.
   */
  // The header stacks (title row above the actions row) whenever the title is BOTH visible and
  // competing for a narrow row — see the <header> below.
  const stackHeader = isMobile && !titleHidden && !titleControl;
  const sheetShape = isMobile
    ? `max-w-none rounded-t-2xl ${size === 'full' || size === 'studio' || size === 'screen' ? 'h-full' : 'max-h-full'}`
    : `${SIZES[size]} ${size === 'screen' ? 'max-h-[calc(100dvh-4rem)]' : 'max-h-[82dvh]'} rounded-2xl`;
  // While this (panel-owned) modal lives, pin the panel open so it can't collapse behind us.
  //
  // `pinPanel={false}` opts out while KEEPING the elevation above: the two are separate concerns, and
  // a modal that can be opened by a keyboard shortcut from anywhere needs the z-index without the
  // pin — otherwise the shortcut drags the whole side panel open as a side effect.
  const panelHold = useContext(SidePanelHold);
  useEffect(() => {
    if (!elevated || !panelHold || !pinPanel) return;
    panelHold.hold();
    return () => panelHold.release();
  }, [elevated, panelHold, pinPanel]);

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
    const panel = panelRef.current;
    // Move focus INTO the dialog — but never take it back off a control that already claimed it.
    // React applies a child's `autoFocus` during commit, before this parent effect runs, so an
    // unconditional `panel.focus()` here silently undid every `autoFocus` in a modal: the project
    // selector's search box was focused and then blurred within the same tick, and typing went nowhere.
    if (!panel?.contains(document.activeElement)) panel?.focus();
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
          // Below `sm` the SIDE gutters all but disappear, because the thing they reserve room for is
          // gone: a phone mounts no side rails at all — its two surviving rails dock to the bottom
          // corners (App.tsx). 112px of horizontal chrome on a 375px screen left a modal 263px wide;
          // this gives those 96px back to the content. The BOTTOM gutter stays at full size on every
          // viewport — that is where the mobile rail tabs live and they still have to peek out.
          className={`fixed inset-0 flex justify-center overscroll-contain ${
            isMobile ? 'items-end px-0 pb-12 pt-2' : 'items-center px-2 pb-12 pt-2 sm:px-14 sm:pt-4'
          } ${elevated ? 'z-[70]' : 'z-50'}`}
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
            // A card DROPS in from above and rises back out; a bottom sheet must do the opposite, or it
            // reads as the panel falling through the bottom of the screen on the way in.
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: isMobile ? 24 : -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: isMobile ? 24 : -24 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={`relative flex w-full ${sheetShape} flex-col overflow-hidden border border-white/60 bg-white/95 shadow-2xl outline-none backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/95`}
          >
            {/* ON A NARROW HEADER THE TITLE GETS ITS OWN ROW.
                One row has to hold the title, whatever the modal pins to either side, and Save/Close.
                Below 1000px that is a fight the title loses by truncating to a few characters — and in
                the entry editor it does not even lose cleanly: the "View dataset" link under the title
                collides with the action buttons beside it. Stacking gives the name (and its link) the
                full width and leaves the controls a row of their own.

                Skipped when `titleHidden` — the page editor deliberately gives its title's width AWAY
                on mobile, so stacking would add an empty row to buy back nothing. */}
            <header className={`flex border-b border-slate-200/70 px-5 py-3 dark:border-white/10 ${
              // Centred once stacked: with the title on its own row there is no left-hand anchor left to
              // align to, and a left-aligned title over a right-aligned button row reads as two unrelated
              // strips rather than one header.
              stackHeader ? 'flex-col items-center gap-2' : 'items-center gap-3'
            }`}>
              {stackHeader && (
                <div className="flex min-w-0 flex-col items-center text-center">
                  {titleBelow ? (
                    <>
                      <h2 id={titleId} className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
                      {titleBelow}
                    </>
                  ) : (
                    <h2 id={titleId} className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
                  )}
                  {titleExtra && <div className="mt-0.5 flex items-center gap-2">{titleExtra}</div>}
                </div>
              )}
              <div className={stackHeader ? 'flex w-full items-center justify-center gap-3' : 'contents'}>
              {headerLeft}
              {!stackHeader && (
              <div className={`flex min-w-0 flex-1 items-center gap-2 ${centerTitle ? 'justify-center' : ''}`}>
                {titleHidden ? (
                  <h2 id={titleId} className="sr-only">{title}</h2>
                ) : titleControl ? (
                  <>
                    <h2 id={titleId} className="sr-only">{title}</h2>
                    {titleControl}
                  </>
                ) : titleBelow ? (
                  <div className="min-w-0">
                    <h2 id={titleId} className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
                    {titleBelow}
                  </div>
                ) : (
                  <h2 id={titleId} className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
                )}
                {titleExtra}
              </div>
              )}
              {headerExtra}
              {onSave && (
                <Tooltip tip={`${saveLabel} (${IS_MAC ? '⌘' : 'Ctrl+'}S)`} side="bottom">
                  <button
                    type="button"
                    aria-label={saveLabel}
                    disabled={saving || saveDisabled}
                    onClick={onSave}
                    // Gradient only when there IS something to save; neutral when clean. The layout
                    // classes are shared by both states so the button never changes size.
                    className={`${saveSurface(!saveDisabled)} waves-effect inline-flex cursor-pointer items-center justify-center rounded-xl p-2 transition ${saveDisabled ? '' : 'disabled:opacity-60'}`}
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
                  className="waves-effect inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-100"
                >
                  <CloseIcon />
                </button>
              </Tooltip>
              </div>
            </header>
            {/* `overscroll-contain`: dragging past the end of this list must not start scrolling the PAGE
                behind the sheet. On iOS that chaining is what makes a modal feel like it is not really
                modal — and it happens despite the `overflow: hidden` lock on <body>. */}
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

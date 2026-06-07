/* eslint-disable security/detect-object-injection -- every dynamic index in this file keys a local
   const lookup table by a typed `SidePanelSide`/`SidePanelAlign` literal; never user-controlled. */
import { createContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * True for any subtree rendered inside a {@link SidePanel}'s content. {@link Modal} reads it to
 * ELEVATE itself above the side-panel layer (so a panel's own dialogs — Assets rename, Library
 * gallery — sit on top of the panel rather than behind it). Defaults to false at the app root.
 */
export const InSidePanel = createContext(false);

/**
 * Lets a {@link Modal} opened INSIDE a panel pin it open for its lifetime. Without this, moving the
 * pointer onto the (body-portalled) dialog fires the panel's mouseleave and collapses it behind the
 * dialog — so the panel would vanish mid-operation. A {@link Modal} calls `hold` on mount + `release`
 * on unmount; the panel suppresses hover-close while the count is non-zero. Null outside any panel.
 */
export const SidePanelHold = createContext<{ hold: () => void; release: () => void } | null>(null);

export type SidePanelSide = 'left' | 'right' | 'bottom';
/** Where the collapsed tab sits along its edge (lets several tabs share one edge). */
export type SidePanelAlign = 'start' | 'center' | 'end';

interface SidePanelProps {
  /** Edge the panel is anchored to. */
  side: SidePanelSide;
  /** Tab label + the panel's accessible name. */
  label: string;
  /** Small glyph shown in the tab (decorative; `aria-hidden` it at the call site). */
  icon?: ReactNode;
  /**
   * Fixed panel size — left/right ⇒ a width class (e.g. `w-[26rem]`), bottom ⇒ a height class
   * (e.g. `h-[60vh]`). FIXED on purpose: the panel slides in/out at a constant size so nothing
   * reflows on open/close.
   */
  size?: string;
  /** Tab position along the edge (default `center`). */
  align?: SidePanelAlign;
  /** Increment from a parent to force the panel open (e.g. a top-nav button). */
  openSignal?: number;
  children: ReactNode;
}

const DEFAULT_SIZE: Record<SidePanelSide, string> = {
  left: 'w-[26rem]',
  right: 'w-[26rem]',
  bottom: 'h-[60vh]',
};

// Panel rest position, per edge. `top-16` clears the sticky header; bottom panels are centered
// horizontally (a static -translate-x-1/2) with side gutters so the edge tabs stay clear. The panel
// FADES in place (opacity+visibility) rather than sliding: it stays anchored at the edge, so the
// moment it opens it is already under the cursor — a slide would briefly leave the edge uncovered,
// the cursor would fall through the (pointer-events-none) tab to the page, and the panel would
// immediately collapse on the resulting mouseleave.
const PANEL_POS: Record<SidePanelSide, string> = {
  left: 'left-0 top-16 bottom-0 h-auto border-r',
  right: 'right-0 top-16 bottom-0 h-auto border-l',
  bottom: 'bottom-0 left-1/2 -translate-x-1/2 w-[min(72rem,92vw)] rounded-t-2xl border-x border-t',
};

// Collapsed-tab anchoring. left/right tabs are vertically centred (or start/end); bottom tabs are
// horizontally placed so three can share the bottom edge (start | center | end).
function tabPosition(side: SidePanelSide, align: SidePanelAlign): string {
  if (side === 'bottom') {
    const x = align === 'start' ? 'left-8' : align === 'end' ? 'right-8' : 'left-1/2 -translate-x-1/2';
    return `bottom-0 ${x}`;
  }
  const edge = side === 'left' ? 'left-0' : 'right-0';
  const y = align === 'start' ? 'top-24' : align === 'end' ? 'bottom-16' : 'top-1/2 -translate-y-1/2';
  return `${edge} ${y}`;
}

// Rounded outer corners point AWAY from the edge the tab grows from.
const TAB_RADIUS: Record<SidePanelSide, string> = {
  left: 'rounded-r-xl',
  right: 'rounded-l-xl',
  bottom: 'rounded-t-xl',
};

/**
 * A reusable, hover-expanding edge panel — the platform's side-rail primitive (Library, Assets, and
 * the bottom code rails all build on it). A small **blue tab** rides the chosen edge; on
 * `mouseenter` (or keyboard focus) a FIXED-SIZE, frosted panel FADES in at the edge, and fades back
 * out on `mouseleave`/blur (fade-in-place, not a slide — see the PANEL_POS note for why). The whole
 * thing sits ABOVE modals (so the tabs are always reachable), and exposes {@link InSidePanel} to its
 * children so their own dialogs elevate above it.
 */
export function SidePanel({ side, label, icon, size, align = 'center', openSignal, children }: SidePanelProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const panelSize = size ?? DEFAULT_SIZE[side];

  // Number of child dialogs currently holding the panel open (see SidePanelHold). A ref mirrors it
  // so the hover/blur handlers read the latest value without being re-created.
  const [held, setHeld] = useState(0);
  const heldRef = useRef(0);
  heldRef.current = held;
  const holdApi = useMemo(
    () => ({ hold: () => setHeld((h) => h + 1), release: () => setHeld((h) => Math.max(0, h - 1)) }),
    [],
  );
  // A held dialog forces the panel open (it opened FROM the panel).
  useEffect(() => {
    if (held > 0) setOpen(true);
  }, [held]);

  // Force-open when the parent bumps `openSignal` (e.g. the header "Assets" button). Hover/blur
  // then govern closing as usual, so it behaves like any other open afterwards.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== lastSignal.current) {
      lastSignal.current = openSignal;
      setOpen(true);
    }
  }, [openSignal]);

  return (
    // Hover/focus on EITHER the tab or the panel keeps it open; both are descendants of this
    // wrapper, so React's enter/leave fire only when the pointer crosses the whole group's boundary.
    // Hover-close is suppressed while a child dialog holds the panel open.
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => heldRef.current === 0 && setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (heldRef.current === 0 && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {/* Dim+blur scrim behind the open panel. `pointer-events-none` is CRITICAL: the scrim is a
          descendant of this hover group, so if it captured the pointer the group would never see a
          mouseleave (the full-screen scrim is always "under" the cursor) and the panel could never
          close on hover-out — and it must not block clicks on the page behind it either. */}
      {open && <div aria-hidden className="pointer-events-none fixed inset-0 z-[55] bg-slate-900/15 backdrop-blur-[2px]" />}

      {/* The collapsed TAB — always visible (even over a modal: z above the panel layer), but it
          fades out while ITS OWN panel is open so it never overlaps the panel content (the panel
          header carries the close affordance, and the other panels' tabs stay visible). */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={open ? `Close ${label}` : `Open ${label}`}
        onClick={() => setOpen((v) => !v)}
        // While open the tab is invisible (the panel's own × closes it), so drop it from the tab
        // order too — a focusable-but-invisible control would break keyboard focus order.
        tabIndex={open ? -1 : undefined}
        className={`fixed z-[61] flex items-center justify-center gap-1.5 bg-blue-600 font-bold uppercase tracking-wide text-white shadow-lg transition hover:bg-blue-500 ${TAB_RADIUS[side]} ${tabPosition(side, align)} ${
          side === 'bottom' ? 'px-4 py-2 text-sm' : 'px-2 py-4 text-sm'
        } ${open ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        {side === 'bottom' ? (
          <>
            {icon}
            <span>{label}</span>
          </>
        ) : (
          <span className={`flex items-center gap-1.5 ${side === 'left' ? 'rotate-180' : ''} [writing-mode:vertical-rl]`}>
            {icon}
            {label}
          </span>
        )}
      </button>

      {/* The FIXED-SIZE panel: fades in/out at a constant size + position (no resize ⇒ no reflow). */}
      <section
        id={regionId}
        role="region"
        aria-label={label}
        aria-hidden={!open}
        className={`fixed z-[60] flex flex-col overflow-hidden border-white/60 bg-white/90 shadow-2xl backdrop-blur-xl transition-opacity duration-200 ease-out ${PANEL_POS[side]} ${panelSize} ${
          open ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
        }`}
      >
        <header className="flex items-center gap-2 border-b border-slate-200/70 px-4 py-2.5">
          <span className="flex-1 text-xs font-bold uppercase tracking-widest text-blue-700">{label}</span>
          <button
            type="button"
            aria-label={`Close ${label}`}
            title="Close"
            onClick={() => setOpen(false)}
            className="rounded-lg px-2 py-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <InSidePanel.Provider value={true}>
            <SidePanelHold.Provider value={holdApi}>{children}</SidePanelHold.Provider>
          </InSidePanel.Provider>
        </div>
      </section>
    </div>
  );
}

/* eslint-disable security/detect-object-injection -- every dynamic index in this file keys a local
   const lookup table by a typed `SidePanelSide`/`SidePanelAlign` literal; never user-controlled. */
import { createContext, useEffect, useId, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * True for any subtree rendered inside a {@link SidePanel}'s content. {@link Modal} reads it to
 * ELEVATE itself above the side-panel layer (so a panel's own dialogs — Assets rename, Library
 * gallery — sit on top of the panel rather than behind it). Defaults to false at the app root.
 */
export const InSidePanel = createContext(false);

/**
 * Lets a {@link Modal} opened INSIDE a panel claim Esc/close ownership for its lifetime. While the
 * count is non-zero the panel does NOT close on Escape (the topmost dialog handles Esc first) and
 * is force-held open. A {@link Modal} calls `hold` on mount + `release` on unmount. Null outside any
 * panel. (Drag interactions also hold it as a belt-and-braces guard, though the click-open drawer no
 * longer collapses on pointer movement.)
 */
export const SidePanelHold = createContext<{ hold: () => void; release: () => void } | null>(null);

export type SidePanelSide = 'left' | 'right' | 'bottom';
/** Where the collapsed tab sits along its edge (lets several tabs share one edge). `center-left`/
 *  `center-right` are a CLUSTER either side of dead-centre (bottom edge only) — e.g. the paired
 *  Snippets + Widgets rails; they share the centered panel anchor. */
export type SidePanelAlign = 'start' | 'center' | 'center-left' | 'center-right' | 'end';

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
  /** For a BOTTOM panel: an explicit width class (default `w-[min(42rem,48vw)]` start/end). */
  width?: string;
  /** Tab position along the edge (default `center`). */
  align?: SidePanelAlign;
  /** Render a SMALLER collapsed tab (less padding + smaller text) — for secondary rails. */
  compact?: boolean;
  /** Increment from a parent to force the panel open (e.g. a main-nav button). */
  openSignal?: number;
  /**
   * When set, dragging OS files over the collapsed tab opens the panel, so the drop can land on
   * the content inside it — the panel's own drop zone is `pointer-events-none` while collapsed,
   * which otherwise blocks drag-and-drop upload entirely. Used by the File Manager.
   */
  openOnFileDrag?: boolean;
  children: ReactNode;
}

const DEFAULT_SIZE: Record<SidePanelSide, string> = {
  left: 'w-[26rem]',
  right: 'w-[26rem]',
  bottom: 'h-[60vh]',
};

// Panel REST position (open). Left/right span the full screen height (top-0, over the header); a
// bottom panel docks to the bottom edge at its `align` anchor. The slide transform (SLIDE) animates
// the panel between this rest position and an off-edge start position; it composes with the
// bottom-centre `-translate-x-1/2` here (different axis, so both apply).
function panelPos(side: SidePanelSide, align: SidePanelAlign, width?: string): string {
  if (side === 'left') return 'left-0 top-0 bottom-0 h-auto border-r';
  if (side === 'right') return 'right-0 top-0 bottom-0 h-auto border-l';
  const w = width ?? 'w-[min(42rem,48vw)]';
  if (align === 'start') return `bottom-0 left-0 ${w} rounded-tr-2xl border-r border-t`;
  if (align === 'end') return `bottom-0 right-0 ${w} rounded-tl-2xl border-l border-t`;
  // center + the center-left/center-right cluster share the wide CENTERED panel anchor.
  return `bottom-0 left-1/2 -translate-x-1/2 ${width ?? 'w-[min(72rem,92vw)]'} rounded-t-2xl border-x border-t`;
}

// Open ⇄ closed slide. Closed = parked just off its edge; open = at rest. Only touches the slide
// axis, so it composes with panelPos's `-translate-x-1/2` centring (the perpendicular axis).
const SLIDE: Record<SidePanelSide, { open: string; closed: string }> = {
  left: { open: 'translate-x-0', closed: '-translate-x-full' },
  right: { open: 'translate-x-0', closed: 'translate-x-full' },
  bottom: { open: 'translate-y-0', closed: 'translate-y-full' },
};

// Collapsed-tab anchoring. left/right tabs are vertically centred (or start/end); bottom tabs are
// horizontally placed so several can share the bottom edge (start | center-left | center-right | end).
function tabPosition(side: SidePanelSide, align: SidePanelAlign): string {
  if (side === 'bottom') {
    const x =
      align === 'start' ? 'left-8'
      : align === 'end' ? 'right-8'
      // Cluster either side of dead-centre (tab CENTRE lands 4.75rem from viewport centre): the
      // translate is `50% of own width` ± the offset, so the pair sits adjacent with a small gap.
      : align === 'center-left' ? 'left-1/2 -translate-x-[calc(50%+4.75rem)]'
      : align === 'center-right' ? 'left-1/2 translate-x-[calc(4.75rem-50%)]'
      : 'left-1/2 -translate-x-1/2';
    // Flush to the viewport bottom (no gap), per the docked-rails design.
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

// Hover affordance: the tab reaches a little further toward the screen interior (the outward-facing
// face) on hover, a quiet "I'm a clickable handle" cue. Animated by the tab's `transition-all`.
const TAB_HOVER_PAD: Record<SidePanelSide, string> = {
  left: 'hover:pr-3.5',
  right: 'hover:pl-3.5',
  bottom: 'hover:pt-3',
};

/**
 * A reusable click-to-open edge drawer — the platform's side-rail primitive (Library, Assets, and
 * the bottom code rails all build on it). A small **brand tab** rides the chosen edge; CLICKING it
 * slides a fixed-size, frosted panel in from that edge over a dimmed backdrop. The panel STAYS open
 * until dismissed — click the backdrop, press Escape, or hit the header ×. Only one drawer is open
 * at a time (an open drawer's backdrop covers the other tabs). The whole thing sits ABOVE modals (so
 * the tabs are always reachable when nothing's open) and exposes {@link InSidePanel} to its children
 * so their own dialogs elevate above it.
 */
export function SidePanel({ side, label, icon, size, width, align = 'center', compact, openSignal, openOnFileDrag, children }: SidePanelProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const panelSize = size ?? DEFAULT_SIZE[side];
  // A bottom panel is flush to its corner (so its near-edge content can sit under the centered
  // Library/Assets EDGE tabs). Inset that side so they don't clip.
  const edgeInset = side === 'bottom' ? (align === 'start' ? 'pl-10' : align === 'end' ? 'pr-10' : '') : '';

  // Number of child dialogs currently holding the panel (see SidePanelHold). A ref mirrors it so the
  // Escape handler reads the latest value without re-subscribing.
  const [held, setHeld] = useState(0);
  const heldRef = useRef(0);
  heldRef.current = held;
  const holdApi = useMemo(
    () => ({ hold: () => setHeld((h) => h + 1), release: () => setHeld((h) => Math.max(0, h - 1)) }),
    [],
  );
  // A held dialog forces the panel open (it opened FROM the panel, so the panel must back it).
  useEffect(() => {
    if (held > 0) setOpen(true);
  }, [held]);

  // Force-open when the parent bumps `openSignal` (e.g. the header "Assets" button).
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== lastSignal.current) {
      lastSignal.current = openSignal;
      setOpen(true);
    }
  }, [openSignal]);

  // Escape closes the drawer — unless a child dialog is held open (it owns Esc and closes first).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && heldRef.current === 0) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // With `openOnFileDrag`, dragging OS files over the collapsed tab opens the panel so the drop can
  // reach the content inside. Only OS file drags carry a 'Files' type; internal element drags are
  // ignored. `preventDefault` + copy effect so (a) the cursor reads as a valid drop and (b) a file
  // dropped ON THE TAB during the open transition is swallowed rather than opened by the browser
  // (which would navigate away — there is no global drop guard).
  const onTabFileDrag = (e: ReactDragEvent) => {
    if (!openOnFileDrag || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOpen(true);
  };
  // Same browser-navigation guard for the OPEN panel: a file dropped on the panel chrome that misses
  // the inner drop zone would otherwise navigate the browser. The file browser handles real uploads.
  const onPanelFileDrag = (e: ReactDragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  return (
    <>
      {/* Dim+blur backdrop behind the open drawer. CLICK ANYWHERE on it to close (z-60: above the
          other tabs at z-55, below this drawer at z-61, so it both dismisses and enforces
          one-drawer-at-a-time). Always mounted so it can FADE out on close. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[60] bg-slate-900/30 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* The collapsed TAB. A `fixed` positioning wrapper (z-55, reachable over a base modal at z-50,
          below the backdrop+panel) holds an inner waves-effect button — the button can't be the
          fixed node because `.waves-effect` forces `position:relative`. The wrapper fades out while
          the drawer is open (the panel's own × / backdrop / Esc close it). */}
      <div
        className={`fixed z-[55] transition-opacity duration-200 ${tabPosition(side, align)} ${
          open ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          aria-label={`Open ${label}`}
          onClick={() => setOpen(true)}
          onDragEnter={onTabFileDrag}
          onDragOver={onTabFileDrag}
          onDrop={onTabFileDrag}
          // Invisible-but-present while open would break keyboard focus order, so drop it from the
          // tab order too.
          tabIndex={open ? -1 : undefined}
          className={`waves-effect waves-light sw-brand-gradient sw-brand-shadow-lg sw-brand-shadow-lg-hover flex items-center justify-center gap-1.5 font-bold uppercase tracking-wide text-white transition-all duration-200 ${TAB_RADIUS[side]} ${TAB_HOVER_PAD[side]} ${
            side === 'bottom'
              ? compact ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'
              : compact ? 'gap-1 px-1.5 py-2.5 text-[11px]' : 'px-2 py-4 text-sm'
          }`}
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
      </div>

      {/* The FIXED-SIZE panel: SLIDES in from its edge + fades, at a constant size (no reflow). When
          closed it's parked off-edge and made `inert` so its off-screen controls leave the tab order. */}
      <section
        id={regionId}
        role="region"
        aria-label={label}
        aria-hidden={!open}
        {...(!open ? ({ inert: '' } as object) : {})}
        onDragOver={openOnFileDrag ? onPanelFileDrag : undefined}
        onDrop={openOnFileDrag ? onPanelFileDrag : undefined}
        className={`fixed z-[61] flex flex-col overflow-hidden border-white/60 bg-white/90 shadow-2xl backdrop-blur-xl transition-[translate,opacity] duration-300 ease-out motion-reduce:transition-none ${panelPos(side, align, width)} ${panelSize} ${
          open ? `${SLIDE[side].open} opacity-100` : `${SLIDE[side].closed} opacity-0 pointer-events-none`
        }`}
      >
        <header className={`flex items-center gap-2 border-b border-slate-200/70 px-4 py-2.5 ${edgeInset}`}>
          <span className="flex-1 text-xs font-bold uppercase tracking-widest text-indigo-700">{label}</span>
          <button
            type="button"
            aria-label={`Close ${label}`}
            title="Close"
            onClick={() => setOpen(false)}
            className="waves-effect rounded-lg px-2 py-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className={`min-h-0 flex-1 overflow-auto ${edgeInset}`}>
          <InSidePanel.Provider value={true}>
            <SidePanelHold.Provider value={holdApi}>{children}</SidePanelHold.Provider>
          </InSidePanel.Provider>
        </div>
      </section>
    </>
  );
}

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'bottom' | 'left' | 'right';

// Literal class strings so DaisyUI/Tailwind's content scan emits each placement variant. The classes
// are kept even though the bubble is a PORTAL now: they carry the host's layout (`.tooltip` is
// `display:inline-block`) and every existing layout is tuned against them.
const SIDE_CLASS: Record<Side, string> = {
  top: 'tooltip-top',
  bottom: 'tooltip-bottom',
  left: 'tooltip-left',
  right: 'tooltip-right',
};

/** Gap between the trigger and the bubble, and the margin kept from every viewport edge. */
const GAP = 8;
const EDGE = 8;

interface Placed {
  left: number;
  top: number;
  /** The transform that anchors the bubble's own box to that point. */
  transform: string;
}

/**
 * Where the bubble goes for `side`, flipping to the opposite side when there is no room, and clamped
 * so it never leaves the viewport.
 *
 * ★ Measured from the trigger at SHOW time, not tracked. The bubble hides again on any scroll or
 * resize (see the effect below), so a one-shot rect cannot go stale while it is visible.
 */
function place(r: DOMRect, side: Side, vw: number, vh: number): Placed {
  const clampX = (x: number): number => Math.min(Math.max(x, EDGE), vw - EDGE);
  const clampY = (y: number): number => Math.min(Math.max(y, EDGE), vh - EDGE);
  // Flip when the preferred side has no room for a bubble of a plausible size.
  const flipped: Side =
    side === 'top' && r.top < 64 ? 'bottom'
    : side === 'bottom' && vh - r.bottom < 64 ? 'top'
    : side === 'left' && r.left < 160 ? 'right'
    : side === 'right' && vw - r.right < 160 ? 'left'
    : side;
  switch (flipped) {
    case 'top':
      return { left: clampX(r.left + r.width / 2), top: clampY(r.top - GAP), transform: 'translate(-50%, -100%)' };
    case 'bottom':
      return { left: clampX(r.left + r.width / 2), top: clampY(r.bottom + GAP), transform: 'translate(-50%, 0)' };
    case 'left':
      return { left: clampX(r.left - GAP), top: clampY(r.top + r.height / 2), transform: 'translate(-100%, -50%)' };
    default:
      return { left: clampX(r.right + GAP), top: clampY(r.top + r.height / 2), transform: 'translate(0, -50%)' };
  }
}

/**
 * A hover/focus tooltip. Wrap an interactive element (usually an icon button) so its help text appears
 * as a styled bubble instead of the browser's native `title`. Keep `aria-label` on the wrapped control
 * for the accessible name — the tip is the visual layer only.
 *
 * ★★ THE BUBBLE RENDERS IN A `document.body` PORTAL, not as DaisyUI's `:before` pseudo-element, so it
 * cannot be clipped by an ancestor's `overflow`. Every editor panel is a scroll container, so the CSS
 * bubble was cut off at the panel edge exactly where the hint was most needed.
 *
 * ★ A `position:fixed` pseudo-element would NOT have been enough, and this is worth recording because
 * it looks like it should be: `backdrop-filter` establishes a containing block for fixed descendants,
 * so inside a glass panel a fixed bubble is still trapped. Measured in a real browser — a fixed child
 * of a plain `overflow:auto` panel lands at the viewport origin, the same child inside a
 * `backdrop-filter` panel lands at the panel's origin. Every editor surface is a glass panel, so only
 * leaving the subtree works.
 *
 * ★ `data-tip` STAYS on the host even though nothing renders from it now: it is how the test helpers
 * (`tipOf` / `byTip`) find a tooltipped control, and dropping it would be pure churn across the suite.
 * `data-sw-tip="portal"` marks the hosts whose CSS bubble is suppressed in `styles.css`, so the two
 * raw `data-tip` users that are NOT this component (the Image Map handles, which cannot take a
 * wrapper, and the rich-text field) keep the CSS bubble they still rely on.
 */
export function Tooltip({
  tip,
  side = 'bottom',
  className = '',
  children,
}: {
  /** Absent/empty renders the child bare — a conditional hint must not leave an empty bubble. */
  tip?: string | undefined;
  side?: Side;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const [placed, setPlaced] = useState<Placed | null>(null);

  const hide = useCallback(() => setPlaced(null), []);
  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setPlaced(place(el.getBoundingClientRect(), side, window.innerWidth, window.innerHeight));
  }, [side]);

  // The rect is a snapshot, so any scroll or resize while the bubble is open would strand it. Hide
  // instead; the next hover re-measures. CAPTURE phase, because a scroll inside the panel's own
  // container does not bubble to the window — the same reason the row virtualiser listens that way.
  useEffect(() => {
    if (!placed) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [placed, hide]);

  if (!tip) return <>{children}</>;
  return (
    <span
      ref={ref}
      // eslint-disable-next-line security/detect-object-injection -- side is a typed Side literal
      className={`tooltip ${SIDE_CLASS[side]} inline-flex ${className}`}
      data-tip={tip}
      data-sw-tip="portal"
      aria-describedby={placed ? tipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {placed &&
        createPortal(
          <span
            id={tipId}
            role="tooltip"
            style={{ position: 'fixed', left: placed.left, top: placed.top, transform: placed.transform }}
            className="pointer-events-none z-[100] max-w-xs whitespace-normal rounded-lg bg-slate-900/95 px-2.5 py-1.5 text-center text-xs font-medium leading-snug text-white shadow-xl dark:bg-slate-700/95"
          >
            {tip}
          </span>,
          document.body,
        )}
    </span>
  );
}

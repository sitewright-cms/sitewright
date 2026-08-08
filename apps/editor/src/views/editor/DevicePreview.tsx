import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The page editor's responsive simulation targets, aligned to the DEFAULT
 * Tailwind breakpoints (sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536):
 * mobile previews BELOW `sm` (mobile-first base styles, a real phone width);
 * tablet/laptop sit exactly ON `md`/`lg`; large desktop is FLUID — the modal's
 * full width (`width: null`), i.e. whatever a desktop monitor really gives you.
 */
export const PREVIEW_DEVICES = [
  { key: 'desktop', label: 'Large desktop', width: null }, // fluid — the modal's full width
  { key: 'laptop', label: 'Laptop', width: 1024 }, // lg
  { key: 'tablet', label: 'Tablet', width: 768 }, // md
  { key: 'mobile', label: 'Mobile', width: 390 }, // below sm → base styles
] as const;

export type PreviewDeviceKey = (typeof PREVIEW_DEVICES)[number]['key'];

/** How long a device switch glides, in step with the `duration-300` utility applied while it plays. */
const TRANSITION_MS = 300;

/** The device rail's glyph per target — shared, so the page and slot editors show one icon set. */
export const DEVICE_ICONS: Record<PreviewDeviceKey, ReactNode> = {
  desktop: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  ),
  laptop: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v11H4Z" />
      <path d="M2 19h20" />
    </svg>
  ),
  tablet: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  ),
  mobile: (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  ),
};

interface DevicePreviewProps {
  /** The simulated viewport width in CSS px; `null` = fluid (fill the available box). */
  width: number | null;
  children: ReactNode;
}

/**
 * Browser responsive-design-mode semantics: the child (the preview iframe) lays
 * out at EXACTLY `width` CSS px — so the page's Tailwind breakpoints respond as
 * on a real device — and the whole thing is scaled DOWN (never up) to fit the
 * available box when the simulated viewport is wider than the editor.
 */
export function DevicePreview({ width, children }: DevicePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<number | null>(null);
  const fluid = width === null;

  // Keyed on `fluid`: the measured host div only exists in the fixed-width branch,
  // so the observer must (re)attach when switching from fluid to a fixed device.
  useLayoutEffect(() => {
    if (fluid) return;
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setAvail(host.clientWidth);
    measure();
    /* v8 ignore next -- jsdom has no ResizeObserver; the first measure still runs */
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [fluid]);

  // `avail` of null (pre-measure) or 0 (hidden / jsdom) → no scaling: never
  // scale(0) or divide by zero.
  const scale = !fluid && avail !== null && avail > 0 && avail < width ? avail / width : 1;

  // Glide between simulated widths instead of snapping — but ONLY for a device CHANGE. `width` and
  // `scale` also move when the editor pane itself is resized (the ResizeObserver above), and animating
  // that would make the preview lag a pointer drag by the duration of the transition. So the
  // transition is armed by a change of the `width` PROP and disarmed once it has played.
  //
  // ★ This MUST be a LAYOUT effect. A passive `useEffect` is flushed AFTER the browser has painted,
  // so the new width reached the screen while the element still carried no `transition-property` —
  // the browser had nothing to interpolate and the switch snapped, every single time. A layout effect
  // runs before paint, so the width change and the transition arrive in the SAME style-change event,
  // which is what actually starts a transition. Measured in a real browser, 1024px → 768px sampled at
  // 120ms: passive → 768.0px (already at the destination, no tween); layout → 899.1px (mid-flight).
  //
  // A jsdom test CANNOT tell these apart — Testing Library's `act()` flushes passive effects
  // synchronously, so the class is observable either way. The proof lives in the E2E device-rail spec,
  // which samples the width mid-flight in a real browser.
  const [animating, setAnimating] = useState(false);
  useLayoutEffect(() => {
    setAnimating(true);
    const t = setTimeout(() => setAnimating(false), TRANSITION_MS + 40);
    return () => clearTimeout(t);
  }, [width]);

  // ONE element tree for every device, fluid included — the branches differ only in STYLE.
  //
  // This used to render two shapes: fluid returned a single div wrapping `children`, fixed-width
  // returned a host div with the scaled box NESTED inside it. React reconciles by position, so
  // switching between them moved the preview <iframe> between tree depths → unmount + REMOUNT →
  // the iframe re-fetched `/preview/<slug>/<token>`. Preview tokens expire, so a switch made after
  // the token lapsed refetched a dead one and the pane stuck on the route's "Preview expired" 404
  // until a manual reload. Keeping the depth constant keeps the same iframe element (and its loaded
  // document) alive across every device switch, so nothing is refetched at all.
  return (
    <div ref={hostRef} className={fluid ? 'h-full w-full' : 'relative h-full overflow-hidden'}>
      <div
        data-testid="device-viewport"
        className={
          // Both branches carry the transition while a switch plays, so the glide is symmetric: the
          // way OUT to fluid is a device change like any other, and leaving it unarmed made "back to
          // Large desktop" the one switch that still snapped. Measured: 1024px → 1400px reaches
          // 1207px at 120ms, i.e. it tweens even though the box also drops from absolute to static
          // positioning (`position` is not interpolable, but `width` still is).
          //
          // Standard utilities only: an arbitrary-value `transition-[width,transform]` carries a
          // comma the class extractor can choke on, and an INLINE transition could not be waived for
          // prefers-reduced-motion (inline styles outrank any class).
          fluid
            ? `h-full w-full${animating ? ' transition-all duration-300 ease-out motion-reduce:transition-none' : ''}`
            : `absolute left-1/2 top-0${animating ? ' transition-all duration-300 ease-out motion-reduce:transition-none' : ''}`
        }
        style={
          fluid
            ? undefined
            : {
                width: `${width}px`,
                // The scaled-down box must still FILL the row visually: pre-scale height
                // by 1/scale so height × scale = 100%.
                height: `${100 / scale}%`,
                // Subtle but correct: with `left: 50%`, translateX(-50%) centers the
                // unscaled box, and scaling about `top center` shrinks it symmetrically —
                // so it STAYS centered at every scale. Don't reorder the functions.
                transform: `translateX(-50%) scale(${scale})`,
                transformOrigin: 'top center',
              }
        }
      >
        {children}
      </div>
    </div>
  );
}

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
        className={fluid ? 'h-full w-full' : 'absolute left-1/2 top-0'}
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

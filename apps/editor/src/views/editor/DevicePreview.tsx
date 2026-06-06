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

  // Fluid (large desktop): no simulation — the preview simply fills the box.
  // Hooks above run unconditionally; only the render branches.
  if (width === null) {
    return (
      <div data-testid="device-viewport" className="h-full w-full">
        {children}
      </div>
    );
  }

  // `avail` of null (pre-measure) or 0 (hidden / jsdom) → no scaling: never
  // scale(0) or divide by zero.
  const scale = avail !== null && avail > 0 && avail < width ? avail / width : 1;
  return (
    <div ref={hostRef} className="relative h-full overflow-hidden">
      <div
        data-testid="device-viewport"
        className="absolute left-1/2 top-0"
        style={{
          width: `${width}px`,
          // The scaled-down box must still FILL the row visually: pre-scale height
          // by 1/scale so height × scale = 100%.
          height: `${100 / scale}%`,
          // Subtle but correct: with `left: 50%`, translateX(-50%) centers the
          // unscaled box, and scaling about `top center` shrinks it symmetrically —
          // so it STAYS centered at every scale. Don't reorder the functions.
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'top center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

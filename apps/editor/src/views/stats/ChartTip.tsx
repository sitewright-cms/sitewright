import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { place, TooltipBubble, type Placed } from '../ui/Tooltip';

/**
 * The editor's tooltip for a CHART: an SVG bar or a map country cannot be wrapped in {@link Tooltip}, so
 * the chart shows the same bubble itself, on hover. `lines` read one fact per row, the first in bold.
 *
 * ★ Replaces an SVG `<title>` — the browser's native tooltip, which is plain, slow to appear and puts the
 * whole description on one line. Remove the `<title>` wherever this is used, or both tooltips show.
 * The chart's own `aria-label` summary is what a screen reader gets; these bubbles are visual only.
 */
export function useChartTip(): {
  /** Above `el` (a day's bar), flipping below when there is no room. */
  showAt: (el: Element, lines: readonly string[]) => void;
  /** Just above the pointer, for a shape whose box is no guide to where it was hovered (a country). */
  showAtPointer: (x: number, y: number, lines: readonly string[]) => void;
  hide: () => void;
  bubble: ReactNode;
} {
  const [tip, setTip] = useState<{ lines: readonly string[]; placed: Placed } | null>(null);
  const showAt = useCallback((el: Element, lines: readonly string[]) => {
    setTip({ lines, placed: place(el.getBoundingClientRect(), 'top', window.innerWidth, window.innerHeight) });
  }, []);
  const showAtPointer = useCallback((x: number, y: number, lines: readonly string[]) => {
    // A zero-size box just above the pointer (a plain object: `place` reads only these sides).
    const at = { left: x, right: x, top: y - 6, bottom: y - 6, width: 0, height: 0 } as DOMRect;
    setTip({ lines, placed: place(at, 'top', window.innerWidth, window.innerHeight) });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  // A placed bubble is a snapshot of where the shape was, so a scroll or resize would strand it: hide, as
  // the editor's Tooltip does (capture phase — a panel's own scroll does not bubble to the window).
  useEffect(() => {
    if (!tip) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [tip, hide]);

  const bubble = tip ? (
    <TooltipBubble placed={tip.placed}>
      {tip.lines.map((line, i) => (
        <span key={i} className={`block whitespace-nowrap ${i === 0 ? 'font-bold' : 'font-normal'}`}>
          {line}
        </span>
      ))}
    </TooltipBubble>
  ) : null;
  return { showAt, showAtPointer, hide, bubble };
}

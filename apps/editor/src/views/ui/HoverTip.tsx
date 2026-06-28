import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A hover/focus tooltip whose bubble renders in a `document.body` PORTAL, so it never clips against
 * an `overflow:hidden`/`overflow:auto` ancestor — which a CSS `data-tip` tooltip ({@link Tooltip})
 * does. Use it inside scrolling side-panels (e.g. the Snippets rail). The bubble is centred above the
 * trigger, flips below when there's no room above, and its centre is clamped into the viewport so a
 * long bubble on an edge chip stays on-screen. Decorative only — keep the real label on the children.
 */
export function HoverTip({ tip, children, className = '' }: { tip: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 64; // not enough headroom above → flip below the trigger
    const cx = Math.min(Math.max(r.left + r.width / 2, 168), window.innerWidth - 168);
    setBox({ left: cx, top: below ? r.bottom : r.top, below });
  };
  const hide = () => setBox(null);
  return (
    <span ref={ref} className={className} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {box &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              left: box.left,
              top: box.top,
              transform: `translate(-50%, ${box.below ? '8px' : 'calc(-100% - 8px)'})`,
            }}
            className="pointer-events-none z-[100] max-w-xs whitespace-normal rounded-lg bg-slate-900/95 px-2.5 py-1.5 text-center text-xs font-medium leading-snug text-white shadow-xl"
          >
            {tip}
          </span>,
          document.body,
        )}
    </span>
  );
}

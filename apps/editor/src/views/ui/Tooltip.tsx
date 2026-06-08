import type { ReactNode } from 'react';

type Side = 'top' | 'bottom' | 'left' | 'right';

// Literal class strings so DaisyUI/Tailwind's content scan emits each placement variant.
const SIDE_CLASS: Record<Side, string> = {
  top: 'tooltip-top',
  bottom: 'tooltip-bottom',
  left: 'tooltip-left',
  right: 'tooltip-right',
};

/**
 * A DaisyUI tooltip wrapper. Wrap an interactive element (usually an icon button) so its help text
 * appears on hover/focus as a styled bubble instead of the browser's native `title`. Renders an
 * inline-flex `<span>` host (DaisyUI's `.tooltip` is `display:inline-block`) so it doesn't disturb
 * flex rows. Keep `aria-label` on the wrapped control for the accessible name — `data-tip` is the
 * visual layer only.
 */
export function Tooltip({
  tip,
  side = 'bottom',
  className = '',
  children,
}: {
  tip: string;
  side?: Side;
  className?: string;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line security/detect-object-injection -- side is a typed Side literal
    <span className={`tooltip ${SIDE_CLASS[side]} inline-flex ${className}`} data-tip={tip}>
      {children}
    </span>
  );
}

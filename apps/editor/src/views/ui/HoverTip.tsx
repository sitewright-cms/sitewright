import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

/**
 * A hover/focus tooltip that cannot be clipped by an `overflow` ancestor.
 *
 * ★ Now a thin alias for {@link Tooltip}, which renders its bubble in a `document.body` portal for
 * every call site rather than only here. This component existed because the CSS `data-tip` bubble was
 * clipped inside scrolling side-panels; that is no longer true of `Tooltip`, so keeping a second
 * positioning implementation would only let the two drift.
 */
export function HoverTip({ tip, children, className = '' }: { tip: string; children: ReactNode; className?: string }) {
  return (
    <Tooltip tip={tip} side="top" className={className}>
      {children}
    </Tooltip>
  );
}

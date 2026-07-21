import { CircleHelp } from 'lucide-react';
import { Tooltip } from './Tooltip';

type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * A small "?" help affordance next to a section heading: it reveals `tip` in a DaisyUI tooltip on
 * hover/focus, replacing the inline description paragraph that used to sit under the heading. The
 * `tip` text is also the trigger's `aria-label`, so screen-reader users get the help text directly.
 * `type="button"` is required — these live inside settings `<form>`s and must not submit.
 */
export function SectionHelp({ tip, side = 'bottom' }: { tip: string; side?: Side }) {
  return (
    <Tooltip tip={tip} side={side} className="align-middle">
      <button
        type="button"
        aria-label={tip}
        className="inline-flex cursor-help text-slate-400 outline-none transition hover:text-slate-600 focus-visible:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 dark:focus-visible:text-slate-300"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

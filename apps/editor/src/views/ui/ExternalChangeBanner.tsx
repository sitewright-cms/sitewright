import { RefreshCw, X } from 'lucide-react';
import type { ContentChange } from '../../lib/use-project-events';

/**
 * "This changed while you were editing" — shown by a view when {@link useExternalEdit} reports a
 * pending change AND the operator has unsaved edits.
 *
 * Deliberately non-destructive: it never replaces the buffer on its own. Auto-refreshing over unsaved
 * work would just move the data loss from the agent's side to the operator's. Both outcomes stay
 * reachable, and "Keep mine" is safe because the `If-Match` guard refuses a save that would clobber —
 * the operator gets a conflict they can act on rather than a silent overwrite.
 */
export function ExternalChangeBanner({
  change,
  label,
  onReload,
  onDismiss,
}: {
  change: ContentChange;
  /** What changed, in the view's own words — e.g. "This page", "Website settings". */
  label: string;
  onReload: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const who = change.actor === 'agent' ? 'an agent' : 'someone else';
  const what = change.op === 'delete' ? 'deleted' : 'changed';
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-amber-300/70 dark:border-amber-500/25 bg-amber-100/80 dark:bg-amber-500/15 px-4 py-2 text-sm text-amber-950 dark:text-amber-100"
    >
      <span>
        {label} was {what} by {who} while you were editing. Your unsaved changes are still here — saving
        them as-is would be refused rather than overwrite that work.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Load their version
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title="Keep editing your version"
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/60 px-2.5 py-1 text-xs font-semibold transition hover:bg-amber-200/60 dark:hover:bg-amber-500/20"
        >
          <X className="h-3.5 w-3.5" /> Keep mine
        </button>
      </div>
    </div>
  );
}

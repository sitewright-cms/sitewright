import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react';

/**
 * The grab handle for a sortable row: a drag grip plus ↑/↓ buttons.
 *
 * The buttons are the accessible path — HTML5 drag-and-drop cannot be driven from the keyboard, so without
 * them the list is mouse-only. They are labelled with what the row IS ("Move WhatsApp channel up"), not
 * "Move up", because a screen-reader user tabbing a list of eight buttons needs to know which row each one
 * belongs to.
 */
export function ReorderHandle({
  label,
  onUp,
  onDown,
  canUp,
  canDown,
}: {
  /** What this row is, for the button labels — e.g. `field 2 in channel 1`. */
  label: string;
  onUp: () => void;
  onDown: () => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const btn =
    'rounded p-0.5 text-slate-500 dark:text-slate-400 transition hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:pointer-events-none disabled:opacity-25';
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span aria-hidden className="cursor-grab select-none text-slate-500 dark:text-slate-400" title="Drag to reorder">
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="flex flex-col">
        <button type="button" className={btn} aria-label={`Move ${label} up`} disabled={!canUp} onClick={onUp}>
          <ChevronUp className="h-3 w-3" />
        </button>
        <button type="button" className={btn} aria-label={`Move ${label} down`} disabled={!canDown} onClick={onDown}>
          <ChevronDown className="h-3 w-3" />
        </button>
      </span>
    </span>
  );
}

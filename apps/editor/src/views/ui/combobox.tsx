import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { glassInput } from '../../theme';

/**
 * The parts every searchable picker shares — `SearchableSelect` (a list it holds) and the rank tracker's place
 * picker (a list the server answers): the field that shows the choice, the list's place on screen, the keys, the
 * popover and its rows. One copy, so the pickers cannot drift apart. What is searched, and how, stays each picker's
 * own.
 */

/** A list narrower than this is widened (and kept on screen): a narrow field must not make its options unreadable. */
const MIN_LIST_WIDTH = 256;
/** With less room than this under the field, the list opens above it when there is more room there. */
const ROOM_BELOW = 260;
/** The gap kept between the list and the window's edges. */
const EDGE = 8;

export interface ListPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

/** Under the field, or above it when there is more room there; at least MIN_LIST_WIDTH wide; never past the window. */
export function placeList(field: HTMLElement): ListPlacement {
  const r = field.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const above = r.top;
  const useAbove = below < ROOM_BELOW && above > below;
  const width = Math.min(Math.max(r.width, MIN_LIST_WIDTH), window.innerWidth - 2 * EDGE);
  return {
    left: Math.max(EDGE, Math.min(r.left, window.innerWidth - width - EDGE)),
    top: useAbove ? r.top : r.bottom,
    width,
    maxHeight: Math.max(160, Math.min(320, (useAbove ? above : below) - 12)),
    above: useAbove,
  };
}

/**
 * The list's place on screen while it is open, following the field as the editor scrolls or the window changes size;
 * a press anywhere but the field and the list closes it. `close` also puts focus back on the field: the list's search
 * box is about to unmount, and focus would otherwise fall to the page. `setOpen` is a state setter, so the effects need
 * not re-run for it.
 */
export function useAnchoredList(open: boolean, setOpen: (open: boolean) => void) {
  const [pos, setPos] = useState<ListPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (triggerRef.current) setPos(placeList(triggerRef.current));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return { triggerRef, popRef, pos, close };
}

/**
 * The keyboard-highlighted row: kept within a list that narrows, and scrolled into view as it moves.
 * (`scrollIntoView` is missing in jsdom, hence the guard.)
 */
export function useActiveRow(count: number, open: boolean) {
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, count - 1)));
  }, [count]);
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);
  return { active, setActive, activeRef };
}

/**
 * The keys of a picker, for its field and its list alike (the search box has focus while the list is open, so its keys
 * bubble up to the list): ↑/↓ open the list or move the highlight, Enter picks the highlighted row, Escape closes
 * without the enclosing modal closing too, and Tab closes and lets focus move on from the field (no preventDefault).
 * `pick` says whether there was a row to pick.
 */
export function listKeys(o: {
  open: boolean;
  count: number;
  openList: () => void;
  close: () => void;
  setActive: (next: (a: number) => number) => void;
  pick: () => boolean;
}) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!o.open) return;
      e.preventDefault();
      e.stopPropagation();
      o.close();
    } else if (e.key === 'Tab') {
      if (o.open) o.close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!o.open) return o.openList();
      const down = e.key === 'ArrowDown';
      o.setActive((a) => (down ? Math.min(a + 1, o.count - 1) : Math.max(a - 1, 0)));
    } else if (e.key === 'Enter' && o.open && o.pick()) {
      e.preventDefault();
    }
  };
}

/** The field that shows the choice and opens the list (`role="combobox"`, so the value is always in view). */
export function ListTrigger({
  ref,
  ariaLabel,
  open,
  listId,
  disabled,
  chosen,
  detail,
  className,
  onClick,
  onKeyDown,
  children,
}: {
  ref: Ref<HTMLButtonElement>;
  ariaLabel: string;
  open: boolean;
  listId: string;
  disabled: boolean;
  /** Whether `children` is a choice (darker) or a placeholder (muted). */
  chosen: boolean;
  /** Shown muted before the chevron, e.g. the kind of place. */
  detail?: ReactNode;
  className?: string;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="combobox"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`${glassInput} flex items-center justify-between gap-2 text-left font-normal disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ''}`}
    >
      <span className={`min-w-0 truncate ${chosen ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{children}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        {detail}
        <ChevronDown aria-hidden className="h-4 w-4" />
      </span>
    </button>
  );
}

/** The open list: portalled to the body (a scrolling modal or an `overflow-hidden` card cannot clip it), at `pos`. */
export function ListPopover({
  pos,
  popRef,
  onKeyDown,
  search,
  listId,
  ariaLabel,
  busy,
  children,
}: {
  pos: ListPlacement;
  popRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (e: KeyboardEvent) => void;
  /** The search box, above the list. */
  search: ReactNode;
  listId: string;
  ariaLabel: string;
  busy?: boolean;
  /** The rows, or one `ListNote`. */
  children: ReactNode;
}) {
  return createPortal(
    <div
      ref={popRef}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        left: pos.left,
        width: pos.width,
        ...(pos.above ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
        zIndex: 1000, // above the Modal's z-50 / z-[70]
      }}
      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-800"
    >
      <div className="border-b border-slate-100 p-2 dark:border-white/10">{search}</div>
      <ul id={listId} role="listbox" aria-label={ariaLabel} aria-busy={busy || undefined} className="overflow-y-auto p-1" style={{ maxHeight: pos.maxHeight }}>
        {children}
      </ul>
    </div>,
    document.body,
  );
}

/** A line in place of the rows: nothing found, still searching, or why the search failed. */
export function ListNote({ children }: { children: ReactNode }) {
  return <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">{children}</li>;
}

/** One row. The highlighted one carries the id the search box's `aria-activedescendant` points at. */
export function ListRow({
  listId,
  active,
  selected,
  activeRef,
  onHover,
  onChoose,
  detail,
  wrap = false,
  children,
}: {
  listId: string;
  active: boolean;
  selected: boolean;
  activeRef: Ref<HTMLButtonElement>;
  onHover: () => void;
  onChoose: () => void;
  /** Shown muted at the end of the row, e.g. the kind of place. */
  detail?: ReactNode;
  /** Wrap a long label onto more lines instead of cutting it off. */
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        id={active ? `${listId}-active` : undefined}
        ref={active ? activeRef : null}
        type="button"
        // Pointer-move, not hover: a resting cursor must not fight the arrow keys.
        onPointerMove={onHover}
        onClick={onChoose}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${
          active ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        <span className={`min-w-0 ${wrap ? 'break-words' : 'truncate'}`}>{children}</span>
        {(detail || selected) && (
          <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {detail}
            {selected && <Check aria-hidden className="h-4 w-4" />}
          </span>
        )}
      </button>
    </li>
  );
}

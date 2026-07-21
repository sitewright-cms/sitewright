import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { SearchField } from './SearchField';
import { glassInput } from '../../theme';

export interface SelectOption {
  /** The value stored/submitted for this option. */
  value: string;
  /** The text shown in the trigger + list row (e.g. a page path, a template name). */
  label: string;
  /** Extra text matched by the search box IN ADDITION to `label` (e.g. a page's title). */
  keywords?: string;
}

/** Does `opt` match the (already-lowercased) search term against its label + keywords? */
function matches(opt: SelectOption, term: string): boolean {
  if (!term) return true;
  return opt.label.toLowerCase().includes(term) || (opt.keywords ?? '').toLowerCase().includes(term);
}

/**
 * A searchable single-select combobox — a trigger styled like `glassInput` that opens a PORTALLED
 * popover (so it's never clipped by a scrollable modal) holding a search box + a bounded, scrollable
 * option list. Filters by `label` + `keywords`; keyboard: ↑/↓ move, Enter selects, Esc closes; a
 * click outside / scroll / resize closes or repositions it. Use for long option lists (pages,
 * templates) where a native `<select>` is unsearchable and its rows can grow too wide.
 *
 * A11y: the trigger is `role="combobox"` (it shows the current value); on open, focus moves to the
 * search box, which carries `aria-controls`/`aria-activedescendant` so a screen reader announces the
 * keyboard-highlighted option. This puts `combobox` on the trigger rather than the input (a minor
 * deviation from APG that keeps the selected value always visible) — fine for these admin selectors.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const term = query.trim().toLowerCase();
  const filtered = options.filter((o) => matches(o, term));

  // Position the popover under (or above, when there's more room) the trigger; recomputed on open,
  // and on any scroll/resize so it stays attached to the trigger inside a scrolling modal.
  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const useAbove = below < 260 && above > below;
    setPos({
      left: r.left,
      top: useAbove ? r.top : r.bottom,
      width: r.width,
      maxHeight: Math.max(160, Math.min(320, (useAbove ? above : below) - 12)),
      above: useAbove,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // Close on an outside pointer-down (trigger + popover are the "inside").
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

  // Keep the active row within the filtered range as the query narrows it.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll the keyboard-active row into view within the bounded list. (scrollIntoView is absent in
  // jsdom and not universal, so guard the call.)
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const openMenu = () => {
    if (disabled) return;
    setQuery(''); // resets the list to ALL options, so pre-highlight against `options`, not `filtered`
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const choose = (opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // don't also close the enclosing modal
        setOpen(false);
        triggerRef.current?.focus();
      }
      return;
    }
    if (e.key === 'Tab') {
      // APG combobox: Tab closes the popup and lets focus move on naturally (no preventDefault).
      if (open) setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return openMenu();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openMenu();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        choose(filtered[active]);
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`${glassInput} flex items-center justify-between gap-2 text-left font-normal ${className ?? ''}`}
      >
        <span className={`truncate ${selected ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            // The search box takes focus on open, so arrow/Enter/Esc keys fire from INSIDE the
            // popover — handle them here (they bubble up) so keyboard nav works while it's open.
            onKeyDown={onKeyDown}
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              ...(pos.above ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
              zIndex: 1000,
            }}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900"
          >
            <div className="border-b border-slate-100 p-2 dark:border-white/10">
              <SearchField
                value={query}
                onChange={setQuery}
                ariaLabel={`Search ${ariaLabel}`}
                placeholder={searchPlaceholder}
                controls={listId}
                activeDescendant={filtered.length > 0 ? `${listId}-active` : undefined}
                autoFocus
              />
            </div>
            <ul id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto p-1" style={{ maxHeight: pos.maxHeight }}>
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">No matches.</li>
              ) : (
                filtered.map((opt, i) => (
                  <li key={opt.value} role="option" aria-selected={opt.value === value}>
                    <button
                      id={i === active ? `${listId}-active` : undefined}
                      ref={i === active ? activeRef : null}
                      type="button"
                      // Use pointer-move (not hover) so keyboard nav isn't fought by a resting cursor.
                      onPointerMove={() => setActive(i)}
                      onClick={() => choose(opt)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition ${
                        i === active ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {opt.value === value && <Check aria-hidden className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

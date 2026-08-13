import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { glassInput } from '../../theme';

/** One choice: the stored `value`, the `label` shown, and optional extra text to match/show. */
export interface SearchOption {
  value: string;
  label: string;
  /** A second line under the label (e.g. a page's route) — also matched by the search. */
  hint?: string;
}

/**
 * A `<select>` you can TYPE into.
 *
 * A plain select is fine for five options and useless for five hundred: picking the page to link to,
 * or the entry to reference, means scrolling a list ordered by nothing you can predict. The native
 * control's own type-ahead only matches a PREFIX of the label, which is the one thing you are least
 * likely to have — you remember a word from the middle of a title.
 *
 * Deliberately not a native `<select>` underneath: the whole point is filtering, and no amount of
 * `<option>` juggling gives you that. What it does keep is the parts of the native control people
 * rely on — Escape closes, Enter commits the highlighted row, ↑/↓ move, a click outside closes, and
 * the trigger reports the current selection rather than the raw stored value.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '— none —',
  searchPlaceholder = 'Search…',
  /** Text shown when the stored value matches no option — a reference to something since deleted. */
  missingLabel = (v: string) => `${v} (missing)`,
  id,
  allowClear = true,
  disabled = false,
}: {
  value: string;
  options: readonly SearchOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  missingLabel?: (value: string) => string;
  id?: string;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options),
    [options, q],
  );

  // Reset the search each time it opens: the last query is nearly always the wrong starting point,
  // and an inherited filter looks like a list that has lost most of its options.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  // Close on an outside click. Pointerdown (not click) so it also fires when the press starts on
  // another control that unmounts on its own click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${glassInput} flex w-full items-center gap-2 text-left disabled:opacity-50`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected || value ? '' : 'text-slate-400 dark:text-slate-500'}`}>
          {selected ? selected.label : value ? missingLabel(value) : placeholder}
        </span>
        {allowClear && value !== '' && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Clear ${ariaLabel}`}
            onClick={(e) => {
              e.stopPropagation();
              commit('');
            }}
            className="shrink-0 rounded p-0.5 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1.5 dark:border-white/10">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              aria-label={`Search ${ariaLabel}`}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation(); // don't let Escape close the modal this picker sits in
                  setOpen(false);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, shown.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const pick = shown[active];
                  if (pick) commit(pick.value);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </div>
          <ul role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-auto py-1">
            {shown.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o.value)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition ${
                    i === active ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''
                  }`}
                >
                  <Check className={`h-3.5 w-3.5 shrink-0 ${o.value === value ? 'text-indigo-500' : 'invisible'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-700 dark:text-slate-200">{o.label}</span>
                    {o.hint && <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">{o.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2.5 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
                {options.length === 0 ? 'Nothing to choose from yet.' : `Nothing matched “${query}”.`}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

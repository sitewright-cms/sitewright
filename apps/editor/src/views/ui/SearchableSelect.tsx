import { useId, useState } from 'react';
import { SearchField } from './SearchField';
import { ListNote, ListPopover, ListRow, ListTrigger, listKeys, useActiveRow, useAnchoredList } from './combobox';

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
 *
 * The field, placement, keys, popover and rows are `./combobox`, shared with the rank tracker's place picker.
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
  const listId = useId();
  const { triggerRef, popRef, pos, close } = useAnchoredList(open, setOpen);

  const selected = options.find((o) => o.value === value);
  const term = query.trim().toLowerCase();
  const filtered = options.filter((o) => matches(o, term));
  const { active, setActive, activeRef } = useActiveRow(filtered.length, open);

  const openMenu = () => {
    if (disabled) return;
    setQuery(''); // resets the list to ALL options, so pre-highlight against `options`, not `filtered`
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const choose = (opt: SelectOption) => {
    onChange(opt.value);
    close();
  };

  const onKeyDown = listKeys({
    open,
    count: filtered.length,
    openList: openMenu,
    close,
    setActive,
    pick: () => {
      const opt = filtered.at(active);
      if (opt) choose(opt);
      return !!opt;
    },
  });

  return (
    <>
      <ListTrigger
        ref={triggerRef}
        ariaLabel={ariaLabel}
        open={open}
        listId={listId}
        disabled={disabled}
        chosen={!!selected}
        className={className}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {selected ? selected.label : placeholder}
      </ListTrigger>

      {open && pos && (
        <ListPopover
          pos={pos}
          popRef={popRef}
          onKeyDown={onKeyDown}
          listId={listId}
          ariaLabel={ariaLabel}
          search={
            <SearchField
              value={query}
              onChange={(q) => {
                setQuery(q);
                // A new search highlights its FIRST match: Enter then picks what the search found, not whatever
                // row index the previous list had highlighted ("de" picked Sweden, not Germany).
                setActive(0);
              }}
              ariaLabel={`Search ${ariaLabel}`}
              placeholder={searchPlaceholder}
              controls={listId}
              activeDescendant={filtered.length > 0 ? `${listId}-active` : undefined}
              autoFocus
            />
          }
        >
          {filtered.length === 0 ? (
            <ListNote>No matches.</ListNote>
          ) : (
            filtered.map((opt, i) => (
              <ListRow
                key={opt.value}
                listId={listId}
                active={i === active}
                selected={opt.value === value}
                activeRef={activeRef}
                onHover={() => setActive(i)}
                onChoose={() => choose(opt)}
              >
                {opt.label}
              </ListRow>
            ))
          )}
        </ListPopover>
      )}
    </>
  );
}

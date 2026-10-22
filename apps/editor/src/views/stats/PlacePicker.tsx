import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { RankLocationOption } from '@sitewright/schema';
import { api } from '../../api';
import { fieldLabel, glassInput } from '../../theme';
import { SearchField } from '../ui/SearchField';

/** `Windhoek,Khomas Region,Namibia` → `Windhoek, Khomas Region, Namibia`. */
export const placeLabel = (name: string): string => name.split(',').join(', ');

/** Place names are long: the list is at least this wide, even under a narrow field. */
const MIN_LIST_WIDTH = 256;
/** Each typed search is a request: wait for a pause in the typing. */
const SEARCH_DELAY_MS = 250;

interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

/** Under the field, or above it when there is more room there; never past the window's edges. */
function placeUnder(el: HTMLElement): Placement {
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const above = r.top;
  const useAbove = below < 260 && above > below;
  const width = Math.min(Math.max(r.width, MIN_LIST_WIDTH), window.innerWidth - 16);
  return {
    left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    top: useAbove ? r.top : r.bottom,
    width,
    maxHeight: Math.max(160, Math.min(320, (useAbove ? above : below) - 12)),
    above: useAbove,
  };
}

/**
 * The list's place on screen while it is open: under (or above) the field, following it as the editor scrolls or
 * the window changes size; a press anywhere but the field and the list closes it. `setOpen` is a state setter, so
 * the effects need not re-run for it.
 */
function useAnchoredList(open: boolean, setOpen: (open: boolean) => void) {
  const [pos, setPos] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (triggerRef.current) setPos(placeUnder(triggerRef.current));
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

  return { triggerRef, popRef, pos };
}

/** The provider's places as options; the keyboard-active one carries the id the search box points at. */
function PlaceOptions({
  listId,
  places,
  value,
  active,
  activeRef,
  empty,
  onActive,
  onChoose,
}: {
  listId: string;
  places: readonly RankLocationOption[];
  value: RankLocationOption | null;
  active: number;
  activeRef: Ref<HTMLButtonElement>;
  empty: string;
  onActive: (i: number) => void;
  onChoose: (o: RankLocationOption) => void;
}) {
  if (places.length === 0) return <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">{empty}</li>;
  return places.map((o, i) => (
    <li key={o.name} role="option" aria-selected={value?.name === o.name}>
      <button
        id={i === active ? `${listId}-active` : undefined}
        ref={i === active ? activeRef : null}
        type="button"
        // Pointer-move, not hover: a resting cursor must not fight the arrow keys.
        onPointerMove={() => onActive(i)}
        onClick={() => onChoose(o)}
        className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm transition ${
          i === active ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        <span className="min-w-0 break-words">{placeLabel(o.name)}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {o.type}
          {value?.name === o.name && <Check aria-hidden className="h-4 w-4" />}
        </span>
      </button>
    </li>
  ));
}

/**
 * "Searched from": a place from the rank-tracking provider's list, for one country.
 *
 * It looks and works like the Country and Language pickers beside it (`ui/SearchableSelect`): a field that shows the
 * choice and opens a search box over a list, portalled to the body so the rankings card's `overflow-hidden` cannot
 * clip it. It is not one of them because those filter a list they already hold, while the provider knows thousands
 * of places per country and answers at most 25 per search, so every search here goes to the server.
 */
export function PlacePicker({
  country,
  value,
  onChange,
}: {
  country: string;
  value: RankLocationOption | null;
  onChange: (l: RankLocationOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The last answer, with the search it answers: a list kept from a typed search is the wrong start for the next open.
  const [answer, setAnswer] = useState<{ q: string; list: RankLocationOption[] }>({ q: '', list: [] });
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { triggerRef, popRef, pos } = useAnchoredList(open, setOpen);
  const activeRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // A new country starts at the country itself (the most common choice, and always valid) with the old
  // country's places gone. Its own `alive` flag: the typed search below must never discard this answer.
  useEffect(() => {
    let alive = true;
    onChange(null);
    setOpen(false);
    setAnswer({ q: '', list: [] });
    setQuery('');
    setError(null);
    if (!country) return;
    void api
      .searchRankLocations(country, '')
      .then((res) => {
        if (alive) onChange(res.locations.find((l) => l.type === 'Country') ?? null);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load the places');
      });
    return () => {
      alive = false;
    };
    // Re-run per country only: `onChange` is the parent's state setter.
  }, [country]);

  useEffect(() => {
    if (!country || !open) return;
    let alive = true;
    setSearching(true);
    const t = setTimeout(
      () => {
        void api
          .searchRankLocations(country, query)
          .then((res) => {
            if (!alive) return;
            setAnswer({ q: query, list: res.locations });
            setError(null);
          })
          .catch((err: unknown) => {
            if (alive) setError(err instanceof Error ? err.message : 'Could not search the places');
          })
          .finally(() => {
            if (alive) setSearching(false);
          });
      },
      query ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [country, query, open]);

  // Only places of the chosen country: a list still showing the previous country's answer offers nothing.
  const shown = answer.list.filter((o) => o.countryCode === country);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  // `scrollIntoView` is missing in jsdom.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (!country) return;
    setQuery('');
    if (answer.q !== '') setAnswer({ q: '', list: [] });
    const at = answer.q === '' ? shown.findIndex((o) => o.name === value?.name) : -1;
    setActive(Math.max(0, at));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (o: RankLocationOption) => {
    onChange(o);
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation(); // not the enclosing modal as well
      close();
    } else if (e.key === 'Tab') {
      if (open) setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, shown.length - 1) : Math.max(a - 1, 0)));
    } else if (e.key === 'Enter' && open) {
      const pick = shown.at(active);
      if (!pick) return;
      e.preventDefault();
      choose(pick);
    }
  };

  const typed = query.trim();
  return (
    // `min-w-0`: a long place name must truncate, not widen the form's grid column past the card.
    <div className="flex min-w-0 flex-col">
      <span className={fieldLabel}>Searched from</span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label="Searched from"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={!country}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`${glassInput} flex items-center justify-between gap-2 text-left font-normal disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`min-w-0 truncate ${value ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
          {value ? placeLabel(value.name) : country ? 'Choose…' : 'Choose a country first'}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {value?.type}
          <ChevronDown aria-hidden className="h-4 w-4" />
        </span>
      </button>
      {error && <span className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</span>}

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            // Focus is in the search box, so the list's keys arrive here.
            onKeyDown={onKeyDown}
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              ...(pos.above ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
              zIndex: 1000,
            }}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-800"
          >
            <div className="border-b border-slate-100 p-2 dark:border-white/10">
              <SearchField
                value={query}
                onChange={(q) => {
                  setQuery(q);
                  setActive(0);
                }}
                ariaLabel="Search places"
                placeholder="Type a city or region"
                controls={listId}
                activeDescendant={shown.length > 0 ? `${listId}-active` : undefined}
                autoFocus
              />
            </div>
            <ul id={listId} role="listbox" aria-label="Searched from" aria-busy={searching} className="overflow-y-auto p-1" style={{ maxHeight: pos.maxHeight }}>
              <PlaceOptions
                listId={listId}
                places={shown}
                value={value}
                active={active}
                activeRef={activeRef}
                empty={searching ? 'Searching…' : typed ? `No place matches “${typed}”.` : 'No places found.'}
                onActive={setActive}
                onChoose={choose}
              />
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

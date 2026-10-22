import { useEffect, useId, useState } from 'react';
import type { RankLocationOption } from '@sitewright/schema';
import { api } from '../../api';
import { fieldLabel } from '../../theme';
import { ListNote, ListPopover, ListRow, ListTrigger, listKeys, useActiveRow, useAnchoredList } from '../ui/combobox';
import { SearchField } from '../ui/SearchField';

/** `Windhoek,Khomas Region,Namibia` → `Windhoek, Khomas Region, Namibia`. */
export const placeLabel = (name: string): string => name.split(',').join(', ');

/** Each typed search is a request: wait for a pause in the typing. */
export const PLACE_SEARCH_DELAY_MS = 250;
/** The longest search sent; the server cuts `q` to the same length. */
const MAX_QUERY = 100;

/** The provider's answer to one search: its places, or why there are none. */
interface Answer {
  country: string;
  q: string;
  places: RankLocationOption[] | null;
  error: string | null;
}

/**
 * "Searched from": a place from the rank-tracking provider's list, for one country.
 *
 * It is built from the same parts as the Country and Language pickers beside it (`ui/combobox`, as
 * `ui/SearchableSelect` is): a field that shows the choice and opens a search box over a list, portalled so the
 * rankings card's `overflow-hidden` cannot clip it. It is not a SearchableSelect because that filters a list it holds,
 * while the provider knows thousands of places per country and answers at most 25 per search, so every search here
 * goes to the server.
 *
 * The rows shown are always the answer to the search as typed now. While that answer is on its way the list says
 * "Searching…" and offers nothing: rows left from the previous search would let Enter or a click pick a place that
 * does not match what was typed. An answer that arrives late, for an older search or the previous country, is dropped.
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
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const listId = useId();
  const { triggerRef, popRef, pos, close } = useAnchoredList(open, setOpen);

  // The places answering search `q` for this country; none while that answer is still on its way. Only places of the
  // chosen country: a list still showing the previous country's answer offers nothing.
  const answered = (q: string): Answer | null => (answer && answer.country === country && answer.q === q ? answer : null);
  const placesFor = (q: string): RankLocationOption[] => answered(q)?.places?.filter((o) => o.countryCode === country) ?? [];
  const current = answered(query);
  const shown = placesFor(query);
  const { active, setActive, activeRef } = useActiveRow(shown.length, open);

  // A new country starts at the country itself (the most common choice, and always valid) with the old
  // country's places gone. Its own `alive` flag: the typed search below must never discard this answer.
  useEffect(() => {
    let alive = true;
    onChange(null);
    setOpen(false);
    setAnswer(null);
    setQuery('');
    setLoadError(null);
    if (!country) return;
    api.searchRankLocations(country, '').then(
      (res) => {
        if (alive) onChange(res.locations.find((l) => l.type === 'Country') ?? null);
      },
      (err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'Could not load the places');
      },
    );
    return () => {
      alive = false;
    };
    // Re-run per country only: `onChange` is the parent's state setter.
  }, [country]);

  // The search as typed, after a pause. A newer search (or country, or closing the list) silences this one's answer.
  useEffect(() => {
    if (!country || !open) return;
    let alive = true;
    const t = setTimeout(
      () => {
        api.searchRankLocations(country, query).then(
          (res) => {
            if (alive) setAnswer({ country, q: query, places: res.locations, error: null });
          },
          (err: unknown) => {
            if (alive) setAnswer({ country, q: query, places: null, error: err instanceof Error ? err.message : 'Could not search the places' });
          },
        );
      },
      query ? PLACE_SEARCH_DELAY_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [country, query, open]);

  const openList = () => {
    if (!country) return;
    setQuery('');
    setActive(Math.max(0, placesFor('').findIndex((o) => o.name === value?.name)));
    setOpen(true);
  };

  const choose = (o: RankLocationOption) => {
    onChange(o);
    close();
  };

  const onKeyDown = listKeys({
    open,
    count: shown.length,
    openList,
    close,
    setActive,
    pick: () => {
      const o = shown.at(active);
      if (o) choose(o);
      return !!o;
    },
  });

  const typed = query.trim();
  const note = !current ? 'Searching…' : current.error ? current.error : typed ? `No place matches “${typed}”.` : 'No places found.';
  return (
    // `min-w-0`: a long place name must truncate, not widen the form's grid column past the card.
    <div className="flex min-w-0 flex-col">
      <span className={fieldLabel}>Searched from</span>
      <ListTrigger
        ref={triggerRef}
        ariaLabel="Searched from"
        open={open}
        listId={listId}
        disabled={!country}
        chosen={!!value}
        detail={value?.type}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {value ? placeLabel(value.name) : country ? 'Choose…' : 'Choose a country first'}
      </ListTrigger>
      {loadError && <span className="mt-1 text-xs text-rose-700 dark:text-rose-300">{loadError}</span>}

      {open && pos && (
        <ListPopover
          pos={pos}
          popRef={popRef}
          onKeyDown={onKeyDown}
          listId={listId}
          ariaLabel="Searched from"
          busy={!current}
          search={
            <SearchField
              value={query}
              onChange={(q) => {
                setQuery(q);
                setActive(0);
              }}
              ariaLabel="Search places"
              placeholder="Type a city or region"
              maxLength={MAX_QUERY}
              controls={listId}
              activeDescendant={shown.length > 0 ? `${listId}-active` : undefined}
              autoFocus
            />
          }
        >
          {shown.length === 0 ? (
            <ListNote>{note}</ListNote>
          ) : (
            shown.map((o, i) => (
              <ListRow
                key={o.name}
                listId={listId}
                active={i === active}
                selected={value?.name === o.name}
                activeRef={activeRef}
                onHover={() => setActive(i)}
                onChoose={() => choose(o)}
                detail={o.type}
                wrap
              >
                {placeLabel(o.name)}
              </ListRow>
            ))
          )}
        </ListPopover>
      )}
    </div>
  );
}

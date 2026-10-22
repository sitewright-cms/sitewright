import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RankLocationOption } from '@sitewright/schema';

const api = vi.hoisted(() => ({
  addRankKeywords: vi.fn(),
  searchRankLocations: vi.fn(),
}));
vi.mock('../src/api', () => ({ api }));

import { PlacePicker } from '../src/views/stats/PlacePicker';
import { AddKeywordsForm } from '../src/views/stats/RankSetup';

/**
 * "Searched from" against a provider that answers late, out of order, or not at all. Every search is held until the
 * test answers it, so each race is played out step by step.
 */

const place = (name: string, type: string, countryCode: string): RankLocationOption => ({ name, type, countryCode });
const NAMIBIA = place('Namibia', 'Country', 'NA');
const WINDHOEK = place('Windhoek,Khomas Region,Namibia', 'City', 'NA');

interface Held {
  country: string;
  q: string;
  answer: (places: RankLocationOption[] | Error) => void;
}

let held: Held[] = [];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  held = [];
  api.searchRankLocations.mockImplementation(
    (country: string, q: string) =>
      new Promise((resolve, reject) => {
        held.push({ country, q, answer: (r) => (r instanceof Error ? reject(r) : resolve({ locations: r })) });
      }),
  );
});

afterEach(() => vi.restoreAllMocks());

/** Answers the newest held search for `country` and `q` (waiting for it to be asked). */
async function answer(country: string, q: string, places: RankLocationOption[] | Error): Promise<void> {
  const search = await waitFor(() => {
    const found = [...held].reverse().find((h) => h.country === country && h.q === q);
    expect(found, `a search for ${country} "${q}"`).toBeDefined();
    return found!;
  });
  held = held.filter((h) => h !== search);
  await act(async () => search.answer(places));
}

const field = () => screen.getByRole('combobox', { name: 'Searched from' });
const list = () => screen.getByRole('listbox', { name: 'Searched from' });
const box = () => screen.getByLabelText('Search places');
const options = () => within(list()).queryAllByRole('option').map((o) => o.textContent);
const typedSearches = () => api.searchRankLocations.mock.calls.filter(([, q]) => q !== '');

/** The form at Namibia, with the list open on the provider's answer to an empty search. */
async function openAtNamibia(): Promise<void> {
  render(<AddKeywordsForm projectId="p1" defaultCountry="NA" onAdded={() => {}} />);
  await answer('NA', '', [NAMIBIA]);
  expect(field()).toHaveTextContent('NamibiaCountry');
  fireEvent.click(field());
  await answer('NA', '', [NAMIBIA, place('Khomas Region,Namibia', 'Region', 'NA')]);
  expect(options()).toHaveLength(2);
}

describe('a search still on its way', () => {
  it('offers nothing to pick: Enter waits for the answer, which it then picks from', async () => {
    await openAtNamibia();
    fireEvent.change(box(), { target: { value: 'windhoek' } });
    // The rows of the empty search are gone; they do not match what was typed.
    expect(options()).toEqual([]);
    expect(list()).toHaveTextContent('Searching…');
    expect(list()).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(list()).toBeInTheDocument();
    expect(field()).toHaveTextContent('NamibiaCountry');

    await answer('NA', 'windhoek', [WINDHOEK]);
    expect(options()).toEqual(['Windhoek, Khomas Region, NamibiaCity']);
    expect(list()).not.toHaveAttribute('aria-busy');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.queryByRole('listbox', { name: 'Searched from' })).toBeNull();
    expect(field()).toHaveTextContent('Windhoek, Khomas Region, NamibiaCity');
  });

  it('drops an answer that arrives after the answer to a newer search', async () => {
    await openAtNamibia();
    fireEvent.change(box(), { target: { value: 'wi' } });
    await waitFor(() => expect(typedSearches()).toHaveLength(1));
    fireEvent.change(box(), { target: { value: 'win' } });
    await waitFor(() => expect(typedSearches()).toHaveLength(2));
    await answer('NA', 'win', [WINDHOEK]);
    await answer('NA', 'wi', [place('Witvlei,Omaheke Region,Namibia', 'City', 'NA')]);
    expect(options()).toEqual(['Windhoek, Khomas Region, NamibiaCity']);
  });

  it('asks once the typing pauses, not for every letter', async () => {
    await openAtNamibia();
    for (const q of ['w', 'wi', 'win']) fireEvent.change(box(), { target: { value: q } });
    await answer('NA', 'win', [WINDHOEK]);
    expect(typedSearches()).toEqual([['NA', 'win']]);
  });

  it('accepts at most 100 characters, as the server does', async () => {
    await openAtNamibia();
    expect(box()).toHaveAttribute('maxlength', '100');
  });
});

describe('a provider that fails', () => {
  it('says why a search failed, and the next search starts afresh', async () => {
    await openAtNamibia();
    fireEvent.change(box(), { target: { value: 'wind' } });
    await answer('NA', 'wind', new Error('The provider did not answer'));
    expect(options()).toEqual([]);
    expect(list()).toHaveTextContent('The provider did not answer');
    fireEvent.change(box(), { target: { value: 'windh' } });
    expect(list()).toHaveTextContent('Searching…');
    await answer('NA', 'windh', [WINDHOEK]);
    expect(options()).toEqual(['Windhoek, Khomas Region, NamibiaCity']);
  });

  it('says so when even the country cannot be loaded, and nothing can be added', async () => {
    render(<AddKeywordsForm projectId="p1" defaultCountry="NA" onAdded={() => {}} />);
    fireEvent.change(screen.getByLabelText('Keywords, one per line'), { target: { value: 'plumber' } });
    await answer('NA', '', new Error('no rank-tracking provider is set up yet'));
    expect(await screen.findByText('no rank-tracking provider is set up yet')).toBeInTheDocument();
    expect(field()).toHaveTextContent('Choose…');
    expect(screen.getByRole('button', { name: 'Add keyword' })).toBeDisabled();
  });
});

describe('answers that come too late', () => {
  it('a new country is not overwritten by the old country’s place or places', async () => {
    render(<AddKeywordsForm projectId="p1" defaultCountry="NA" onAdded={() => {}} />);
    // Namibia's own place has not answered yet when the list opens and a search goes out.
    fireEvent.click(field());
    await waitFor(() => expect(held).toHaveLength(2));
    await answer('NA', '', []); // the open list's empty search (the newer of the two)
    fireEvent.change(box(), { target: { value: 'p' } });
    await waitFor(() => expect(typedSearches()).toEqual([['NA', 'p']]));

    fireEvent.click(screen.getByRole('combobox', { name: 'Country' }));
    fireEvent.change(screen.getByLabelText('Search Country'), { target: { value: 'germ' } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Country' })).getByText('Germany'));
    expect(screen.queryByRole('listbox', { name: 'Searched from' })).toBeNull();
    await answer('DE', '', [place('Germany', 'Country', 'DE')]);
    expect(field()).toHaveTextContent('GermanyCountry');

    // Now Namibia's answers arrive: neither may land.
    await answer('NA', 'p', [place('Opuwo,Kunene Region,Namibia', 'City', 'NA')]);
    await answer('NA', '', [NAMIBIA]);
    expect(field()).toHaveTextContent('GermanyCountry');
    fireEvent.click(field());
    await answer('DE', '', [place('Germany', 'Country', 'DE'), place('Berlin,Germany', 'City', 'DE')]);
    expect(options()).toEqual(['GermanyCountry', 'Berlin, GermanyCity']);
  });

  it('nothing happens when the answers arrive after the picker is gone', async () => {
    const onChange = vi.fn();
    const consoleError = vi.spyOn(console, 'error');
    const { unmount } = render(<PlacePicker country="NA" value={null} onChange={onChange} />);
    fireEvent.click(field());
    await waitFor(() => expect(held).toHaveLength(2)); // the country's place, and the open list's search
    expect(onChange.mock.calls).toEqual([[null]]);
    unmount();
    await act(async () => {
      for (const h of held) h.answer([NAMIBIA]);
    });
    expect(onChange.mock.calls).toEqual([[null]]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('focus', () => {
  it('Tab from the search box closes the list and leaves focus on the field, from where the Tab moves on', async () => {
    await openAtNamibia();
    expect(box()).toHaveFocus();
    fireEvent.keyDown(box(), { key: 'Tab' });
    expect(screen.queryByRole('listbox', { name: 'Searched from' })).toBeNull();
    expect(field()).toHaveFocus();
  });
});

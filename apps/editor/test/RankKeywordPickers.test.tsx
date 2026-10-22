import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RankLocationOption } from '@sitewright/schema';

const api = vi.hoisted(() => ({
  addRankKeywords: vi.fn(),
  searchRankLocations: vi.fn(),
}));
vi.mock('../src/api', () => ({ api }));

import { AddKeywordsForm } from '../src/views/stats/RankSetup';
import { COUNTRY_OPTIONS } from '../src/views/stats/rank-options';

/**
 * "Add keywords": Country, Searched from and Language are searchable pickers. Country and Language filter a list
 * they hold (`ui/SearchableSelect`); Searched from asks the provider for each search.
 */

const place = (name: string, type: string, countryCode: string): RankLocationOption => ({ name, type, countryCode });

/** The provider: the country itself for an empty search, else a city named after the search. */
function provider(): void {
  api.searchRankLocations.mockImplementation(async (country: string, q: string) => ({
    locations: q
      ? [place(`${q[0]!.toUpperCase()}${q.slice(1)}ville,${country}`, 'City', country), place(`Upper ${q},${country}`, 'Region', country)]
      : [place(country === 'NA' ? 'Namibia' : country === 'DE' ? 'Germany' : country, 'Country', country)],
  }));
}

function renderForm(defaultCountry?: string) {
  const onAdded = vi.fn();
  render(<AddKeywordsForm projectId="p1" defaultCountry={defaultCountry} onAdded={onAdded} />);
  fireEvent.change(screen.getByLabelText('Keywords, one per line'), { target: { value: 'plumber' } });
  return onAdded;
}

/** Opens a picker and types into its search box; returns its (portalled) list. */
function search(label: string, text: string, searchLabel = `Search ${label}`): HTMLElement {
  if (!screen.queryByRole('listbox', { name: label })) fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.change(screen.getByLabelText(searchLabel), { target: { value: text } });
  return screen.getByRole('listbox', { name: label });
}

const optionTexts = (list: HTMLElement): string[] => within(list).queryAllByRole('option').map((o) => o.textContent ?? '');

const submitted = () => api.addRankKeywords.mock.calls[0]?.[1] as { location: { name: string; countryCode: string }; languageCode: string } | undefined;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  provider();
  api.addRankKeywords.mockResolvedValue({ added: 1, existing: 0 });
});

describe('the Country picker', () => {
  it('finds a country by name or by code, and submits the one picked', async () => {
    renderForm();
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('Choose…');
    expect(screen.getByRole('combobox', { name: 'Searched from' })).toBeDisabled();

    const list = search('Country', 'DE');
    const found = optionTexts(list);
    expect(found).toContain('Germany');
    expect(found).not.toContain('France');
    expect(found.length).toBeLessThan(COUNTRY_OPTIONS.length / 5);

    expect(optionTexts(search('Country', 'uk'))).toContain('United Kingdom');
    expect(optionTexts(search('Country', 'turkey'))).toEqual(['Türkiye']);
    expect(optionTexts(search('Country', 'cote d'))).toEqual(['Côte d’Ivoire']);

    fireEvent.click(within(search('Country', 'germ')).getByText('Germany'));
    expect(screen.queryByRole('listbox', { name: 'Country' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('Germany');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Searched from' })).toHaveTextContent('GermanyCountry'));
    expect(api.searchRankLocations).toHaveBeenCalledWith('DE', '');

    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(submitted()).toEqual({ keywords: ['plumber'], location: { name: 'Germany', countryCode: 'DE' }, languageCode: 'en', device: 'desktop' }));
  });
});

describe('the Language picker', () => {
  it('starts at English, finds a language by name, code or its own name, and submits the one picked', async () => {
    renderForm('NA');
    const language = screen.getByRole('combobox', { name: 'Language' });
    expect(language).toHaveTextContent('English');

    expect(optionTexts(search('Language', 'deutsch'))).toEqual(['German']);
    expect(optionTexts(search('Language', 'zh-tw'))).toEqual(['Chinese (Traditional)']);
    expect(optionTexts(search('Language', 'espanol'))).toEqual(['Spanish']);
    expect(optionTexts(search('Language', 'pt'))).toEqual(['Portuguese']);

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Language' })).getByText('Portuguese'));
    expect(language).toHaveTextContent('Portuguese');

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Searched from' })).toHaveTextContent('Namibia'));
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(submitted()?.languageCode).toBe('pt'));
  });
});

describe('the Searched from picker', () => {
  it('starts at the default country, which is submitted as it is', async () => {
    renderForm('NA');
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('Namibia');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English');
    const where = screen.getByRole('combobox', { name: 'Searched from' });
    await waitFor(() => expect(where).toHaveTextContent('NamibiaCountry'));
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(submitted()).toMatchObject({ location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'en' }));
  });

  it('asks the provider as you type, and submits the place picked', async () => {
    renderForm('NA');
    const where = screen.getByRole('combobox', { name: 'Searched from' });
    await waitFor(() => expect(where).toHaveTextContent('Namibia'));
    const list = search('Searched from', 'wind', 'Search places');
    await waitFor(() => expect(optionTexts(list)).toEqual(['Windville, NACity', 'Upper wind, NARegion']));
    expect(api.searchRankLocations).toHaveBeenLastCalledWith('NA', 'wind');
    fireEvent.click(within(list).getByText('Upper wind, NA'));
    expect(screen.queryByRole('listbox', { name: 'Searched from' })).toBeNull();
    expect(where).toHaveTextContent('Upper wind, NARegion');
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() => expect(submitted()?.location).toEqual({ name: 'Upper wind,NA', countryCode: 'NA' }));
  });

  it('says when nothing matches', async () => {
    renderForm('NA');
    api.searchRankLocations.mockResolvedValue({ locations: [] });
    const list = search('Searched from', 'zzz', 'Search places');
    expect(await within(list).findByText('No place matches “zzz”.')).toBeInTheDocument();
  });

  it('works from the keyboard', async () => {
    renderForm('NA');
    const where = screen.getByRole('combobox', { name: 'Searched from' });
    await waitFor(() => expect(where).toHaveTextContent('Namibia'));
    fireEvent.keyDown(where, { key: 'ArrowDown' });
    const box = screen.getByLabelText('Search places');
    fireEvent.change(box, { target: { value: 'oka' } });
    await within(screen.getByRole('listbox', { name: 'Searched from' })).findByText('Okaville, NA');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveAttribute('aria-activedescendant', screen.getByRole('button', { name: /Upper oka/ }).id);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(where).toHaveTextContent('Upper oka, NA');
    // Escape closes without changing the choice.
    fireEvent.keyDown(where, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByLabelText('Search places'), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Searched from' })).toBeNull();
    expect(where).toHaveTextContent('Upper oka, NA');
  });

  it('keeps the country as the place even when the list is opened before the provider answers', async () => {
    let answer!: (r: { locations: RankLocationOption[] }) => void;
    api.searchRankLocations.mockImplementation((_c: string, q: string) =>
      q === '' && !answer ? new Promise((resolve) => (answer = resolve)) : Promise.resolve({ locations: [] }),
    );
    renderForm('NA');
    const where = screen.getByRole('combobox', { name: 'Searched from' });
    fireEvent.click(where);
    await act(async () => answer({ locations: [place('Namibia', 'Country', 'NA')] }));
    await waitFor(() => expect(where).toHaveTextContent('Namibia'));
    expect(screen.getByRole('button', { name: 'Add keyword' })).toBeEnabled();
  });

  it('never offers the previous country’s places after the country changes', async () => {
    renderForm('NA');
    const list = search('Searched from', 'p', 'Search places');
    await within(list).findByText('Pville, NA');
    fireEvent.click(within(search('Country', 'germ')).getByText('Germany'));
    // The open list closed with the change, and the next one is Germany's.
    expect(screen.queryByRole('listbox', { name: 'Searched from' })).toBeNull();
    expect(screen.queryByText('Pville, NA')).toBeNull();
    const next = search('Searched from', 'p', 'Search places');
    await within(next).findByText('Pville, DE');
    expect(within(next).queryByText(/, NA$/)).toBeNull();
  });
});

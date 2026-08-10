import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { StockProviderName, StockSearchProvider } from '@sitewright/schema';

const stockProviders = vi.fn();
const searchStock = vi.fn();
const importStock = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    stockProviders: () => stockProviders(),
    searchStock: (_p: string, provider: StockSearchProvider, q: string, page?: number) =>
      searchStock(provider, q, page),
    importStock: (_p: string, provider: StockProviderName, id: string, alt?: string) =>
      importStock(provider, id, alt),
  },
}));

import { StockPicker } from '../src/views/media/StockPicker';

const ALL_PROVIDERS = {
  providers: [
    { name: 'openverse', available: true, requiresKey: false },
    { name: 'unsplash', available: false, requiresKey: true },
    { name: 'pexels', available: false, requiresKey: true },
  ],
};

function hit(provider: StockProviderName, id: string, author: string) {
  return {
    provider,
    id,
    thumbUrl: `https://cdn/${id}-t`,
    previewUrl: `https://cdn/${id}-p`,
    width: 4000,
    height: 3000,
    author,
    sourceUrl: `https://s/${id}`,
    license: 'CC0',
  };
}

const RESULT = { provider: 'all' as const, page: 1, hasMore: false, results: [hit('openverse', 'ov1', 'Ann')] };

beforeEach(() => {
  stockProviders.mockReset();
  searchStock.mockReset();
  importStock.mockReset();
  stockProviders.mockResolvedValue(ALL_PROVIDERS);
  searchStock.mockResolvedValue(RESULT);
  importStock.mockResolvedValue({ item: { id: 'asset1' } });
});

function renderPicker(onImported = vi.fn()) {
  render(<StockPicker projectId="p" onImported={onImported} />);
  return onImported;
}

async function runSearch(term = 'cats') {
  await screen.findByLabelText('Stock provider');
  fireEvent.change(screen.getByLabelText('Stock search query'), { target: { value: term } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

describe('StockPicker', () => {
  it('offers ALL alongside each provider, annotates the keyed ones, and defaults to ALL', async () => {
    renderPicker();
    const select = (await screen.findByLabelText('Stock provider')) as HTMLSelectElement;
    // The <select> mounts before its options are populated from the async providers fetch — wait for
    // them so this isn't racy (the option can be absent for a tick under load).
    await waitFor(() => expect(Array.from(select.options).some((o) => o.value === 'unsplash')).toBe(true));
    const unsplash = Array.from(select.options).find((o) => o.value === 'unsplash');
    expect(unsplash?.textContent).toMatch(/needs an API key/i);
    expect(select.value).toBe('all');
    expect(Array.from(select.options)[0]?.textContent).toBe('All providers');
  });

  it('searches every provider at once by default, and renders results with author/license', async () => {
    const onImported = renderPicker();
    await runSearch();
    await waitFor(() => expect(searchStock).toHaveBeenCalledWith('all', 'cats', 1));
    expect(await screen.findByText(/Ann · CC0/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importStock).toHaveBeenCalledWith('openverse', 'ov1', undefined));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it('labels each tile with its own provider in a fan-out (the grid is mixed)', async () => {
    searchStock.mockResolvedValue({
      provider: 'all',
      page: 1,
      hasMore: false,
      results: [hit('openverse', 'ov1', 'Ann'), hit('pexels', 'px1', 'Cy')],
    });
    renderPicker();
    await runSearch();
    expect(await screen.findByText('Openverse (CC)')).toBeInTheDocument();
    expect(screen.getByText('Pexels')).toBeInTheDocument();
  });

  it('appends the next page on Load more, keeping what is already on screen', async () => {
    searchStock.mockResolvedValueOnce({ provider: 'all', page: 1, hasMore: true, results: [hit('openverse', 'ov1', 'Ann')] });
    searchStock.mockResolvedValueOnce({ provider: 'all', page: 2, hasMore: false, results: [hit('openverse', 'ov2', 'Bo')] });
    renderPicker();
    await runSearch();
    const more = await screen.findByRole('button', { name: 'Load more' });

    // Typing a NEW query without searching must not hijack "Load more" — it continues page 2 of the
    // search whose results are actually on screen.
    fireEvent.change(screen.getByLabelText('Stock search query'), { target: { value: 'dogs' } });
    fireEvent.click(more);
    await waitFor(() => expect(searchStock).toHaveBeenLastCalledWith('all', 'cats', 2));

    expect(await screen.findByText(/Bo · CC0/)).toBeInTheDocument();
    expect(screen.getByText(/Ann · CC0/)).toBeInTheDocument(); // page 1 still there
    // hasMore=false on the last page → the button is gone.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  });

  it('skips a duplicate page: a provider re-serving page 1 as page 2 does not append nothing', async () => {
    // Measured upstream behaviour: Openverse's anonymous tier returns an IDENTICAL page 1 and 2 for
    // some queries. Without the skip-ahead the button would append zero tiles and read as broken.
    const p1 = [hit('openverse', 'ov1', 'Ann')];
    searchStock.mockResolvedValueOnce({ provider: 'all', page: 1, hasMore: true, results: p1 });
    searchStock.mockResolvedValueOnce({ provider: 'all', page: 2, hasMore: true, results: p1 }); // same rows
    searchStock.mockResolvedValueOnce({ provider: 'all', page: 3, hasMore: false, results: [hit('openverse', 'ov3', 'Cy')] });
    renderPicker();
    await runSearch();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText(/Cy · CC0/)).toBeInTheDocument();
    await waitFor(() => expect(searchStock).toHaveBeenLastCalledWith('all', 'cats', 3));
    // Exactly one tile per photo — the duplicate page did not double ov1.
    expect(screen.getAllByText(/Ann · CC0/)).toHaveLength(1);
  });

  it('hides Load more when the first page is already the last', async () => {
    renderPicker();
    await runSearch();
    expect(await screen.findByText(/Ann · CC0/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('opens a full-size preview from a tile, showing the large rendition and the true dimensions', async () => {
    renderPicker();
    await runSearch();
    fireEvent.click(await screen.findByRole('button', { name: /Preview stock photo by Ann/ }));

    const dialog = await screen.findByRole('dialog');
    // The PREVIEW url, not the grid thumbnail — the point of the whole feature.
    const img = Array.from(dialog.querySelectorAll('img')).find((i) => i.getAttribute('src') === 'https://cdn/ov1-p');
    expect(img).toBeTruthy();
    expect(dialog.textContent).toContain('4000×3000');

    fireEvent.click(screen.getByRole('button', { name: 'Import this photo' }));
    await waitFor(() => expect(importStock).toHaveBeenCalledWith('openverse', 'ov1', undefined));
  });

  it('surfaces a search error', async () => {
    searchStock.mockRejectedValue(new Error('stock provider unavailable — please try again'));
    renderPicker();
    await runSearch();
    expect(await screen.findByText(/stock provider unavailable/)).toBeInTheDocument();
  });

  it('reports a partially failed fan-out without hiding the results that did arrive', async () => {
    searchStock.mockResolvedValue({
      provider: 'all',
      page: 1,
      hasMore: false,
      results: [hit('openverse', 'ov1', 'Ann')],
      errors: [{ provider: 'unsplash', error: 'provider request failed (503)' }],
    });
    renderPicker();
    await runSearch();
    expect(await screen.findByText(/Unsplash did not respond/)).toBeInTheDocument();
    expect(screen.getByText(/Ann · CC0/)).toBeInTheDocument();
  });

  it('warns and disables search when a SPECIFIC provider needs a key', async () => {
    renderPicker();
    const select = await screen.findByLabelText('Stock provider');
    fireEvent.change(select, { target: { value: 'unsplash' } });
    // The warning paragraph (distinct from the option label) points to System settings.
    expect(screen.getByText(/This provider needs an API key/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stock search query'), { target: { value: 'cats' } });
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('under ALL, says which providers are actually being searched when some are unkeyed', async () => {
    renderPicker();
    await screen.findByLabelText('Stock provider');
    expect(await screen.findByText(/Searching Openverse \(CC\)\./)).toBeInTheDocument();
    // ALL stays searchable because openverse needs no key.
    fireEvent.change(screen.getByLabelText('Stock search query'), { target: { value: 'cats' } });
    expect(screen.getByRole('button', { name: 'Search' })).not.toBeDisabled();
  });
});

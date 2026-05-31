import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { StockProviderName } from '@sitewright/schema';

const stockProviders = vi.fn();
const searchStock = vi.fn();
const importStock = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    stockProviders: () => stockProviders(),
    searchStock: (_o: string, _p: string, provider: StockProviderName, q: string, page?: number) =>
      searchStock(provider, q, page),
    importStock: (_o: string, _p: string, provider: StockProviderName, id: string, alt?: string) =>
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

const RESULT = {
  provider: 'openverse' as const,
  page: 1,
  results: [
    { provider: 'openverse' as const, id: 'ov1', thumbUrl: 'https://cdn/ov1', width: 4, height: 3, author: 'Ann', sourceUrl: 'https://s/ov1', license: 'CC0' },
  ],
};

beforeEach(() => {
  stockProviders.mockReset();
  searchStock.mockReset();
  importStock.mockReset();
  stockProviders.mockResolvedValue(ALL_PROVIDERS);
  searchStock.mockResolvedValue(RESULT);
  importStock.mockResolvedValue({ item: { id: 'asset1' } });
});

function renderPicker(onImported = vi.fn()) {
  render(<StockPicker orgId="o" projectId="p" onImported={onImported} />);
  return onImported;
}

describe('StockPicker', () => {
  it('loads providers, annotates keyed providers that need a key, and defaults to the first available', async () => {
    renderPicker();
    const select = (await screen.findByLabelText('Stock provider')) as HTMLSelectElement;
    const unsplash = Array.from(select.options).find((o) => o.value === 'unsplash');
    expect(unsplash?.textContent).toMatch(/needs an API key/i);
    expect(select.value).toBe('openverse'); // defaulted to first available
  });

  it('searches and renders results with author/license, then imports', async () => {
    const onImported = renderPicker();
    await screen.findByLabelText('Stock provider');
    fireEvent.change(screen.getByLabelText('Stock search query'), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchStock).toHaveBeenCalledWith('openverse', 'cats', undefined));
    expect(await screen.findByText(/Ann · CC0/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importStock).toHaveBeenCalledWith('openverse', 'ov1', undefined));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it('surfaces a search error', async () => {
    searchStock.mockRejectedValue(new Error('stock provider unavailable — please try again'));
    renderPicker();
    await screen.findByLabelText('Stock provider');
    fireEvent.change(screen.getByLabelText('Stock search query'), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/stock provider unavailable/)).toBeInTheDocument();
  });

  it('warns and disables search when the selected provider needs a key', async () => {
    renderPicker();
    const select = await screen.findByLabelText('Stock provider');
    fireEvent.change(select, { target: { value: 'unsplash' } });
    // The warning paragraph (distinct from the option label) points to instance settings.
    expect(screen.getByText(/Configure it under Instance settings/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stock search query'), { target: { value: 'cats' } });
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });
});

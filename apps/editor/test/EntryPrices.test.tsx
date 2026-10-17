import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Dataset, Entry } from '@sitewright/schema';

const { putEntry, listPages, getSettings } = vi.hoisted(() => ({
  putEntry: vi.fn<(pid: string, e: Entry, v?: string) => Promise<unknown>>(),
  listPages: vi.fn<(pid: string) => Promise<unknown>>(),
  getSettings: vi.fn<(pid: string) => Promise<unknown>>(),
}));
vi.mock('../src/api', () => ({
  api: {
    putEntry: (pid: string, e: Entry, v?: string) => putEntry(pid, e, v),
    listPages: (pid: string) => listPages(pid),
    getSettings: (pid: string) => getSettings(pid),
  },
}));

import { EntryEditorModal } from '../src/views/datasets/EntryEditorModal';

/** A shop product's price PER MARKET — one input per market, in its currency, blank = not sold there. */
const dataset: Dataset = {
  id: 'products',
  name: 'Products',
  slug: 'products',
  fields: [{ name: 'price_by_market', type: 'prices', required: false, localized: false }],
};
const entry: Entry = { id: 'mug', dataset: 'products', status: 'published', values: { price_by_market: { eu: 19.9, old: 5 } } };

beforeEach(() => {
  putEntry.mockReset();
  putEntry.mockResolvedValue({ item: {}, version: 'v2' });
  listPages.mockResolvedValue({ items: [] });
  getSettings.mockResolvedValue({
    item: {
      identity: {},
      settings: { defaultLocale: 'en', locales: ['en'] },
      website: { shop: { markets: [{ id: 'eu', name: 'Europe', currency: 'EUR', countries: ['DE'] }, { id: 'ch', name: 'Switzerland', currency: 'CHF', countries: ['CH'] }] } },
    },
  });
});

describe('the Prices field', () => {
  it('★ one input per market in its currency; a blank market is saved as not sold there', async () => {
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={entry} onSaved={() => {}} onClose={() => {}} />);
    const eu = await screen.findByLabelText('price_by_market — Europe (EUR)');
    expect(eu).toHaveValue(19.9);
    const ch = screen.getByLabelText('price_by_market — Switzerland (CHF)');
    expect(ch).toHaveValue(null);
    // A price for a market the shop no longer has stays visible rather than vanishing.
    expect(screen.getByLabelText('price_by_market — old — not a market of this shop')).toHaveValue(5);

    fireEvent.change(ch, { target: { value: '21.5' } });
    fireEvent.change(screen.getByLabelText('price_by_market — old — not a market of this shop'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalled());
    expect(putEntry.mock.calls[0]![1].values).toEqual({ price_by_market: { eu: 19.9, ch: 21.5 } });
  });

  it('a shop without markets says where to add them', async () => {
    getSettings.mockResolvedValue({ item: { identity: {}, settings: { defaultLocale: 'en', locales: ['en'] }, website: {} } });
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={{ ...entry, values: {} }} onSaved={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/This shop has no markets yet/)).toBeInTheDocument();
  });
});

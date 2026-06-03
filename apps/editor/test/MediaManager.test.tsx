import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { StockProviderName } from '@sitewright/schema';

const listMedia = vi.fn();
const stockProviders = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    listMedia: () => listMedia(),
    uploadMedia: vi.fn(),
    deleteMedia: vi.fn(),
    stockProviders: () => stockProviders(),
    searchStock: vi.fn(),
    importStock: vi.fn(),
  },
}));

import { MediaManager } from '../src/views/MediaManager';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

beforeEach(() => {
  listMedia.mockReset();
  stockProviders.mockReset();
  listMedia.mockResolvedValue({ items: [] });
  stockProviders.mockResolvedValue({
    providers: [{ name: 'openverse' as StockProviderName, available: true, requiresKey: false }],
  });
});

describe('MediaManager', () => {
  it('shows the upload surface and no stock modal by default', async () => {
    render(<MediaManager project={project} />);
    expect(screen.getByLabelText('Upload image')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(listMedia).toHaveBeenCalled());
  });

  it('opens the stock-image search in a modal, and closes it', async () => {
    render(<MediaManager project={project} />);

    fireEvent.click(screen.getByRole('button', { name: 'Search stock images' }));
    const dialog = await screen.findByRole('dialog', { name: 'Search stock images' });
    expect(dialog).toBeInTheDocument();
    // The picker mounts inside the modal (it loads providers on mount).
    await waitFor(() => expect(stockProviders).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

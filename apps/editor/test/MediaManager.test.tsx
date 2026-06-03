import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { StockProviderName, MediaAsset } from '@sitewright/schema';

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

const image: MediaAsset = {
  kind: 'image',
  id: 'img1',
  filename: 'hero.png',
  folder: '',
  bytes: 2048,
  format: 'image/png',
  width: 100,
  height: 100,
  variants: [],
  fallback: 'hero-100.jpg',
  url: '/media/p/img1/hero-100.jpg',
};
const file: MediaAsset = {
  kind: 'file',
  id: 'file1',
  filename: 'brochure.pdf',
  folder: '',
  bytes: 1048576,
  contentType: 'application/pdf',
  storedName: 'brochure.pdf',
  url: '/media/p/file1/file/brochure.pdf',
};
const nested: MediaAsset = { ...file, id: 'file2', filename: 'q4.pdf', folder: 'Docs', storedName: 'q4.pdf', url: '/media/p/file2/file/q4.pdf' };

beforeEach(() => {
  listMedia.mockReset();
  stockProviders.mockReset();
  listMedia.mockResolvedValue({ items: [image, file, nested] });
  stockProviders.mockResolvedValue({
    providers: [{ name: 'openverse' as StockProviderName, available: true, requiresKey: false }],
  });
});

describe('MediaManager (Assets)', () => {
  it('shows the multi-file upload surface and renders root assets with size + preview links', async () => {
    render(<MediaManager project={project} />);
    expect(screen.getByLabelText('Upload files')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload files')).toHaveAttribute('multiple');

    // Image (thumbnail) + file (download link) both appear at root, with sizes.
    const imgLink = await screen.findByRole('link', { name: 'hero.png' });
    expect(imgLink).toHaveAttribute('href', '/media/p/img1/hero-100.jpg');
    const fileLink = screen.getByRole('link', { name: 'brochure.pdf' });
    expect(fileLink).toHaveAttribute('href', '/media/p/file1/file/brochure.pdf');
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();

    // The nested asset is NOT shown at root, but its folder is.
    expect(screen.queryByRole('link', { name: 'q4.pdf' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Docs' })).toBeInTheDocument();
  });

  it('navigates into a folder and back via the breadcrumb', async () => {
    render(<MediaManager project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }));
    // Inside Docs: the nested file shows, root files do not.
    expect(await screen.findByRole('link', { name: 'q4.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'brochure.pdf' })).toBeNull();
    // Breadcrumb back to root.
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(await screen.findByRole('link', { name: 'brochure.pdf' })).toBeInTheDocument();
  });

  it('toggles grid and list views', async () => {
    render(<MediaManager project={project} />);
    await screen.findByRole('link', { name: 'hero.png' });
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    // List view renders a table with a Size column header.
    expect(screen.getByRole('columnheader', { name: 'Size' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('application/pdf')).toBeInTheDocument();
  });

  it('creates a virtual folder and switches into it', async () => {
    render(<MediaManager project={project} />);
    await screen.findByRole('link', { name: 'hero.png' });
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'Brand' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Folder' }));
    // Now inside Brand (breadcrumb shows it) and it is empty.
    await waitFor(() => expect(screen.getByText('This folder is empty.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Brand' })).toBeInTheDocument();
  });

  it('opens the stock-image search in a modal', async () => {
    render(<MediaManager project={project} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search stock images' }));
    expect(await screen.findByRole('dialog', { name: 'Search stock images' })).toBeInTheDocument();
    await waitFor(() => expect(stockProviders).toHaveBeenCalled());
  });
});

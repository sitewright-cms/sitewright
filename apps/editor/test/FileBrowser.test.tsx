import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { StockProviderName, MediaAsset, MediaFolderRecord } from '@sitewright/schema';

const listMedia = vi.fn();
const listMediaFolders = vi.fn();
const stockProviders = vi.fn();
const createMediaFolder = vi.fn();
const renameMediaFolder = vi.fn();
const copyMediaFolder = vi.fn();
const deleteMediaFolder = vi.fn();
const patchMedia = vi.fn();
const copyMedia = vi.fn();
const deleteMedia = vi.fn();

vi.mock('../src/api', () => ({
  api: {
    listMedia: () => listMedia(),
    listMediaFolders: () => listMediaFolders(),
    uploadMedia: vi.fn(),
    deleteMedia: (...a: unknown[]) => deleteMedia(...a),
    patchMedia: (...a: unknown[]) => patchMedia(...a),
    copyMedia: (...a: unknown[]) => copyMedia(...a),
    createMediaFolder: (...a: unknown[]) => createMediaFolder(...a),
    renameMediaFolder: (...a: unknown[]) => renameMediaFolder(...a),
    copyMediaFolder: (...a: unknown[]) => copyMediaFolder(...a),
    deleteMediaFolder: (...a: unknown[]) => deleteMediaFolder(...a),
    stockProviders: () => stockProviders(),
    searchStock: vi.fn(),
    importStock: vi.fn(),
  },
}));

import { FileBrowser } from '../src/views/files/FileBrowser';

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
const emptyFolder: MediaFolderRecord = { id: 'fr1', path: 'Empty' };

beforeEach(() => {
  vi.clearAllMocks();
  listMedia.mockResolvedValue({ items: [image, file, nested] });
  listMediaFolders.mockResolvedValue({ items: [emptyFolder] });
  stockProviders.mockResolvedValue({ providers: [{ name: 'openverse' as StockProviderName, available: true, requiresKey: false }] });
  createMediaFolder.mockResolvedValue({ ok: true });
  renameMediaFolder.mockResolvedValue({ ok: true });
  copyMediaFolder.mockResolvedValue({ ok: true });
  deleteMediaFolder.mockResolvedValue(undefined);
  patchMedia.mockResolvedValue({ item: image });
  copyMedia.mockResolvedValue({ item: image });
  deleteMedia.mockResolvedValue(undefined);
});

describe('FileBrowser (Assets)', () => {
  it('defaults to LIST view and shows assets + folders (incl. a persisted empty folder)', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    expect(screen.getByLabelText('Upload files')).toHaveAttribute('multiple');
    // List view is the default → a table with a Size column.
    expect(await screen.findByRole('columnheader', { name: 'Size' })).toBeInTheDocument();
    // Await the asset row itself: the table shell (and its 'Size' header) can render before
    // the async asset load resolves, so don't assume the rows are present yet.
    expect(await screen.findByRole('button', { name: 'hero.png' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('application/pdf')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    // The empty folder record persists into the list (the bug fix).
    expect(screen.getByRole('button', { name: 'Empty' })).toBeInTheDocument();
    // The nested asset is filed away under Docs (a folder), not shown at root.
    expect(screen.queryByRole('button', { name: 'q4.pdf' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Docs' })).toBeInTheDocument();
  });

  it('navigates into a folder and back via the breadcrumb', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }));
    expect(await screen.findByRole('button', { name: 'q4.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'brochure.pdf' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(await screen.findByRole('button', { name: 'brochure.pdf' })).toBeInTheDocument();
  });

  it('persists a new folder via the API (not just local state)', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'Brand' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Folder' }));
    await waitFor(() => expect(createMediaFolder).toHaveBeenCalledWith('p', 'Brand'));
  });

  it('renames a file through the prompt dialog → patchMedia', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename brochure.pdf' }));
    // The prompt dialog appears, pre-filled; change + save.
    const field = await screen.findByLabelText('Display name');
    fireEvent.change(field, { target: { value: 'flyer.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchMedia).toHaveBeenCalledWith('p', 'file1', { filename: 'flyer.pdf' }));
  });

  it('copies a file → copyMedia into the current folder', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy brochure.pdf' }));
    await waitFor(() => expect(copyMedia).toHaveBeenCalledWith('p', 'file1', ''));
  });

  it('deletes a file only after the confirm dialog', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete brochure.pdf' }));
    expect(deleteMedia).not.toHaveBeenCalled(); // not until confirmed
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteMedia).toHaveBeenCalledWith('p', 'file1'));
  });

  it('deletes a folder recursively, warning how many items are inside', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Docs' }));
    // The confirm dialog states the cascade (1 file under Docs).
    expect(await screen.findByText(/permanently deletes 1 file/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    await waitFor(() => expect(deleteMediaFolder).toHaveBeenCalledWith('p', 'Docs'));
  });

  it('opens an image in an IN-APP preview modal (not a new tab)', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'hero.png' }));
    const dialog = await screen.findByRole('dialog', { name: 'hero.png' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/media/p/img1/hero-100.jpg');
  });

  it('opens the stock-image search in a modal scoped to the current folder', async () => {
    render(<FileBrowser project={project} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Search stock images' }));
    expect(await screen.findByRole('dialog', { name: /Search stock images/ })).toBeInTheDocument();
    await waitFor(() => expect(stockProviders).toHaveBeenCalled());
  });
});

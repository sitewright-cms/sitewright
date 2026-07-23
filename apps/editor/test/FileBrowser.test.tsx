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
  format: 'png',
  width: 100,
  height: 100,
  hasAlpha: false,
  animated: false,
  original: 'hero.png',
  url: '/media/p/img1/hero.png',
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
    render(<FileBrowser projectId={project.id} mode="manage" />);
    expect(screen.getByLabelText('Upload files')).toHaveAttribute('multiple');
    // List view is the default → a table with a Size column.
    expect(await screen.findByRole('columnheader', { name: 'Size' })).toBeInTheDocument();
    // Await the asset row itself: the table shell (and its 'Size' header) can render before
    // the async asset load resolves, so don't assume the rows are present yet.
    expect(await screen.findByRole('button', { name: 'hero.png' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('application/pdf')).toBeInTheDocument();
    // brochure.pdf (1 MB) AND the Docs folder (its 1 MB q4.pdf) both show a size now.
    expect(screen.getAllByText('1.0 MB')).toHaveLength(2);
    // The empty folder record persists into the list (the bug fix).
    expect(screen.getByRole('button', { name: 'Empty' })).toBeInTheDocument();
    // The nested asset is filed away under Docs (a folder), not shown at root.
    expect(screen.queryByRole('button', { name: 'q4.pdf' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Docs' })).toBeInTheDocument();
  });

  it('navigates into a folder and back via the breadcrumb', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }));
    expect(await screen.findByRole('button', { name: 'q4.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'brochure.pdf' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    expect(await screen.findByRole('button', { name: 'brochure.pdf' })).toBeInTheDocument();
  });

  it('creates a new folder through the modal → createMediaFolder', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    fireEvent.click(screen.getByRole('button', { name: '+ New folder' }));
    const field = await screen.findByLabelText('Folder name'); // the modal prompt
    fireEvent.change(field, { target: { value: 'Brand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMediaFolder).toHaveBeenCalledWith('p', 'Brand'));
  });

  it('indicates folder sizes (the recursive total of the assets inside)', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    const docsRow = (await screen.findByRole('button', { name: 'Docs' })).closest('tr')!;
    expect(within(docsRow).getByText('1.0 MB')).toBeInTheDocument(); // q4.pdf lives under Docs
    const emptyRow = screen.getByRole('button', { name: 'Empty' }).closest('tr')!;
    expect(within(emptyRow).getByText('0 B')).toBeInTheDocument();
  });

  it('sorts by Size when its column header is clicked (default is name-ascending)', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    const before = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Default name-ascending: brochure.pdf precedes hero.png.
    const hero = await screen.findByRole('button', { name: 'hero.png' });
    expect(before(screen.getByRole('button', { name: 'brochure.pdf' }), hero)).toBe(true);
    // Sort by size ascending: the 2 KB image now precedes the 1 MB pdf.
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    expect(before(screen.getByRole('button', { name: 'hero.png' }), screen.getByRole('button', { name: 'brochure.pdf' }))).toBe(true);
  });

  it('searches files and folders by name (a result carries its folder location)', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    fireEvent.change(screen.getByLabelText('Search assets by name'), { target: { value: 'hero' } });
    // The name-cell button now reads "<filename> in <folder>" (the location subtitle).
    expect(screen.getByRole('button', { name: 'hero.png in Assets' })).toBeInTheDocument();
    expect(screen.queryByText('brochure.pdf')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Docs' })).toBeNull(); // folders are filtered too
  });

  it('search is GLOBAL: surfaces a file from another folder at the root, showing where it lives', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    // q4.pdf lives in Docs; at the root it is NOT listed until a global search surfaces it.
    expect(screen.queryByText('q4.pdf')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search assets by name'), { target: { value: 'q4' } });
    expect(await screen.findByRole('button', { name: 'q4.pdf in Docs' })).toBeInTheDocument();
    expect(screen.getByText('in Docs')).toBeInTheDocument(); // the result shows its folder location
  });

  it('clears the search when navigating into a folder (no silent stale filter)', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    // Search for something that only matches a folder, then open it.
    fireEvent.change(screen.getByLabelText('Search assets by name'), { target: { value: 'Docs' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Docs' }));
    // Inside Docs: q4.pdf (which would NOT match the old "Docs" query) is visible → search was reset.
    expect(await screen.findByRole('button', { name: 'q4.pdf' })).toBeInTheDocument();
    expect((screen.getByLabelText('Search assets by name') as HTMLInputElement).value).toBe('');
  });

  it('downloads an asset via a blob fetch (forces the download dialog, never a new tab)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download brochure.pdf' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/p/file1/file/brochure.pdf'));
    vi.unstubAllGlobals();
  });

  it('renames a file through the prompt dialog → patchMedia', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename brochure.pdf' }));
    // The prompt dialog appears, pre-filled; change + save.
    const field = await screen.findByLabelText('Display name');
    fireEvent.change(field, { target: { value: 'flyer.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchMedia).toHaveBeenCalledWith('p', 'file1', { filename: 'flyer.pdf' }));
  });

  it('copies a file URL to the clipboard (one click, replaces the old duplicate action)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FileBrowser projectId={project.id} mode="manage" />);
    // The old "Copy" (duplicate) action is gone; the new one copies the URL.
    expect(screen.queryByRole('button', { name: 'Copy brochure.pdf' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy URL of brochure.pdf' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/media/p/file1/file/brochure.pdf'));
    expect(copyMedia).not.toHaveBeenCalled(); // no server-side duplicate
  });

  it('offers copyable embed URLs (default + original + sizes) in the image preview', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'hero.png' }));
    const dialog = await screen.findByRole('dialog', { name: 'hero.png' });
    expect(within(dialog).getByText('Embed URLs')).toBeInTheDocument();
    // The Original chip copies the raw-source URL.
    fireEvent.click(within(dialog).getByTitle('Copy /media/p/img1/hero.png?size=original'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/media/p/img1/hero.png?size=original'));
  });

  it('the rename dialog explains the name is the alt text (image) and shows the filename helper', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename hero.png' }));
    await screen.findByLabelText('Display name');
    expect(screen.getByText('alt text')).toBeInTheDocument();
    expect(screen.getByText('{{sw-image}}')).toBeInTheDocument();
    expect(screen.getByText('{{this.filename}}')).toBeInTheDocument();
  });

  it('deletes a file only after the confirm dialog', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete brochure.pdf' }));
    expect(deleteMedia).not.toHaveBeenCalled(); // not until confirmed
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteMedia).toHaveBeenCalledWith('p', 'file1'));
  });

  it('deletes a folder recursively, warning how many items are inside', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Docs' }));
    // The confirm dialog states the cascade (1 file under Docs) and that it's recoverable.
    expect(await screen.findByText(/moves 1 file.*to the Recycle Bin/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    await waitFor(() => expect(deleteMediaFolder).toHaveBeenCalledWith('p', 'Docs'));
  });

  it('opens an image in an IN-APP preview modal (not a new tab)', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'hero.png' }));
    const dialog = await screen.findByRole('dialog', { name: 'hero.png' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/media/p/img1/hero.png');
  });

  it('opens the stock-image search in a modal scoped to the current folder', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Search stock images' }));
    expect(await screen.findByRole('dialog', { name: /Search stock images/ })).toBeInTheDocument();
    await waitFor(() => expect(stockProviders).toHaveBeenCalled());
  });
});

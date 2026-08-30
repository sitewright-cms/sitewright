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
const replaceMediaContent = vi.fn();
const uploadMedia = vi.fn();

vi.mock('../src/api', () => ({
  api: {
    listMedia: () => listMedia(),
    listMediaFolders: () => listMediaFolders(),
    uploadMedia: (...a: unknown[]) => uploadMedia(...a),
    deleteMedia: (...a: unknown[]) => deleteMedia(...a),
    replaceMediaContent: (...a: unknown[]) => replaceMediaContent(...a),
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
  uploadMedia.mockResolvedValue(undefined);
  replaceMediaContent.mockResolvedValue({ item: image, previous: { bytes: 2048, width: 100, height: 100 }, snapshotId: 'snap1' });
});

describe('FileBrowser (Assets)', () => {
  it('defaults to LIST view and shows assets + folders (incl. a persisted empty folder)', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    expect(screen.getByLabelText('Upload files')).toHaveAttribute('multiple');
    // …but the native control is hidden: the visible affordance is the branded button.
    expect(screen.getByLabelText('Upload files')).toHaveClass('hidden');
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeInTheDocument();
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
    // The Original chip copies the raw-source URL (the hint moved into a DaisyUI tooltip; the
    // accessible name carries the variant + URL).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy Original URL: /media/p/img1/hero.png?size=original' }));
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

// ── Scale: a DHPS-sized media library ────────────────────────────────────────────────────────────
// Measured on a deployed instance with 3,000 assets in one folder: 75,686 DOM nodes and 3,000 <img>
// elements, a 78MB JS heap, ~334ms per search keystroke. The API side was never the problem
// (0.84MB in 42ms) — the browser was.

const many = (n: number): MediaAsset[] =>
  Array.from({ length: n }, (_, i) => ({
    ...image,
    id: `m${i}`,
    filename: `photo-${String(i).padStart(4, '0')}.png`,
    url: `/media/p/m${i}/photo-${String(i).padStart(4, '0')}.png`,
  }));

/**
 * jsdom does no layout, so every measured height is 0 and the virtualiser takes its deliberate
 * render-everything fallback. Stub a realistic list geometry, or a test that claims to prove windowing
 * proves only that the fallback works — the exact silent-no-op this feature shipped once already.
 */
const ROW_H = 44;
function stubListGeometry(): void {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
  // O(1): walk backwards over previous siblings rather than materialising the whole child list for
  // every read. jsdom's own getter is a no-op, so the cost of the STUB is what would dominate.
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute('data-virtual-row')) return 0;
    let idx = 0;
    for (let prev = this.previousElementSibling; prev; prev = prev.previousElementSibling) {
      if (prev.hasAttribute('data-virtual-row')) idx += 1;
    }
    return idx * ROW_H;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW_H);
}

describe('FileBrowser at media-library scale', () => {
  it('★ asks for the SMALLEST thumbnail rung, not the 2400px original', async () => {
    // A bare media URL serves the `xl` (2400px) variant by default — the file manager was painting a
    // 32px list icon from it. Measured on a photo-like source: sm 36KB vs xl 2,120KB. The LIST now
    // asks for `xs` (150px), which still covers the 4x hover zoom on a 32px box; the GRID tile keeps
    // `sm` because it paints at 96px and the zoom takes it to ~384px.
    render(<FileBrowser projectId={project.id} mode="manage" />);
    const img = await screen.findByRole('img', { name: '' }).catch(() => null);
    const el = img ?? document.querySelector('img');
    expect(el, 'the list row renders a thumbnail').toBeTruthy();
    expect((el as HTMLImageElement).getAttribute('src')).toBe(`${image.url}?size=xs`);
  });

  it('★ renders only a WINDOW of a long list, not every row', async () => {
    stubListGeometry();
    listMedia.mockResolvedValue({ items: many(300) });
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByText('photo-0000.png');
    const rows = document.querySelectorAll('tr[data-virtual-row]');
    expect(rows.length, 'a windowed list must not mount all 300 rows').toBeLessThan(300);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('keeps a SHORT list on exactly the code path it had before', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByText('hero.png');
    // 3 assets: no spacers, nothing skipped.
    expect(document.querySelectorAll('[data-virtual-spacer]').length).toBe(0);
    expect(screen.getByText('brochure.pdf')).toBeInTheDocument();
  });

  it('★ reserves the skipped height, so the scrollbar still spans the whole library', async () => {
    stubListGeometry();
    listMedia.mockResolvedValue({ items: many(300) });
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByText('photo-0000.png');
    const spacers = [...document.querySelectorAll('[data-virtual-spacer]')];
    expect(spacers.length, 'the skipped rows must still occupy their height').toBeGreaterThan(0);
    // ★ A <tr>, never a <div>: anything else inside <tbody> is invalid HTML and the browser hoists it
    // out of the table, silently losing the reserved height.
    for (const el of spacers) expect(el.tagName).toBe('TR');
    // The list spacer carries its height on the <td> (a <tr> cannot be sized directly); the grid one
    // carries it on the element itself. Read whichever actually has it.
    const heightOf = (el: Element): number => {
      const own = Number.parseInt((el as HTMLElement).style.height || '0', 10);
      if (own > 0) return own;
      const cell = el.firstElementChild as HTMLElement | null;
      return Number.parseInt(cell?.style.height || '0', 10);
    };
    const reserved = spacers.reduce((n, el) => n + heightOf(el), 0);
    expect(reserved, '300 rows at 44px is ~13,200px of list').toBeGreaterThan(8_000);
  });
});

// ── REGRESSION: the SPA went blank on the way back out of a folder ───────────────────────────────
//
// Reported from a real project: open the File Manager, enter a folder, click the "Assets" crumb to go
// back — blank page, React error #185 ("Maximum update depth exceeded"). The folder held enough assets
// to virtualise (>80 rows) and the root holds only a handful, so the click flips the virtualiser from
// active to inactive in the same commit that changes the row count. This drives exactly those steps.
describe('navigating back to the Assets root', () => {
  /** One folder with enough rows to virtualise, and almost nothing at the root. */
  function bigLibrary(): MediaAsset[] {
    const many = Array.from({ length: 400 }, (_, i) => ({
      ...image,
      id: `deep${i}`,
      filename: `photo-${String(i).padStart(3, '0')}.png`,
      folder: 'gallery',
      url: `/media/p/deep${i}/photo-${i}.png`,
    }));
    return [{ ...image, id: 'root1', filename: 'crest.png', folder: '' }, ...many];
  }

  beforeEach(() => {
    listMedia.mockResolvedValue({ items: bigLibrary() });
    listMediaFolders.mockResolvedValue({ items: [] as MediaFolderRecord[] });
    stockProviders.mockResolvedValue({ providers: [] as StockProviderName[] });
  });

  it('goes in and back out again without crashing', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByText('gallery');

    fireEvent.click(screen.getByText('gallery'));
    await waitFor(() => expect(screen.getByText(/photo-000/)).toBeTruthy());

    // Back to the root via the crumb — the step that went blank.
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    await waitFor(() => expect(screen.getByText('gallery')).toBeTruthy());
    expect(screen.getByText('crest.png')).toBeTruthy();
  });
});

/**
 * "Replace file" swaps the bytes BEHIND an asset, keeping its id and URL. It is deliberately a
 * different thing from the page editor's "Replace image" picker, which repoints one `<img>` at a
 * different asset — hence the distinct label, and hence the aspect-ratio warning: nothing else tells
 * the author that every page using this asset is about to reflow.
 */
describe('FileBrowser — replace a file in place', () => {
  it('sends the picked file to replaceMediaContent, filtered to the asset’s own extension', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });

    fireEvent.click(screen.getByRole('button', { name: 'Replace hero.png' }));
    const input = screen.getByLabelText('Replace file') as HTMLInputElement;
    // The server refuses a format change, so the picker never offers one.
    await waitFor(() => expect(input).toHaveAttribute('accept', '.png'));

    const png = new File([new Uint8Array([1, 2, 3])], 'new-hero.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [png], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(replaceMediaContent).toHaveBeenCalledWith('p', 'img1', png));
  });

  it('warns when the replacement has a different aspect ratio', async () => {
    uploadMedia.mockResolvedValue(undefined);
  replaceMediaContent.mockResolvedValue({
      item: { ...image, width: 100, height: 300 },
      previous: { bytes: 2048, width: 100, height: 100 },
      snapshotId: 'snap1',
    });
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });

    fireEvent.click(screen.getByRole('button', { name: 'Replace hero.png' }));
    const input = screen.getByLabelText('Replace file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([1])], 'tall.png', { type: 'image/png' })],
      configurable: true,
    });
    fireEvent.change(input);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('100×300');
    expect(note).toHaveTextContent('reflow');
  });

  it('surfaces the server’s refusal instead of failing silently', async () => {
    replaceMediaContent.mockRejectedValue(new Error('a replacement must keep the .png extension (got .jpg)'));
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });

    fireEvent.click(screen.getByRole('button', { name: 'Replace hero.png' }));
    const input = screen.getByLabelText('Replace file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([1])], 'wrong.jpg', { type: 'image/jpeg' })],
      configurable: true,
    });
    fireEvent.change(input);

    expect(await screen.findByText(/must keep the \.png extension/)).toBeInTheDocument();
  });

  it('offers no Replace action for a FONT — a family is many files', async () => {
    const font = {
      kind: 'font' as const,
      id: 'f1',
      filename: 'Inter',
      folder: '',
      bytes: 1000,
      family: 'Inter',
      fallback: 'sans-serif' as const,
      source: { kind: 'upload' as const },
      files: [{ file: 'inter-400.woff2', weight: 400, style: 'normal' as const, format: 'woff2' as const }],
      url: '/media/p/f1/inter-400.woff2',
    } as unknown as MediaAsset;
    listMedia.mockResolvedValue({ items: [font] });
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'Inter' });
    expect(screen.queryByRole('button', { name: 'Replace Inter' })).toBeNull();
  });
});

/**
 * File Manager toolbar + drop-zone UX.
 *
 * The native `<input type=file>` cannot be styled — its browser-drawn "Choose files" control was the
 * one piece of unbranded chrome in the manager. It stays in the DOM (hidden) so it remains the
 * accessible control and still what a test drives; a branded button forwards the click.
 */
describe('FileBrowser — upload affordance and drop zone', () => {
  it('hides the native input behind a branded button that forwards the click', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });

    const input = screen.getByLabelText('Upload files') as HTMLInputElement;
    expect(input).toHaveClass('hidden');

    const btn = screen.getByRole('button', { name: 'Upload files' });
    // The platform's primary styling: brand gradient + the waves ripple.
    expect(btn.className).toContain('sw-brand-gradient');
    expect(btn.className).toContain('waves-effect');

    const clicked = vi.fn();
    input.addEventListener('click', clicked);
    fireEvent.click(btn);
    expect(clicked).toHaveBeenCalled();
  });

  it('puts Upload / Search stock / Search unused on one row', async () => {
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    const upload = screen.getByRole('button', { name: 'Upload files' });
    const stock = screen.getByRole('button', { name: 'Search stock images' });
    const unused = screen.getByRole('button', { name: 'Search for unused files' });
    // Same flex row ⇒ same parent element.
    expect(stock.parentElement).toBe(upload.parentElement);
    expect(unused.parentElement).toBe(upload.parentElement);
    expect(upload.parentElement?.className).toContain('flex');
  });

  it('outlines the whole manager while FILES are dragged over it, and clears on drop', async () => {
    const { container } = render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    const pane = container.firstElementChild as HTMLElement;
    expect(pane.getAttribute('data-file-drag')).toBeNull();

    fireEvent.dragEnter(pane, { dataTransfer: { types: ['Files'], files: [] } });
    expect(pane.getAttribute('data-file-drag')).toBe('over');
    expect(pane.className).toContain('outline-dashed');

    fireEvent.drop(pane, { dataTransfer: { types: ['Files'], files: [] } });
    expect(pane.getAttribute('data-file-drag')).toBeNull();
  });

  it('does NOT outline the pane for an internal asset move (that has its own row highlight)', async () => {
    const { container } = render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });
    const pane = container.firstElementChild as HTMLElement;
    // An internal drag carries no 'Files' type — outlining the whole pane would wrongly say
    // "drop anywhere", when a move needs a specific target folder.
    fireEvent.dragEnter(pane, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(pane.getAttribute('data-file-drag')).toBeNull();
  });

  it('keeps the outline while the pointer crosses child rows (enter/leave depth)', async () => {
    const { container } = render(<FileBrowser projectId={project.id} mode="manage" />);
    const row = await screen.findByRole('button', { name: 'hero.png' });
    const pane = container.firstElementChild as HTMLElement;
    const dt = { types: ['Files'], files: [] };

    fireEvent.dragEnter(pane, { dataTransfer: dt });
    fireEvent.dragEnter(row, { dataTransfer: dt }); // moving onto a descendant…
    fireEvent.dragLeave(pane, { dataTransfer: dt }); // …fires leave for the ancestor
    // Naive boolean tracking would drop the outline here, mid-drag.
    expect(pane.getAttribute('data-file-drag')).toBe('over');

    fireEvent.dragLeave(row, { dataTransfer: dt });
    expect(pane.getAttribute('data-file-drag')).toBeNull();
  });
});

/**
 * Upload progress. A batch can take minutes (uploadBatch waits out 429s), and the previous signal was
 * one line of small print that scrolled away. The modal auto-closes on success so a clean run costs no
 * click, and is held open ONLY on failure — the one case with something to read.
 */
describe('FileBrowser — upload progress modal', () => {
  const pick = (name = 'a.png') =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

  function drop(files: File[]) {
    const input = screen.getByLabelText('Upload files') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fireEvent.change(input);
  }

  it('shows progress while uploading and auto-closes on success', async () => {
    let release!: () => void;
    uploadMedia.mockImplementation(() => new Promise<void>((res) => { release = () => res(); }));
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });

    drop([pick()]);
    expect(await screen.findByRole('dialog', { name: /Uploading files/i })).toBeInTheDocument();

    release();
    // Success ⇒ unmounted without any interaction.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Uploading files/i })).toBeNull());
  });

  it('stays open naming what failed, and closes on demand', async () => {
    uploadMedia.mockRejectedValue(new Error('nope')); // non-transient ⇒ no retry wait
    render(<FileBrowser projectId={project.id} mode="manage" />);
    await screen.findByRole('button', { name: 'hero.png' });

    drop([pick('broken.png')]);

    const dialog = await screen.findByRole('dialog', { name: /errors/i });
    expect(dialog).toHaveTextContent('broken.png'); // the NAME, not just a count
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /errors/i })).toBeNull());
  });
});

/**
 * Stepping through a folder from the preview.
 *
 * The sibling list is the SAME one the rows are built from, so it carries the active folder, the
 * search filter and the chosen sort — stepping in any other order would move through a sequence the
 * author cannot see.
 */
describe('FileBrowser — image preview navigation', () => {
  const img = (id: string, filename: string): MediaAsset => ({
    ...(image as MediaAsset & { kind: 'image' }),
    id,
    filename,
    original: filename,
    url: `/media/p/${id}/${filename}`,
  });

  const three = [img('i1', 'a.png'), img('i2', 'b.png'), img('i3', 'c.png')];

  async function openFirst(items: MediaAsset[] = three) {
    listMedia.mockResolvedValue({ items });
    render(<FileBrowser projectId={project.id} mode="manage" />);
    fireEvent.click(await screen.findByRole('button', { name: 'a.png' }));
    return screen.findByRole('dialog');
  }

  it('shows chevrons and a position counter, with prev disabled on the first image', async () => {
    const dialog = await openFirst();
    expect(within(dialog).getByRole('button', { name: 'Previous image' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Next image' })).toBeEnabled();
    expect(dialog).toHaveTextContent('1 of 3');
  });

  it('steps forward and back with the chevrons', async () => {
    const dialog = await openFirst();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('2 of 3');

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Previous image' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('1 of 3');
  });

  it('disables next on the last image (ends do not wrap — the counter says where you are)', async () => {
    const dialog = await openFirst();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next image' }));
    const last = screen.getByRole('dialog');
    expect(last).toHaveTextContent('3 of 3');
    expect(within(last).getByRole('button', { name: 'Next image' })).toBeDisabled();
  });

  it('navigates with the arrow keys wherever focus is', async () => {
    await openFirst();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByRole('dialog')).toHaveTextContent('2 of 3');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(await screen.findByRole('dialog')).toHaveTextContent('1 of 3');
  });

  it('ignores arrows aimed at a text field, and modified arrows', async () => {
    await openFirst();
    const typing = document.createElement('input');
    document.body.appendChild(typing);
    fireEvent.keyDown(typing, { key: 'ArrowRight' }); // caret movement, not navigation
    expect(screen.getByRole('dialog')).toHaveTextContent('1 of 3');
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true }); // a browser/OS shortcut
    expect(screen.getByRole('dialog')).toHaveTextContent('1 of 3');
    typing.remove();
  });

  it('steps past non-images: a PDF between two pictures is skipped', async () => {
    const dialog = await openFirst([three[0]!, file, three[1]!]);
    // The preview cannot render a PDF (clicking one downloads it), so it is not a stop on the way.
    expect(dialog).toHaveTextContent('1 of 2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('b.png');
  });

  it('offers no counter when the folder holds a single image', async () => {
    const dialog = await openFirst([three[0]!]);
    expect(dialog).not.toHaveTextContent('1 of 1');
    expect(within(dialog).getByRole('button', { name: 'Next image' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Previous image' })).toBeDisabled();
  });
});

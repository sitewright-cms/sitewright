import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UnusedFilesModal } from '../src/views/files/UnusedFilesModal';
import { ApiError } from '../src/api';

const unusedMedia = vi.fn();
const deleteMedia = vi.fn();
const deleteMediaBulk = vi.fn();
const confirmMock = vi.fn();

vi.mock('../src/api', async (orig) => {
  const actual = await orig<typeof import('../src/api')>();
  return {
    ...actual,
    api: {
      unusedMedia: (...a: unknown[]) => unusedMedia(...a),
      deleteMedia: (...a: unknown[]) => deleteMedia(...a),
      deleteMediaBulk: (...a: unknown[]) => deleteMediaBulk(...a),
    },
  };
});
vi.mock('../src/views/ui/Dialogs', () => ({
  useDialogs: () => ({ confirm: (...a: unknown[]) => confirmMock(...a), dialog: null }),
}));

const asset = (id: string, filename: string, over: Record<string, unknown> = {}) => ({
  id,
  filename,
  kind: 'image',
  // An image asset carries `format`; FileTypeIcon derives the extension from it rather than from the
  // display name, so a fixture without it renders nothing and fails for the wrong reason.
  format: 'png',
  url: `/media/site/${id}-${filename}`,
  bytes: 2048,
  ...over,
});

const scanned = { assets: 3, contentRows: 12, globalRows: 4, revisionRows: 30 };

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  deleteMedia.mockResolvedValue(undefined);
  deleteMediaBulk.mockImplementation(async (_p: string, ids: string[]) => ({ deleted: ids, failed: [], requested: ids.length }));
  unusedMedia.mockResolvedValue({ items: [asset('aaaaaa', 'one.png'), asset('bbbbbb', 'two.png')], scanned });
});

const props = { projectId: 'p1', onClose: vi.fn(), onChanged: vi.fn() };

describe('UnusedFilesModal', () => {
  it('lists what nothing refers to and pre-selects it all', async () => {
    render(<UnusedFilesModal {...props} />);
    expect(await screen.findByText('one.png')).toBeInTheDocument();
    expect((screen.getByLabelText('Select one.png') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Select two.png') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: /Move 2 to Recycle Bin/ })).toBeEnabled();
  });

  it('★ does NOT pre-select an asset that only version history refers to', async () => {
    // Deleting one breaks a RESTORE rather than a page. That is a different decision, and not one to
    // make on somebody's behalf under a "select all" they took on trust.
    unusedMedia.mockResolvedValue({
      items: [asset('aaaaaa', 'live.png'), asset('hhhhhh', 'historic.png', { onlyInHistory: true })],
      scanned,
    });
    render(<UnusedFilesModal {...props} />);
    await screen.findByText('historic.png');
    expect((screen.getByLabelText('Select live.png') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Select historic.png') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/in history/i)).toBeInTheDocument();
  });

  it('★ says what it searched, rather than asking to be trusted', async () => {
    // An author about to delete a page's worth of files deserves to see the scan's reach.
    render(<UnusedFilesModal {...props} />);
    expect(await screen.findByText(/12 content records/)).toBeInTheDocument();
    expect(screen.getByText(/30 versions of history/)).toBeInTheDocument();
  });

  it('deletes only the checked files, to the RECYCLE BIN', async () => {
    render(<UnusedFilesModal {...props} />);
    fireEvent.click(await screen.findByLabelText('Select two.png')); // deselect
    fireEvent.click(screen.getByRole('button', { name: /Move 1 to Recycle Bin/ }));
    await waitFor(() => expect(deleteMediaBulk).toHaveBeenCalledTimes(1));
    expect(deleteMediaBulk).toHaveBeenCalledWith('p1', ['aaaaaa']);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it('★ sends a large selection in batches of 200, not one request per file', async () => {
    // One DELETE per file shared the session's general budget of 200 requests a minute, so select-all
    // on a large library was refused with a 429 partway through.
    const many = Array.from({ length: 450 }, (_, i) => asset(`id${String(i).padStart(4, '0')}`, `f${String(i).padStart(4, '0')}.png`));
    unusedMedia.mockResolvedValue({ items: many, scanned });
    render(<UnusedFilesModal {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Move 450 to Recycle Bin/ }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(deleteMedia).not.toHaveBeenCalled();
    expect(deleteMediaBulk.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([200, 200, 50]);
    expect(deleteMediaBulk.mock.calls.flatMap((c) => c[1] as string[])).toEqual(many.map((m) => m.id));
  });

  it('★ a batch the server refuses outright counts all of its files, and the next batch still goes', async () => {
    const many = Array.from({ length: 250 }, (_, i) => asset(`id${String(i).padStart(4, '0')}`, `f${String(i).padStart(4, '0')}.png`));
    unusedMedia.mockResolvedValue({ items: many, scanned });
    deleteMediaBulk.mockRejectedValueOnce(new Error('429 rate limit exceeded'));
    render(<UnusedFilesModal {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Move 250 to Recycle Bin/ }));
    // The reason travels with the count, so the author can tell "wait a minute" from "sign in again".
    expect(await screen.findByText('200 files could not be deleted — 429 rate limit exceeded.')).toBeInTheDocument();
    expect(deleteMediaBulk).toHaveBeenCalledTimes(2);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('★ stops after a refusal about who is asking — every later batch would get the same answer', async () => {
    const many = Array.from({ length: 450 }, (_, i) => asset(`id${String(i).padStart(4, '0')}`, `f${String(i).padStart(4, '0')}.png`));
    unusedMedia.mockResolvedValue({ items: many, scanned });
    deleteMediaBulk.mockRejectedValueOnce(new ApiError(403, 'you do not have access to this project'));
    render(<UnusedFilesModal {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Move 450 to Recycle Bin/ }));
    expect(await screen.findByText('450 files could not be deleted — you do not have access to this project.')).toBeInTheDocument();
    expect(deleteMediaBulk).toHaveBeenCalledTimes(1);
  });

  it('warns in the confirm when the selection includes history-only files', async () => {
    unusedMedia.mockResolvedValue({ items: [asset('hhhhhh', 'historic.png', { onlyInHistory: true })], scanned });
    render(<UnusedFilesModal {...props} />);
    fireEvent.click(await screen.findByLabelText('Select historic.png')); // opt in deliberately
    fireEvent.click(screen.getByRole('button', { name: /Move 1 to Recycle Bin/ }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(String((confirmMock.mock.calls[0]![0] as { message: string }).message)).toMatch(/version history/i);
  });

  it('deletes nothing when the confirm is declined', async () => {
    confirmMock.mockResolvedValue(false);
    render(<UnusedFilesModal {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Move 2 to Recycle Bin/ }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteMediaBulk).not.toHaveBeenCalled();
  });

  it('★ reports a PARTIAL failure instead of claiming a clean sweep', async () => {
    deleteMediaBulk.mockResolvedValueOnce({ deleted: ['aaaaaa'], failed: [{ id: 'bbbbbb', error: 'media not found' }], requested: 2 });
    render(<UnusedFilesModal {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Move 2 to Recycle Bin/ }));
    expect(await screen.findByText(/1 file could not be deleted/)).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled(); // the modal stays open on the failure
  });

  it('select-all toggles both ways', async () => {
    render(<UnusedFilesModal {...props} />);
    const all = await screen.findByLabelText('Select all');
    fireEvent.click(all); // everything was selected → clears
    expect(screen.getByRole('button', { name: /Move 0 to Recycle Bin/ })).toBeDisabled();
    fireEvent.click(all);
    expect(screen.getByRole('button', { name: /Move 2 to Recycle Bin/ })).toBeEnabled();
  });

  it('says so plainly when nothing is unused', async () => {
    unusedMedia.mockResolvedValue({ items: [], scanned });
    render(<UnusedFilesModal {...props} />);
    expect(await screen.findByText(/Nothing unused/)).toBeInTheDocument();
  });

  it('surfaces a scan failure', async () => {
    unusedMedia.mockRejectedValue(new Error('403 forbidden'));
    render(<UnusedFilesModal {...props} />);
    expect(await screen.findByText('403 forbidden')).toBeInTheDocument();
  });
});

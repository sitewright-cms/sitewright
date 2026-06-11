import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Dataset, Entry } from '@sitewright/schema';
import type { Project } from '../src/api';

const { listDatasets, listEntries, putDataset, putEntry, deleteDataset, deleteEntry } = vi.hoisted(() => ({
  listDatasets: vi.fn<() => Promise<{ items: Dataset[] }>>(),
  listEntries: vi.fn<() => Promise<{ items: Entry[] }>>(),
  putDataset: vi.fn<(pid: string, d: Dataset) => Promise<unknown>>(),
  putEntry: vi.fn<(pid: string, e: Entry) => Promise<unknown>>(),
  deleteDataset: vi.fn<(pid: string, id: string) => Promise<unknown>>(),
  deleteEntry: vi.fn<(pid: string, id: string) => Promise<unknown>>(),
}));
vi.mock('../src/api', () => ({
  api: {
    listDatasets: () => listDatasets(),
    listEntries: () => listEntries(),
    putDataset: (pid: string, d: Dataset) => putDataset(pid, d),
    putEntry: (pid: string, e: Entry) => putEntry(pid, e),
    deleteDataset: (pid: string, id: string) => deleteDataset(pid, id),
    deleteEntry: (pid: string, id: string) => deleteEntry(pid, id),
  },
}));

import { DatasetManager } from '../src/views/DatasetManager';

const project = { id: 'p', name: 'P', slug: 'p', role: 'owner' } as Project;
const textField = { name: 'title', type: 'text', required: false, localized: false } as const;
// Deliberately NOT alphabetical, to prove the component sorts.
const datasets: Dataset[] = [
  { id: 'zeta', name: 'Zeta', slug: 'zeta', fields: [textField] },
  { id: 'alpha', name: 'Alpha', slug: 'alpha', fields: [textField] },
];
const entries: Entry[] = [
  { id: 'e1', dataset: 'alpha', status: 'draft', order: 0, values: { title: 'First post' } },
  { id: 'e2', dataset: 'alpha', status: 'published', order: 1, values: { title: 'Second post' } },
];

beforeEach(() => {
  for (const m of [listDatasets, listEntries, putDataset, putEntry, deleteDataset, deleteEntry]) m.mockReset();
  listDatasets.mockResolvedValue({ items: datasets });
  listEntries.mockResolvedValue({ items: entries });
  putDataset.mockResolvedValue({});
  putEntry.mockResolvedValue({});
});

async function renderAndSelectAlpha() {
  render(<DatasetManager project={project} />);
  fireEvent.click(await screen.findByText('Alpha'));
}

describe('DatasetManager', () => {
  it('lists datasets sorted alphabetically by name', async () => {
    render(<DatasetManager project={project} />);
    await screen.findByText('Alpha');
    const names = screen.getAllByText(/^(Alpha|Zeta)$/).map((n) => n.textContent);
    expect(names).toEqual(['Alpha', 'Zeta']);
  });

  it('keeps the schema editor collapsed by default; expanding reveals Save schema + Delete dataset', async () => {
    await renderAndSelectAlpha();
    // Collapsed: the schema body (Save schema / Delete dataset) is not rendered yet.
    expect(screen.queryByRole('button', { name: 'Save schema' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete dataset' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /schema/ }));
    expect(screen.getByRole('button', { name: 'Save schema' })).toBeInTheDocument();
    // Delete dataset now lives INSIDE the expanded schema editor.
    expect(screen.getByRole('button', { name: 'Delete dataset' })).toBeInTheDocument();
  });

  it('opens the entry editor when an entry row is clicked, with a Draft/Published switch', async () => {
    await renderAndSelectAlpha();
    fireEvent.click(await screen.findByText('First post'));
    expect(await screen.findByText('Edit First post')).toBeInTheDocument();
    const statusGroup = screen.getByRole('group', { name: 'Status' });
    expect(statusGroup).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'draft' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'published' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('duplicates a dataset under a "<slug>-copy" id, cloning its entries', async () => {
    render(<DatasetManager project={project} />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate dataset Alpha' }));
    await waitFor(() =>
      expect(putDataset).toHaveBeenCalledWith(
        'p',
        expect.objectContaining({ id: 'alpha-copy', name: 'Alpha copy', slug: 'alpha-copy' }),
      ),
    );
    // Both of Alpha's entries are cloned under the new slug.
    await waitFor(() =>
      expect(putEntry.mock.calls.filter(([, e]) => e.dataset === 'alpha-copy')).toHaveLength(2),
    );
  });

  async function openRename() {
    await renderAndSelectAlpha();
    fireEvent.click(screen.getByRole('button', { name: /schema/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename dataset' }));
    return within(screen.getByRole('dialog', { name: /Rename/ }));
  }

  it('renames a dataset NAME only — updates the row in place, no entry migration', async () => {
    const dlg = await openRename();
    fireEvent.change(dlg.getByLabelText('Dataset name'), { target: { value: 'Alpha Renamed' } });
    fireEvent.click(dlg.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(putDataset).toHaveBeenCalledWith(
        'p',
        expect.objectContaining({ id: 'alpha', slug: 'alpha', name: 'Alpha Renamed' }),
      ),
    );
    expect(putEntry).not.toHaveBeenCalled();
    expect(deleteDataset).not.toHaveBeenCalled();
  });

  it('migrates the SLUG: creates the new dataset, re-points entries (same ids), deletes the old', async () => {
    const dlg = await openRename();
    fireEvent.change(dlg.getByLabelText('Dataset slug'), { target: { value: 'articles' } });
    // The migration warning appears once the slug changes.
    expect(dlg.getByText(/re-points all/)).toBeInTheDocument();
    fireEvent.click(dlg.getByRole('button', { name: /^Save$/ }));

    await waitFor(() =>
      expect(putDataset).toHaveBeenCalledWith(
        'p',
        expect.objectContaining({ id: 'articles', slug: 'articles', name: 'Alpha' }),
      ),
    );
    await waitFor(() => {
      const repointed = putEntry.mock.calls.filter(([, e]) => e.dataset === 'articles');
      expect(repointed).toHaveLength(2);
      // Entry ids are PRESERVED across the migration (only the dataset segment changes).
      expect(repointed.map(([, e]) => e.id).sort()).toEqual(['e1', 'e2']);
    });
    await waitFor(() => expect(deleteDataset).toHaveBeenCalledWith('p', 'alpha'));
  });

  it('aborts the slug migration if an entry re-point fails — the old dataset is NOT deleted', async () => {
    const dlg = await openRename();
    putEntry.mockRejectedValueOnce(new Error('boom')); // one re-point fails
    fireEvent.change(dlg.getByLabelText('Dataset slug'), { target: { value: 'articles' } });
    fireEvent.click(dlg.getByRole('button', { name: /^Save$/ }));
    // The error surfaces in the modal and the old dataset row survives (no data loss).
    await waitFor(() => expect(dlg.getByText(/boom/)).toBeInTheDocument());
    expect(deleteDataset).not.toHaveBeenCalled();
  });
});

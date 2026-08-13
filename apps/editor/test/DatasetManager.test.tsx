import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Dataset, Entry } from '@sitewright/schema';
import type { Project } from '../src/api';

const { listDatasets, listEntries, putDataset, putEntry, deleteDataset, deleteEntry, renameDataset } = vi.hoisted(() => ({
  listDatasets: vi.fn<() => Promise<{ items: Dataset[] }>>(),
  listEntries: vi.fn<() => Promise<{ items: Entry[] }>>(),
  putDataset: vi.fn<(pid: string, d: Dataset) => Promise<unknown>>(),
  putEntry: vi.fn<(pid: string, e: Entry) => Promise<unknown>>(),
  deleteDataset: vi.fn<(pid: string, id: string) => Promise<unknown>>(),
  deleteEntry: vi.fn<(pid: string, id: string, dataset: string) => Promise<unknown>>(),
  renameDataset: vi.fn<(pid: string, id: string, slug: string, cascade: boolean) => Promise<unknown>>(),
}));
vi.mock('../src/api', () => ({
  api: {
    listDatasets: () => listDatasets(),
    listEntries: () => listEntries(),
    putDataset: (pid: string, d: Dataset) => putDataset(pid, d),
    putEntry: (pid: string, e: Entry) => putEntry(pid, e),
    deleteDataset: (pid: string, id: string) => deleteDataset(pid, id),
    deleteEntry: (pid: string, id: string, dataset: string) => deleteEntry(pid, id, dataset),
    renameDataset: (pid: string, id: string, slug: string, cascade: boolean) => renameDataset(pid, id, slug, cascade),
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
  for (const m of [listDatasets, listEntries, putDataset, putEntry, deleteDataset, deleteEntry, renameDataset]) m.mockReset();
  listDatasets.mockResolvedValue({ items: datasets });
  listEntries.mockResolvedValue({ items: entries });
  putDataset.mockResolvedValue({});
  putEntry.mockResolvedValue({});
  renameDataset.mockResolvedValue({ oldSlug: 'alpha', newSlug: 'articles', cascaded: true, entriesUpdated: 2, pagesUpdated: 0, templatesUpdated: 0, referencesUpdated: 0 });
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

  it('creates a NEW entry defaulting to published, with a short identifier-safe auto key', async () => {
    await renderAndSelectAlpha();
    fireEvent.click(screen.getByRole('button', { name: 'New entry' }));
    // The new-entry modal defaults the status switch to Published (not Draft).
    expect(await screen.findByRole('button', { name: 'published' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'draft' })).toHaveAttribute('aria-pressed', 'false');
    // Save the (empty, no required fields) new entry → its auto key is a short, hyphen-free, letter-led
    // identifier (valid as a bare {{item.<set>.<key>}} segment), and it persists as published.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    const saved = putEntry.mock.calls[0]![1];
    expect(saved.status).toBe('published');
    expect(saved.id).toMatch(/^[a-z][a-z0-9]{6}$/);
    expect(saved.dataset).toBe('alpha');
  });

  it('duplicates a dataset under a "<slug>_copy" id, cloning its entries', async () => {
    render(<DatasetManager project={project} />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate dataset Alpha' }));
    await waitFor(() =>
      expect(putDataset).toHaveBeenCalledWith(
        'p',
        // underscore, not hyphen — a dataset slug is a Handlebars identifier
        expect.objectContaining({ id: 'alpha_copy', name: 'Alpha copy', slug: 'alpha_copy' }),
      ),
    );
    // Both of Alpha's entries are cloned under the new slug.
    await waitFor(() =>
      expect(putEntry.mock.calls.filter(([, e]) => e.dataset === 'alpha_copy')).toHaveLength(2),
    );
  });

  it('reveals the "Enter Dataset Name" input from the header "New Dataset" button, then creates', async () => {
    render(<DatasetManager project={project} />);
    await screen.findByText('Alpha');
    // The name input is hidden until the header button is clicked (no persistent bottom form).
    expect(screen.queryByText('Enter Dataset Name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New dataset' }));
    await screen.findByText('Enter Dataset Name');
    fireEvent.change(screen.getByLabelText('Dataset name'), { target: { value: 'Posts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(putDataset).toHaveBeenCalledWith('p', expect.objectContaining({ id: 'posts', name: 'Posts', slug: 'posts', fields: [] })),
    );
    // the create input collapses again after a successful create
    await waitFor(() => expect(screen.queryByText('Enter Dataset Name')).toBeNull());
  });

  it('hides the create input again when Cancel is clicked', async () => {
    render(<DatasetManager project={project} />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'New dataset' }));
    await screen.findByText('Enter Dataset Name');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Enter Dataset Name')).toBeNull());
    expect(putDataset).not.toHaveBeenCalled();
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

  it('renames the SLUG with cascade via the server endpoint (id stays; no client migration)', async () => {
    const dlg = await openRename();
    fireEvent.change(dlg.getByLabelText('Dataset slug'), { target: { value: 'articles' } });
    // The slug change reveals the cascade choice (the header Save is hidden in favour of it).
    fireEvent.click(dlg.getByRole('button', { name: /Rename \+ update all references/ }));
    await waitFor(() => expect(renameDataset).toHaveBeenCalledWith('p', 'alpha', 'articles', true));
    // No client-side create/re-point/delete migration anymore.
    expect(putEntry).not.toHaveBeenCalled();
    expect(deleteDataset).not.toHaveBeenCalled();
  });

  it('offers a no-cascade "Rename only" choice (server handles it, cascade=false)', async () => {
    const dlg = await openRename();
    fireEvent.change(dlg.getByLabelText('Dataset slug'), { target: { value: 'articles' } });
    fireEvent.click(dlg.getByRole('button', { name: /Rename slug only/ }));
    await waitFor(() => expect(renameDataset).toHaveBeenCalledWith('p', 'alpha', 'articles', false));
  });

  it('rejects a slug with disallowed characters (allow-list: lowercase alphanumeric + underscores)', async () => {
    const dlg = await openRename();
    // a HYPHEN is now rejected too — a dataset slug is a Handlebars identifier (underscores only)
    fireEvent.change(dlg.getByLabelText('Dataset slug'), { target: { value: 'faq-passengers' } });
    expect(dlg.queryByRole('button', { name: /Rename \+ update all references/ })).not.toBeInTheDocument();
    expect(dlg.getByText(/only lowercase letters, numbers, and underscores/i)).toBeInTheDocument();
    expect(renameDataset).not.toHaveBeenCalled();
  });

  it('badges the FIRST text field as the entry title (reorder to change which one)', async () => {
    listDatasets.mockResolvedValue({
      items: [
        {
          id: 'art',
          name: 'Art',
          slug: 'art',
          fields: [
            { name: 'count', type: 'number', required: false, localized: false },
            { name: 'headline', type: 'text', required: false, localized: false },
            { name: 'subtitle', type: 'text', required: false, localized: false },
          ],
        },
      ],
    });
    listEntries.mockResolvedValue({ items: [] });
    render(<DatasetManager project={project} />);
    fireEvent.click(await screen.findByText('Art'));
    fireEvent.click(screen.getByRole('button', { name: /schema/ }));

    // The "title" badge sits on `headline` (the first text field), not on `count` (number) or the
    // second text field `subtitle`.
    const headlineRow = screen.getByText('headline').closest('li')!;
    expect(within(headlineRow).getByText('title')).toBeInTheDocument();
    expect(within(screen.getByText('count').closest('li')!).queryByText('title')).toBeNull();
    expect(within(screen.getByText('subtitle').closest('li')!).queryByText('title')).toBeNull();
  });
});

describe('DatasetManager — schema editor UX', () => {
  const openSchema = async () => {
    await renderAndSelectAlpha();
    fireEvent.click(screen.getByRole('button', { name: /schema/ }));
  };

  it('the add-field form is CLOSED until asked for, then submits from its own Add button', async () => {
    await openSchema();
    // Two empty inputs sitting under the schema read as part of it — an unnamed field the author has
    // half-filled in, which is exactly what they are not.
    expect(screen.queryByLabelText('New field name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add field/ }));
    fireEvent.change(screen.getByLabelText('New field name'), { target: { value: 'subtitle' } });
    fireEvent.change(screen.getByLabelText('New field type'), { target: { value: 'richtext' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

    expect(screen.queryByLabelText('New field name')).toBeNull(); // closes again
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }));
    await waitFor(() => expect(putDataset).toHaveBeenCalled());
    expect(putDataset.mock.calls[0]![1].fields.map((f) => f.name)).toEqual(['title', 'subtitle']);
  });

  it('offers the field types ALPHABETICALLY, with the structural pair last', async () => {
    await openSchema();
    fireEvent.click(screen.getByRole('button', { name: /Add field/ }));
    const opts = within(screen.getByLabelText('New field type'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    const values = opts.slice(0, -2);
    expect(values).toEqual([...values].sort()); // a curated order is one only its author can predict
    // list/object hold child fields rather than a value — a different kind of choice, so pinned last.
    expect(opts.slice(-2)).toEqual(['list', 'object']);
  });

  it('★ renaming a field MOVES the entries’ values — the name IS the key they are stored under', async () => {
    await openSchema();
    fireEvent.doubleClick(screen.getByTitle('title — double-click to rename'));
    fireEvent.change(screen.getByLabelText('Rename field title'), { target: { value: 'heading' } });
    fireEvent.keyDown(screen.getByLabelText('Rename field title'), { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }));
    await waitFor(() => expect(putDataset).toHaveBeenCalled());
    expect(putDataset.mock.calls[0]![1].fields[0]!.name).toBe('heading');

    // Without this the old content sits under the old key while the renamed field reads empty — the
    // data is not lost, but it is invisible, which is worse than an error.
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(2));
    const written = putEntry.mock.calls.map((c) => c[1]);
    expect(written.map((e) => e.values)).toEqual([{ heading: 'First post' }, { heading: 'Second post' }]);
    expect(JSON.stringify(written)).not.toContain('"title"');
  });

  it('a rename that does not survive to the save moves nothing', async () => {
    await openSchema();
    // Rename, then rename back: the chain resolves to a no-op rather than to two separate moves.
    fireEvent.doubleClick(screen.getByTitle('title — double-click to rename'));
    fireEvent.change(screen.getByLabelText('Rename field title'), { target: { value: 'heading' } });
    fireEvent.keyDown(screen.getByLabelText('Rename field title'), { key: 'Enter' });
    fireEvent.doubleClick(screen.getByTitle('heading — double-click to rename'));
    fireEvent.change(screen.getByLabelText('Rename field heading'), { target: { value: 'title' } });
    fireEvent.keyDown(screen.getByLabelText('Rename field heading'), { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }));
    await waitFor(() => expect(putDataset).toHaveBeenCalled());
    expect(putEntry).not.toHaveBeenCalled();
  });

  it('Escape abandons a rename, and a duplicate name is refused', async () => {
    await openSchema();
    fireEvent.doubleClick(screen.getByTitle('title — double-click to rename'));
    fireEvent.change(screen.getByLabelText('Rename field title'), { target: { value: 'heading' } });
    fireEvent.keyDown(screen.getByLabelText('Rename field title'), { key: 'Escape' });
    expect(screen.getByTitle('title — double-click to rename')).toBeInTheDocument();

    // …and a name already taken is rejected rather than silently merging two fields' values.
    fireEvent.click(screen.getByRole('button', { name: /Add field/ }));
    fireEvent.change(screen.getByLabelText('New field name'), { target: { value: 'body' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    fireEvent.doubleClick(screen.getByTitle('title — double-click to rename'));
    fireEvent.change(screen.getByLabelText('Rename field title'), { target: { value: 'body' } });
    fireEvent.keyDown(screen.getByLabelText('Rename field title'), { key: 'Enter' });
    expect(screen.getByText(/field "body" already exists/)).toBeInTheDocument();
    expect(screen.getByTitle('title — double-click to rename')).toBeInTheDocument();
  });
});

describe('DatasetManager — filtering entries', () => {
  it('filters on the title, the entry KEY, and any other text value', async () => {
    await renderAndSelectAlpha();
    await screen.findByText('First post');
    const filter = screen.getByLabelText('Filter entries');

    fireEvent.change(filter, { target: { value: 'second' } });
    expect(screen.queryByText('First post')).toBeNull();
    expect(screen.getByText('Second post')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    // The id is the {{item.<set>.<key>}} key, so it is often what an author has in hand.
    fireEvent.change(filter, { target: { value: 'e1' } });
    expect(screen.getByText('First post')).toBeInTheDocument();
    expect(screen.queryByText('Second post')).toBeNull();

    // An empty result says so, rather than looking like an empty dataset.
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(screen.getByText(/No entry matches/)).toBeInTheDocument();
    expect(screen.queryByText('No entries yet.')).toBeNull();
  });
});

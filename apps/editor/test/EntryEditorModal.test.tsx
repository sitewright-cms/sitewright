import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Dataset, Entry } from '@sitewright/schema';

// Mock the API so submit() resolves without a backend.
const { putEntry } = vi.hoisted(() => ({ putEntry: vi.fn<(pid: string, e: Entry) => Promise<unknown>>() }));
vi.mock('../src/api', () => ({ api: { putEntry: (pid: string, e: Entry) => putEntry(pid, e) } }));

import { EntryEditorModal } from '../src/views/datasets/EntryEditorModal';

// A nested dataset: a scalar setting + a `list` of items shaped by child fields.
const dataset: Dataset = {
  id: 'hero',
  name: 'Hero',
  slug: 'hero',
  fields: [
    { name: 'show_navigation', type: 'boolean', required: false, localized: false },
    {
      name: 'slides',
      type: 'list',
      required: false,
      localized: false,
      fields: [{ name: 'caption', type: 'text', required: false, localized: false }],
    },
  ],
};
const entry: Entry = {
  id: 'h1',
  dataset: 'hero',
  status: 'published',
  values: { show_navigation: true, slides: [{ caption: 'First' }] },
};

beforeEach(() => {
  putEntry.mockReset();
  putEntry.mockResolvedValue(undefined);
});

describe('EntryEditorModal — recursive nested-list editing', () => {
  it('adds, edits, reorders, and saves list items (values stay typed/nested)', async () => {
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={entry} onSaved={() => {}} onClose={() => {}} />);

    // The existing item's caption is editable (not a JSON blob); labels are item-disambiguated.
    expect((screen.getByLabelText('caption (item 1)') as HTMLInputElement).value).toBe('First');

    // Add a second item, then type into it.
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    fireEvent.change(screen.getByLabelText('caption (item 2)'), { target: { value: 'Second' } });

    // Move the second item up → order becomes [Second, First].
    fireEvent.click(screen.getByRole('button', { name: 'Move item 2 up' }));

    // Save → the persisted entry keeps the nested array (reordered) AND the sibling scalar.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    const saved = putEntry.mock.calls[0]![1];
    expect(saved.values.slides).toEqual([{ caption: 'Second' }, { caption: 'First' }]);
    expect(saved.values.show_navigation).toBe(true);
  });

  it('removing an item drops it from the saved array', async () => {
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={entry} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    fireEvent.change(screen.getByLabelText('caption (item 2)'), { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' })); // remove the first
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(putEntry.mock.calls[0]![1].values.slides).toEqual([{ caption: 'Second' }]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Dataset, Entry } from '@sitewright/schema';

// Mock the API so submit() resolves without a backend.
const { putEntry } = vi.hoisted(() => ({ putEntry: vi.fn<(pid: string, e: Entry) => Promise<unknown>>() }));
vi.mock('../src/api', () => ({ api: { putEntry: (pid: string, e: Entry) => putEntry(pid, e) } }));

// Swap CodeMirror for a plain textarea so the json edit→validate flow runs in jsdom; the real
// editor is covered by the Playwright browser E2E (mirrors CodeField.test).
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

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

    // The `list` section is collapsed by default — expand it to reveal its items.
    fireEvent.click(screen.getByRole('button', { name: /slides/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /slides/i })); // expand the collapsed list
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    fireEvent.change(screen.getByLabelText('caption (item 2)'), { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' })); // remove the first
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(putEntry.mock.calls[0]![1].values.slides).toEqual([{ caption: 'Second' }]);
  });

  it('duplicates an item directly after its source', async () => {
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={entry} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /slides/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate item 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(putEntry.mock.calls[0]![1].values.slides).toEqual([{ caption: 'First' }, { caption: 'First' }]);
  });
});

const ds = (fields: Dataset['fields'], over: Partial<Dataset> = {}): Dataset => ({ id: 'd', name: 'D', slug: 'd', fields, ...over });
const row = (over: Partial<Entry>): Entry => ({ id: 'r1', dataset: 'd', status: 'draft', values: {}, ...over });

describe('EntryEditorModal — Save gating + toasts behaviour', () => {
  it('disables Save until there is a change, then keeps the modal OPEN after saving', async () => {
    const onClose = vi.fn();
    render(<EntryEditorModal projectId="p" dataset={ds([{ name: 'title', type: 'text', required: false, localized: false }])} entry={row({ values: { title: 'Hi' } })} onSaved={() => {}} onClose={onClose} />);
    const save = () => screen.getByRole('button', { name: 'Save' });
    expect(save()).toBeDisabled(); // pristine existing entry
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Hello' } });
    expect(save()).not.toBeDisabled();
    fireEvent.click(save());
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled(); // save does NOT close the editor
    expect(save()).toBeDisabled(); // baseline reset → no longer dirty
  });

  it('blocks Save while a json field is malformed and shows an error', async () => {
    render(<EntryEditorModal projectId="p" dataset={ds([{ name: 'meta', type: 'json', required: false, localized: false }])} entry={row({ values: { meta: { a: 1 } } })} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('meta'), { target: { value: '{ bad' } });
    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('meta'), { target: { value: '{"a":2}' } });
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('Format prettifies a valid json field (and is disabled while malformed)', () => {
    render(<EntryEditorModal projectId="p" dataset={ds([{ name: 'meta', type: 'json', required: false, localized: false }])} entry={row({ values: {} })} onSaved={() => {}} onClose={() => {}} />);
    const field = () => screen.getByLabelText('meta') as HTMLTextAreaElement;
    const format = () => screen.getByRole('button', { name: 'Format' });
    fireEvent.change(field(), { target: { value: '{ bad' } });
    expect(format()).toBeDisabled();
    fireEvent.change(field(), { target: { value: '{"a":1,"b":2}' } });
    expect(format()).not.toBeDisabled();
    fireEvent.click(format());
    expect(field().value).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });
});

describe('EntryEditorModal — asset-valued fields (image / file / folder)', () => {
  it('renders a file field as a browsable asset input holding its path', () => {
    const dataset = ds([{ name: 'attachment', type: 'file', required: false, localized: false }]);
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={row({ values: { attachment: '/files/brochure.pdf' } })} onSaved={() => {}} onClose={() => {}} />);
    // The asset input is labelled by the field heading ("attachment (file)") — match by role + name.
    expect((screen.getByRole('textbox', { name: /attachment/ }) as HTMLInputElement).value).toBe('/files/brochure.pdf');
    expect(screen.getByRole('button', { name: /browse for attachment/i })).toBeInTheDocument();
  });

  it('renders a folder field as a browsable input holding a folder path, and saves it', async () => {
    const dataset = ds([{ name: 'gallery', type: 'folder', required: false, localized: false }]);
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={row({ values: { gallery: 'photos/team' } })} onSaved={() => {}} onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: /gallery/ }) as HTMLInputElement;
    expect(input.value).toBe('photos/team');
    expect(screen.getByRole('button', { name: /browse for gallery/i })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'photos/events' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(putEntry.mock.calls[0]![1].values.gallery).toBe('photos/events');
  });
});

describe('EntryEditorModal — config-driven + temporal inputs', () => {
  it('renders a select of the configured choices and saves the chosen value', async () => {
    const dataset = ds([{ name: 'category', type: 'select', required: false, localized: false, config: { options: ['News', 'Blog'] } }]);
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={row({ values: { category: '' } })} onSaved={() => {}} onClose={() => {}} />);
    const sel = screen.getByLabelText('category') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', 'News', 'Blog']);
    fireEvent.change(sel, { target: { value: 'Blog' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(putEntry.mock.calls[0]![1].values.category).toBe('Blog');
  });

  it('renders a reference picker of the target dataset entries and saves the entry id', async () => {
    const posts = ds([{ name: 'author', type: 'reference', required: false, localized: false, config: { dataset: 'authors' } }], { id: 'posts', slug: 'posts', name: 'Posts' });
    const authors = ds([{ name: 'name', type: 'text', required: false, localized: false }], { id: 'authors', slug: 'authors', name: 'Authors' });
    const jane: Entry = { id: 'jane', dataset: 'authors', status: 'published', values: { name: 'Jane' } };
    render(
      <EntryEditorModal projectId="p" dataset={posts} entry={row({ dataset: 'posts', values: { author: '' } })} allDatasets={[posts, authors]} allEntries={[jane]} onSaved={() => {}} onClose={() => {}} />,
    );
    const sel = screen.getByLabelText('author') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toContain('Jane');
    fireEvent.change(sel, { target: { value: 'jane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(putEntry.mock.calls[0]![1].values.author).toBe('jane');
  });

  it('renders native time + datetime-local inputs for the temporal field types', () => {
    const dataset = ds([
      { name: 'opens', type: 'time', required: false, localized: false },
      { name: 'when', type: 'datetime', required: false, localized: false },
    ]);
    render(<EntryEditorModal projectId="p" dataset={dataset} entry={row({ values: {} })} onSaved={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText('opens') as HTMLInputElement).type).toBe('time');
    expect((screen.getByLabelText('when') as HTMLInputElement).type).toBe('datetime-local');
  });
});

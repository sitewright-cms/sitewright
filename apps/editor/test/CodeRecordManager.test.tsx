import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeRecordManager, type CodeRecord, type MakeId } from '../src/views/code/CodeRecordManager';

// Mock the CodeMirror-backed editor modal (CodeMirror doesn't render in jsdom). It exposes the
// title as a dialog, an optional NAME field (uncontrolled — closure-tracked, no re-render), and a
// save button that fires onSave(source, name?) so we can test the wiring incl. rename.
vi.mock('../src/views/ui/CodeEditorModal', () => ({
  CodeEditorModal: ({
    title,
    onSave,
    onClose,
    nameEdit,
  }: {
    title: string;
    onSave: (s: string, name?: string) => void | Promise<void>;
    onClose: () => void;
    nameEdit?: { value: string; label?: string };
  }) => {
    let nameValue = nameEdit?.value ?? '';
    return (
      <div role="dialog" aria-label={title}>
        {nameEdit && (
          <input
            aria-label={nameEdit.label ?? 'Name'}
            defaultValue={nameEdit.value}
            onChange={(e) => {
              nameValue = e.target.value;
            }}
          />
        )}
        <button onClick={() => void Promise.resolve(onSave('NEW SOURCE', nameEdit ? nameValue : undefined)).catch(() => {})}>mock-save</button>
        <button onClick={onClose}>mock-close</button>
      </div>
    );
  },
}));

const recs: CodeRecord[] = [{ id: 'hero', name: 'hero', source: '<h1>{{x}}</h1>' }];
const makeId: MakeId = (name, existing) =>
  existing.some((r) => r.id === name.trim()) ? { error: 'A snippet with that name already exists.' } : { id: name.trim() };

function setup(extra?: { renamable?: boolean; previewUrl?: (r: CodeRecord, scope: 'project' | 'global') => string }, records: CodeRecord[] = recs) {
  const load = vi.fn().mockResolvedValue(records);
  const save = vi.fn().mockResolvedValue({});
  const remove = vi.fn().mockResolvedValue(undefined);
  render(<CodeRecordManager projectId="p1" noun="snippet" load={load} save={save} remove={remove} makeId={makeId} {...extra} />);
  return { load, save, remove };
}

describe('CodeRecordManager', () => {
  it('lists loaded records', async () => {
    setup();
    expect(await screen.findByText('hero')).toBeInTheDocument();
  });

  it('shows a catalogued global snippet’s description in a DaisyUI tooltip (data-tip) on hover', async () => {
    render(
      <CodeRecordManager
        projectId="p1"
        noun="snippet"
        load={vi.fn().mockResolvedValue([])}
        save={vi.fn().mockResolvedValue({})}
        remove={vi.fn().mockResolvedValue(undefined)}
        makeId={makeId}
        globalAdapters={{
          load: vi.fn().mockResolvedValue([{ id: 'page-vars', name: 'page-vars', source: '<x/>' }]),
          save: vi.fn(),
          remove: vi.fn(),
        }}
        globalCatalog={{
          meta: { 'page-vars': { group: 'Data', description: 'Bind page variables and list children.' } },
          groupOrder: ['Data'],
        }}
      />,
    );
    const name = await screen.findByText('page-vars');
    const tip = name.closest('[data-tip]');
    expect(tip).toHaveClass('tooltip');
    expect(tip).toHaveAttribute('data-tip', 'Bind page variables and list children.');
  });

  it('creates via the name prompt → saves an empty-source record → opens the editor', async () => {
    const { save } = setup();
    await screen.findByText('hero');
    fireEvent.click(screen.getByRole('button', { name: '+ New snippet' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'footer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('p1', { id: 'footer', name: 'footer', source: '' }));
    expect(await screen.findByRole('dialog', { name: 'footer — snippet' })).toBeInTheDocument();
  });

  it('saving in the editor persists the new source', async () => {
    const { save } = setup();
    await screen.findByText('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Edit hero' }));
    fireEvent.click(await screen.findByRole('button', { name: 'mock-save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('p1', { id: 'hero', name: 'hero', source: 'NEW SOURCE' }));
  });

  it('rejects a duplicate name (makeId error) without saving', async () => {
    const { save } = setup();
    await screen.findByText('hero');
    fireEvent.click(screen.getByRole('button', { name: '+ New snippet' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'hero' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A snippet with that name already exists.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('deletes a record after the confirm dialog', async () => {
    const { remove } = setup();
    await screen.findByText('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Delete hero' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('p1', 'hero'));
    await waitFor(() => expect(screen.queryByText('hero')).toBeNull());
  });

  it('shows an eye preview button per snippet when previewUrl is provided', async () => {
    setup({ previewUrl: (r, scope) => `/p/${scope}/${r.id}` });
    expect(await screen.findByRole('button', { name: 'Preview hero' })).toBeInTheDocument();
  });

  it('omits the eye preview button when previewUrl is not provided', async () => {
    setup();
    await screen.findByText('hero');
    expect(screen.queryByRole('button', { name: 'Preview hero' })).toBeNull();
  });

  it('renames a snippet (renamable): writes the NEW key and removes the OLD', async () => {
    const { save, remove } = setup({ renamable: true });
    await screen.findByText('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Edit hero' }));
    fireEvent.change(await screen.findByLabelText('snippet name'), { target: { value: 'hero2' } });
    fireEvent.click(screen.getByRole('button', { name: 'mock-save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('p1', { id: 'hero2', name: 'hero2', source: 'NEW SOURCE' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('p1', 'hero'));
  });

  it('blocks a rename onto an existing name (persist re-validates) without re-keying', async () => {
    const two: CodeRecord[] = [
      { id: 'hero', name: 'hero', source: '' },
      { id: 'footer', name: 'footer', source: '' },
    ];
    const { save, remove } = setup({ renamable: true }, two);
    await screen.findByText('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Edit hero' }));
    fireEvent.change(await screen.findByLabelText('snippet name'), { target: { value: 'footer' } });
    fireEvent.click(screen.getByRole('button', { name: 'mock-save' }));
    expect(await screen.findByText('A snippet with that name already exists.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

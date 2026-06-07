import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeRecordManager, type CodeRecord, type MakeId } from '../src/views/code/CodeRecordManager';

// Mock the CodeMirror-backed editor modal (CodeMirror doesn't render in jsdom). It exposes the
// title as a dialog + a button that fires onSave with new source, so we can test the wiring.
vi.mock('../src/views/ui/CodeEditorModal', () => ({
  CodeEditorModal: ({ title, onSave, onClose }: { title: string; onSave: (s: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <button onClick={() => onSave('NEW SOURCE')}>mock-save</button>
      <button onClick={onClose}>mock-close</button>
    </div>
  ),
}));

const recs: CodeRecord[] = [{ id: 'hero', name: 'hero', source: '<h1>{{x}}</h1>' }];
const makeId: MakeId = (name, existing) =>
  existing.some((r) => r.id === name.trim()) ? { error: 'A snippet with that name already exists.' } : { id: name.trim() };

function setup() {
  const load = vi.fn().mockResolvedValue(recs);
  const save = vi.fn().mockResolvedValue({});
  const remove = vi.fn().mockResolvedValue(undefined);
  render(<CodeRecordManager projectId="p1" noun="snippet" load={load} save={save} remove={remove} makeId={makeId} />);
  return { load, save, remove };
}

describe('CodeRecordManager', () => {
  it('lists loaded records', async () => {
    setup();
    expect(await screen.findByText('hero')).toBeInTheDocument();
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
});

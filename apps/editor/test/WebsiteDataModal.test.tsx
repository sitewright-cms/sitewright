import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { JsonValue } from '@sitewright/schema';
import { WebsiteDataModal } from '../src/views/settings/WebsiteDataModal';

function setup(value: JsonValue) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<WebsiteDataModal value={value} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('WebsiteDataModal — graphical tree editor', () => {
  it('shows existing keys/values and saves an edited scalar', () => {
    const { onSave, onClose } = setup({ title: 'Hi' });
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('title');
    const valueInput = screen.getByLabelText('Value') as HTMLInputElement;
    expect(valueInput.value).toBe('Hi');

    fireEvent.change(valueInput, { target: { value: 'Bye' } });
    save();
    expect(onSave).toHaveBeenCalledWith({ title: 'Bye' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('adds a key to an empty object', () => {
    const { onSave } = setup({});
    fireEvent.click(screen.getByRole('button', { name: '+ Add key' }));
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('key');
    save();
    expect(onSave).toHaveBeenCalledWith({ key: '' });
  });

  it('renames a key on blur', () => {
    const { onSave } = setup({ old: 1 });
    const keyInput = screen.getByLabelText('Key');
    fireEvent.change(keyInput, { target: { value: 'fresh' } });
    fireEvent.blur(keyInput);
    save();
    expect(onSave).toHaveBeenCalledWith({ fresh: 1 });
  });

  it('ignores a rename to a prototype-pollution key', () => {
    const { onSave } = setup({ ok: 1 });
    const keyInput = screen.getByLabelText('Key');
    fireEvent.change(keyInput, { target: { value: '__proto__' } });
    fireEvent.blur(keyInput);
    save();
    expect(onSave).toHaveBeenCalledWith({ ok: 1 }); // unchanged — the rename was rejected
  });

  it('changes a value type and resets to that type’s default', () => {
    const { onSave } = setup({ n: 'text' });
    // The root is a fixed OBJECT (no type select); the only "Value type" select is the child value's.
    const typeSelect = screen.getByLabelText('Value type');
    fireEvent.change(typeSelect, { target: { value: 'number' } });
    save();
    expect(onSave).toHaveBeenCalledWith({ n: 0 });
  });

  it('removes a key', () => {
    const { onSave } = setup({ a: 1, b: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Remove a' }));
    save();
    expect(onSave).toHaveBeenCalledWith({ b: 2 });
  });
});

describe('WebsiteDataModal — JSON source view', () => {
  it('round-trips a draft through the source textarea via Apply JSON', () => {
    const { onSave } = setup({ a: 1 });
    fireEvent.click(screen.getByRole('button', { name: /JSON source/ }));
    const ta = screen.getByLabelText('JSON source') as HTMLTextAreaElement;
    expect(JSON.parse(ta.value)).toEqual({ a: 1 }); // serialized current draft
    fireEvent.change(ta, { target: { value: '{"hero":{"headline":"X"},"tags":["a","b"]}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));
    // Back in the tree: the new top-level keys are present. Branches start COLLAPSED, so the nested
    // "headline" only appears once its parent is expanded.
    expect(screen.getAllByLabelText('Key').map((i) => (i as HTMLInputElement).value)).toEqual(['hero', 'tags']);
    fireEvent.click(screen.getByRole('button', { name: 'Expand hero' }));
    expect(screen.getAllByLabelText('Key').map((i) => (i as HTMLInputElement).value)).toEqual(
      expect.arrayContaining(['hero', 'tags', 'headline']),
    );
    save();
    expect(onSave).toHaveBeenCalledWith({ hero: { headline: 'X' }, tags: ['a', 'b'] });
  });

  it('saves directly from the source view when the JSON is valid', () => {
    const { onSave, onClose } = setup({});
    fireEvent.click(screen.getByRole('button', { name: /JSON source/ }));
    fireEvent.change(screen.getByLabelText('JSON source'), { target: { value: '{"k":42}' } });
    save();
    expect(onSave).toHaveBeenCalledWith({ k: 42 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks save on invalid JSON and shows an error (modal stays open)', () => {
    const { onSave, onClose } = setup({});
    fireEvent.click(screen.getByRole('button', { name: /JSON source/ }));
    fireEvent.change(screen.getByLabelText('JSON source'), { target: { value: '{ not json' } });
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
  });

  it('blocks a reserved (__proto__) key typed in the source view before it reaches the server', () => {
    const { onSave } = setup({});
    fireEvent.click(screen.getByRole('button', { name: /JSON source/ }));
    fireEvent.change(screen.getByLabelText('JSON source'), { target: { value: '{"__proto__":{"x":1}}' } });
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/reserved/)).toBeInTheDocument();
  });
});

describe('WebsiteDataModal — tree shape, collapsing and reordering', () => {
  it('shows the name and the type on one row', () => {
    setup({ my_array: [1, 2] });
    const row = screen.getByLabelText('Key').closest('div')!;
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('my_array');
    // The type select reads "[array]" and lives on the same row as the key and the remove button.
    expect((screen.getByLabelText('Value type') as HTMLSelectElement).value).toBe('array');
    expect(row).toContainElement(screen.getByLabelText('Value type'));
    expect(row).toContainElement(screen.getByRole('button', { name: 'Remove my_array' }));
    expect(screen.getByRole('option', { name: '[array]' })).toBeInTheDocument();
  });

  it('starts every branch collapsed and toggles it', () => {
    setup({ hero: { headline: 'X' } });
    expect(screen.getAllByLabelText('Key')).toHaveLength(1); // just `hero`
    fireEvent.click(screen.getByRole('button', { name: 'Expand hero' }));
    expect(screen.getAllByLabelText('Key')).toHaveLength(2); // + `headline`
    fireEvent.click(screen.getByRole('button', { name: 'Collapse hero' }));
    expect(screen.getAllByLabelText('Key')).toHaveLength(1);
  });

  it('summarises a collapsed branch by its size', () => {
    setup({ tags: ['a', 'b', 'c'], hero: { headline: 'X' } });
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText('1 key')).toBeInTheDocument();
  });

  it('offers no expander for a scalar', () => {
    setup({ title: 'Hi' });
    expect(screen.queryByRole('button', { name: /Expand/ })).toBeNull();
  });

  it('reorders object keys with the move buttons', () => {
    const { onSave } = setup({ a: 1, b: 2, c: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Move c up' }));
    save();
    expect(Object.keys(onSave.mock.calls[0]![0] as object)).toEqual(['a', 'c', 'b']);
  });

  it('disables the move buttons at the ends of a list', () => {
    setup({ a: 1, b: 2 });
    expect(screen.getByRole('button', { name: 'Move a up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move b down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move a down' })).toBeEnabled();
  });

  it('reorders array items and keeps their values with them', () => {
    const { onSave } = setup({ tags: ['x', 'y', 'z'] });
    fireEvent.click(screen.getByRole('button', { name: 'Expand tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move item 1 down' }));
    save();
    expect(onSave).toHaveBeenCalledWith({ tags: ['y', 'x', 'z'] });
  });

  it('reorders by drag and drop, dropping after the row when released on its lower half', () => {
    const { onSave } = setup({ a: 1, b: 2, c: 3 });
    const rows = screen.getAllByTitle('Drag to reorder').map((g) => g.closest('[draggable]')!.parentElement!.parentElement!);
    const dt = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(screen.getAllByTitle('Drag to reorder')[0]!, { dataTransfer: dt });
    // Release over the LOWER half of row `c` → land after it.
    rows[2]!.getBoundingClientRect = () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.dragOver(rows[2]!, { clientY: 18 });
    fireEvent.drop(rows[2]!);
    save();
    expect(Object.keys(onSave.mock.calls[0]![0] as object)).toEqual(['b', 'c', 'a']);
  });

  it('removes an array item without shifting the others’ values', () => {
    const { onSave } = setup({ tags: ['x', 'y', 'z'] });
    fireEvent.click(screen.getByRole('button', { name: 'Expand tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
    save();
    expect(onSave).toHaveBeenCalledWith({ tags: ['x', 'z'] });
  });

  it('expands a node the moment its type becomes a branch', () => {
    setup({ thing: 'text' });
    fireEvent.change(screen.getByLabelText('Value type'), { target: { value: 'object' } });
    // Newly a branch, shown open (not collapsed like a pre-existing one) so "+ Add key" is reachable.
    expect(screen.getByRole('button', { name: 'Collapse thing' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '+ Add key' })).toHaveLength(2);
  });
});

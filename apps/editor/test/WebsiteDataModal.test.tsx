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
    // [0] = root object select, [1] = the child value's type select.
    const typeSelect = screen.getAllByLabelText('Value type')[1]!;
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
    // Back in the tree: the new keys are present (incl. the nested "headline" under hero).
    const keys = screen.getAllByLabelText('Key').map((i) => (i as HTMLInputElement).value);
    expect(keys).toEqual(expect.arrayContaining(['hero', 'tags', 'headline']));
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

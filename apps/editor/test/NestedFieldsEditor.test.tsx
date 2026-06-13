import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Field } from '@sitewright/schema';
import { MAX_FIELD_DEPTH } from '@sitewright/schema';
import { NestedFieldsEditor, normalizeFieldForType, fieldsHaveEmptyGroup } from '../src/views/datasets/NestedFieldsEditor';

// Controlled wrapper so the editor's onChange round-trips through real state.
function Harness({ initial, depth = 2 }: { initial: Field[]; depth?: number }) {
  const [fields, setFields] = useState<Field[]>(initial);
  return (
    <>
      <NestedFieldsEditor value={fields} depth={depth} onChange={setFields} />
      <pre data-testid="state">{JSON.stringify(fields)}</pre>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId('state').textContent || '[]') as Field[];

describe('normalizeFieldForType', () => {
  it('gives a group type an empty child list and strips children from a scalar', () => {
    expect(normalizeFieldForType({ name: 'x', type: 'list', required: false, localized: false })).toMatchObject({ fields: [] });
    expect(normalizeFieldForType({ name: 'x', type: 'text', required: false, localized: false, fields: [] })).not.toHaveProperty('fields');
  });
});

describe('fieldsHaveEmptyGroup', () => {
  const f = (name: string, type: Field['type'], fields?: Field[]): Field => ({ name, type, required: false, localized: false, ...(fields ? { fields } : {}) });
  it('flags a group with no children (incl. nested) and passes a valid tree', () => {
    expect(fieldsHaveEmptyGroup([f('a', 'text')])).toBe(false);
    expect(fieldsHaveEmptyGroup([f('a', 'list', [])])).toBe(true);
    expect(fieldsHaveEmptyGroup([f('a', 'list', [f('b', 'text')])])).toBe(false);
    expect(fieldsHaveEmptyGroup([f('a', 'list', [f('b', 'object', [])])])).toBe(true);
  });
});

describe('NestedFieldsEditor', () => {
  it('adds a child field via the add row', () => {
    render(<Harness initial={[]} />);
    fireEvent.change(screen.getByLabelText('New nested field name'), { target: { value: 'caption' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(state()).toEqual([{ name: 'caption', type: 'text', required: false, localized: false }]);
  });

  it('retyping a child to a group adds an empty child list + reveals a nested editor', () => {
    render(<Harness initial={[{ name: 'rows', type: 'text', required: false, localized: false }]} />);
    fireEvent.change(screen.getByLabelText('Type of rows'), { target: { value: 'object' } });
    expect(state()[0]).toMatchObject({ type: 'object', fields: [] });
    // A nested add row appears for the new group's children.
    expect(screen.getAllByLabelText('New nested field name').length).toBeGreaterThan(1);
  });

  it('removes a child', () => {
    render(<Harness initial={[{ name: 'gone', type: 'text', required: false, localized: false }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove field gone' }));
    expect(state()).toEqual([]);
  });

  it('does NOT offer list/object once the depth cap is reached', () => {
    render(<Harness initial={[]} depth={MAX_FIELD_DEPTH} />);
    const typeSelect = screen.getByLabelText('New nested field type');
    const opts = within(typeSelect).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(opts).not.toContain('list');
    expect(opts).not.toContain('object');
    expect(opts).toContain('text');
  });

  it('warns when a group has no children (would fail to save)', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/needs children to save/)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Field } from '@sitewright/schema';
import { FieldConfigEditor } from '../src/views/datasets/FieldConfigEditor';

const datasets = [
  { slug: 'authors', name: 'Authors' },
  { slug: 'tags', name: 'Tags' },
];

// Controlled harness: config round-trips through real state, like the schema editor.
function Harness({ initial }: { initial: Field }) {
  const [field, setField] = useState<Field>(initial);
  return (
    <>
      <FieldConfigEditor field={field} datasets={datasets} onChange={(config) => setField((f) => ({ ...f, config }))} />
      <pre data-testid="config">{JSON.stringify(field.config ?? null)}</pre>
    </>
  );
}

const cfg = () => JSON.parse(screen.getByTestId('config').textContent || 'null');

describe('FieldConfigEditor', () => {
  it('renders nothing for a non-config field type', () => {
    const { container } = render(<FieldConfigEditor field={{ name: 'x', type: 'text', required: false, localized: false }} datasets={datasets} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('select: adds, edits, and removes choices', () => {
    render(<Harness initial={{ name: 'stage', type: 'select', required: false, localized: false }} />);
    fireEvent.click(screen.getByRole('button', { name: /add choice/i }));
    fireEvent.click(screen.getByRole('button', { name: /add choice/i }));
    fireEvent.change(screen.getByLabelText('Choice 1 for stage'), { target: { value: 'Draft' } });
    fireEvent.change(screen.getByLabelText('Choice 2 for stage'), { target: { value: 'Live' } });
    expect(cfg().options).toEqual(['Draft', 'Live']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice 1' }));
    expect(cfg().options).toEqual(['Live']);
  });

  it('reference: picks the target dataset', () => {
    render(<Harness initial={{ name: 'author', type: 'reference', required: false, localized: false }} />);
    fireEvent.change(screen.getByLabelText('Reference target for author'), { target: { value: 'authors' } });
    expect(cfg().dataset).toBe('authors');
  });
});

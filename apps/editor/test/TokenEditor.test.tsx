import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TokenEditor } from '../src/views/settings/TokenEditor';
import type { KeyedPair } from '../src/views/settings/model';

// A controlled harness that surfaces the current rows as text, so we assert on the
// onChange-driven state (robust to AnimatePresence exit ghosts in jsdom) rather than
// the animated DOM.
function Harness({ initial }: { initial: KeyedPair[] }) {
  const [rows, setRows] = useState<KeyedPair[]>(initial);
  return (
    <>
      <TokenEditor rows={rows} onChange={setRows} keyPlaceholder="primary" valuePlaceholder="val" />
      <div data-testid="out">{rows.map((r) => `${r.key}=${r.value}`).join(',')}</div>
    </>
  );
}

const three: KeyedPair[] = [
  { id: 'a', key: 'one', value: 'v1' },
  { id: 'b', key: 'two', value: 'v2' },
  { id: 'c', key: 'three', value: 'v3' },
];

describe('TokenEditor (stable-id rows)', () => {
  it('removes the correct MIDDLE row by id, not by index', () => {
    render(<Harness initial={three} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove two 2' }));
    // The survivors are the first and third rows — the bug (index keys) would keep v2.
    expect(screen.getByTestId('out')).toHaveTextContent('one=v1,three=v3');
  });

  it('edits the right row when a key is changed', () => {
    render(<Harness initial={three} />);
    fireEvent.change(screen.getByLabelText('primary 2'), { target: { value: 'TWO' } });
    expect(screen.getByTestId('out')).toHaveTextContent('one=v1,TWO=v2,three=v3');
  });

  it('adds a new empty row', () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add token' }));
    fireEvent.change(screen.getByLabelText('primary 1'), { target: { value: 'accent' } });
    fireEvent.change(screen.getByLabelText('val 1'), { target: { value: '#f50' } });
    expect(screen.getByTestId('out')).toHaveTextContent('accent=#f50');
  });
});

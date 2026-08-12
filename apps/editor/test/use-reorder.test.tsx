// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { useReorder } from '../src/views/settings/use-reorder';
import { ReorderHandle } from '../src/views/settings/ReorderHandle';

interface Row {
  id: string;
  label: string;
}

/** A minimal sortable list built exactly the way ShopChannelsEditor builds one. */
function List({ initial, onOrder }: { initial: Row[]; onOrder?: (ids: string[]) => void }) {
  const [rows, setRows] = useState(initial);
  const apply = (next: Row[]) => {
    setRows(next);
    onOrder?.(next.map((r) => r.id));
  };
  const { dragProps, move } = useReorder(rows, apply);
  return (
    <ul>
      {rows.map((r, i) => (
        <li key={r.id} {...dragProps(r.id)} data-testid={`row-${i}`}>
          <ReorderHandle
            label={r.label}
            onUp={() => move(r.id, -1)}
            onDown={() => move(r.id, 1)}
            canUp={i > 0}
            canDown={i < rows.length - 1}
          />
          {r.label}
        </li>
      ))}
    </ul>
  );
}

const ROWS: Row[] = [
  { id: 'a', label: 'alpha' },
  { id: 'b', label: 'beta' },
  { id: 'c', label: 'gamma' },
];
const order = () => [0, 1, 2].map((i) => screen.getByTestId(`row-${i}`).textContent);

describe('useReorder + ReorderHandle', () => {
  it('moves a row down and back up with the keyboard buttons', () => {
    render(<List initial={ROWS} />);
    expect(order()).toEqual(['alpha', 'beta', 'gamma']);
    fireEvent.click(screen.getByLabelText('Move alpha down'));
    expect(order()).toEqual(['beta', 'alpha', 'gamma']);
    fireEvent.click(screen.getByLabelText('Move alpha up'));
    expect(order()).toEqual(['alpha', 'beta', 'gamma']);
  });

  // The keyboard path is the ACCESSIBLE half of the feature — HTML5 drag-and-drop cannot be driven from a
  // keyboard at all, so these buttons existing (and being labelled per row) is the requirement, not a nicety.
  it('labels each button with the row it belongs to, and disables the ends', () => {
    render(<List initial={ROWS} />);
    expect((screen.getByLabelText('Move alpha up') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Move gamma down') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Move beta up') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Move beta down') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reorders on drop, moving the dragged row to the drop target position', () => {
    render(<List initial={ROWS} />);
    fireEvent.dragStart(screen.getByTestId('row-2')); // grab gamma
    fireEvent.drop(screen.getByTestId('row-0')); // onto alpha's slot
    expect(order()).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('is a no-op when a row is dropped on itself', () => {
    render(<List initial={ROWS} />);
    fireEvent.dragStart(screen.getByTestId('row-1'));
    fireEvent.drop(screen.getByTestId('row-1'));
    expect(order()).toEqual(['alpha', 'beta', 'gamma']);
  });

  // Order fields are nested INSIDE a channel row, which is itself sortable. Without stopPropagation a field
  // drop would bubble to the channel list and reorder the channels as a side effect of moving a field.
  it('does not let a nested list’s drop bubble to its parent list', () => {
    const parentDrops: string[] = [];
    render(
      <div onDrop={() => parentDrops.push('parent')}>
        <List initial={ROWS} />
      </div>,
    );
    fireEvent.dragStart(screen.getByTestId('row-0'));
    fireEvent.drop(screen.getByTestId('row-1'));
    expect(order()).toEqual(['beta', 'alpha', 'gamma']); // the inner list did reorder
    expect(parentDrops).toEqual([]); // …and the outer one never heard about it
  });
});

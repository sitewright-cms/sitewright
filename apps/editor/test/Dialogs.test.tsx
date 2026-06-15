import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useDialogs } from '../src/views/ui/Dialogs';

function Harness({ onResult }: { onResult: (r: boolean) => void }) {
  const { confirm, dialog } = useDialogs();
  return (
    <>
      <button onClick={async () => onResult(await confirm({ title: 'Delete item', message: 'Are you sure?', confirmLabel: 'Delete' }))}>open</button>
      {dialog}
    </>
  );
}

describe('useDialogs confirm — keyboard shortcuts', () => {
  it('ENTER applies the primary (confirm) action → resolves true', async () => {
    const res = vi.fn();
    render(<Harness onResult={res} />);
    fireEvent.click(screen.getByText('open'));
    await screen.findByRole('dialog', { name: 'Delete item' });
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(res).toHaveBeenCalledWith(true));
  });

  it('ESC aborts → resolves false', async () => {
    const res = vi.fn();
    render(<Harness onResult={res} />);
    fireEvent.click(screen.getByText('open'));
    await screen.findByRole('dialog', { name: 'Delete item' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(res).toHaveBeenCalledWith(false));
  });
});

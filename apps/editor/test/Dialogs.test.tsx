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

function PromptHarness({ onResult, secret }: { onResult: (r: string | null) => void; secret?: boolean }) {
  const { prompt, dialog } = useDialogs();
  return (
    <>
      <button onClick={async () => onResult(await prompt({ title: 'Ask', label: 'Value', confirmLabel: 'Continue', ...(secret ? { secret: true } : {}) }))}>ask</button>
      {dialog}
    </>
  );
}

describe('useDialogs prompt', () => {
  it('returns the trimmed text, and null when cancelled or left blank', async () => {
    const res = vi.fn();
    render(<PromptHarness onResult={res} />);
    fireEvent.click(screen.getByText('ask'));
    const field = (await screen.findByLabelText('Value')) as HTMLInputElement;
    expect(field.type).toBe('text');
    // Whitespace alone is not an answer.
    fireEvent.change(field, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '  My Phone ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(res).toHaveBeenCalledWith('My Phone'));

    fireEvent.click(screen.getByText('ask'));
    await screen.findByLabelText('Value');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(res).toHaveBeenLastCalledWith(null));
  });

  it('★ a SECRET prompt is masked, offered to the password manager, and returned exactly as typed', async () => {
    const res = vi.fn();
    render(<PromptHarness onResult={res} secret />);
    fireEvent.click(screen.getByText('ask'));
    const field = (await screen.findByLabelText('Value')) as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(field.autocomplete).toBe('current-password');
    // A space at either end is part of a password — trimming it would send the wrong one.
    fireEvent.change(field, { target: { value: ' pass word ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(res).toHaveBeenCalledWith(' pass word '));
  });
});

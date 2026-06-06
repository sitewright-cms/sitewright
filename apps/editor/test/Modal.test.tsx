import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from '../src/views/ui/Modal';

describe('Modal', () => {
  it('renders the title + children and portals to <body>', () => {
    render(
      <Modal title="My dialog" onClose={() => {}}>
        <p>Body content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'My dialog' })).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  // onClose fires after the exit animation (AnimatePresence.onExitComplete), so each path is
  // checked on its own instance with waitFor.
  it('closes (after the exit animation) on the Close button', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on a backdrop click', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    // Backdrop = the presentation wrapper; a mousedown directly on it (not the panel) closes.
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does NOT close when the mousedown originates inside the panel', () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByText('hi'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('consults onBeforeClose: a false guard vetoes the close', async () => {
    const onClose = vi.fn();
    const onBeforeClose = vi.fn().mockResolvedValue(false);
    render(
      <Modal title="X" onClose={onClose} onBeforeClose={onBeforeClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    await waitFor(() => expect(onBeforeClose).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 40));
    expect(onClose).not.toHaveBeenCalled(); // vetoed → stays open
  });

  it('consults onBeforeClose: a true guard allows the close', async () => {
    const onClose = vi.fn();
    const onBeforeClose = vi.fn().mockResolvedValue(true);
    render(
      <Modal title="X" onClose={onClose} onBeforeClose={onBeforeClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('only renders the Save button when onSave is given, and fires it on click + ⌘S', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <Modal title="X" onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    rerender(
      <Modal title="X" onClose={() => {}} onSave={onSave} saveLabel="Save">
        <p>hi</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside the panel (last focusable wraps back to the first)', () => {
    render(
      <Modal title="X" onClose={() => {}} onSave={() => {}} saveLabel="Save">
        <p>hi</p>
      </Modal>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    const close = screen.getByRole('button', { name: 'Close' });
    // DOM order inside the panel: Save, then Close → Close is the last focusable.
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(save);
  });

  it('suppresses ⌘S while a save is already in flight', () => {
    const onSave = vi.fn();
    render(
      <Modal title="X" onClose={() => {}} onSave={onSave} saving>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saveDisabled disables the Save button AND suppresses ⌘S (still eating the browser dialog)', () => {
    const onSave = vi.fn();
    render(
      <Modal title="X" onClose={() => {}} onSave={onSave} saveDisabled>
        <p>hi</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const event = fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
    // preventDefault still fired — the browser's own "save page" dialog must never appear.
    expect(event).toBe(false); // fireEvent returns false when defaultPrevented
  });
});

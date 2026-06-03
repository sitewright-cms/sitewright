import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('closes on the Close button, Escape, and a backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Backdrop = the presentation wrapper; a mousedown directly on it (not the panel) closes.
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(3);
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
});

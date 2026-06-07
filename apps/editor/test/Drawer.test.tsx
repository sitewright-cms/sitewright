import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Drawer } from '../src/views/ui/Drawer';
import { Modal } from '../src/views/ui/Modal';

describe('Drawer', () => {
  it('renders the title + children as a portalled dialog', () => {
    render(
      <Drawer title="Assets" onClose={() => {}}>
        <p>Drawer body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByText('Drawer body')).toBeInTheDocument();
  });

  it('closes (after the exit animation) on the Close button', async () => {
    const onClose = vi.fn();
    render(
      <Drawer title="X" onClose={onClose}>
        <p>hi</p>
      </Drawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape (top of the overlay stack)', async () => {
    const onClose = vi.fn();
    render(
      <Drawer title="X" onClose={onClose}>
        <p>hi</p>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not close on a click inside the panel', () => {
    const onClose = vi.fn();
    render(
      <Drawer title="X" onClose={onClose}>
        <button>inside</button>
      </Drawer>,
    );
    fireEvent.mouseDown(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shares the overlay stack: Escape closes the TOP modal first, not the drawer underneath', async () => {
    const onDrawerClose = vi.fn();
    const onModalClose = vi.fn();
    // A modal opened FROM the drawer (a later mount) pushes onto the shared stack last, so it owns
    // Escape — mirrors FileBrowser opening its stock/preview modals inside the manager drawer.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <Drawer title="Drawer" onClose={onDrawerClose}>
          <button onClick={() => setOpen(true)}>open modal</button>
          {open && (
            <Modal title="Stacked" onClose={onModalClose}>
              <p>stacked</p>
            </Modal>
          )}
        </Drawer>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText('open modal'));
    expect(await screen.findByRole('dialog', { name: 'Stacked' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onModalClose).toHaveBeenCalledTimes(1));
    expect(onDrawerClose).not.toHaveBeenCalled();
  });
});

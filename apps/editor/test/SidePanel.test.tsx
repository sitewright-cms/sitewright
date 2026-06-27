import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidePanel } from '../src/views/ui/SidePanel';
import { Modal } from '../src/views/ui/Modal';

describe('SidePanel', () => {
  it('opens on tab click and closes on backdrop click, Escape, and the header ×', () => {
    const { container } = render(
      <SidePanel side="left" label="Library">
        <p>panel body</p>
      </SidePanel>,
    );
    const region = container.querySelector('[role="region"]')!;
    const backdrop = container.firstChild as HTMLElement; // fragment: backdrop, tab, panel
    expect(screen.getByRole('button', { name: 'Open Library' })).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-hidden', 'true');

    // Click the tab → open (and STAYS open — no hover dependency).
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }));
    expect(region).toHaveAttribute('aria-hidden', 'false');

    // Click the backdrop → close.
    fireEvent.click(backdrop);
    expect(region).toHaveAttribute('aria-hidden', 'true');

    // Re-open, then Escape (dispatched at document → bubbles to the window listener) → close.
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }));
    expect(region).toHaveAttribute('aria-hidden', 'false');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(region).toHaveAttribute('aria-hidden', 'true');

    // Re-open, then the header × → close.
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }));
    expect(region).toHaveAttribute('aria-hidden', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Close Library' }));
    expect(region).toHaveAttribute('aria-hidden', 'true');
  });

  it('force-opens when openSignal increments (the header button path)', () => {
    const { container, rerender } = render(
      <SidePanel side="right" label="Assets" openSignal={0}>
        <p>files</p>
      </SidePanel>,
    );
    const region = container.querySelector('[role="region"]')!;
    expect(region).toHaveAttribute('aria-hidden', 'true');

    rerender(
      <SidePanel side="right" label="Assets" openSignal={1}>
        <p>files</p>
      </SidePanel>,
    );
    expect(region).toHaveAttribute('aria-hidden', 'false');
  });

  it('opens when OS files are dragged over the collapsed tab (openOnFileDrag)', () => {
    const { container } = render(
      <SidePanel side="right" label="File Manager" openOnFileDrag>
        <p>files</p>
      </SidePanel>,
    );
    const region = container.querySelector('[role="region"]')!;
    const tab = screen.getByRole('button', { name: 'Open File Manager' });
    expect(region).toHaveAttribute('aria-hidden', 'true');

    fireEvent.dragEnter(tab, { dataTransfer: { types: ['Files'] } });
    expect(region).toHaveAttribute('aria-hidden', 'false');
  });

  it('ignores internal element drags over the tab (no Files in the payload)', () => {
    const { container } = render(
      <SidePanel side="right" label="File Manager" openOnFileDrag>
        <p>files</p>
      </SidePanel>,
    );
    const region = container.querySelector('[role="region"]')!;
    const tab = screen.getByRole('button', { name: 'Open File Manager' });

    fireEvent.dragEnter(tab, { dataTransfer: { types: ['text/plain'] } });
    expect(region).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not open on file drag unless openOnFileDrag is set', () => {
    const { container } = render(
      <SidePanel side="left" label="Library">
        <p>panel body</p>
      </SidePanel>,
    );
    const region = container.querySelector('[role="region"]')!;
    const tab = screen.getByRole('button', { name: 'Open Library' });

    fireEvent.dragEnter(tab, { dataTransfer: { types: ['Files'] } });
    expect(region).toHaveAttribute('aria-hidden', 'true');
  });

  // fireEvent returns false when the handler called preventDefault — i.e. the browser's default
  // "open the dropped file" navigation is suppressed (there is no global drop guard in the editor).
  it('swallows file drops on the tab and the open panel so the browser cannot navigate away', () => {
    const { container } = render(
      <SidePanel side="right" label="File Manager" openOnFileDrag>
        <p>files</p>
      </SidePanel>,
    );
    const region = container.querySelector('[role="region"]')!;
    const tab = screen.getByRole('button', { name: 'Open File Manager' });

    // A stray drop on the tab is prevented (and is a safe no-op).
    expect(fireEvent.drop(tab, { dataTransfer: { types: ['Files'] } })).toBe(false);
    // Open the panel (as the drag would), then a drop that misses the inner browser and lands on
    // the panel chrome is prevented too.
    fireEvent.dragEnter(tab, { dataTransfer: { types: ['Files'] } });
    expect(region).toHaveAttribute('aria-hidden', 'false');
    expect(fireEvent.drop(region, { dataTransfer: { types: ['Files'] } })).toBe(false);
  });

  it('does not intercept drops when openOnFileDrag is unset (no upload target)', () => {
    const { container } = render(
      <SidePanel side="left" label="Library">
        <p>panel body</p>
      </SidePanel>,
    );
    const region = container.querySelector('[role="region"]')!;
    // No openOnFileDrag ⇒ no drop handler ⇒ default not prevented (fireEvent returns true).
    expect(fireEvent.drop(region, { dataTransfer: { types: ['Files'] } })).toBe(true);
  });

  it('elevates a Modal rendered inside it above the panel layer (z-[70]); a standalone modal stays z-50', () => {
    render(
      <SidePanel side="left" label="Lib">
        <Modal title="Inside" onClose={() => {}}>
          <p>m</p>
        </Modal>
      </SidePanel>,
    );
    expect(screen.getByRole('dialog', { name: 'Inside' }).parentElement).toHaveClass('z-[70]');

    render(
      <Modal title="Base" onClose={() => {}}>
        <p>b</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Base' }).parentElement).toHaveClass('z-50');
  });
});

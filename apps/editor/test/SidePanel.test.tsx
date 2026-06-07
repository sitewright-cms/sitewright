import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidePanel } from '../src/views/ui/SidePanel';
import { Modal } from '../src/views/ui/Modal';

describe('SidePanel', () => {
  it('renders the edge tab; the panel is hidden until hover and shown on mouseenter', () => {
    const { container } = render(
      <SidePanel side="left" label="Library">
        <p>panel body</p>
      </SidePanel>,
    );
    const wrapper = container.firstChild as HTMLElement;
    const region = container.querySelector('[role="region"]')!;
    expect(screen.getByRole('button', { name: 'Open Library' })).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-hidden', 'true');

    fireEvent.mouseEnter(wrapper);
    expect(region).toHaveAttribute('aria-hidden', 'false');

    fireEvent.mouseLeave(wrapper);
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

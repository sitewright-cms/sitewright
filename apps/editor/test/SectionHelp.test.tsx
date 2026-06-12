import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHelp } from '../src/views/ui/SectionHelp';

describe('SectionHelp', () => {
  it('renders a help button (CircleHelp svg) whose accessible name + DaisyUI tooltip is the tip', () => {
    const { container } = render(<SectionHelp tip="Helpful explanation." />);
    const btn = screen.getByRole('button', { name: 'Helpful explanation.' });
    expect(btn.querySelector('svg')).not.toBeNull(); // the lucide CircleHelp glyph
    // The DaisyUI tooltip host carries the visual help text.
    expect(container.querySelector('.tooltip')).toHaveAttribute('data-tip', 'Helpful explanation.');
  });

  it('is a type=button (it must never submit the settings form it lives in)', () => {
    render(<SectionHelp tip="x" />);
    expect(screen.getByRole('button', { name: 'x' })).toHaveAttribute('type', 'button');
  });
});

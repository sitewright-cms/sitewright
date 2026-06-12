import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlassCard } from '../src/views/settings/ui';

describe('GlassCard', () => {
  it('shows a "?" help affordance only when a tooltip is provided', () => {
    const { rerender } = render(
      <GlassCard title="Brand colors" icon={<span />} tooltip="The six core colors…">
        <div>body</div>
      </GlassCard>,
    );
    expect(screen.getByRole('heading', { name: 'Brand colors' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The six core colors…' })).toBeInTheDocument();

    rerender(
      <GlassCard title="Identity" icon={<span />}>
        <div>body</div>
      </GlassCard>,
    );
    expect(screen.getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull(); // no tooltip → no help icon
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentIndicator } from '../src/views/AgentIndicator';

describe('AgentIndicator', () => {
  it('renders the "none" state as a connect affordance', () => {
    render(<AgentIndicator state="none" count={0} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Connect an agent/ })).toBeInTheDocument();
  });

  it('renders the idle state and shows a count only when more than one', () => {
    const { rerender } = render(<AgentIndicator state="idle" count={1} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Agent connected' })).toBeInTheDocument();
    rerender(<AgentIndicator state="idle" count={3} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Agent connected · 3' })).toBeInTheDocument();
  });

  it('renders the working state', () => {
    render(<AgentIndicator state="working" count={1} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Agent working/ })).toBeInTheDocument();
  });

  it('is clickable in every state', () => {
    const onClick = vi.fn();
    const { rerender } = render(<AgentIndicator state="none" count={0} onClick={onClick} />);
    screen.getByRole('button').click();
    rerender(<AgentIndicator state="idle" count={1} onClick={onClick} />);
    screen.getByRole('button').click();
    rerender(<AgentIndicator state="working" count={1} onClick={onClick} />);
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledTimes(3);
  });
});

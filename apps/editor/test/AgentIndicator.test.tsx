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

  /**
   * COMPACT is the phone header. The labelled pill (~132–152px, and it never shrinks) painted over the
   * project switcher at 320–390px, so there the label is visually hidden and the button keeps only its
   * dot/spinner/glyph. What must NOT change is the name a screen reader announces, the count included,
   * or the editor tooltip; and the hover text must stay the editor's tooltip, never a native `title`.
   *
   * The name comes from sr-only TEXT, not `aria-label`: on a touch screen `button[aria-label]` also gets
   * a 44px minimum width (styles.css), and the 320px touch row has no room for it.
   */
  describe('compact', () => {
    const cases = [
      { state: 'idle' as const, count: 3, name: 'Agent connected · 3', tip: /connected \(idle\)/ },
      { state: 'working' as const, count: 1, name: 'Agent working…', tip: /editing this project right now/ },
      { state: 'none' as const, count: 0, name: 'Connect an agent', tip: /No agent connected/ },
    ];

    it.each(cases)('$state: keeps its accessible name with the label visually hidden', ({ state, count, name, tip }) => {
      render(<AgentIndicator state={state} count={count} onClick={() => {}} compact />);
      const button = screen.getByRole('button', { name });
      expect(screen.getByText(name)).toHaveClass('sr-only');
      expect(button.closest('[data-tip]')?.getAttribute('data-tip')).toMatch(tip);
      expect(button).not.toHaveAttribute('title');
      expect(button).not.toHaveAttribute('aria-label');
    });

    it.each(cases)('$state: the label stays VISIBLE outside compact (the desktop pill is unchanged)', ({ state, count, name }) => {
      render(<AgentIndicator state={state} count={count} onClick={() => {}} />);
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
      expect(screen.queryByText(name, { selector: '.sr-only' })).not.toBeInTheDocument();
    });
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

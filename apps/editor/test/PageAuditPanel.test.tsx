import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MainThreadView } from '../src/views/pagespeed/PageAuditPanel';
import type { PagespeedMainThread } from '../src/api';

/**
 * The audit's MAIN-THREAD section: what the blocking time is made of. Lighthouse files long tasks and
 * non-composited animations as informative audits, so the recommendation list never shows them — an
 * author whose blocking time jumped after adding a few CSS effects had nothing to trace it to.
 */
describe('MainThreadView', () => {
  const full: PagespeedMainThread = {
    longTasks: [
      { url: '/_assets/_sw/shader-bg.js', durationMs: 412.6, startMs: 2310.4 },
      { label: 'Unattributable', durationMs: 230 },
    ],
    moreLongTasks: 3,
    nonCompositedAnimations: [
      {
        label: 'Welcome to Acme',
        animations: ['sw-pan'],
        properties: ['background-position', 'filter'],
        reasons: ['Unsupported CSS Properties: background-position, filter'],
      },
      { reasons: ['Transform-related property depends on box size'] },
    ],
    moreNonCompositedAnimations: 1,
  };

  it('lists the longest tasks with their duration and start, and the overflow', () => {
    render(<MainThreadView mainThread={full} />);
    const tasks = screen.getByRole('list', { name: /longest main-thread tasks/i });
    const rows = within(tasks).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('/_assets/_sw/shader-bg.js');
    expect(rows[0]).toHaveTextContent('413 ms');
    expect(rows[0]).toHaveTextContent('at 2.3 s');
    expect(rows[1]).toHaveTextContent('Unattributable');
    expect(rows[1]).toHaveTextContent('230 ms');
    expect(tasks).toHaveTextContent('…and 3 more');
  });

  it('names each refused animation: element, animation, animated properties, reason', () => {
    render(<MainThreadView mainThread={full} />);
    const anims = screen.getByRole('list', { name: /animations not on the compositor/i });
    const rows = within(anims).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Welcome to Acme');
    expect(rows[0]).toHaveTextContent('sw-pan');
    expect(rows[0]).toHaveTextContent('background-position');
    expect(rows[0]).toHaveTextContent('filter');
    expect(rows[0]).toHaveTextContent('Unsupported CSS Properties');
    expect(rows[1]).toHaveTextContent('element'); // nameless → a placeholder, still listed
    expect(rows[1]).toHaveTextContent('depends on box size');
    expect(anims).toHaveTextContent('…and 1 more');
  });

  it('says why it costs more here than on a phone — the audit server has no GPU', () => {
    render(<MainThreadView mainThread={full} />);
    expect(screen.getByText(/without a GPU/i)).toBeInTheDocument();
  });

  it('shows only the half that has entries', () => {
    render(<MainThreadView mainThread={{ longTasks: [{ url: '/a.js', durationMs: 80 }], nonCompositedAnimations: [] }} />);
    expect(screen.getByRole('list', { name: /longest main-thread tasks/i })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /animations not on the compositor/i })).toBeNull();
  });
});

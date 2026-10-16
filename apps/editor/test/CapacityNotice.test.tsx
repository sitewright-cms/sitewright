import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CapacityNotice } from '../src/views/ui/CapacityNotice';
import { ApiError } from '../src/api';

/**
 * A shed request is not a broken feature.
 *
 * The instance refuses work it cannot afford (a Lighthouse audit, a screenshot, an image encode) with
 * a 503. Rendered in the same red "it failed" alert as a genuine error, that taught authors the button
 * was broken and hid the only useful fact: come back in a moment. These pin the cases apart — and,
 * since a `capacity` 503 is EITHER a busy renderer OR the memory ledger, say which one it was: telling
 * an author "not enough memory" while every render slot is merely held by another audit sends them
 * looking for a problem that does not exist.
 */
describe('CapacityNotice', () => {
  const capacity = (opts: { transient?: boolean; after?: number; reason?: string } = {}) =>
    new ApiError(503, 'temporarily out of capacity', undefined, opts.after, 'capacity', opts.transient ?? true, opts.reason);

  it('★ a BUSY RENDERER says so — other work holds the renderer, not a memory shortage — with its interval', () => {
    render(<CapacityNotice error={capacity({ reason: 'busy', after: 15 })} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(/renderer is busy with other work/i);
    expect(note).toHaveTextContent(/retry in about 15 seconds/i);
    expect(note).not.toHaveTextContent(/memory/i);
    expect(note.className).not.toContain('rose'); // NOT the failure alert — nothing is broken
  });

  it('a busy renderer with no interval still says when: in a few seconds', () => {
    render(<CapacityNotice error={capacity({ reason: 'busy' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/retry in a few seconds/i);
  });

  it('reports a transient MEMORY refusal calmly, with the retry interval', () => {
    render(<CapacityNotice error={capacity({ reason: 'memory', after: 5 })} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(/not enough memory/i);
    expect(note).toHaveTextContent(/5 seconds/);
    expect(note.className).not.toContain('rose');
  });

  it('★ does not blame memory when the server did not say what was full', () => {
    // A concurrency gate sheds with the same `capacity` 503 and no reason — "busy" is true, "memory" is a guess.
    render(<CapacityNotice error={capacity({ after: 1 })} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(/busy/i);
    expect(note).toHaveTextContent(/about 1 second\b/);
    expect(note).not.toHaveTextContent(/memory/i);
  });

  it.each(['busy', 'memory', undefined])('offers a retry for a transient refusal (reason: %s)', (reason) => {
    const onRetry = vi.fn();
    render(<CapacityNotice error={capacity({ after: 3, reason })} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('does NOT promise a quick retry once refusals are sustained', () => {
    const onRetry = vi.fn();
    render(<CapacityNotice error={capacity({ transient: false, reason: 'memory' })} onRetry={onRetry} />);
    const note = screen.getByRole('status');
    // Saying "try again shortly" here would be a lie — the ledger has been refusing for a while.
    expect(note).toHaveTextContent(/not enough memory/i);
    expect(note).toHaveTextContent(/will not help/i);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('a sustained refusal that names no resource still says retrying will not help — without blaming memory', () => {
    render(<CapacityNotice error={capacity({ transient: false })} onRetry={vi.fn()} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(/will not help/i);
    expect(note).not.toHaveTextContent(/memory/i);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('★ treats a NON-capacity 503 as a real failure', () => {
    // The audit route answers 503 when no headless browser can be launched. That is not transient and
    // must not be dressed up as "busy" — which is why the server sends `code: capacity` and status
    // alone is not enough to tell them apart.
    const unavailable = new ApiError(503, 'page-speed audit is unavailable: no headless browser could be launched');
    render(<CapacityNotice error={unavailable} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(/no headless browser/i)).toBeInTheDocument();
  });

  it('falls back to a plain message for an ordinary error', () => {
    render(<CapacityNotice error={new Error('boom')} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

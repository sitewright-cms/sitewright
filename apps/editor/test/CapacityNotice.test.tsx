import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CapacityNotice } from '../src/views/ui/CapacityNotice';
import { ApiError } from '../src/api';

/**
 * A shed request is not a broken feature.
 *
 * The instance refuses work it cannot afford (a Lighthouse audit, a screenshot, an image encode) with
 * a 503. Rendered in the same red "it failed" alert as a genuine error, that taught authors the button
 * was broken and hid the only useful fact: come back in a moment. These pin the three cases apart.
 */
describe('CapacityNotice', () => {
  const capacity = (opts: { transient?: boolean; after?: number } = {}) =>
    new ApiError(503, 'temporarily out of capacity', undefined, opts.after, 'capacity', opts.transient ?? true);

  it('reports a transient refusal calmly, with the retry interval', () => {
    render(<CapacityNotice error={capacity({ after: 5 })} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(/not enough memory/i);
    expect(note).toHaveTextContent(/5 seconds/);
    // NOT the failure alert — nothing is broken.
    expect(note.className).not.toContain('rose');
  });

  it('offers a retry for a transient refusal', () => {
    const onRetry = vi.fn();
    render(<CapacityNotice error={capacity({ after: 3 })} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('does NOT promise a quick retry once refusals are sustained', () => {
    const onRetry = vi.fn();
    render(<CapacityNotice error={capacity({ transient: false })} onRetry={onRetry} />);
    const note = screen.getByRole('status');
    // Saying "try again shortly" here would be a lie — the ledger has been refusing for a while.
    expect(note).toHaveTextContent(/will not help/i);
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

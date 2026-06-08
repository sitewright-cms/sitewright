import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../src/views/ui/Toast';

function Trigger({ msg, kind }: { msg: string; kind?: 'success' | 'error' | 'info' }) {
  const toast = useToast();
  return (
    <button onClick={() => toast.show(msg, kind)}>fire</button>
  );
}

describe('ToastProvider / useToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a toast on show() and auto-dismisses it after the TTL', () => {
    render(
      <ToastProvider>
        <Trigger msg="Copied to clipboard" />
      </ToastProvider>,
    );
    expect(screen.queryByText('Copied to clipboard')).toBeNull();
    act(() => {
      fireEvent.click(screen.getByText('fire'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    expect(screen.queryByText('Copied to clipboard')).toBeNull();
  });

  it('applies the DaisyUI alert variant for the kind', () => {
    render(
      <ToastProvider>
        <Trigger msg="Saved" kind="success" />
      </ToastProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText('fire'));
    });
    // The alert item wraps the message span; assert it carries the DaisyUI success variant.
    expect(screen.getByText('Saved').parentElement?.className).toContain('alert-success');
  });

  it('useToast() is a safe no-op when used outside a provider', () => {
    render(<Trigger msg="x" />);
    expect(() => fireEvent.click(screen.getByText('fire'))).not.toThrow();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

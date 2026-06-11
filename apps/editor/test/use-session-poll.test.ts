import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionPoll } from '../src/lib/use-session-poll';

// jsdom defaults visibilityState to 'visible'; override it through a controllable getter.
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useSessionPoll', () => {
  it('invokes onPoll once per interval while active and visible (never immediately)', () => {
    const onPoll = vi.fn();
    renderHook(() => useSessionPoll(true, onPoll, 1000));
    expect(onPoll).not.toHaveBeenCalled(); // no probe on mount — only on the tick
    act(() => vi.advanceTimersByTime(1000));
    expect(onPoll).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(onPoll).toHaveBeenCalledTimes(3);
  });

  it('does nothing while inactive', () => {
    const onPoll = vi.fn();
    renderHook(() => useSessionPoll(false, onPoll, 1000));
    act(() => vi.advanceTimersByTime(5000));
    expect(onPoll).not.toHaveBeenCalled();
  });

  it('skips ticks while the tab is hidden', () => {
    const onPoll = vi.fn();
    visibility = 'hidden';
    renderHook(() => useSessionPoll(true, onPoll, 1000));
    act(() => vi.advanceTimersByTime(3000));
    expect(onPoll).not.toHaveBeenCalled();
    // …and resumes once the tab is visible again.
    visibility = 'visible';
    act(() => vi.advanceTimersByTime(1000));
    expect(onPoll).toHaveBeenCalledTimes(1);
  });

  it('probes immediately when the tab returns to the foreground (without waiting a full interval)', () => {
    const onPoll = vi.fn();
    visibility = 'hidden';
    renderHook(() => useSessionPoll(true, onPoll, 60_000));
    act(() => {
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onPoll).toHaveBeenCalledTimes(1);
    // The refocus probe must not disturb the interval — it keeps ticking on schedule.
    act(() => vi.advanceTimersByTime(60_000));
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it('stops polling when `active` flips to false (without unmounting)', () => {
    const onPoll = vi.fn();
    const { rerender } = renderHook(({ on }) => useSessionPoll(on, onPoll, 1000), { initialProps: { on: true } });
    act(() => vi.advanceTimersByTime(1000));
    expect(onPoll).toHaveBeenCalledTimes(1);
    rerender({ on: false }); // e.g. a 401 dropped the user back to the login screen
    act(() => vi.advanceTimersByTime(5000));
    expect(onPoll).toHaveBeenCalledTimes(1); // the interval was torn down by the dep-array cleanup
  });

  it('stops polling after unmount', () => {
    const onPoll = vi.fn();
    const { unmount } = renderHook(() => useSessionPoll(true, onPoll, 1000));
    act(() => vi.advanceTimersByTime(1000));
    expect(onPoll).toHaveBeenCalledTimes(1);
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(onPoll).toHaveBeenCalledTimes(1); // no further calls after teardown
  });

  it('does not reset the timer when only the onPoll closure changes (read via ref)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSessionPoll(true, cb, 1000), { initialProps: { cb: first } });
    act(() => vi.advanceTimersByTime(500)); // mid-interval
    rerender({ cb: second }); // a fresh closure must NOT restart the interval
    act(() => vi.advanceTimersByTime(500)); // completes the ORIGINAL 1000ms interval
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1); // the latest closure runs, on the preserved timer
  });
});

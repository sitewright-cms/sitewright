import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { scrollToTopNow, useScrollTopOnChange } from '../src/lib/scroll-top';

const INSTANT = { top: 0, left: 0, behavior: 'instant' };

afterEach(() => vi.restoreAllMocks());

describe('scrollToTopNow', () => {
  it('jumps to the top with no scroll animation, whatever CSS says about scroll-behavior', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    scrollToTopNow();
    expect(scrollTo).toHaveBeenCalledWith(INSTANT);
  });
});

describe('useScrollTopOnChange', () => {
  it('leaves the page alone on mount, and jumps to the top each time the value changes', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const { rerender } = renderHook(({ v }) => useScrollTopOnChange(v), { initialProps: { v: 'pages' } });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ v: 'forms' });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(INSTANT);
    rerender({ v: 'forms' }); // a re-render on the same value is not a change
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('skips a change the caller says is handled elsewhere — and still tracks it as the new previous value', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const shared = new Set(['corporate-identity', 'website-settings']);
    const skip = (prev: string, next: string) => shared.has(prev) && shared.has(next);
    const { rerender } = renderHook(({ v }) => useScrollTopOnChange(v, skip), { initialProps: { v: 'corporate-identity' } });
    rerender({ v: 'website-settings' });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ v: 'pages' });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { UIEvent } from 'react';
import { useScrollPaging } from '../src/lib/useScrollPaging';

/** A synthetic scroll event whose distance-from-bottom (scrollHeight - scrollTop - clientHeight) is `gap`. */
function scrollEvent(gap: number): UIEvent<HTMLElement> {
  return {
    currentTarget: { scrollHeight: gap + 200, scrollTop: 0, clientHeight: 200 },
  } as unknown as UIEvent<HTMLElement>;
}

describe('useScrollPaging', () => {
  it('starts at the page size', () => {
    const { result } = renderHook(() => useScrollPaging(500));
    expect(result.current.visible).toBe(50);
  });

  it('honours a custom page size', () => {
    const { result } = renderHook(() => useScrollPaging(500, 24));
    expect(result.current.visible).toBe(24);
  });

  it('appends a page when scrolled near the bottom', () => {
    const { result } = renderHook(() => useScrollPaging(500));
    act(() => result.current.onScroll(scrollEvent(0)));
    expect(result.current.visible).toBe(100);
    act(() => result.current.onScroll(scrollEvent(100)));
    expect(result.current.visible).toBe(150);
  });

  it('does nothing while scrolled far from the bottom', () => {
    const { result } = renderHook(() => useScrollPaging(500));
    act(() => result.current.onScroll(scrollEvent(500)));
    expect(result.current.visible).toBe(50);
  });

  it('stops growing once the total is reached', () => {
    const { result } = renderHook(() => useScrollPaging(70));
    act(() => result.current.onScroll(scrollEvent(0)));
    expect(result.current.visible).toBe(100); // 50 < 70 → +50
    act(() => result.current.onScroll(scrollEvent(0)));
    expect(result.current.visible).toBe(100); // 100 ≥ 70 → held
  });

  it('reset() returns to the page size', () => {
    const { result } = renderHook(() => useScrollPaging(500));
    act(() => result.current.onScroll(scrollEvent(0)));
    expect(result.current.visible).toBe(100);
    act(() => result.current.reset());
    expect(result.current.visible).toBe(50);
  });

  it('exposes a ref for the auto-fill scroll container', () => {
    // Auto-fill (load until the container overflows) needs real layout metrics, which jsdom does not
    // compute — it is verified by rendering in the browser. Here we just assert the ref is wired up;
    // under renderHook the ref stays null, so the auto-fill effect is a safe no-op.
    const { result } = renderHook(() => useScrollPaging(500));
    expect(result.current.ref).toMatchObject({ current: null });
  });
});

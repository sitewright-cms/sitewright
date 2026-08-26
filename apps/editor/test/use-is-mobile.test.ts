import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile, MOBILE_QUERY } from '../src/lib/use-is-mobile';

/**
 * A controllable `matchMedia`: reports `matches` for the mobile query and hands back the change
 * listener so a test can flip the viewport mid-render.
 */
function stubViewport(mobile: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === MOBILE_QUERY ? mobile : false,
    media: q,
    addListener() {},
    removeListener() {},
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  }));
  return {
    listeners,
    resize: (nowMobile: boolean) => act(() => listeners.forEach((cb) => cb({ matches: nowMobile } as MediaQueryListEvent))),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useIsMobile', () => {
  // ★ Pinned deliberately. This started at Tailwind's `sm` (640px) and moved to 1000px, because the
  // question is not "is this a phone" but "does the desktop chrome still fit" — and the header wants
  // ~560px of controls before the project name gets a pixel. A 900px tablet was being handed a layout
  // that technically fits and is miserable to use. It also means this line and `sm:` NO LONGER agree,
  // so the two are not interchangeable.
  it('draws the line at 1000px, not at Tailwind\'s `sm`', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 999.98px)');
  });

  // ★ THE LOAD-BEARING CASE. jsdom implements no `matchMedia` at all, so this is what every other
  // unit test in the suite sees — and they were all written against the desktop UI. If the hook ever
  // guessed `true` here, ~1500 tests would start asserting on chrome that is no longer rendered.
  it('reports DESKTOP where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('reports mobile for a phone-sized viewport, desktop otherwise', () => {
    stubViewport(true);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    vi.unstubAllGlobals();
    stubViewport(false);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it('follows the viewport across a resize or rotation', () => {
    const vp = stubViewport(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    vp.resize(true);
    expect(result.current).toBe(true);
    vp.resize(false);
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount — a listener firing into a dead tree is a jsdom teardown error', () => {
    const vp = stubViewport(true);
    const { unmount } = renderHook(() => useIsMobile());
    expect(vp.listeners).toHaveLength(1);
    unmount();
    expect(vp.listeners).toHaveLength(0);
  });
});

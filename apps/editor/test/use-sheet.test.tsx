import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSheet } from '../src/views/settings/board/use-sheet';

// A settings sheet outlives its own close: Modal plays an exit animation and only then calls `onClose`.
// These pin what the board must hold true across that gap — see the hook for the two ways it went wrong.
describe('useSheet — an opening, not just a key', () => {
  it('opens and closes a sheet', () => {
    const { result } = renderHook(() => useSheet<'identity' | 'contact'>());
    expect(result.current.sheet).toBeNull();
    act(() => result.current.setSheet('identity'));
    expect(result.current.sheet).toBe('identity');
    act(() => result.current.close());
    expect(result.current.sheet).toBeNull();
  });

  // Clicking the tile of a sheet that is still closing: the same key again. With a bare
  // `useState<Key | null>` nothing changed, so nothing re-rendered and the click was swallowed.
  it('gives the SAME sheet a new openKey every time it is opened', () => {
    const { result } = renderHook(() => useSheet<'identity'>());
    act(() => result.current.setSheet('identity'));
    const first = result.current.openKey;
    act(() => result.current.setSheet('identity'));
    expect(result.current.sheet).toBe('identity');
    expect(result.current.openKey).not.toBe(first);
  });

  // ★ The click that lands in the last instant: the old sheet's close and the new open arrive in ONE
  // batch. The open wins — and it must be a NEW opening, or the old instance (already invisible, its
  // close latched) stays mounted in its place: no dialog, and the page scroll-locked for good.
  it('a re-open batched with the previous close still lands on a new opening', () => {
    const { result } = renderHook(() => useSheet<'identity'>());
    act(() => result.current.setSheet('identity'));
    const first = result.current.openKey;
    const closeFirst = result.current.close;
    act(() => {
      closeFirst();
      result.current.setSheet('identity');
    });
    expect(result.current.sheet).toBe('identity');
    expect(result.current.openKey).not.toBe(first);
  });

  // A sheet that finishes its exit after it has been replaced must not close its replacement.
  it('a stale close cannot close a later opening', () => {
    const { result } = renderHook(() => useSheet<'identity' | 'contact'>());
    act(() => result.current.setSheet('identity'));
    const closeFirst = result.current.close;
    act(() => result.current.setSheet('contact'));
    act(() => closeFirst());
    expect(result.current.sheet).toBe('contact');
    // …while the current opening's own close still works.
    act(() => result.current.close());
    expect(result.current.sheet).toBeNull();
  });
});

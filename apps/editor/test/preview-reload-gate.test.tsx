import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { INLINE_EDIT_QUIET_MS, usePreviewReloadGate } from '../src/lib/preview-reload-gate';

/**
 * When an editor may reload a preview the author types into. A reload renders the SERVER's copy, so one
 * that lands before the typing is saved wipes the keystrokes off the screen — and the next edit to that
 * text is read back off the screen, so they are then lost for good.
 */
describe('usePreviewReloadGate', () => {
  let idle: boolean;
  const onReload = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    idle = true;
    onReload.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const mount = () => renderHook(() => usePreviewReloadGate({ isIdle: () => idle, onReload })).result;
  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('reloads at once when nobody is typing and nothing is being saved', () => {
    const gate = mount();
    gate.current.request();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('★ waits for typing to pause — and every keystroke pushes the reload further out', async () => {
    const gate = mount();
    gate.current.noteEdit();
    gate.current.request();
    expect(onReload).not.toHaveBeenCalled();

    await tick(INLINE_EDIT_QUIET_MS - 100);
    gate.current.noteEdit(); // still typing
    await tick(INLINE_EDIT_QUIET_MS - 100);
    expect(onReload).not.toHaveBeenCalled();

    await tick(100);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('★ waits for the stores to finish saving, however long that takes after the pause', async () => {
    const gate = mount();
    idle = false;
    gate.current.request();
    await tick(10_000);
    expect(onReload).not.toHaveBeenCalled();

    idle = true;
    await tick(200);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a second request while one is pending reloads once, not twice', async () => {
    const gate = mount();
    gate.current.noteEdit();
    gate.current.request();
    gate.current.request();
    await tick(INLINE_EDIT_QUIET_MS * 3);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('admits a render nobody typed through', () => {
    const gate = mount();
    const ticket = gate.current.begin();
    expect(gate.current.admit(ticket)).toBe(true);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('★ refuses a render that was typed through, and renders again once typing pauses', async () => {
    const gate = mount();
    const ticket = gate.current.begin();
    gate.current.noteEdit(); // typed while the render was on its way
    expect(gate.current.admit(ticket)).toBe(false);
    expect(onReload).not.toHaveBeenCalled();

    await tick(INLINE_EDIT_QUIET_MS);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('★ a document typed into while it was loading (into the OLD one) is rendered again', async () => {
    const gate = mount();
    expect(gate.current.admit(gate.current.begin())).toBe(true);
    gate.current.noteEdit(); // the old document still had the caret
    gate.current.loaded();
    await tick(INLINE_EDIT_QUIET_MS);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a document that loaded undisturbed asks for nothing — nor does one the gate never admitted', async () => {
    const gate = mount();
    expect(gate.current.admit(gate.current.begin())).toBe(true);
    gate.current.loaded();
    gate.current.noteEdit();
    gate.current.loaded(); // a `ready` with no admitted render behind it (the first document, a re-post)
    await tick(INLINE_EDIT_QUIET_MS * 2);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('unmounting drops a pending reload', async () => {
    const { result, unmount } = renderHook(() => usePreviewReloadGate({ isIdle: () => idle, onReload }));
    result.current.noteEdit();
    result.current.request();
    unmount();
    await tick(INLINE_EDIT_QUIET_MS * 2);
    expect(onReload).not.toHaveBeenCalled();
  });
});

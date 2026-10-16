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

  it('a document that loaded undisturbed asks for nothing — nor does a `ready` before any render was admitted', async () => {
    const first = mount();
    first.current.noteEdit();
    first.current.loaded(); // the editor's first document: no admitted render behind it
    const gate = mount();
    expect(gate.current.admit(gate.current.begin())).toBe(true);
    gate.current.loaded();
    await tick(INLINE_EDIT_QUIET_MS * 2);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('★ refuses a render that BEGAN while typing was still unsaved — whatever started it', async () => {
    const gate = mount();
    idle = false; // typed, and the save has not landed: the render will show the server's older copy
    const ticket = gate.current.begin();
    idle = true;
    expect(gate.current.admit(ticket)).toBe(false);
    await tick(INLINE_EDIT_QUIET_MS);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('every `ready` is checked against the last render admitted, so a late one cannot use the check up', async () => {
    const gate = mount();
    expect(gate.current.admit(gate.current.begin())).toBe(true);
    gate.current.loaded(); // e.g. the previous document's `ready`, delivered late
    gate.current.noteEdit(); // typed into the old document while the admitted one loads
    gate.current.loaded(); // the admitted document's own `ready`
    await tick(INLINE_EDIT_QUIET_MS);
    expect(onReload).toHaveBeenCalledTimes(1);
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

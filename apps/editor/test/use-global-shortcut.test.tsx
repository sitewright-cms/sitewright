import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useGlobalShortcut, shortcutLabel, type Shortcut } from '../src/lib/use-global-shortcut';
import { OVERLAY_STACK } from '../src/views/ui/overlay';

const TW: Shortcut[] = [
  { key: 't', mod: true, alt: true },
  { key: 'k', mod: true, shift: true },
];

function Harness({ onFire, enabled = true }: { onFire: () => void; enabled?: boolean }) {
  useGlobalShortcut(TW, onFire, enabled);
  return (
    <>
      <input aria-label="field" />
      <div contentEditable aria-label="rich" />
    </>
  );
}

afterEach(() => {
  cleanup();
  OVERLAY_STACK.length = 0;
});

describe('useGlobalShortcut', () => {
  it('fires on the primary chord', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('fires on the alternate chord too', () => {
    // Ctrl+Alt+T is GNOME's "open terminal" and never reaches the browser there, so the alternate
    // has to work on its own.
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('accepts the Meta key as the modifier, for macOS', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireEvent.keyDown(window, { key: 'T', metaKey: true, altKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('ignores the key without its modifiers', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.keyDown(window, { key: 't', ctrlKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('does not fire while the user is typing in a field', () => {
    const onFire = vi.fn();
    const { getByLabelText } = render(<Harness onFire={onFire} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('does not fire while the user is typing in a contentEditable', () => {
    const onFire = vi.fn();
    const { getByLabelText } = render(<Harness onFire={onFire} />);
    const rich = getByLabelText('rich');
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(rich, 'isContentEditable', { value: true });
    fireEvent.keyDown(rich, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('does not fire behind an open overlay', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    OVERLAY_STACK.push({});
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('unregisters entirely when disabled, so it cannot swallow the key', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} enabled={false} />);
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    const onFire = vi.fn();
    const { unmount } = render(<Harness onFire={onFire} />);
    unmount();
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });
});

describe('shortcutLabel', () => {
  it('writes the chord the way the platform does', () => {
    // jsdom reports a non-Mac platform, so this is the Windows/Linux spelling.
    expect(shortcutLabel({ key: 't', mod: true, alt: true })).toBe('Ctrl+Alt+T');
    expect(shortcutLabel({ key: 'k', mod: true, shift: true })).toBe('Ctrl+Shift+K');
  });
});

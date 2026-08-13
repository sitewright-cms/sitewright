import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useGlobalShortcut, shortcutLabel, type Shortcut } from '../src/lib/use-global-shortcut';
import { OVERLAY_STACK } from '../src/views/ui/overlay';

const TW: Shortcut[] = [
  { key: 't', mod: true, alt: true },
  { key: 'k', mod: true, shift: true },
];

/** A BARE-key shortcut — the only kind that can collide with typing. */
const BARE: Shortcut[] = [{ key: '/' }];

function Harness({
  onFire,
  enabled = true,
  overOverlays = false,
  shortcuts = TW,
}: {
  onFire: () => void;
  enabled?: boolean;
  overOverlays?: boolean;
  shortcuts?: Shortcut[];
}) {
  useGlobalShortcut(shortcuts, onFire, { enabled, overOverlays });
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

  it('DOES fire while typing — a modified chord produces no character to steal', () => {
    // The typing guard exists so a shortcut can't eat a keystroke meant for the text. Ctrl+Alt+T is
    // not a keystroke meant for the text, and suppressing it there meant the reference would not open
    // from inside the code editor — which is precisely where an author reaches for a reference.
    const onFire = vi.fn();
    const { getByLabelText } = render(<Harness onFire={onFire} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 't', ctrlKey: true, altKey: true });
    const rich = getByLabelText('rich');
    Object.defineProperty(rich, 'isContentEditable', { value: true }); // jsdom ignores the attribute
    fireEvent.keyDown(rich, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it('a BARE-key shortcut is still suppressed while typing', () => {
    const onFire = vi.fn();
    const { getByLabelText } = render(<Harness onFire={onFire} shortcuts={BARE} />);
    fireEvent.keyDown(getByLabelText('field'), { key: '/' });
    const rich = getByLabelText('rich');
    Object.defineProperty(rich, 'isContentEditable', { value: true });
    fireEvent.keyDown(rich, { key: '/' });
    expect(onFire).not.toHaveBeenCalled();
    // …and fires normally when focus is not in a text surface.
    fireEvent.keyDown(window, { key: '/' });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('does not fire behind an open overlay by default', () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);
    OVERLAY_STACK.push({});
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('fires over an open overlay when the shortcut opts in', () => {
    // For a shortcut that OPENS an overlay of its own: it stacks above, Escape unwinds it first, and
    // nothing behind it is touched. That is the opposite of acting on a page you can no longer see.
    const onFire = vi.fn();
    render(<Harness onFire={onFire} overOverlays />);
    OVERLAY_STACK.push({});
    OVERLAY_STACK.push({}); // two deep — e.g. a slot editor over the page editor
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
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

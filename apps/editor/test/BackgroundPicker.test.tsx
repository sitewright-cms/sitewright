// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ToastProvider } from '../src/views/ui/Toast';
import { BackgroundPicker } from '../src/views/library/BackgroundPicker';

// WebGL is unavailable in jsdom, so shaderRenderer() returns null and the canvas RAF loops bail — the
// settings + markup surface (what these tests exercise) still renders. Tests focus on the authored
// markup, which is the picker's actual output.

function open() {
  return render(
    <ToastProvider>
      <BackgroundPicker onClose={() => {}} />
    </ToastProvider>,
  );
}

const markup = (): string => screen.getByRole('code').textContent ?? '';

describe('BackgroundPicker — simplified markup + AUTO color slots', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light';
  });

  it('defaults to the project CI brand tokens and emits the simplified markup with a content placeholder', () => {
    open();
    const m = markup();
    // Brand-tracking default (theme-aware CI tokens), NOT a hardcoded palette.
    expect(m).toContain('<div data-sw-component="shader-bg" data-preset="mesh-gradient" data-angle="0" data-colors="primary,secondary,neutral">');
    expect(m).toContain('YOUR HTML CODE HERE');
    // the simplified sample does NOT carry the dropped knobs
    expect(m).not.toContain('data-speed');
    expect(m).not.toContain('data-intensity');
    expect(m).not.toContain('data-interactive');
    expect(m).not.toContain('data-sw-part="overlay"');
  });

  it('sets a slot to the AUTO token via its mode select', () => {
    open();
    fireEvent.change(screen.getByLabelText('Color 2'), { target: { value: 'auto' } });
    expect(markup()).toContain('data-colors="primary,auto,neutral"');
  });

  it('a slot can bind to a different CI token, and a Custom color reveals the swatch', () => {
    open();
    fireEvent.change(screen.getByLabelText('Color 1'), { target: { value: 'accent' } });
    expect(markup()).toContain('data-colors="accent,secondary,neutral"');
    // Switch slot 3 to custom → the color input appears and its hex is emitted.
    fireEvent.change(screen.getByLabelText('Color 3'), { target: { value: 'custom' } });
    const swatch = screen.getByLabelText('Color 3 custom color') as HTMLInputElement;
    fireEvent.change(swatch, { target: { value: '#123456' } });
    expect(markup()).toContain('data-colors="accent,secondary,#123456"');
  });

  it('a quick palette sets all three to custom literal colors', () => {
    open();
    fireEvent.click(screen.getByTitle('Sunset'));
    expect(markup()).toContain('data-colors="#fb7185,#fbbf24,#1e1b4b"');
  });

  it('reflects the chosen angle in the markup', () => {
    open();
    const angle = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(angle, { target: { value: '135' } });
    expect(markup()).toContain('data-angle="135"');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ToastProvider } from '../src/views/ui/Toast';
import { BackgroundPicker } from '../src/views/library/BackgroundPicker';
import { api } from '../src/api';

// WebGL is unavailable in jsdom, so shaderRenderer() returns null and the canvas RAF loops bail — the
// settings + markup surface (what these tests exercise) still renders. Tests focus on the authored
// markup, which is the picker's actual output.

function open(props: Partial<Parameters<typeof BackgroundPicker>[0]> = {}) {
  return render(
    <ToastProvider>
      <BackgroundPicker onClose={() => {}} {...props} />
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

  it('shows the platform-background admin buttons ONLY for an instance admin', () => {
    open({ isInstanceAdmin: false });
    expect(screen.queryByRole('button', { name: /use as platform background/i })).toBeNull();
    open({ isInstanceAdmin: true });
    expect(screen.getByRole('button', { name: /use as platform background/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear platform background/i })).toBeInTheDocument();
  });

  it('"Use as platform background" PUTs the current config (preset + angle + slot tokens)', async () => {
    const put = vi.spyOn(api, 'putInstanceSettings').mockResolvedValue({} as never);
    open({ isInstanceAdmin: true });
    fireEvent.change(screen.getByLabelText('Color 2'), { target: { value: 'auto' } });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /use as platform background/i }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({ platformBackground: { preset: 'mesh-gradient', angle: 90, colors: ['primary', 'auto', 'neutral'] } }),
    );
    put.mockRestore();
  });

  it('"Clear platform background" PUTs null', async () => {
    const put = vi.spyOn(api, 'putInstanceSettings').mockResolvedValue({} as never);
    open({ isInstanceAdmin: true });
    fireEvent.click(screen.getByRole('button', { name: /clear platform background/i }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ platformBackground: null }));
    put.mockRestore();
  });
});

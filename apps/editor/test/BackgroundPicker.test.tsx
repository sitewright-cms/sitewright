// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '../src/views/ui/Toast';
import { BackgroundPicker } from '../src/views/library/BackgroundPicker';
import { api } from '../src/api';
import { CiPaletteProvider } from '../src/lib/ci-palette';

// WebGL is unavailable in jsdom, so shaderRenderer() returns null and the canvas RAF loops bail — the
// settings + markup surface (what these tests exercise) still renders. Tests focus on the authored
// markup, which is the picker's actual output.

function open(props: Partial<Parameters<typeof BackgroundPicker>[0]> = {}, identity?: { colors: Record<string, string> }) {
  return render(
    <ToastProvider>
      {/* `identity` present = a project is open, so its CI palette is what the studio resolves against. */}
      <CiPaletteProvider identity={identity as never}>
        <BackgroundPicker onClose={() => {}} {...props} />
      </CiPaletteProvider>
    </ToastProvider>,
  );
}

const markup = (): string => screen.getByRole('code').textContent ?? '';

describe('BackgroundPicker — minimal markup, AUTO color slots + knobs', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light';
  });

  it('defaults to the project CI brand tokens and emits the minimal markup with a content placeholder', () => {
    open();
    const m = markup();
    // Brand-tracking default (theme-aware CI tokens), NOT a hardcoded palette.
    expect(m).toContain('<div data-sw-component="shader-bg" data-preset="mesh-gradient" data-angle="0" data-colors="primary,secondary,neutral">');
    expect(m).toContain('YOUR HTML CODE HERE');
    // With every knob at its default the sample stays minimal — an attribute appears ONLY when its knob
    // is moved off the default (asserted below), so the paste-ready default has no noise.
    expect(m).not.toContain('data-speed');
    expect(m).not.toContain('data-intensity');
    expect(m).not.toContain('data-interactive');
    expect(m).not.toContain('data-sw-part="overlay"');
  });

  it('emits data-speed / data-intensity only when moved off their defaults', () => {
    open();
    fireEvent.change(screen.getByRole('slider', { name: /speed/i }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('slider', { name: /intensity/i }), { target: { value: '0.8' } });
    const m = markup();
    expect(m).toContain('data-speed="2"');
    expect(m).toContain('data-intensity="0.8"');
  });

  it('drops data-speed again once the knob is returned to its default (round-trip invariant)', () => {
    open();
    const speed = screen.getByRole('slider', { name: /speed/i });
    fireEvent.change(speed, { target: { value: '2' } });
    expect(markup()).toContain('data-speed="2"');
    // Back to the runtime default (1) → the attribute disappears, keeping the sample minimal.
    fireEvent.change(speed, { target: { value: '1' } });
    expect(markup()).not.toContain('data-speed');
  });

  it('emits data-interactive when Pointer-interactive is enabled', () => {
    open();
    fireEvent.click(screen.getByLabelText(/pointer-interactive/i));
    expect(markup()).toContain('data-interactive="true"');
  });

  it('adds the legibility overlay child when the overlay is enabled', () => {
    open();
    fireEvent.click(screen.getByLabelText(/text-legibility overlay/i));
    expect(markup()).toContain('<div data-sw-part="overlay" class="bg-black/30"></div>');
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
    // Switch slot 3 to custom → the shared picker's swatch button appears, seeded from that token.
    fireEvent.change(screen.getByLabelText('Color 3'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('Edit Color 3 custom color')).toBeInTheDocument();
    // `neutral`'s platform default — the colour that was on screen a moment ago.
    expect(markup()).toContain('data-colors="accent,secondary,#171627"');
  });

  it('a quick palette sets all three to custom literal colors', () => {
    open();
    fireEvent.click(screen.getByTitle('Sunset'));
    expect(markup()).toContain('data-colors="#fb7185,#fbbf24,#1e1b4b"');
  });

  it('reflects the chosen angle in the markup', () => {
    open();
    const angle = screen.getByRole('slider', { name: /angle/i }) as HTMLInputElement;
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
    fireEvent.change(screen.getByRole('slider', { name: /angle/i }), { target: { value: '90' } });
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

describe('★ CI slots resolve against the OPEN PROJECT’s brand', () => {
  // jsdom cannot evaluate `var()` and gives no WebGL context, so the painted preview is unobservable
  // here — `slotCssExpr` has its own unit tests for the colour maths. What IS observable is the seed
  // the picker takes when a slot leaves a CI token: it becomes the emitted literal, which proves the
  // project's palette reached the component. Asserting the MARKUP rather than a widget's value also
  // means the test survives the control being swapped out, which is exactly what just happened to it.
  it('seeds a custom slot from the PROJECT’s colour when a project is open', () => {
    open({}, { colors: { primary: '#ff0000', secondary: '#00ff00', neutral: '#0000ff' } });
    fireEvent.change(screen.getByLabelText('Color 1'), { target: { value: 'custom' } });
    expect(markup()).toContain('data-colors="#ff0000,secondary,neutral"');
  });

  it('seeds from the PLATFORM palette when no project is open', () => {
    open(); // no identity → no project
    fireEvent.change(screen.getByLabelText('Color 1'), { target: { value: 'custom' } });
    expect(markup()).toContain('data-colors="#4f46e5,secondary,neutral"');
  });

  it('falls back per token when the project defines only some', () => {
    open({}, { colors: { primary: '#ff0000' } });
    // slot 2 defaults to `secondary`, which this project does not define → the platform value.
    fireEvent.change(screen.getByLabelText('Color 2'), { target: { value: 'custom' } });
    expect(markup()).toContain('data-colors="primary,#0ea5e9,neutral"');
  });

  it('★ offers the project’s brand as one-click swatches inside the picker', () => {
    // The reason the shared picker replaced the native input: the colours a background most wants are
    // the project's own, and a colour wheel is the wrong amount of work to reach them.
    open({}, { colors: { primary: '#ff0000', secondary: '#00ff00' } });
    fireEvent.change(screen.getByLabelText('Color 1'), { target: { value: 'custom' } });
    fireEvent.click(screen.getByLabelText('Use secondary for Color 1 custom color'));
    expect(markup()).toContain('data-colors="#00ff00,secondary,neutral"');
  });
});

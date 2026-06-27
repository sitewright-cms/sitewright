import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LibraryPanel } from '../src/views/library/LibraryPanel';

// The preview is a same-origin iframe `src` (updates pushed via postMessage); stub the clipboard for copy.
beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

async function openBuilder() {
  render(<LibraryPanel />);
  fireEvent.mouseEnter(screen.getByLabelText('System Library'));
  fireEvent.click(screen.getByRole('button', { name: /Parallax builder/ }));
  return screen.findByRole('dialog', { name: 'Parallax builder' });
}

describe('ParallaxBuilder', () => {
  it('shows the featured card in the Library panel', () => {
    render(<LibraryPanel />);
    fireEvent.mouseEnter(screen.getByLabelText('System Library'));
    expect(screen.getByRole('button', { name: /Parallax builder/ })).toBeInTheDocument();
  });

  it('emits a from→to motion by default and adds channels as they are toggled', async () => {
    const dialog = await openBuilder();
    expect(dialog).toHaveTextContent('data-sw-parallax-translate="40,-40"');
    expect(dialog).not.toHaveTextContent('data-sw-parallax-opacity');

    fireEvent.click(within(dialog).getByLabelText('Opacity'));
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity="0,1"');

    fireEvent.click(within(dialog).getByLabelText('Blur (px)'));
    expect(dialog).toHaveTextContent('data-sw-parallax-blur="8,0"');
  });

  it('validates values — opacity is clamped to its 0–1 range (both ends)', async () => {
    const dialog = await openBuilder();
    fireEvent.click(within(dialog).getByLabelText('Opacity'));
    fireEvent.change(within(dialog).getByLabelText('Opacity to'), { target: { value: '9' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity="0,1"'); // 9 → 1
    fireEvent.change(within(dialog).getByLabelText('Opacity from'), { target: { value: '-4' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity="0,1"'); // -4 → 0
  });

  it('Viewport: a preset/custom window emits -range; inputs are PERCENT (0–100 → 0–1)', async () => {
    const dialog = await openBuilder();
    fireEvent.click(within(dialog).getByLabelText('Opacity'));

    // through-view default → no -range, no OUT
    expect(dialog).not.toHaveTextContent('data-sw-parallax-opacity-range');
    expect(within(dialog).queryByLabelText('Opacity animate out')).toBeNull();

    // Bottom-To-Center preset → 0–50% → 0,0.5
    fireEvent.change(within(dialog).getByLabelText('Opacity viewport'), { target: { value: 'center' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-range="0,0.5"');

    // custom % → 0 → 30 → 0,0.3
    fireEvent.change(within(dialog).getByLabelText('Opacity viewport'), { target: { value: 'custom' } });
    fireEvent.change(within(dialog).getByLabelText('Opacity viewport to'), { target: { value: '30' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-range="0,0.3"');
  });

  it('OUT phase: from is LOCKED to the In ‘to’, and the out-range start makes a HOLD', async () => {
    const dialog = await openBuilder();
    fireEvent.click(within(dialog).getByLabelText('Opacity'));
    fireEvent.change(within(dialog).getByLabelText('Opacity viewport'), { target: { value: 'center' } });
    fireEvent.click(within(dialog).getByLabelText('Opacity animate out'));

    // out from = In 'to' (1), out to = default reverse (0); out-range default = [inEnd 50%, 100%]
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-out="1,0"');
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-out-range="0.5,1"');

    // the 'out from' field is locked + mirrors the In 'to'
    const outFrom = within(dialog).getByLabelText('Opacity out from') as HTMLInputElement;
    expect(outFrom).toBeDisabled();
    expect(outFrom.value).toBe('1');
    fireEvent.change(within(dialog).getByLabelText('Opacity to'), { target: { value: '0.8' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-out="0.8,0"');

    // push the out start later → a HOLD between the in end (50%) and the out start (70%)
    fireEvent.change(within(dialog).getByLabelText('Opacity out from-range'), { target: { value: '70' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-out-range="0.7,1"');

    // collapse the out window (end ≤ start) → emit NO -out at all (matches the engine, no divergence)
    fireEvent.change(within(dialog).getByLabelText('Opacity out to-range'), { target: { value: '70' } });
    expect(dialog).not.toHaveTextContent('data-sw-parallax-opacity-out');
  });

  it('loads the preview by a STATIC src (no query) so value changes never reload it', async () => {
    const dialog = await openBuilder();
    const iframe = within(dialog).getByTitle('Parallax preview') as HTMLIFrameElement;
    expect(iframe.getAttribute('srcdoc')).toBeNull();
    const src = iframe.getAttribute('src') ?? '';
    expect(src).toContain('/authoring/parallax-preview');
    expect(src).not.toContain('?'); // static — config is pushed via postMessage, not the URL
  });

  it('switches the translate axis and copies the markup', async () => {
    const dialog = await openBuilder();
    fireEvent.change(within(dialog).getByLabelText('Parallax axis'), { target: { value: 'x' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-axis="x"');

    fireEvent.click(within(dialog).getByRole('button', { name: /Copy markup/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('data-sw-parallax-translate="40,-40"'));
  });
});

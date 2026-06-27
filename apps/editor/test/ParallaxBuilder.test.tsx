import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { LibraryPanel } from '../src/views/library/LibraryPanel';

// The preview is a same-origin iframe `src` (no fetch); just stub the clipboard for the copy test.
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

  it('emits a from→to translate by default and adds channels as they are toggled', async () => {
    const dialog = await openBuilder();
    // motion is now a from→to translate (px), on by default
    expect(dialog).toHaveTextContent('data-sw-parallax-translate="40,-40"');
    expect(dialog).not.toHaveTextContent('data-sw-parallax-opacity');

    fireEvent.click(within(dialog).getByLabelText('Opacity'));
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity="0,1"');

    fireEvent.click(within(dialog).getByLabelText('Blur (px)'));
    expect(dialog).toHaveTextContent('data-sw-parallax-blur="8,0"');
  });

  it('gives each effect its own window + an OUT phase only when the window leaves room', async () => {
    const dialog = await openBuilder();
    fireEvent.click(within(dialog).getByLabelText('Opacity'));

    // a full-pass-through channel (inheriting the default Through-view window) offers NO out phase
    expect(within(dialog).queryByLabelText('Opacity animate out')).toBeNull();

    // narrow opacity to "reveal to centre" → its own window is emitted AND an OUT toggle appears
    fireEvent.change(within(dialog).getByLabelText('Opacity window'), { target: { value: 'centre' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-range="0,0.5"');
    const outToggle = within(dialog).getByLabelText('Opacity animate out');

    fireEvent.click(outToggle); // enable the OUT phase → reverse values over the remainder by default
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity-out="1,0"');
  });

  it('loads the preview by src (NOT srcdoc) and threads the channel knobs into the query', async () => {
    const dialog = await openBuilder();
    const iframe = within(dialog).getByTitle('Parallax preview') as HTMLIFrameElement;
    expect(iframe.getAttribute('srcdoc')).toBeNull();
    const src = iframe.getAttribute('src') ?? '';
    expect(src).toContain('/authoring/parallax-preview?');
    expect(decodeURIComponent(src)).toContain('translate=40,-40');

    fireEvent.click(within(dialog).getByLabelText('Scale'));
    await waitFor(() => expect(decodeURIComponent(iframe.getAttribute('src') ?? '')).toContain('scale=0.9,1.05'));
  });

  it('switches the translate axis and copies the markup', async () => {
    const dialog = await openBuilder();
    fireEvent.change(within(dialog).getByLabelText('Parallax axis'), { target: { value: 'x' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-axis="x"');

    fireEvent.click(within(dialog).getByRole('button', { name: /Copy markup/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('data-sw-parallax-translate="40,-40"'));
  });
});

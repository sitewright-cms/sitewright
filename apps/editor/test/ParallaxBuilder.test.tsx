import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { LibraryPanel } from '../src/views/library/LibraryPanel';

// The preview is now a same-origin iframe `src` (no fetch); just stub the clipboard for the copy test.
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

  it('emits data-sw-parallax markup and adds channels as they are toggled', async () => {
    const dialog = await openBuilder();
    // base: the speed channel is always emitted
    expect(dialog).toHaveTextContent('data-sw-parallax="0.3"');
    expect(dialog).not.toHaveTextContent('data-sw-parallax-opacity');

    // toggle opacity → its from,to attribute appears
    fireEvent.click(within(dialog).getByLabelText('Opacity'));
    expect(dialog).toHaveTextContent('data-sw-parallax-opacity="0,1"');

    // toggle blur → appears too (composable)
    fireEvent.click(within(dialog).getByLabelText('Blur (px)'));
    expect(dialog).toHaveTextContent('data-sw-parallax-blur="8,0"');
  });

  it('preview loads the same-origin sandboxed route by src (NOT srcdoc) so the runtime runs under its CSP', async () => {
    const dialog = await openBuilder();
    const iframe = within(dialog).getByTitle('Parallax preview') as HTMLIFrameElement;
    // srcDoc would inherit the editor's `script-src 'self'` CSP and freeze the runtime — must be `src`.
    expect(iframe.getAttribute('srcdoc')).toBeNull();
    const src = iframe.getAttribute('src') ?? '';
    expect(src).toContain('/authoring/parallax-preview?');
    expect(src).toContain('speed=0.3');
    // toggling a channel threads it through the query string (server clamps + renders it)
    fireEvent.click(within(dialog).getByLabelText('Opacity'));
    await waitFor(() => expect(decodeURIComponent(iframe.getAttribute('src') ?? '')).toContain('opacity=0,1'));
  });

  it('switches the translate axis and copies the markup', async () => {
    const dialog = await openBuilder();
    fireEvent.change(within(dialog).getByLabelText('Parallax axis'), { target: { value: 'x' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-axis="x"');

    fireEvent.click(within(dialog).getByRole('button', { name: /Copy markup/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('data-sw-parallax="0.3"'));
  });
});

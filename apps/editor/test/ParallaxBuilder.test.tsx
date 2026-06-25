import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LibraryPanel } from '../src/views/library/LibraryPanel';

// The builder fetches the runtime for its preview iframe; stub it so the modal mounts cleanly.
beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ css: '', js: '' }) } as Response),
  );
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

  it('switches the translate axis and copies the markup', async () => {
    const dialog = await openBuilder();
    fireEvent.change(within(dialog).getByLabelText('Parallax axis'), { target: { value: 'x' } });
    expect(dialog).toHaveTextContent('data-sw-parallax-axis="x"');

    fireEvent.click(within(dialog).getByRole('button', { name: /Copy markup/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('data-sw-parallax="0.3"'));
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LibraryPanel } from '../src/views/library/LibraryPanel';

beforeEach(() => {
  // jsdom has no clipboard by default.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('LibraryPanel', () => {
  it('expands on hover and lists the section buttons', () => {
    render(<LibraryPanel />);
    fireEvent.mouseEnter(screen.getByLabelText('Library'));
    for (const name of [/Icons/, /AOS/, /Lazy-load/, /Ripple effect/, /DaisyUI components/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('opens a section gallery modal, searches within it, and copies an example', async () => {
    render(<LibraryPanel />);
    fireEvent.mouseEnter(screen.getByLabelText('Library'));
    fireEvent.click(screen.getByRole('button', { name: /DaisyUI components/ }));

    const dialog = await screen.findByRole('dialog', { name: 'DaisyUI components' });
    expect(within(dialog).getByText('Card')).toBeInTheDocument();
    expect(within(dialog).getByText('Hero')).toBeInTheDocument();

    // Search filters within the section.
    fireEvent.change(within(dialog).getByLabelText('Search DaisyUI components'), { target: { value: 'hero' } });
    expect(within(dialog).getByText('Hero')).toBeInTheDocument();
    expect(within(dialog).queryByText('Card')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('hero'));
    expect(await within(dialog).findByText('Copied!')).toBeInTheDocument();
  });

  it('renders a live preview for DaisyUI components (real markup, Handlebars neutralized)', async () => {
    render(<LibraryPanel />);
    fireEvent.mouseEnter(screen.getByLabelText('Library'));
    fireEvent.click(screen.getByRole('button', { name: /DaisyUI components/ }));
    const dialog = await screen.findByRole('dialog', { name: 'DaisyUI components' });
    fireEvent.change(within(dialog).getByLabelText('Search DaisyUI components'), { target: { value: 'navbar' } });
    // The Navbar example interpolates {{ company.name }} → neutralized in the preview.
    const preview = dialog.querySelector('.sw-preview')!;
    expect(preview.querySelector('.navbar')).not.toBeNull();
    expect(preview.innerHTML).not.toContain('{{');
  });

  it('lazy-loads the whole icon pack and copies an icon snippet on click', async () => {
    render(<LibraryPanel />);
    fireEvent.mouseEnter(screen.getByLabelText('Library'));
    fireEvent.click(screen.getByRole('button', { name: /^Icons/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Icons' });

    // Narrow via search BEFORE the (large) pack finishes loading: the search input is
    // always present (only the grid shows a skeleton), so the grid renders the tiny
    // filtered set instead of all 360 capped icons. This keeps the accessible-name scan
    // small and deterministic regardless of how slow the code-split import resolves under
    // CI's parallel-coverage load (the un-capped 360-button render can exceed findBy's
    // default 1s poll on a loaded runner).
    fireEvent.change(within(dialog).getByLabelText('Search Icons'), { target: { value: 'arrow-right' } });

    // Icons arrive via a dynamic import (code-split) — wait for the (now-filtered) grid.
    const iconBtn = await within(dialog).findByRole('button', { name: 'Copy arrow-right icon snippet' });
    fireEvent.click(iconBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{{icon "arrow-right" "h-5 w-5"}}');

    // Search by Lucide keyword tags too — "photo" finds "image".
    fireEvent.change(within(dialog).getByLabelText('Search Icons'), { target: { value: 'photo' } });
    expect(await within(dialog).findByRole('button', { name: 'Copy image icon snippet' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Copy arrow-right icon snippet' })).toBeNull();
  });

  it('lazy-loads the brand icons and copies a brand: snippet', async () => {
    render(<LibraryPanel />);
    fireEvent.mouseEnter(screen.getByLabelText('Library'));
    fireEvent.click(screen.getByRole('button', { name: /Brand icons/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Brand icons' });
    const gh = await within(dialog).findByRole('button', { name: 'Copy GitHub icon snippet' });
    fireEvent.click(gh);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{{icon "brand:github" "h-6 w-6"}}');
  });
});

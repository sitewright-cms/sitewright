import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LibraryPanel } from '../src/views/library/LibraryPanel';

beforeEach(() => {
  // jsdom has no clipboard by default.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('LibraryPanel', () => {
  it('opens from the edge handle and lists the library sections', () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    // The category headings are present.
    expect(screen.getByText('Icons')).toBeInTheDocument();
    expect(screen.getByText('AOS (scroll reveal)')).toBeInTheDocument();
    expect(screen.getByText('Lazy-load')).toBeInTheDocument();
    expect(screen.getByText('Ripple effect')).toBeInTheDocument();
    expect(screen.getByText('DaisyUI components')).toBeInTheDocument();
  });

  it('searches across items (e.g. "ripple") and filters out non-matches', () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 'ripple' } });
    expect(screen.getByText('Ripple effect')).toBeInTheDocument();
    expect(screen.queryByText('DaisyUI components')).toBeNull();
    expect(screen.queryByText('Icons')).toBeNull();
  });

  it('opens an item details modal with the example + copies it', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    // A DaisyUI Card item → details modal.
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Card' });
    expect(within(dialog).getByText(/Example/)).toBeInTheDocument();
    expect(within(dialog).getByText(/card-body/)).toBeInTheDocument(); // the example markup, as text
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('card bg-base-100'));
    expect(await within(dialog).findByText('Copied!')).toBeInTheDocument();
  });

  it('an icon item shows the {{icon}} snippet to copy', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    fireEvent.click(screen.getByRole('button', { name: 'arrow-right' }));
    const dialog = await screen.findByRole('dialog', { name: 'arrow-right' });
    expect(within(dialog).getByText('{{icon "arrow-right" "h-5 w-5"}}')).toBeInTheDocument();
  });
});

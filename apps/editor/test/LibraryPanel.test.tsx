import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LibraryPanel } from '../src/views/library/LibraryPanel';

beforeEach(() => {
  // jsdom has no clipboard by default.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.unstubAllGlobals(); // undo any per-test fetch stub (the API-driven icon gallery)
});

describe('LibraryPanel', () => {
  it('expands on hover and lists the section buttons', () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    for (const name of [/Icons/, /Animation/, /Lazy-load/, /Ripple effect/, /DaisyUI components/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('opens a section gallery modal, searches within it, and copies an example', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /DaisyUI components/ }));
    const dialog = await screen.findByRole('dialog', { name: 'DaisyUI components' });
    fireEvent.change(within(dialog).getByLabelText('Search DaisyUI components'), { target: { value: 'navbar' } });
    // The Navbar example interpolates {{ company.name }} → neutralized in the preview.
    const preview = dialog.querySelector('.sw-preview')!;
    expect(preview.querySelector('.navbar')).not.toBeNull();
    expect(preview.innerHTML).not.toContain('{{');
  });

  it('lazy-loads documented variants and toggles them with "Show all variants"', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /DaisyUI components/ }));
    const dialog = await screen.findByRole('dialog', { name: 'DaisyUI components' });
    fireEvent.change(within(dialog).getByLabelText('Search DaisyUI components'), { target: { value: 'breadcrumbs' } });
    // Variants are code-split (dynamic import) → the toggle appears once they load.
    const toggle = await within(dialog).findByRole('button', { name: /Show all variants \(\d+\)/ });
    fireEvent.click(toggle);
    expect(within(dialog).getByRole('button', { name: 'Hide variants' })).toBeInTheDocument();
    // A documented variant label is now revealed, each with its own Copy button.
    expect(within(dialog).getByText('Max-width scroll')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: 'Copy' }).length).toBeGreaterThan(1); // per-variant copies
  });

  it('makes previews INTERACTIVE (no pointer-events-none) but blocks preview-link navigation', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /DaisyUI components/ }));
    const dialog = await screen.findByRole('dialog', { name: 'DaisyUI components' });
    fireEvent.change(within(dialog).getByLabelText('Search DaisyUI components'), { target: { value: 'navbar' } });
    const preview = dialog.querySelector('.sw-preview') as HTMLElement;
    expect(preview.className).not.toContain('pointer-events-none'); // interactive now
    // A link inside the preview must NOT navigate the editor — the guard preventDefaults it.
    // fireEvent.click returns false when the default action was prevented.
    const link = preview.querySelector('a') as HTMLAnchorElement;
    expect(fireEvent.click(link)).toBe(false);
  });

  it('loads the API-driven icon pack, searches by name, and copies an icon snippet on click', async () => {
    // The Phosphor icon gallery is API-driven: it fetches the name list from /authoring/icons/names
    // and renders each visible glyph via /authoring/icons/render. jsdom has no server, so mock both.
    const NAMES = ['arrow-right', 'arrow-left', 'image', 'star', 'house'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/authoring/icons/names')) {
          return { ok: true, json: async () => ({ names: NAMES, weights: ['fill', 'regular', 'bold'] }) };
        }
        if (url.includes('/authoring/icons/render')) {
          const requested = decodeURIComponent(url.split('names=')[1] ?? '').split(',');
          const svgs = Object.fromEntries(requested.map((n) => [n, `<svg data-icon="${n}"></svg>`]));
          return { ok: true, json: async () => ({ svgs }) };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );

    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /^Icons/ }));
    // The Phosphor icon gallery's modal is titled "Icons — Phosphor" (section label + provider), so
    // match by prefix. Give it a generous timeout — the gallery is code-split + fetches on mount.
    const dialog = await screen.findByRole('dialog', { name: /^Icons/ }, { timeout: 15000 });

    // The search filters the name list (substring, incl. dash→space) → the grid shows the tiny match.
    fireEvent.change(within(dialog).getByLabelText('Search icons'), { target: { value: 'arrow-right' } });
    const iconBtn = await within(dialog).findByRole('button', { name: 'Copy arrow-right icon snippet' }, { timeout: 15000 });
    fireEvent.click(iconBtn);
    // Default weight is `fill` → the snippet carries no weight suffix.
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{{sw-icon "arrow-right" "h-5 w-5"}}');

    // Re-searching narrows to a different icon and drops the previous match.
    fireEvent.change(within(dialog).getByLabelText('Search icons'), { target: { value: 'image' } });
    expect(await within(dialog).findByRole('button', { name: 'Copy image icon snippet' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Copy arrow-right icon snippet' })).toBeNull();
  }, 20000);

  it('lazy-loads the brand icons and copies a brand: snippet', async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /Brand icons/ }));
    // Same lazy-Suspense caveat as the Icons dialog: if THIS test is the first to trigger the
    // code-split `import('./catalog-icons')`, the dialog can take several seconds to mount under CI.
    const dialog = await screen.findByRole('dialog', { name: 'Brand icons' }, { timeout: 15000 });
    // The grid lazy-loads a page at a time (50) and appends more on scroll, so a deep entry like
    // GitHub isn't in the initial render — search to surface it (jsdom can't drive real scroll).
    // Same code-split module as the icon pack — generous timeout in case this test is the
    // first to trigger the (slow-under-CI) `import('./catalog-icons')`.
    fireEvent.change(within(dialog).getByLabelText('Search Brand icons'), { target: { value: 'github' } });
    const gh = await within(dialog).findByRole('button', { name: 'Copy GitHub icon snippet' }, { timeout: 15000 });
    fireEvent.click(gh);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{{sw-icon "brand:github" "h-6 w-6"}}');
  }, 20000);
});

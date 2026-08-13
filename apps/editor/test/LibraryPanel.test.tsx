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
  it('lists the consolidated, grouped library cards', () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    // 11 cards across 3 groups (each card's accessible name = title + blurb).
    for (const name of [
      /Template reference/,
      /SiteWright Components/,
      /TailwindCSS Reference/,
      /DaisyUI components/,
      /Icons & flags/,
      /Google Fonts/,
      /Animated backgrounds/,
      /Textures/,
      /Button builder/,
      /Parallax builder/,
      /SVG animation studio/,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // The old flat effect entries are gone — folded into SiteWright Components.
    expect(screen.queryByRole('button', { name: /^Lazy-load/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Ripple effect/ })).toBeNull();
    // Group headings anchor the three sections.
    expect(screen.getByRole('heading', { name: 'Reference' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Builders & Studios' })).toBeInTheDocument();
  });

  it('opens the Textures picker, lists API textures, and copies a CI-tinted CSS snippet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ names: ['cartographer', 'paper', 'denim'] }) }),
    );
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /Textures/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Textures' });
    // A texture thumbnail (fetched from /authoring/textures) is clickable.
    fireEvent.click(await within(dialog).findByTitle('cartographer'));
    // Choose the Primary CI colour → the snippet emits a var(--sw-color-*) token (re-tints on the site).
    fireEvent.click(within(dialog).getByTitle(/Primary Color — var\(--sw-color-primary\)/));
    const code = dialog.querySelector('pre code');
    expect(code?.textContent).toContain('background-color: var(--sw-color-primary);');
    expect(code?.textContent).toContain('url("/authoring/textures/cartographer.png")');

    fireEvent.click(within(dialog).getByRole('button', { name: /Copy CSS/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/authoring/textures/cartographer.png'));
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
    fireEvent.click(screen.getByRole('button', { name: /Icons & flags/ }));
    // Icons/brand/flags now share one modal titled "Icons & flags"; the Icons tab is the default.
    // Give it a generous timeout — the gallery fetches on mount.
    const dialog = await screen.findByRole('dialog', { name: 'Icons & flags' }, { timeout: 15000 });

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

  it('switches to the Brand tab (lazy-loaded) and copies a brand: snippet', async () => {
    // The default Icons tab fetches on mount — stub it so the real network isn't hit before we
    // switch to Brand (which needs no fetch, just the code-split `import('./catalog-icons')`).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /Icons & flags/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Icons & flags' }, { timeout: 15000 });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Brand' }));
    // The grid lazy-loads a page at a time (50) and appends more on scroll, so a deep entry like
    // GitHub isn't in the initial render — search to surface it (jsdom can't drive real scroll).
    // Generous timeout in case this test is the first to trigger the code-split import.
    fireEvent.change(await within(dialog).findByLabelText('Search Brand icons', {}, { timeout: 15000 }), { target: { value: 'github' } });
    const gh = await within(dialog).findByRole('button', { name: 'Copy GitHub icon snippet' }, { timeout: 15000 });
    fireEvent.click(gh);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{{sw-icon "brand:github" "h-6 w-6"}}');
  }, 20000);

  it('Flags tab: the shape pills re-cut the set and the copied snippet, EU included', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open System Library' }));
    fireEvent.click(screen.getByRole('button', { name: /Icons & flags/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Icons & flags' }, { timeout: 15000 });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Flags' }));

    // Rectangular is the default shape; the EU flag is one of the set (it used to be missing entirely).
    const shapes = await within(dialog).findByRole('radiogroup', { name: 'Flag shape' }, { timeout: 15000 });
    expect(within(shapes).getByRole('radio', { name: /Rectangular/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(within(dialog).getByLabelText('Search Country flags'), { target: { value: 'european union' } });
    // Matched on the TITLE (which carries the snippet), not the accessible name: both shapes of a flag
    // are called "European Union", so a name-only query would happily return the tile from before the
    // switch and the assertion below would pass without the pill having done anything.
    fireEvent.click(await within(dialog).findByTitle(/"eu"/, {}, { timeout: 15000 }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{{sw-flag "eu" "h-4"}}');

    // Switching to Round re-cuts the SAME flag — the snippet must follow the pill, not stay rectangular.
    fireEvent.click(within(shapes).getByRole('radio', { name: /Round/ }));
    fireEvent.click(await within(dialog).findByTitle(/"eu-circle"/, {}, { timeout: 15000 }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('{{sw-flag "eu-circle" "h-5 w-5"}}');
  }, 20000);
});

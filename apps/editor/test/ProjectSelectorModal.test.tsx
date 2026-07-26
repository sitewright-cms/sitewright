import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { ProjectSelectorModal } from '../src/views/ProjectSelectorModal';
import type { Project } from '../src/api';

const PROJECTS: Project[] = [
  { id: 'z', name: 'Zebra Legal', slug: 's-zebra', role: 'owner', siteUrl: 'https://zebralegal.com/' },
  { id: 'e', name: 'eTaxi Worldwide', slug: 's-etaxi', role: 'owner', iconUrl: '/media/s-etaxi/fav.png', siteUrl: 'https://www.etaxi-worldwide.com/' },
  { id: 'a', name: 'Acme Studio', slug: 's-acme', role: 'member' },
];

function open(extra: Partial<Parameters<typeof ProjectSelectorModal>[0]> = {}) {
  return render(
    <ProjectSelectorModal
      projects={PROJECTS}
      onClose={() => {}}
      onOpen={() => {}}
      onNew={() => {}}
      onImportZip={() => {}}
      {...extra}
    />,
  );
}

const rowNames = (): string[] =>
  screen.getAllByRole('listitem').map((li) => within(li).getByRole('button').querySelector('.font-medium')?.textContent ?? '');

describe('ProjectSelectorModal', () => {
  it('lists projects alphabetically by name regardless of input order', () => {
    open();
    expect(rowNames()).toEqual(['Acme Studio', 'eTaxi Worldwide', 'Zebra Legal']);
  });

  it('shows the production URL (scheme + trailing slash stripped) instead of the slug, falling back to the slug when unset', () => {
    open();
    expect(screen.getByText('www.etaxi-worldwide.com')).toBeInTheDocument();
    expect(screen.getByText('zebralegal.com')).toBeInTheDocument();
    // Acme has no siteUrl → the slug is shown.
    expect(screen.getByText('/s-acme')).toBeInTheDocument();
  });

  it('renders a favicon <img> when iconUrl is set and a placeholder (globe svg, no img) when not', () => {
    open();
    // The favicon carries alt="" (presentational), so query by element rather than the img role.
    const etaxi = screen.getByRole('button', { name: /eTaxi Worldwide/ });
    expect(etaxi.querySelector('img')).toHaveAttribute('src', '/media/s-etaxi/fav.png');
    const acme = screen.getByRole('button', { name: /Acme Studio/ });
    expect(acme.querySelector('img')).toBeNull();
    expect(acme.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the placeholder when the favicon image fails to load', () => {
    open();
    const etaxi = screen.getByRole('button', { name: /eTaxi Worldwide/ });
    const img = etaxi.querySelector('img')!;
    fireEvent.error(img); // simulate a broken icon URL
    expect(etaxi.querySelector('img')).toBeNull();
    expect(etaxi.querySelector('svg')).not.toBeNull();
  });

  it('search matches on name, slug, and the production URL', () => {
    open();
    const box = screen.getByRole('searchbox', { name: /search projects/i });
    fireEvent.change(box, { target: { value: 'etaxi-worldwide.com' } }); // URL substring
    expect(rowNames()).toEqual(['eTaxi Worldwide']);
  });

  it('hides the create buttons for a client (canCreate false)', () => {
    open({ canCreate: false });
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull();
    open({ canCreate: true });
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('calls onOpen with the clicked project', () => {
    const onOpen = vi.fn();
    open({ onOpen });
    fireEvent.click(screen.getByRole('button', { name: /Zebra Legal/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'z' }));
  });
});

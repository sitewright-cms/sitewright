import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The rails' contents are heavy and irrelevant here — this file is about WHERE each rail docks.
vi.mock('../src/views/files/FileBrowser', () => ({
  FileBrowser: () => <div>FILES</div>,
  formatBytes: (n: number) => `${n} B`,
  ACCEPT: '',
}));
vi.mock('../src/views/DatasetManager', () => ({ DatasetManager: () => <div>DATASETS</div> }));
vi.mock('../src/api', () => ({ api: { listDatasets: () => Promise.resolve({ items: [] }), listEntries: () => Promise.resolve({ items: [] }) } }));

import { AssetsPanel } from '../src/views/files/AssetsPanel';
import { DataPanel } from '../src/views/datasets/DataPanel';
import { RegionsPanel } from '../src/views/code/RegionsPanel';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

/**
 * The collapsed tab is the rail's whole presence until someone opens it, so its anchor IS the
 * placement. SidePanel expresses that as utility classes (`bottom-0 left-8` / `right-8` / centred),
 * which is what these assert — in jsdom there is no layout to measure, and the alternative is not
 * covering the one requirement this change was made to satisfy.
 */
const tabOf = (name: string) => screen.getByRole('button', { name }).parentElement!;

afterEach(() => vi.unstubAllGlobals());

describe('the two rails a phone keeps, in the two bottom corners', () => {
  it('File Manager: a RIGHT-edge rail on desktop, the BOTTOM-RIGHT corner on mobile', () => {
    const { unmount } = render(<AssetsPanel projectId="p" />);
    expect(tabOf('Open File Manager').className).toContain('right-0');
    expect(tabOf('Open File Manager').className).not.toContain('bottom-0');
    unmount();

    render(<AssetsPanel projectId="p" mobile />);
    const tab = tabOf('Open File Manager').className;
    expect(tab).toContain('bottom-0');
    expect(tab).toContain('right-8');
  });

  it('Datasets: already the BOTTOM-LEFT corner — mobile only widens the panel to fit a phone', () => {
    const { container, unmount } = render(<DataPanel project={project} />);
    expect(tabOf('Open Datasets').className).toContain('left-8');
    // 66vw of a monitor is a deliberate "does not swallow the screen"; 66vw of a phone is ~250px.
    expect(container.innerHTML).toContain('w-[min(56rem,66vw)]');
    unmount();

    const { container: mob } = render(<DataPanel project={project} mobile />);
    expect(tabOf('Open Datasets').className).toContain('left-8');
    expect(mob.innerHTML).toContain('w-[min(56rem,100vw)]');
  });

  it('Regions: the page editor rail moves to bottom-CENTRE, clear of both corner rails', () => {
    // It survives on mobile precisely because it is the touch-friendly way to edit: a list of
    // labelled rows beats precision-tapping body text inside a live preview.
    const { unmount } = render(<RegionsPanel regions={[]} projectId="p" onEdit={() => {}} />);
    expect(tabOf('Open Regions').className).toContain('left-0'); // left EDGE on desktop
    unmount();

    render(<RegionsPanel regions={[]} projectId="p" onEdit={() => {}} mobile />);
    const tab = tabOf('Open Regions').className;
    expect(tab).toContain('bottom-0');
    // Centred — NOT `left-8`/`right-8`, which the Datasets and File Manager rails already hold.
    expect(tab).toContain('left-1/2');
    expect(tab).not.toContain('left-8');
    expect(tab).not.toContain('right-8');
  });
});

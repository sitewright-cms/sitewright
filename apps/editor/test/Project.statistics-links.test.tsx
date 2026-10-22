import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The Statistics tab's links out: a Website Settings tile (switch tabs, then bring the tile into view) and System
 * Settings (handed through from App, for instance admins only).
 */
const { getSettings, listPages, listTemplates, reveal, cancels } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  listPages: vi.fn(),
  listTemplates: vi.fn(),
  reveal: vi.fn(),
  cancels: [] as Array<ReturnType<typeof vi.fn>>,
}));
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    getSettings: (p: string) => getSettings(p),
    listTemplates: (p: string) => listTemplates(p),
  },
}));
vi.mock('../src/lib/settings-links', () => ({ revealSettingsTile: (tile: string) => reveal(tile) }));
vi.mock('../src/views/stats/StatisticsTab', () => ({
  StatisticsTab: ({
    onOpenSettings,
    onOpenSystemSettings,
    isStaff,
    access,
  }: {
    onOpenSettings?: (tile?: string) => void;
    onOpenSystemSettings?: (t: { tab: string }) => void;
    isStaff?: boolean;
    access: { statistics?: boolean | null; search?: string[] | null };
  }) => (
    <div>
      STATS staff={String(isStaff)} enabled={String(access.statistics)} search={String(access.search)}
      <button type="button" onClick={() => onOpenSettings?.('analytics')}>
        open analytics
      </button>
      <button type="button" onClick={() => onOpenSettings?.('search-engines')}>
        open search engines
      </button>
      <button type="button" onClick={() => onOpenSettings?.()}>
        open website settings
      </button>
      <button type="button" onClick={() => onOpenSystemSettings?.({ tab: 'integrations' })}>
        open system settings
      </button>
    </div>
  ),
}));
vi.mock('../src/views/settings/SettingsView', () => ({ SettingsView: () => <div /> }));

import { ProjectView } from '../src/views/Project';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

beforeEach(() => {
  vi.clearAllMocks();
  cancels.length = 0;
  listPages.mockResolvedValue({ items: [] });
  listTemplates.mockResolvedValue({ items: [] });
  getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
  reveal.mockImplementation(() => {
    const cancel = vi.fn();
    cancels.push(cancel);
    return cancel;
  });
});

describe('the Statistics tab’s links out of the project view', () => {
  it('passes the staff state, App’s access answer and the System Settings link through', () => {
    const system = vi.fn();
    render(
      <ProjectView
        project={project}
        tab="statistics"
        isStaff
        statisticsAccess={{ statistics: false, rankings: true, search: ['bing'] }}
        onOpenSystemSettings={system}
        onSelectTab={vi.fn()}
      />,
    );
    expect(screen.getByText(/STATS staff=true enabled=false search=bing/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open system settings' }));
    expect(system).toHaveBeenCalledWith({ tab: 'integrations' });
  });

  it('a tile link switches to Website Settings, then brings that tile into view', () => {
    const select = vi.fn();
    render(<ProjectView project={project} tab="statistics" isStaff onSelectTab={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'open analytics' }));
    expect(select).toHaveBeenCalledWith('website-settings');
    expect(reveal).toHaveBeenCalledWith('analytics');
    fireEvent.click(screen.getByRole('button', { name: 'open search engines' }));
    expect(reveal).toHaveBeenLastCalledWith('search-engines');
    // Only the newest link is followed.
    expect(cancels[0]).toHaveBeenCalled();
  });

  it('a plain link only switches tabs, and no reveal outlives the view', () => {
    const select = vi.fn();
    const { unmount } = render(<ProjectView project={project} tab="statistics" isStaff onSelectTab={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'open website settings' }));
    expect(select).toHaveBeenCalledWith('website-settings');
    expect(reveal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'open analytics' }));
    unmount();
    expect(cancels[0]).toHaveBeenCalled();
  });
});

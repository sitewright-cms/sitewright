import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import type { Page } from '@sitewright/schema';
import { LONG_PRESS_MS } from '../src/lib/use-long-press';

const { listPages, getPage, putPage, getSettings, listTemplates } = vi.hoisted(() => ({
  listPages: vi.fn(),
  getPage: vi.fn(),
  putPage: vi.fn(),
  getSettings: vi.fn(),
  listTemplates: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    getPage: (p: string, id: string) => getPage(p, id),
    putPage: (p: string, page: Page) => putPage(p, page),
    getSettings: (p: string) => getSettings(p),
    listTemplates: (p: string) => listTemplates(p),
  },
}));
vi.mock('../src/views/CodePageEditor', () => ({ CodePageEditor: () => <div>PAGE EDITOR</div> }));
vi.mock('../src/views/ApiKeysManager', () => ({ ApiKeysManager: () => <div /> }));
vi.mock('../src/views/FormsManager', () => ({ FormsManager: () => <div /> }));
vi.mock('../src/views/SubmissionsInbox', () => ({ SubmissionsInbox: () => <div /> }));
vi.mock('../src/views/settings/SettingsView', () => ({ SettingsView: () => <div /> }));

import { ProjectView } from '../src/views/Project';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const pages: Page[] = [
  { id: 'home', path: '', title: 'Home' },
  { id: 'about', path: 'about', title: 'About' },
];

/** A phone-sized viewport — jsdom answers `false` to every query, i.e. desktop, by default. */
function withMobileViewport() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width'),
    media: q,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  for (const m of [listPages, getPage, putPage, getSettings, listTemplates]) m.mockReset();
  listPages.mockResolvedValue({ items: pages });
  getPage.mockResolvedValue({ item: pages[0] });
  putPage.mockResolvedValue({ item: pages[0] });
  getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
  listTemplates.mockResolvedValue({ items: [] });
});
afterEach(() => vi.unstubAllGlobals());

/**
 * MOBILE PAGES LIST: the per-row action toolbar is seven icon buttons wide. On a phone that is the
 * whole row, leaving no width for the page name they act on — so the row keeps only its own tap
 * target and hands every action to the long-press menu it ALREADY carried for touch.
 *
 * ★ The contract that makes this safe is that the menu is a strict SUPERSET of the toolbar. Both
 * halves are asserted below: the buttons are gone, and each of their actions is still reachable.
 */
describe('ProjectView pages list on a phone', () => {
  async function renderList() {
    render(<ProjectView project={project} tab="pages" onLoaded={() => {}} />);
    return screen.findByText('Home');
  }

  it('renders the row action toolbar on a DESKTOP viewport', async () => {
    await renderList();
    expect(screen.getByRole('button', { name: 'Edit About' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete About' })).toBeInTheDocument();
  });

  it('hides the row action toolbar on a phone', async () => {
    withMobileViewport();
    await renderList();
    for (const label of ['Preview About', 'Edit About', 'Settings for About', 'Duplicate About', 'Delete About']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    // The row itself still opens the page — the primary action never depended on the toolbar.
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('★ every hidden action is still reachable by long-press, and the menu adds "Move to" on top', async () => {
    vi.useFakeTimers();
    try {
      withMobileViewport();
      render(<ProjectView project={project} tab="pages" onLoaded={() => {}} />);
      // The list load is a resolved promise, not a timer, so flush microtasks under fake timers.
      await act(async () => {});
      const row = screen.getByText('About').closest('li')!;
      fireEvent.touchStart(row, { touches: [{ clientX: 40, clientY: 90 }] });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      const menu = screen.getByRole('menu', { name: 'Actions for About' });
      for (const item of [
        'Open page editor',
        'Edit page settings',
        'Preview in new tab',
        'Duplicate page',
        'Delete page',
        'Move to',
      ]) {
        expect(within(menu).getByRole('menuitem', { name: item })).toBeInTheDocument();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

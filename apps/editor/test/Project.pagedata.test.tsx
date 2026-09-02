import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

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
// The LIST row is a summary — no `source`, no `data`. The full page (what getPage returns) has both,
// which is exactly why "Edit page data" has to load before it writes.
const listRow: Page = { id: 'home', path: '', title: 'Home' };
const fullPage: Page = { id: 'home', path: '', title: 'Home', source: '<h1>Home</h1>', data: { hero: 'Old' } };

beforeEach(() => {
  for (const m of [listPages, getPage, putPage, getSettings, listTemplates]) m.mockReset();
  listPages.mockResolvedValue({ items: [listRow] });
  getPage.mockResolvedValue({ item: fullPage });
  putPage.mockResolvedValue({ item: fullPage });
  getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
  listTemplates.mockResolvedValue({ items: [] });
});

/** Right-click the page row and return its context menu. */
async function openMenu() {
  render(<ProjectView project={project} tab="pages" />);
  const row = await screen.findByRole('button', { name: 'Home /' });
  fireEvent.contextMenu(row);
  return screen.getByRole('menu', { name: 'Actions for Home' });
}

describe('Pages tab — Edit page data', () => {
  it('offers the action in the row context menu', async () => {
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Edit page data' })).toBeInTheDocument();
  });

  it('opens the page-data editor on the FULL page, not the list summary', async () => {
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit page data' }));
    await waitFor(() => expect(getPage).toHaveBeenCalledWith('p', 'home'));
    expect(await screen.findByRole('dialog', { name: /Page data — Home/ })).toBeInTheDocument();
    // The existing store is shown, and the hint names the page.data namespace.
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('hero');
    expect(screen.getAllByText(/page\.data\./).length).toBeGreaterThan(0);
  });

  it('saves the edited data and keeps the rest of the page intact', async () => {
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit page data' }));
    await screen.findByRole('dialog', { name: /Page data — Home/ });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putPage).toHaveBeenCalled());
    // The page's SOURCE must survive: putPage replaces the whole entity.
    expect(putPage).toHaveBeenCalledWith('p', { ...fullPage, data: { hero: 'New' } });
  });

  it('stores an emptied store as undefined rather than an empty object', async () => {
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit page data' }));
    await screen.findByRole('dialog', { name: /Page data — Home/ });
    fireEvent.click(screen.getByRole('button', { name: 'Remove hero' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putPage).toHaveBeenCalled());
    expect(putPage).toHaveBeenCalledWith('p', { ...fullPage, data: undefined });
  });

  it('does not offer the action for a link placeholder (it has no template to bind to)', async () => {
    listPages.mockResolvedValue({
      items: [listRow, { id: 'ext', path: 'ext', title: 'Docs', kind: 'link', nav: { href: 'https://x.test' } } as Page],
    });
    render(<ProjectView project={project} tab="pages" />);
    // `/^Docs/` matches the ROW button only — the per-row action buttons are "Edit Docs", "Preview Docs".
    const row = await screen.findByRole('button', { name: /^Docs/ });
    fireEvent.contextMenu(row);
    expect(screen.getByRole('menu', { name: 'Actions for Docs' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit page data' })).toBeNull();
  });
});

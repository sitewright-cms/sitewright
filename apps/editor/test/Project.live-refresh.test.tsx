import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { Page } from '@sitewright/schema';
import type { ContentChange } from '../src/lib/use-project-events';

const { listPages, getSettings, listTemplates } = vi.hoisted(() => ({
  listPages: vi.fn(),
  getSettings: vi.fn(),
  listTemplates: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listPages: (p: string) => listPages(p),
    getSettings: (p: string) => getSettings(p),
    listTemplates: (p: string) => listTemplates(p),
  },
}));
// The live stream is pushed by hand: the module that owns the EventSource is replaced.
let emit: ((c: ContentChange) => void) | null = null;
vi.mock('../src/lib/use-project-events', () => ({
  useProjectEvents: (_projectId: string, listener: (c: ContentChange) => void) => {
    emit = listener;
  },
}));
vi.mock('../src/views/CodePageEditor', () => ({ CodePageEditor: () => <div /> }));
vi.mock('../src/views/ApiKeysManager', () => ({ ApiKeysManager: () => <div /> }));
vi.mock('../src/views/FormsManager', () => ({ FormsManager: () => <div /> }));
vi.mock('../src/views/SubmissionsInbox', () => ({ SubmissionsInbox: () => <div /> }));
vi.mock('../src/views/settings/SettingsView', () => ({ SettingsView: () => <div /> }));

import { ProjectView } from '../src/views/Project';

const home: Page = { id: 'home', path: '', title: 'Home' };
const services: Page = { id: 'services', path: 'services', title: 'Services', parent: 'home' };
const web: Page = { id: 'web', path: 'web', title: 'Web', parent: 'services' };

/** A response the test releases when it chooses — to make two reads answer out of order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  emit = null;
  listPages.mockReset();
  getSettings.mockResolvedValue({ item: { settings: { defaultLocale: 'en', locales: ['en'] } } });
  listTemplates.mockResolvedValue({ items: [] });
});

describe('the pages list, refreshed live', () => {
  it('★ an agent’s second page does not vanish: live reads never overlap, so an older one cannot land last', async () => {
    listPages.mockResolvedValueOnce({ items: [home] });
    render(<ProjectView project={{ id: 'p', name: 'Acme', slug: 'acme', role: 'owner' }} tab="pages" />);
    await screen.findByRole('button', { name: /^Home\s*\/$/ });

    // An agent writes `services`, then `web`: two events. The first read was taken before `web` existed.
    const first = deferred<{ items: Page[] }>();
    const second = deferred<{ items: Page[] }>();
    listPages.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    act(() => emit!({ kind: 'page', entityId: 'services', op: 'put' }));
    act(() => emit!({ kind: 'page', entityId: 'web', op: 'put' }));
    // The second read waits for the first instead of racing it.
    expect(listPages).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve({ items: [home, services] }));
    expect(listPages).toHaveBeenCalledTimes(3);
    await act(async () => second.resolve({ items: [home, services, web] }));
    expect(await screen.findByRole('button', { name: /^Web\s*\/services\/web\/$/ })).toBeInTheDocument();
  });

  it('★ keeps the NEWEST read when the opening read answers after a live one', async () => {
    const opening = deferred<{ items: Page[] }>();
    listPages.mockReturnValueOnce(opening.promise).mockResolvedValueOnce({ items: [home, services] });
    render(<ProjectView project={{ id: 'p', name: 'Acme', slug: 'acme', role: 'owner' }} tab="pages" />);

    // An agent writes `services` while the view's first read is still out; the live read answers first.
    await act(async () => emit!({ kind: 'page', entityId: 'services', op: 'put' }));
    expect(await screen.findByRole('button', { name: /^Services\s*\/services\/$/ })).toBeInTheDocument();
    // The opening read, taken before `services` existed, answers last and must not overwrite the list.
    await act(async () => opening.resolve({ items: [home] }));
    expect(screen.getByRole('button', { name: /^Services\s*\/services\/$/ })).toBeInTheDocument();
  });

  it('★ a burst of page events costs two reads of each list, not one per page', async () => {
    listPages.mockResolvedValue({ items: [home] });
    render(<ProjectView project={{ id: 'p', name: 'Acme', slug: 'acme', role: 'owner' }} tab="pages" />);
    await screen.findByRole('button', { name: /^Home\s*\/$/ });
    listPages.mockClear();
    getSettings.mockClear();

    // Deleting 300 pages in bulk emits one `page` event per page.
    await act(async () => {
      for (let i = 0; i < 300; i += 1) emit!({ kind: 'page', entityId: `p${i}`, op: 'delete' });
    });

    await waitFor(() => expect(listPages).toHaveBeenCalledTimes(2));
    expect(getSettings).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

const { preview, putPage } = vi.hoisted(() => ({ preview: vi.fn(), putPage: vi.fn() }));
vi.mock('../src/api', () => ({
  api: {
    preview: (o: string, p: string, page: Page) => preview(o, p, page),
    putPage: (o: string, p: string, page: Page) => putPage(o, p, page),
  },
  previewDocUrl: (o: string, p: string, token: string) => `/orgs/${o}/projects/${p}/preview/${token}`,
}));

import { ClientSourceEditor } from '../src/views/ClientSourceEditor';

const org = { id: 'o', name: 'Acme', slug: 'acme', role: 'member' };
const project = { id: 'p', name: 'Acme', slug: 'acme' };

const sourcePage: Page = {
  id: 'home',
  path: '/',
  title: 'Home',
  root: { id: 'r', type: 'Section' },
  source: '<h1>{{edit "headline" "Welcome to Acme"}}</h1><p>{{edit "sub" "A subtitle"}}</p>',
  content: { headline: 'Saved headline' },
};

beforeEach(() => {
  preview.mockReset();
  putPage.mockReset();
  preview.mockResolvedValue({ token: 'tok' });
  putPage.mockResolvedValue({ item: sourcePage });
});

describe('ClientSourceEditor', () => {
  it('surfaces the template edit regions with current/default values (not the source)', () => {
    render(<ClientSourceEditor org={org} project={project} page={sourcePage} onClose={() => {}} />);
    // The override shows for `headline`; the default shows for the untouched `sub`.
    expect((screen.getByLabelText('headline') as HTMLTextAreaElement).value).toBe('Saved headline');
    expect((screen.getByLabelText('sub') as HTMLTextAreaElement).value).toBe('A subtitle');
    // The raw template source is not presented as an editable field.
    expect(screen.queryByDisplayValue(/\{\{edit/)).toBeNull();
  });

  it('saves an edited region into page.content (source untouched)', async () => {
    const onClose = vi.fn();
    render(<ClientSourceEditor org={org} project={project} page={sourcePage} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('headline'), { target: { value: 'Client rewrote this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![2] as Page;
    expect(saved.content).toEqual({ headline: 'Client rewrote this' });
    // An untouched region keeps the template default as its source of truth — it is NOT
    // pre-written into content on mount.
    expect(saved.content?.sub).toBeUndefined();
    expect(saved.source).toBe(sourcePage.source); // template is unchanged
    expect(onClose).toHaveBeenCalled();
  });

  it('previews the draft (with edits) through the sandboxed preview pane', async () => {
    render(<ClientSourceEditor org={org} project={project} page={sourcePage} onClose={() => {}} />);
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const draft = preview.mock.calls[0]![2] as Page;
    expect(draft.content).toEqual({ headline: 'Saved headline' });
    await waitFor(() =>
      expect((screen.getByTitle('Live preview') as HTMLIFrameElement).getAttribute('src')).toContain('/preview/tok'),
    );
  });

  it('shows an empty state + disables save when the template has no edit regions', () => {
    const noRegions: Page = { ...sourcePage, source: '<h1>{{ company.name }}</h1>', content: {} };
    render(<ClientSourceEditor org={org} project={project} page={noRegions} onClose={() => {}} />);
    expect(screen.getByText(/no editable regions/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

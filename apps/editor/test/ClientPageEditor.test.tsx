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

import { ClientPageEditor } from '../src/views/ClientPageEditor';

const org = { id: 'o', name: 'O', slug: 'o', role: 'member' };
const project = { id: 'p', name: 'Acme', slug: 'acme' };

const editablePage: Page = {
  id: 'home',
  path: '/',
  title: 'Home',
  root: {
    id: 'r',
    type: 'Section',
    children: [
      { id: 'h', type: 'Heading', props: { text: 'Locked headline', level: 2 } },
      { id: 't', type: 'RichText', editable: true, props: { text: 'Editable copy' } },
    ],
  },
};

beforeEach(() => {
  preview.mockReset();
  putPage.mockReset();
  preview.mockResolvedValue({ token: 'tok' });
  putPage.mockResolvedValue({ item: editablePage });
});

describe('ClientPageEditor', () => {
  it('surfaces only editable nodes and saves the client edit through putPage', async () => {
    const onClose = vi.fn();
    render(<ClientPageEditor org={org} project={project} page={editablePage} onClose={onClose} />);

    // The editable RichText's field is present, pre-filled with its current copy.
    const field = (await screen.findAllByLabelText('Text')).find(
      (el) => (el as HTMLTextAreaElement).value === 'Editable copy',
    ) as HTMLTextAreaElement;
    expect(field).toBeTruthy();
    // The locked Heading's content must NOT be offered for editing.
    expect(screen.queryByDisplayValue('Locked headline')).toBeNull();

    fireEvent.change(field, { target: { value: 'Client rewrote this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![2] as Page;
    // Only the editable node's prop changed; the locked node is byte-identical.
    expect(saved.root.children![1]!.props).toEqual({ text: 'Client rewrote this' });
    expect(saved.root.children![0]!.props).toEqual({ text: 'Locked headline', level: 2 });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an empty state and disables save when no region is editable', async () => {
    const noneEditable: Page = {
      id: 'home',
      path: '/',
      title: 'Home',
      root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }] },
    };
    render(<ClientPageEditor org={org} project={project} page={noneEditable} onClose={vi.fn()} />);
    expect(await screen.findByText(/no editable regions/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

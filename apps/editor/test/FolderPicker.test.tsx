import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MediaAsset, MediaFolderRecord } from '@sitewright/schema';

const listMedia = vi.fn();
const listMediaFolders = vi.fn();

vi.mock('../src/api', () => ({
  api: {
    listMedia: () => listMedia(),
    listMediaFolders: () => listMediaFolders(),
  },
}));

import { FolderPicker } from '../src/views/files/FolderPicker';

// One image filed under gallery/team (so `gallery` + `gallery/team` are implied), plus an explicit
// empty `docs` folder record (no assets) — the picker must surface both kinds.
const teamPhoto: MediaAsset = {
  kind: 'image',
  id: 'img1',
  filename: 'jane.png',
  folder: 'gallery/team',
  bytes: 2048,
  format: 'png',
  width: 100,
  height: 100,
  hasAlpha: false,
  animated: false,
  original: 'jane.png',
  url: '/media/p/img1/jane.png',
};
const docsFolder: MediaFolderRecord = { id: 'fd1', path: 'docs' };

beforeEach(() => {
  listMedia.mockResolvedValue({ items: [teamPhoto] });
  listMediaFolders.mockResolvedValue({ items: [docsFolder] });
});

// The rows are buttons with an explicit `Use folder <path>` label — query by role so the intro's
// example `<code>gallery/team</code>` never collides with a row.
const folderBtn = (path: string) => screen.getByRole('button', { name: `Use folder ${path}` });
const rootBtn = () => screen.getByRole('button', { name: /Use root folder/ });

describe('FolderPicker', () => {
  it('lists every folder path (records + asset ancestors) plus a root option', async () => {
    render(<FolderPicker projectId="p" onPick={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(folderBtn('gallery/team')).toBeInTheDocument());
    expect(folderBtn('docs')).toBeInTheDocument();
    expect(folderBtn('gallery')).toBeInTheDocument(); // implied ancestor of gallery/team
    expect(rootBtn()).toBeInTheDocument();
  });

  it('picks a folder path and closes', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<FolderPicker projectId="p" onPick={onPick} onClose={onClose} />);
    await waitFor(() => expect(folderBtn('gallery/team')).toBeInTheDocument());
    fireEvent.click(folderBtn('gallery/team'));
    expect(onPick).toHaveBeenCalledWith('gallery/team');
    expect(onClose).toHaveBeenCalled();
  });

  it('picks the empty string for the root option', async () => {
    const onPick = vi.fn();
    render(<FolderPicker projectId="p" onPick={onPick} onClose={() => {}} />);
    await waitFor(() => expect(rootBtn()).toBeInTheDocument());
    fireEvent.click(rootBtn());
    expect(onPick).toHaveBeenCalledWith('');
  });

  it('filters the list by the search query (root always stays)', async () => {
    render(<FolderPicker projectId="p" onPick={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(folderBtn('docs')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search folders by path'), { target: { value: 'team' } });
    expect(screen.queryByRole('button', { name: 'Use folder docs' })).toBeNull();
    expect(folderBtn('gallery/team')).toBeInTheDocument();
    expect(rootBtn()).toBeInTheDocument();
  });
});

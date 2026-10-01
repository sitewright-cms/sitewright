// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { RevisionDetailsModal } from '../src/views/RevisionDetailsModal';
import { api, type ProjectRevisionRow } from '../src/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROW: ProjectRevisionRow = {
  id: 'rev2',
  kind: 'page',
  entityId: 'home',
  dataset: '',
  label: 'Home',
  op: 'put',
  actor: 'user',
  author: { isYou: true, email: 'a@b.co' },
  revisionAt: new Date('2026-10-01T12:00:00Z').toISOString(),
  note: null,
} as ProjectRevisionRow;

const stub = (revisions: Array<{ id: string }>, data: Record<string, unknown>) => {
  vi.spyOn(api, 'listRevisions').mockResolvedValue({ items: revisions as never });
  vi.spyOn(api, 'getRevision').mockImplementation(async (_p, _k, _e, revId) => ({
    revision: { id: revId, data: revId === 'rev2' ? data : { title: 'Old', source: 'a\nb' } } as never,
  }));
};

describe('RevisionDetailsModal', () => {
  it('shows the FIELDS that changed, not the whole document', async () => {
    // ★ The row already says a page was saved. What it cannot say is that only the title moved —
    // and reading that out of two snapshots by eye is the thing this replaces.
    stub([{ id: 'rev2' }, { id: 'rev1' }], { title: 'New', source: 'a\nb' });
    render(<RevisionDetailsModal projectId="p1" row={ROW} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/1 field — 1 changed/)).toBeTruthy());
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('Old')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    // `source` did not move, so it must not be listed at all.
    expect(screen.queryByText('source')).toBeNull();
  });

  it('compares against the PREVIOUS revision of the same entity, not the row above it', async () => {
    // The project feed is filtered and paginated, so the row above is frequently a different entity.
    stub([{ id: 'rev2' }, { id: 'rev1' }], { title: 'New' });
    render(<RevisionDetailsModal projectId="p1" row={ROW} onClose={() => {}} />);
    await waitFor(() => expect(api.getRevision).toHaveBeenCalledWith('p1', 'page', 'home', 'rev1'));
    expect(api.listRevisions).toHaveBeenCalledWith('p1', 'page', 'home', undefined);
  });

  it('says so when a revision is the FIRST one, rather than showing an empty diff', async () => {
    stub([{ id: 'rev2' }], { title: 'New', path: 'home' });
    render(<RevisionDetailsModal projectId="p1" row={ROW} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/first version of this item/i)).toBeTruthy());
    // The chip reads ADDED on screen, but that is `uppercase` in CSS — the DOM text is the word.
    expect(screen.getAllByText('added').length).toBeGreaterThan(0);
  });

  it('says so when a save stored no change at all', async () => {
    stub([{ id: 'rev2' }, { id: 'rev1' }], { title: 'Old', source: 'a\nb' });
    render(<RevisionDetailsModal projectId="p1" row={ROW} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/stored the same values/i)).toBeTruthy());
  });

  it('surfaces a load failure instead of an empty modal', async () => {
    vi.spyOn(api, 'listRevisions').mockRejectedValue(new Error('nope'));
    render(<RevisionDetailsModal projectId="p1" row={ROW} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
  });
});

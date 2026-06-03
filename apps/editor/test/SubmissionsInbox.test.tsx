import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listSubmissions = vi.fn();
const deleteSubmission = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    listSubmissions: () => listSubmissions(),
    deleteSubmission: (_p: string, id: string) => deleteSubmission(id),
  },
}));

import { SubmissionsInbox } from '../src/views/SubmissionsInbox';

const project = { id: 'p', name: 'P', slug: 'p', role: 'owner' as const };

beforeEach(() => {
  listSubmissions.mockReset();
  deleteSubmission.mockReset();
  deleteSubmission.mockResolvedValue(undefined);
  vi.stubGlobal('confirm', () => true);
});

describe('SubmissionsInbox', () => {
  it('lists submissions and expands one to show its fields (text rendered safely)', async () => {
    listSubmissions.mockResolvedValue({
      items: [{ id: 's1', formId: 'contact', fields: { email: 'lead@x.co', message: '<b>hi</b>' }, createdAt: '2026-05-31T00:00:00.000Z' }],
      total: 1,
    });
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByText('1 submission')).toBeInTheDocument();
    // Expand (the `message` field only appears once expanded).
    fireEvent.click(screen.getByText('contact'));
    // The angle-bracket value is shown as text, not parsed as markup.
    expect(await screen.findByText('<b>hi</b>')).toBeInTheDocument();
    expect(screen.getByText('message')).toBeInTheDocument(); // the dt label
  });

  it('deletes a submission and reloads', async () => {
    listSubmissions
      .mockResolvedValueOnce({ items: [{ id: 's1', formId: 'contact', fields: { email: 'a@x.co' }, createdAt: '2026-05-31T00:00:00.000Z' }], total: 1 })
      .mockResolvedValueOnce({ items: [], total: 0 });
    render(<SubmissionsInbox project={project} />);
    fireEvent.click(await screen.findByLabelText('Delete submission s1'));
    await waitFor(() => expect(deleteSubmission).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no submissions', async () => {
    listSubmissions.mockResolvedValue({ items: [], total: 0 });
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument();
  });
});

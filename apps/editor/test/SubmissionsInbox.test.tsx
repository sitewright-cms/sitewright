import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listSubmissions = vi.fn();
const deleteSubmission = vi.fn();
const undeliveredSubmissions = vi.fn();
const resendSubmission = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    listSubmissions: () => listSubmissions(),
    deleteSubmission: (_p: string, id: string) => deleteSubmission(id),
    undeliveredSubmissions: () => undeliveredSubmissions(),
    resendSubmission: (_p: string, id: string) => resendSubmission(id),
  },
}));

import { SubmissionsInbox } from '../src/views/SubmissionsInbox';

const project = { id: 'p', name: 'P', slug: 'p', role: 'owner' as const };

beforeEach(() => {
  undeliveredSubmissions.mockReset();
  resendSubmission.mockReset();
  undeliveredSubmissions.mockResolvedValue({ count: 0, lastError: null }); // nothing owed by default
  listSubmissions.mockReset();
  deleteSubmission.mockReset();
  deleteSubmission.mockResolvedValue(undefined);
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

  it('deletes a submission after confirming, then reloads', async () => {
    listSubmissions
      .mockResolvedValueOnce({ items: [{ id: 's1', formId: 'contact', fields: { email: 'a@x.co' }, createdAt: '2026-05-31T00:00:00.000Z' }], total: 1 })
      .mockResolvedValueOnce({ items: [], total: 0 });
    render(<SubmissionsInbox project={project} />);
    fireEvent.click(await screen.findByLabelText('Delete submission s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSubmission).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no submissions', async () => {
    listSubmissions.mockResolvedValue({ items: [], total: 0 });
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument();
  });
});

describe('undelivered notification banner', () => {
  const items = [{ id: 's1', formId: 'contact', fields: { email: 'lead@x.co' }, createdAt: new Date().toISOString(), deliveryState: 'failed' }];

  it('★ says so when submissions were not emailed, and why', async () => {
    // The whole point: a failed notification used to be one line in a server log. The operator's
    // first sign was a client asking why nobody called back.
    listSubmissions.mockResolvedValue({ items, total: 1 });
    undeliveredSubmissions.mockResolvedValue({ count: 2, lastError: 'The mail server rejected the username or password.' });
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByText(/2 submissions were not emailed/)).toBeInTheDocument();
    expect(screen.getByText(/rejected the username or password/)).toBeInTheDocument();
  });

  it('reassures that the submissions themselves are safe — only the notification failed', async () => {
    listSubmissions.mockResolvedValue({ items, total: 1 });
    undeliveredSubmissions.mockResolvedValue({ count: 1, lastError: null });
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByText(/only the notification failed/i)).toBeInTheDocument();
  });

  it('★ resends a submission and refreshes, so a fixed SMTP clears the backlog', async () => {
    listSubmissions.mockResolvedValue({ items, total: 1 });
    undeliveredSubmissions.mockResolvedValue({ count: 1, lastError: 'nope' });
    resendSubmission.mockResolvedValue({ queued: true });
    render(<SubmissionsInbox project={project} />);
    fireEvent.click(await screen.findByLabelText('Resend submission s1'));
    await waitFor(() => expect(resendSubmission).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(listSubmissions).toHaveBeenCalledTimes(2)); // reloaded
  });

  it('offers no Resend and no banner when everything was delivered', async () => {
    // The row must SAY it was delivered — the button is gated on the row's own state now, so a
    // fixture left as `failed` would offer Resend and this test would be asserting the opposite of
    // what its name claims.
    listSubmissions.mockResolvedValue({
      items: [{ ...items[0]!, deliveryState: 'sent' }],
      total: 1,
    });
    render(<SubmissionsInbox project={project} />);
    await screen.findByLabelText('Delete submission s1');
    expect(screen.queryByLabelText('Resend submission s1')).toBeNull();
    expect(screen.queryByText(/not emailed/)).toBeNull();
  });

  it('a failing count never blocks the inbox — the leads still render', async () => {
    listSubmissions.mockResolvedValue({ items, total: 1 });
    undeliveredSubmissions.mockRejectedValue(new Error('offline'));
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByLabelText('Delete submission s1')).toBeInTheDocument();
  });
});

describe('Resend is offered per ROW, not per project', () => {
  const at = new Date().toISOString();

  it('★ never offers Resend on a submission that was already delivered', async () => {
    // The bug this pins: gating on the project-wide count put a Resend beside EVERY row as soon as
    // any one of them failed, and one click re-emailed a lead the recipient already had.
    listSubmissions.mockResolvedValue({
      items: [
        { id: 'sent1', formId: 'contact', fields: { email: 'a@x.co' }, createdAt: at, deliveryState: 'sent' },
        { id: 'failed1', formId: 'contact', fields: { email: 'b@x.co' }, createdAt: at, deliveryState: 'failed' },
      ],
      total: 2,
    });
    undeliveredSubmissions.mockResolvedValue({ count: 1, lastError: 'nope' });
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByLabelText('Resend submission failed1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Resend submission sent1')).toBeNull();
  });

  it('offers Resend on a row still pending, and on none that were never owed an email', async () => {
    listSubmissions.mockResolvedValue({
      items: [
        { id: 'pending1', formId: 'contact', fields: { email: 'a@x.co' }, createdAt: at, deliveryState: 'pending' },
        { id: 'na1', formId: 'contact', fields: { email: 'b@x.co' }, createdAt: at, deliveryState: 'na' },
      ],
      total: 2,
    });
    undeliveredSubmissions.mockResolvedValue({ count: 1, lastError: null });
    render(<SubmissionsInbox project={project} />);
    expect(await screen.findByLabelText('Resend submission pending1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Resend submission na1')).toBeNull();
  });
});


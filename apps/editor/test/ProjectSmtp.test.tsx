import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SmtpInput } from '../src/api';

const getProjectSmtp = vi.fn();
const putProjectSmtp = vi.fn();
const deleteProjectSmtp = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    getProjectSmtp: () => getProjectSmtp(),
    putProjectSmtp: (_p: string, body: SmtpInput) => putProjectSmtp(body),
    deleteProjectSmtp: () => deleteProjectSmtp(),
  },
}));

import { ProjectSmtp } from '../src/views/ProjectSmtp';

const project = { id: 'p', name: 'P', slug: 'p', role: 'owner' as const };

beforeEach(() => {
  getProjectSmtp.mockReset();
  putProjectSmtp.mockReset();
  deleteProjectSmtp.mockReset();
  putProjectSmtp.mockResolvedValue({ smtp: { host: 'h', port: 587, secure: false, fromEmail: 'a@b.co', hasPassword: true } });
  deleteProjectSmtp.mockResolvedValue(undefined);
});

describe('ProjectSmtp', () => {
  it('saves a new SMTP config (password included only when typed)', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: null });
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByLabelText('Configure project SMTP')); // enable → fields appear
    fireEvent.change(screen.getByLabelText('SMTP host'), { target: { value: 'smtp.acme.com' } });
    fireEvent.change(screen.getByLabelText('SMTP from email'), { target: { value: 'no-reply@acme.com' } });
    fireEvent.change(screen.getByLabelText('SMTP password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save SMTP' }));
    await waitFor(() => expect(putProjectSmtp).toHaveBeenCalled());
    const body = putProjectSmtp.mock.calls[0]![0] as SmtpInput;
    expect(body).toMatchObject({ host: 'smtp.acme.com', fromEmail: 'no-reply@acme.com', password: 'pw' });
  });

  it('hydrates an existing config and omits the password on save when left blank', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: { host: 'smtp.acme.com', port: 465, secure: true, user: 'mailer', fromEmail: 'no-reply@acme.com', hasPassword: true } });
    render(<ProjectSmtp project={project} />);
    expect(await screen.findByLabelText('SMTP host')).toHaveValue('smtp.acme.com');
    fireEvent.click(screen.getByRole('button', { name: 'Save SMTP' }));
    await waitFor(() => expect(putProjectSmtp).toHaveBeenCalled());
    const body = putProjectSmtp.mock.calls[0]![0] as SmtpInput;
    expect(body.host).toBe('smtp.acme.com');
    expect('password' in body).toBe(false); // blank → omitted (retain)
  });

  it('does not error when saving an already-absent config (idempotent delete)', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: null }); // never configured → enabled stays false
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save SMTP' }));
    await waitFor(() => expect(deleteProjectSmtp).toHaveBeenCalled());
    expect(putProjectSmtp).not.toHaveBeenCalled();
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it('surfaces a load failure (e.g. 403 for a non-writer)', async () => {
    getProjectSmtp.mockRejectedValue(new Error('insufficient role for this operation'));
    render(<ProjectSmtp project={project} />);
    expect(await screen.findByText(/insufficient role/)).toBeInTheDocument();
  });

  it('deletes the config when unchecked + saved', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: { host: 'h', port: 25, secure: false, fromEmail: 'a@b.co', hasPassword: false } });
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByLabelText('Configure project SMTP')); // uncheck (was enabled)
    fireEvent.click(screen.getByRole('button', { name: 'Save SMTP' }));
    await waitFor(() => expect(deleteProjectSmtp).toHaveBeenCalled());
    expect(putProjectSmtp).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SmtpInput } from '../src/api';

const getProjectSmtp = vi.fn();
const putProjectSmtp = vi.fn();
const deleteProjectSmtp = vi.fn();
const testProjectSmtp = vi.fn();
const sendProjectSmtpTest = vi.fn();
const me = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    getProjectSmtp: () => getProjectSmtp(),
    putProjectSmtp: (_p: string, body: SmtpInput) => putProjectSmtp(body),
    deleteProjectSmtp: () => deleteProjectSmtp(),
    testProjectSmtp: () => testProjectSmtp(),
    sendProjectSmtpTest: (_p: string, to?: string) => sendProjectSmtpTest(to),
    me: () => me(),
  },
}));

import { ProjectSmtp } from '../src/views/ProjectSmtp';

const project = { id: 'p', name: 'P', slug: 'p', role: 'owner' as const };

beforeEach(() => {
  getProjectSmtp.mockReset();
  putProjectSmtp.mockReset();
  deleteProjectSmtp.mockReset();
  testProjectSmtp.mockReset();
  sendProjectSmtpTest.mockReset();
  me.mockReset();
  me.mockResolvedValue({ platformRole: null }); // a client unless a test says otherwise
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

describe('ProjectSmtp connection test', () => {
  // Form delivery is best-effort — the visitor is thanked whether or not the mail leaves — so an
  // operator's only signal that SMTP is broken is this button. It has to report the REASON, not
  // just a red cross, because the most likely failure now is a server that offers no STARTTLS.
  it('reports a failure reason from the server verbatim', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'u', fromEmail: 'a@b.co', hasPassword: true } });
    testProjectSmtp.mockResolvedValue({ ok: false, error: 'The server at smtp.acme.com:587 does not offer STARTTLS' });
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/does not offer STARTTLS/)).toBeInTheDocument();
  });

  it('confirms a healthy connection', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'u', fromEmail: 'a@b.co', hasPassword: true } });
    testProjectSmtp.mockResolvedValue({ ok: true });
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/Connected/)).toBeInTheDocument();
  });

  it('offers no test button until SMTP is switched on — there would be nothing to test', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: null });
    render(<ProjectSmtp project={project} />);
    await screen.findByLabelText('Configure project SMTP');
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull();
  });
});

describe('ProjectSmtp stale test result', () => {
  // The endpoint tests what is STORED. A ✓ left over from the previous settings, sitting next to a
  // Save button the operator just pressed, asserts something nobody has verified — which is the
  // exact "no signal that mail broke" failure this button exists to remove.
  it('clears a previous result as soon as a field is edited', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'u', fromEmail: 'a@b.co', hasPassword: true } });
    testProjectSmtp.mockResolvedValue({ ok: true });
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/Connected/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('SMTP host'), { target: { value: 'smtp.other.com' } });
    await waitFor(() => expect(screen.queryByText(/Connected/)).toBeNull());
  });

  it('clears a previous result on save', async () => {
    getProjectSmtp.mockResolvedValue({ smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'u', fromEmail: 'a@b.co', hasPassword: true } });
    testProjectSmtp.mockResolvedValue({ ok: true });
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/Connected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save SMTP' }));
    await waitFor(() => expect(screen.queryByText(/Connected/)).toBeNull());
  });
});

describe('ProjectSmtp send test message', () => {
  const configured = { smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'u', fromEmail: 'a@b.co', hasPassword: true } };

  it('★ offers a project member NO recipient field — they may only mail themselves', async () => {
    // An invited client is a project member. The server refuses another address regardless; showing
    // the field would only ever produce a 403, so it is not shown.
    getProjectSmtp.mockResolvedValue(configured);
    sendProjectSmtpTest.mockResolvedValue({ ok: true, to: 'client@x.test' });
    render(<ProjectSmtp project={project} />);
    await screen.findByRole('button', { name: 'Send test message' });
    expect(screen.queryByLabelText('Test message recipient')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send test message' }));
    await waitFor(() => expect(sendProjectSmtpTest).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText(/Sent to client@x.test/)).toBeInTheDocument();
  });

  it('offers agency staff a recipient field and sends to it', async () => {
    getProjectSmtp.mockResolvedValue(configured);
    me.mockResolvedValue({ platformRole: 'developer' });
    sendProjectSmtpTest.mockResolvedValue({ ok: true, to: 'deliverability@acme.test' });
    render(<ProjectSmtp project={project} />);
    const to = await screen.findByLabelText('Test message recipient');
    fireEvent.change(to, { target: { value: 'deliverability@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send test message' }));
    await waitFor(() => expect(sendProjectSmtpTest).toHaveBeenCalledWith('deliverability@acme.test'));
  });

  it('surfaces a send failure rather than implying the mail went', async () => {
    getProjectSmtp.mockResolvedValue(configured);
    sendProjectSmtpTest.mockResolvedValue({ ok: false, error: 'The server rejected the username or password.' });
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send test message' }));
    expect(await screen.findByText(/rejected the username or password/)).toBeInTheDocument();
  });
});

describe('ProjectSmtp send-test edge paths', () => {
  const configured = { smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'u', fromEmail: 'a@b.co', hasPassword: true } };

  it('hides the recipient field when the identity lookup fails — fail closed, not open', async () => {
    getProjectSmtp.mockResolvedValue(configured);
    me.mockRejectedValue(new Error('offline'));
    sendProjectSmtpTest.mockResolvedValue({ ok: true, to: 'me@acme.test' });
    render(<ProjectSmtp project={project} />);
    await screen.findByRole('button', { name: 'Send test message' });
    expect(screen.queryByLabelText('Test message recipient')).toBeNull();
  });

  it('staff leaving the field blank still defaults to their own address', async () => {
    getProjectSmtp.mockResolvedValue(configured);
    me.mockResolvedValue({ platformRole: 'admin' });
    sendProjectSmtpTest.mockResolvedValue({ ok: true, to: 'admin@acme.test' });
    render(<ProjectSmtp project={project} />);
    await screen.findByLabelText('Test message recipient');
    fireEvent.click(screen.getByRole('button', { name: 'Send test message' }));
    await waitFor(() => expect(sendProjectSmtpTest).toHaveBeenCalledWith(undefined));
  });

  it('reports a thrown request (e.g. a 403) instead of leaving the button silent', async () => {
    getProjectSmtp.mockResolvedValue(configured);
    sendProjectSmtpTest.mockRejectedValue(new Error('only agency staff can send the test message to another address'));
    render(<ProjectSmtp project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send test message' }));
    expect(await screen.findByText(/only agency staff/)).toBeInTheDocument();
  });
});


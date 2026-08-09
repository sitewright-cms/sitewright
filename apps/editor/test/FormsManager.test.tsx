import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Form } from '@sitewright/schema';

const listForms = vi.fn();
const putForm = vi.fn();
const deleteForm = vi.fn();
const formModes = vi.fn();
const undeliveredSubmissions = vi.fn();
const filteredSubmissions = vi.fn();
const getProjectSmtp = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    listForms: () => listForms(),
    putForm: (_p: string, form: Form) => putForm(form),
    deleteForm: (_p: string, id: string) => deleteForm(id),
    formModes: () => formModes(),
    // Needed only once the embedded <ProjectSmtp> panel actually renders. Every test here used to
    // leave both credential modes off, so the panel never mounted and its absence was invisible.
    getProjectSmtp: () => getProjectSmtp(),
    // <ProjectSmtp> asks who you are, to decide whether to offer a test-message recipient field.
    me: () => Promise.resolve({ platformRole: null }),
    undeliveredSubmissions: () => undeliveredSubmissions(),
    filteredSubmissions: () => filteredSubmissions(),
  },
}));

import { FormsManager } from '../src/views/FormsManager';

const project = { id: 'p', name: 'P', slug: 'p', role: 'owner' as const };

beforeEach(() => {
  listForms.mockReset();
  putForm.mockReset();
  deleteForm.mockReset();
  formModes.mockReset();
  getProjectSmtp.mockReset();
  undeliveredSubmissions.mockReset();
  undeliveredSubmissions.mockResolvedValue({ count: 0, lastError: null });
  filteredSubmissions.mockReset();
  filteredSubmissions.mockResolvedValue({ total: 0, items: [] });
  getProjectSmtp.mockResolvedValue({ smtp: null });
  listForms.mockResolvedValue({ items: [] });
  putForm.mockResolvedValue({ item: {} });
  formModes.mockResolvedValue({ formModes: { globalSmtp: true, userSmtp: false, contactPhp: true, thirdParty: false } });
});

describe('FormsManager', () => {
  it('lists existing forms', async () => {
    listForms.mockResolvedValue({
      items: [{ id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', mode: 'globalSmtp', hcaptcha: false }],
    });
    render(<FormsManager project={project} />);
    expect(await screen.findByText('Contact')).toBeInTheDocument();
  });

  it('creates a form, edits fields + recipient, and saves a valid definition', async () => {
    render(<FormsManager project={project} />);
    // Create → opens the editor with a default email field.
    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Contact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    // Editor opened.
    const recipient = await screen.findByLabelText('Recipient email');
    fireEvent.change(recipient, { target: { value: 'leads@acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalledTimes(1));
    const saved = putForm.mock.calls[0]![0] as Form;
    expect(saved.id).toBe('contact');
    expect(saved.recipient).toBe('leads@acme.com');
    expect(saved.fields[0]!.name).toBe('email');
  });

  it('normalizes a typed field name to a safe identifier on save', async () => {
    render(<FormsManager project={project} />);
    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    await screen.findByLabelText('Recipient email');
    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'a@b.co' } });
    // Rename the default field to a messy label → expect a normalized identifier.
    fireEvent.change(screen.getByLabelText('Field 1 name'), { target: { value: 'Full Name!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalled());
    expect((putForm.mock.calls[0]![0] as Form).fields[0]!.name).toBe('full_name');
  });

  it('blocks saving a form whose only field has a blank name (inline error, no API call)', async () => {
    render(<FormsManager project={project} />);
    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    await screen.findByLabelText('Recipient email');
    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Field 1 name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    expect(await screen.findByText(/needs a name/)).toBeInTheDocument();
    expect(putForm).not.toHaveBeenCalled();
  });

  it('lists only the instance-enabled delivery modes in the selector and saves the choice', async () => {
    render(<FormsManager project={project} />);
    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Contact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    const modeSelect = (await screen.findByLabelText('Delivery mode')) as HTMLSelectElement;
    const options = Array.from(modeSelect.options).map((o) => o.value);
    // globalSmtp + contactPhp enabled in the mock; userSmtp + thirdParty disabled.
    expect(options).toEqual(['globalSmtp', 'contactPhp']);
    fireEvent.change(modeSelect, { target: { value: 'contactPhp' } });
    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalled());
    expect((putForm.mock.calls[0]![0] as Form).mode).toBe('contactPhp');
  });

  it('offers contact.php (SMTP) when enabled, and greys the captcha out for it', async () => {
    // A captcha is verified server-side on the platform endpoint, which the php modes never touch —
    // the embed pass drops the widget for them. An enabled toggle would therefore be a control that
    // silently does nothing, so it must be disabled for BOTH php flavours, not just `contactPhp`.
    formModes.mockResolvedValue({
      formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: true, thirdParty: false },
    });
    render(<FormsManager project={project} />);
    // ★ The panel that sets those credentials must be on the list view. This mode sends with the
    // PROJECT's own SMTP and is deliberately a separate permission from `userSmtp`, so gating the
    // panel on `userSmtp` alone offered a delivery mode with nowhere to type the password — and the
    // publish-time 409 told the author to go to settings that were not on screen.
    expect(await screen.findByLabelText('Configure project SMTP')).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Contact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    const modeSelect = (await screen.findByLabelText('Delivery mode')) as HTMLSelectElement;
    expect(Array.from(modeSelect.options).map((o) => o.value)).toEqual(['globalSmtp', 'contactPhpSmtp']);

    const captcha = screen.getByLabelText('Require a captcha') as HTMLInputElement;
    expect(captcha.disabled).toBe(false); // platform-routed default
    fireEvent.change(modeSelect, { target: { value: 'contactPhpSmtp' } });
    expect((screen.getByLabelText('Require a captcha') as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalled());
    expect((putForm.mock.calls[0]![0] as Form).mode).toBe('contactPhpSmtp');
  });

  it('shows the third-party URL field and saves it when mode is thirdParty', async () => {
    formModes.mockResolvedValue({ formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, thirdParty: true } });
    render(<FormsManager project={project} />);
    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    fireEvent.change(await screen.findByLabelText('Delivery mode'), { target: { value: 'thirdParty' } });
    fireEvent.change(screen.getByLabelText('Third-party endpoint URL'), { target: { value: 'https://formspree.io/f/abc' } });
    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalled());
    const saved = putForm.mock.calls[0]![0] as Form;
    expect(saved.mode).toBe('thirdParty');
    expect(saved.thirdPartyUrl).toBe('https://formspree.io/f/abc');
  });

  it('deletes a form after confirming in the dialog', async () => {
    deleteForm.mockResolvedValue(undefined);
    listForms
      .mockResolvedValueOnce({
        items: [{ id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: false }], recipient: 'a@b.co', submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', mode: 'globalSmtp', hcaptcha: false }],
      })
      .mockResolvedValue({ items: [] });
    render(<FormsManager project={project} />);
    fireEvent.click(await screen.findByLabelText('Delete form contact'));
    // The modal confirm dialog must be accepted before the delete fires.
    expect(deleteForm).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteForm).toHaveBeenCalledWith('contact'));
    expect(await screen.findByText(/No forms yet/)).toBeInTheDocument();
  });

  it('adds and removes fields in the editor', async () => {
    render(<FormsManager project={project} />);
    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    await screen.findByLabelText('Recipient email');
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Field 2 name'), { target: { value: 'phone' } });
    fireEvent.change(screen.getByLabelText('Field 2 label'), { target: { value: 'Phone' } });
    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalled());
    const saved = putForm.mock.calls[0]![0] as Form;
    expect(saved.fields.map((f) => f.name)).toContain('phone');
  });
});

describe('FormsManager undelivered warning', () => {
  it('★ warns on the Forms tab when submissions were not emailed', async () => {
    // An author opens Forms to ask "is this form working?". A silent delivery failure is precisely
    // the answer they came for, so it is surfaced here as well as in the inbox.
    undeliveredSubmissions.mockResolvedValue({ count: 3, lastError: 'The mail server rejected the username or password.' });
    render(<FormsManager project={project} />);
    expect(await screen.findByText(/3 submissions could not be emailed/)).toBeInTheDocument();
    expect(screen.getByText(/rejected the username or password/)).toBeInTheDocument();
  });

  it('stays quiet when everything was delivered', async () => {
    render(<FormsManager project={project} />);
    await screen.findByLabelText('New form name');
    expect(screen.queryByText(/could not be emailed/)).toBeNull();
  });
});



describe('filtered counter', () => {
  it('shows what the bot traps caught, with the reasons in its title', async () => {
    // The inbox can only ever show what got THROUGH. Without this an operator cannot tell a QUIET form
    // (nobody is writing) from a FILTERED one (everybody is, and a trap is eating it) — and cannot
    // answer a client who says they submitted and heard nothing.
    listForms.mockResolvedValue({ items: [{ id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', mode: 'globalSmtp', hcaptcha: false }] });
    filteredSubmissions.mockResolvedValue({
      total: 5,
      items: [
        { formId: 'contact', reason: 'honeypot', count: 4, lastAt: Date.now() },
        { formId: 'contact', reason: 'too-fast', count: 1, lastAt: Date.now() },
      ],
    });
    render(<FormsManager project={project} />);
    const badge = await screen.findByText('5 filtered');
    expect(badge.getAttribute('title')).toContain('4 honeypot');
    expect(badge.getAttribute('title')).toContain('1 too-fast');
    // Says plainly that these were never leads, so nobody hunts the inbox for them.
    expect(badge.getAttribute('title')).toContain('never became submissions');
  });

  it('shows NOTHING when nothing was filtered — no zero-badge noise on a healthy form', async () => {
    listForms.mockResolvedValue({ items: [{ id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', mode: 'globalSmtp', hcaptcha: false }] });
    render(<FormsManager project={project} />);
    await screen.findByText('contact');
    expect(screen.queryByText(/filtered/)).toBeNull();
  });

  it('still renders the forms when the counter endpoint fails — reporting is not load-bearing', async () => {
    listForms.mockResolvedValue({ items: [{ id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', mode: 'globalSmtp', hcaptcha: false }] });
    filteredSubmissions.mockRejectedValue(new Error('boom'));
    render(<FormsManager project={project} />);
    await screen.findByText('contact');
    expect(screen.queryByText(/filtered/)).toBeNull();
  });
});

describe('proof-of-work toggle', () => {
  it('saves the opt-in, and says plainly that it needs no third party or keys', async () => {
    // The distinction that matters when choosing between this and hCaptcha: one needs an account, keys
    // and a third party in the page; the other needs none of that and spends the visitor's CPU instead.
    listForms.mockResolvedValue({ items: [] });
    render(<FormsManager project={project} />);
    fireEvent.change(await screen.findByLabelText('New form name'), { target: { value: 'Contact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create form' }));
    fireEvent.change(await screen.findByLabelText('Recipient email'), { target: { value: 'leads@acme.com' } });
    const toggle = screen.getByLabelText('Require proof of work') as HTMLInputElement;
    expect(toggle.checked).toBe(false); // OPT-IN: never on by default
    expect(toggle.closest('label')!.textContent).toContain('no third party, no keys');
    // …and it points the author at the evidence rather than at a hunch.
    expect(toggle.closest('label')!.textContent).toContain('filtered count');
    // …and states the constraint that would otherwise be discovered the hard way: on plain http the
    // browser crypto is unavailable, so the form could never be submitted at all.
    expect(toggle.closest('label')!.textContent).toContain('needs HTTPS');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalled());
    expect(putForm.mock.calls[0]![0]).toMatchObject({ pow: true });
  });
});

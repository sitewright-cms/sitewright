import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Form } from '@sitewright/schema';

const listForms = vi.fn();
const putForm = vi.fn();
const deleteForm = vi.fn();
const formModes = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    listForms: () => listForms(),
    putForm: (_o: string, _p: string, form: Form) => putForm(form),
    deleteForm: (_o: string, _p: string, id: string) => deleteForm(id),
    formModes: () => formModes(),
  },
}));

import { FormsManager } from '../src/views/FormsManager';

const org = { id: 'o', name: 'O', slug: 'o', role: 'admin' };
const project = { id: 'p', name: 'P', slug: 'p' };

beforeEach(() => {
  listForms.mockReset();
  putForm.mockReset();
  deleteForm.mockReset();
  formModes.mockReset();
  listForms.mockResolvedValue({ items: [] });
  putForm.mockResolvedValue({ item: {} });
  formModes.mockResolvedValue({ formModes: { globalSmtp: true, userSmtp: false, contactPhp: true, thirdParty: false } });
});

describe('FormsManager', () => {
  it('lists existing forms', async () => {
    listForms.mockResolvedValue({
      items: [{ id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email' }], recipient: 'a@b.co', submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', mode: 'globalSmtp', hcaptcha: false }],
    });
    render(<FormsManager org={org} project={project} />);
    expect(await screen.findByText('Contact')).toBeInTheDocument();
  });

  it('creates a form, edits fields + recipient, and saves a valid definition', async () => {
    render(<FormsManager org={org} project={project} />);
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
    render(<FormsManager org={org} project={project} />);
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
    render(<FormsManager org={org} project={project} />);
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
    render(<FormsManager org={org} project={project} />);
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

  it('deletes a form after confirmation', async () => {
    vi.stubGlobal('confirm', () => true);
    deleteForm.mockResolvedValue(undefined);
    listForms
      .mockResolvedValueOnce({
        items: [{ id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: false }], recipient: 'a@b.co', submitLabel: 'Send', successMessage: 'ok', errorMessage: 'no', mode: 'globalSmtp', hcaptcha: false }],
      })
      .mockResolvedValue({ items: [] });
    render(<FormsManager org={org} project={project} />);
    fireEvent.click(await screen.findByLabelText('Delete form contact'));
    await waitFor(() => expect(deleteForm).toHaveBeenCalledWith('contact'));
    expect(await screen.findByText(/No forms yet/)).toBeInTheDocument();
  });

  it('adds and removes fields in the editor', async () => {
    render(<FormsManager org={org} project={project} />);
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

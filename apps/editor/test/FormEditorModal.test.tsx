import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Form } from '@sitewright/schema';

const { putForm, formModes, getProjectCaptcha, confirm } = vi.hoisted(() => ({
  putForm: vi.fn(), formModes: vi.fn(), getProjectCaptcha: vi.fn(), confirm: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    putForm: (...a: unknown[]) => putForm(...a),
    formModes: (...a: unknown[]) => formModes(...a),
    getProjectCaptcha: (...a: unknown[]) => getProjectCaptcha(...a),
  },
}));
vi.mock('../src/views/ui/Dialogs', () => ({
  useDialogs: () => ({ confirm: (...a: unknown[]) => confirm(...a), dialog: null }),
}));

import { FormEditorModal } from '../src/views/FormEditorModal';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const form: Form = {
  id: 'enquiry', name: 'Enquiry', recipient: 'a@b.com', mode: 'globalSmtp',
  fields: [{ name: 'name', label: 'Your name', type: 'text', required: true }],
  pow: false, captcha: false,
} as Form;

beforeEach(() => {
  putForm.mockReset(); formModes.mockReset(); getProjectCaptcha.mockReset(); confirm.mockReset();
  putForm.mockResolvedValue(undefined);
  formModes.mockResolvedValue({ formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false } });
  getProjectCaptcha.mockResolvedValue({ captcha: { hasSecret: true } });
  confirm.mockResolvedValue(true);
});

/**
 * The form editor used to be a view swap inside the Forms tab — unreachable from the place an author
 * actually looks at a form, which is the page or slot that embeds it. As a modal it opens anywhere.
 */
describe('FormEditorModal', () => {
  it('loads delivery modes and captcha readiness itself when opened from a preview', async () => {
    render(<FormEditorModal project={project} form={form} onClose={vi.fn()} />);
    // Nothing hands these in from a page/slot preview, so the modal has to fetch them or it renders
    // an empty mode selector and a spurious captcha warning.
    await waitFor(() => expect(formModes).toHaveBeenCalledWith('p'));
    expect(getProjectCaptcha).toHaveBeenCalledWith('p');
  });

  it('does not refetch what the Forms tab already handed it', async () => {
    render(
      <FormEditorModal
        project={project}
        form={form}
        enabledModes={{ globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false }}
        captchaReady
        onClose={vi.fn()}
      />,
    );
    await Promise.resolve();
    expect(formModes).not.toHaveBeenCalled();
  });

  it('saves the edited definition and closes', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<FormEditorModal project={project} form={form} onSaved={onSaved} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Ask Elvi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(putForm).toHaveBeenCalled());
    expect((putForm.mock.calls[0]![1] as Form).name).toBe('Ask Elvi');
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('never edits the caller’s object — the draft is cloned down to each field', async () => {
    const original = JSON.parse(JSON.stringify(form)) as Form;
    render(<FormEditorModal project={project} form={form} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Changed' } });
    expect(form).toEqual(original);
  });

  it('DISCARD asks before losing changes, and closes when confirmed', async () => {
    const onClose = vi.fn();
    render(<FormEditorModal project={project} form={form} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(putForm).not.toHaveBeenCalled();
  });

  it('DISCARD closes in one click when nothing was changed', async () => {
    const onClose = vi.fn();
    render(<FormEditorModal project={project} form={form} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // "opened it to look" must not cost a confirmation
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the modal open and shows the reason when validation fails', async () => {
    const onClose = vi.fn();
    render(<FormEditorModal project={project} form={{ ...form, fields: [{ ...form.fields[0]!, label: '  ' }] }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(screen.getByText(/needs a label/)).toBeTruthy());
    expect(putForm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a failed save instead of closing over it', async () => {
    putForm.mockRejectedValue(new Error('recipient rejected'));
    const onClose = vi.fn();
    render(<FormEditorModal project={project} form={form} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await waitFor(() => expect(screen.getByText(/recipient rejected/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });
});

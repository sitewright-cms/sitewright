import { describe, it, expect } from 'vitest';
import {
  FormFieldSchema,
  FormSchema,
  FormSubmissionSchema,
  toPublicForm,
  HONEYPOT_FIELD,
  TIMETRAP_FIELD,
  type Form,
} from '../src/form.js';

describe('FormFieldSchema', () => {
  it('defaults type to text and required to false', () => {
    const f = FormFieldSchema.parse({ name: 'email', label: 'Email' });
    expect(f.type).toBe('text');
    expect(f.required).toBe(false);
  });

  it('rejects a file type (no attachments) and a bad field name', () => {
    expect(() => FormFieldSchema.parse({ name: 'cv', label: 'CV', type: 'file' })).toThrow();
    expect(() => FormFieldSchema.parse({ name: '1bad', label: 'x' })).toThrow();
  });
});

describe('FormSchema', () => {
  const base = {
    id: 'contact',
    name: 'Contact form',
    fields: [{ name: 'email', label: 'Email', type: 'email' as const, required: true }],
    recipient: 'sales@acme.com',
  };

  it('applies professional defaults for labels and messages', () => {
    const form = FormSchema.parse(base);
    expect(form.submitLabel).toBe('Send');
    expect(form.successMessage).toContain('Thank you');
    expect(form.errorMessage).toContain('Sorry');
    expect(form.mode).toBe('globalSmtp');
    expect(form.hcaptcha).toBe(false);
  });

  it('requires at least one field and a valid recipient email', () => {
    expect(() => FormSchema.parse({ ...base, fields: [] })).toThrow();
    expect(() => FormSchema.parse({ ...base, recipient: 'not-an-email' })).toThrow();
  });

  it('accepts a path or http(s) redirectUrl but rejects junk', () => {
    expect(FormSchema.parse({ ...base, redirectUrl: '/thanks' }).redirectUrl).toBe('/thanks');
    expect(FormSchema.parse({ ...base, redirectUrl: 'https://acme.com/thanks' }).redirectUrl).toBe(
      'https://acme.com/thanks',
    );
    expect(() => FormSchema.parse({ ...base, redirectUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => FormSchema.parse({ ...base, redirectUrl: '/has space' })).toThrow();
  });
});

describe('toPublicForm', () => {
  it('strips recipient/subject/mode and keeps the renderable fields', () => {
    const form: Form = FormSchema.parse({
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email' }],
      recipient: 'secret@acme.com',
      subject: 'New lead',
      redirectUrl: '/thanks',
    });
    const pub = toPublicForm(form);
    const serialized = JSON.stringify(pub);
    // recipient + subject are server-side and stripped; mode is intentionally kept
    // (the renderer needs it to pick the submission endpoint — it isn't sensitive).
    expect(serialized).not.toContain('secret@acme.com');
    expect(serialized).not.toContain('New lead');
    expect(pub.mode).toBe('globalSmtp');
    expect(pub.redirectUrl).toBe('/thanks');
    expect(pub.fields[0]?.name).toBe('email');
  });
});

describe('FormSubmissionSchema', () => {
  it('accepts a flat text record', () => {
    const sub = FormSubmissionSchema.parse({
      id: 'sub-1',
      formId: 'contact',
      fields: { email: 'a@b.co', message: 'hello' },
      createdAt: '2026-05-31T00:00:00.000Z',
    });
    expect(sub.fields.email).toBe('a@b.co');
  });

  it('rejects non-string field values (no nested/binary data)', () => {
    expect(() =>
      FormSubmissionSchema.parse({
        id: 'sub-1',
        formId: 'contact',
        fields: { attachment: { bytes: 'AAAA' } },
        createdAt: '2026-05-31T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('honeypot/time-trap field names', () => {
  it('are stable constants', () => {
    expect(HONEYPOT_FIELD).toBe('_hpt');
    expect(TIMETRAP_FIELD).toBe('_elapsed');
  });
});

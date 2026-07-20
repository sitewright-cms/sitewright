import { describe, it, expect } from 'vitest';
import {
  FormFieldSchema,
  FormSchema,
  FormSubmissionSchema,
  toPublicForm,
  validateFormSubmission,
  HONEYPOT_FIELD,
  TIMETRAP_FIELD,
  type Form,
  type FormField,
} from '../src/form.js';

/** Parse a partial field spec through the schema so defaults (type/required) match production. */
function field(spec: Partial<FormField> & { name: string; label: string }): FormField {
  return FormFieldSchema.parse(spec);
}

describe('FormFieldSchema', () => {
  it('defaults type to text and required to false', () => {
    const f = FormFieldSchema.parse({ name: 'email', label: 'Email' });
    expect(f.type).toBe('text');
    expect(f.required).toBe(false);
  });

  it('rejects a file type (no attachments), a bad field name, and reserved prototype names', () => {
    expect(() => FormFieldSchema.parse({ name: 'cv', label: 'CV', type: 'file' })).toThrow();
    expect(() => FormFieldSchema.parse({ name: '1bad', label: 'x' })).toThrow();
    for (const n of ['__proto__', 'constructor', 'prototype']) {
      expect(() => FormFieldSchema.parse({ name: n, label: 'x' })).toThrow(/reserved identifier/);
    }
  });

  it('accepts radio + checkbox; a radio REQUIRES options; a checkbox is a group WITH options / boolean without', () => {
    expect(FormFieldSchema.parse({ name: 'plan', label: 'Plan', type: 'radio', options: ['A', 'B'] }).type).toBe('radio');
    expect(() => FormFieldSchema.parse({ name: 'plan', label: 'Plan', type: 'radio' })).toThrow(/at least one option/); // radio needs options
    expect(FormFieldSchema.parse({ name: 'feats', label: 'Features', type: 'checkbox', options: ['SEO'] }).options).toEqual(['SEO']); // group
    expect(FormFieldSchema.parse({ name: 'agree', label: 'Agree', type: 'checkbox' }).type).toBe('checkbox'); // single boolean, no options
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

  it('requires an https thirdPartyUrl when mode is thirdParty', () => {
    expect(() => FormSchema.parse({ ...base, mode: 'thirdParty' })).toThrow(); // missing url
    expect(() => FormSchema.parse({ ...base, mode: 'thirdParty', thirdPartyUrl: 'http://x.co' })).toThrow(); // not https
    expect(() => FormSchema.parse({ ...base, mode: 'thirdParty', thirdPartyUrl: 'not a url' })).toThrow();
    const ok = FormSchema.parse({ ...base, mode: 'thirdParty', thirdPartyUrl: 'https://formspree.io/f/abc' });
    expect(ok.thirdPartyUrl).toBe('https://formspree.io/f/abc');
    // thirdPartyUrl is allowed (ignored) for other modes.
    expect(FormSchema.parse({ ...base, thirdPartyUrl: 'https://x.co' }).mode).toBe('globalSmtp');
  });

  it('rejects a thirdPartyUrl that targets a private/local host or carries credentials', () => {
    const tp = (url: string) => FormSchema.parse({ ...base, mode: 'thirdParty', thirdPartyUrl: url });
    expect(() => tp('https://localhost/submit')).toThrow();
    expect(() => tp('https://127.0.0.1/submit')).toThrow();
    expect(() => tp('https://192.168.1.10/submit')).toThrow();
    expect(() => tp('https://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => tp('https://api.internal/submit')).toThrow();
    expect(() => tp('https://user:pass@formspree.io/f/abc')).toThrow();
    // A public host is fine.
    expect(tp('https://formspree.io/f/abc').thirdPartyUrl).toBe('https://formspree.io/f/abc');
  });

  it('accepts a root-relative path or http(s) redirectUrl but rejects junk', () => {
    expect(FormSchema.parse({ ...base, redirectUrl: '/thanks' }).redirectUrl).toBe('/thanks');
    expect(FormSchema.parse({ ...base, redirectUrl: '/' }).redirectUrl).toBe('/'); // bare root
    expect(FormSchema.parse({ ...base, redirectUrl: '/thanks?ref=1#top' }).redirectUrl).toBe('/thanks?ref=1#top');
    expect(FormSchema.parse({ ...base, redirectUrl: 'https://acme.com/thanks' }).redirectUrl).toBe(
      'https://acme.com/thanks',
    );
    expect(() => FormSchema.parse({ ...base, redirectUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => FormSchema.parse({ ...base, redirectUrl: '/has space' })).toThrow();
  });

  it('rejects a protocol-relative redirectUrl that would navigate cross-origin (open-redirect guard)', () => {
    // `//evil.com` and `/\evil.com` LOOK like local paths but browsers treat them as
    // protocol-relative → cross-origin. An explicit http(s) scheme is the only off-site exit.
    expect(() => FormSchema.parse({ ...base, redirectUrl: '//evil.com' })).toThrow();
    expect(() => FormSchema.parse({ ...base, redirectUrl: '//evil.com/phish' })).toThrow();
    expect(() => FormSchema.parse({ ...base, redirectUrl: '/\\evil.com' })).toThrow();
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

  it('passes thirdPartyUrl through to the public projection (the renderer needs it)', () => {
    const form: Form = FormSchema.parse({
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email' }],
      recipient: 'a@b.co',
      mode: 'thirdParty',
      thirdPartyUrl: 'https://formspree.io/f/abc',
    });
    const pub = toPublicForm(form);
    expect(pub.mode).toBe('thirdParty');
    expect(pub.thirdPartyUrl).toBe('https://formspree.io/f/abc');
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

describe('validateFormSubmission', () => {
  it('accepts a complete, well-formed submission', () => {
    const fields = [
      field({ name: 'email', label: 'Email', type: 'email', required: true }),
      field({ name: 'note', label: 'Note', type: 'textarea' }),
    ];
    expect(validateFormSubmission(fields, { email: 'a@b.co', note: 'hi' })).toEqual([]);
  });

  it('flags a missing required field (absent or blank/whitespace-only)', () => {
    const fields = [field({ name: 'email', label: 'Email', type: 'email', required: true })];
    expect(validateFormSubmission(fields, {})).toEqual(['email']);
    expect(validateFormSubmission(fields, { email: '' })).toEqual(['email']);
    expect(validateFormSubmission(fields, { email: '   ' })).toEqual(['email']);
  });

  it('lets an optional field stay empty (no format check on blank)', () => {
    const fields = [field({ name: 'website', label: 'Website', type: 'url' })];
    expect(validateFormSubmission(fields, {})).toEqual([]);
    expect(validateFormSubmission(fields, { website: '' })).toEqual([]);
  });

  it('validates email / url / number formats when a value is present', () => {
    const fields = [
      field({ name: 'email', label: 'Email', type: 'email' }),
      field({ name: 'site', label: 'Site', type: 'url' }),
      field({ name: 'qty', label: 'Qty', type: 'number' }),
    ];
    expect(validateFormSubmission(fields, { email: 'nope', site: 'not a url', qty: 'ten' })).toEqual([
      'email',
      'site',
      'qty',
    ]);
    expect(
      validateFormSubmission(fields, { email: 'a@b.co', site: 'https://x.io', qty: '-3.5' }),
    ).toEqual([]);
  });

  it('accepts only http(s) urls (rejects javascript:/data:/mailto:)', () => {
    const fields = [field({ name: 'site', label: 'Site', type: 'url' })];
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.co', 'ftp://h/x']) {
      expect(validateFormSubmission(fields, { site: bad })).toEqual(['site']);
    }
    expect(validateFormSubmission(fields, { site: 'http://x.io' })).toEqual([]);
    expect(validateFormSubmission(fields, { site: 'https://x.io/p?q=1' })).toEqual([]);
  });

  it('accepts only decimal/exponent number literals (rejects hex/octal a native input never sends)', () => {
    const fields = [field({ name: 'qty', label: 'Qty', type: 'number' })];
    for (const bad of ['0x1F', '0b101', '1,000', 'Infinity', 'NaN']) {
      expect(validateFormSubmission(fields, { qty: bad })).toEqual(['qty']);
    }
    for (const good of ['0', '42', '-3.5', '.5', '1e5']) {
      expect(validateFormSubmission(fields, { qty: good })).toEqual([]);
    }
  });

  it('enforces single-select option membership for select and radio', () => {
    const fields = [
      field({ name: 'plan', label: 'Plan', type: 'select', options: ['free', 'pro'] }),
      field({ name: 'size', label: 'Size', type: 'radio', options: ['s', 'm', 'l'] }),
    ];
    expect(validateFormSubmission(fields, { plan: 'enterprise', size: 'm' })).toEqual(['plan']);
    expect(validateFormSubmission(fields, { plan: 'pro', size: 'xl' })).toEqual(['size']);
    expect(validateFormSubmission(fields, { plan: 'free', size: 'l' })).toEqual([]);
  });

  it('matches a select option authored with incidental surrounding whitespace', () => {
    // The submitted value is trimmed; the option must be trimmed too, or its own value would be rejected.
    const fields = [field({ name: 'plan', label: 'Plan', type: 'select', options: ['  pro  ', 'free'] })];
    expect(validateFormSubmission(fields, { plan: 'pro' })).toEqual([]);
    expect(validateFormSubmission(fields, { plan: 'enterprise' })).toEqual(['plan']);
  });

  it('checks presence of a required checkbox GROUP via its joined value', () => {
    // A checkbox group submits as one joined "A, B" string; presence is all the server can assert.
    const fields = [field({ name: 'topics', label: 'Topics', type: 'checkbox', required: true, options: ['a', 'b'] })];
    expect(validateFormSubmission(fields, {})).toEqual(['topics']);
    expect(validateFormSubmission(fields, { topics: 'a, b' })).toEqual([]);
  });

  it('ignores submitted keys with no matching field (extras are stored, not rejected)', () => {
    const fields = [field({ name: 'email', label: 'Email', type: 'email', required: true })];
    expect(validateFormSubmission(fields, { email: 'a@b.co', extra: 'kept' })).toEqual([]);
  });

  it('never reads inherited prototype members off the submission map', () => {
    const fields = [field({ name: 'toString', label: 'To String', type: 'text', required: true })];
    // `toString` exists on the prototype but not as an own property → treated as missing → flagged.
    expect(validateFormSubmission(fields, {})).toEqual(['toString']);
  });
});

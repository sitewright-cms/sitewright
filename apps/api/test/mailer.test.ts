import { describe, it, expect } from 'vitest';
import { GlobalSmtpMailer, formatSubmissionText, type MailTransport, type MailerSettings } from '../src/mail/mailer.js';
import type { InstanceSettingsStored } from '@sitewright/schema';

function settings(stored: InstanceSettingsStored, password: string | null = null): MailerSettings {
  return {
    getStored: async () => stored,
    getSmtpPassword: async () => password,
  };
}

const withSmtp: InstanceSettingsStored = {
  formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, thirdParty: false },
  smtp: { host: 'smtp.acme.com', port: 587, secure: false, user: 'mailer', fromEmail: 'no-reply@acme.com', fromName: 'Acme' },
};

describe('formatSubmissionText', () => {
  it('renders each field under a header, indenting multi-line values', () => {
    const text = formatSubmissionText('Contact', { email: 'a@b.co', message: 'line1\nline2' });
    expect(text).toContain('New submission for "Contact"');
    expect(text).toContain('email:\n  a@b.co');
    // A value's own newline is indented, so it can't masquerade as a new field.
    expect(text).toContain('message:\n  line1\n  line2');
  });
});

describe('GlobalSmtpMailer', () => {
  function recordingTransport() {
    const sent: Array<Record<string, unknown>> = [];
    const factory = () => ({ sendMail: async (m: Record<string, unknown>) => { sent.push(m); return {}; } }) as MailTransport;
    return { sent, factory };
  }

  it('sends via the configured SMTP with auth + a From name', async () => {
    const { sent, factory } = recordingTransport();
    const mailer = new GlobalSmtpMailer(settings(withSmtp, 'hunter2'), factory);
    const ok = await mailer.send({ recipient: 'sales@acme.com', subject: 'New lead', formName: 'Contact', fields: { email: 'a@b.co' }, replyTo: 'a@b.co' });
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: 'Acme <no-reply@acme.com>', to: 'sales@acme.com', subject: 'New lead', replyTo: 'a@b.co' });
    expect(String(sent[0]!.text)).toContain('email:\n  a@b.co');
  });

  it('returns false (does not send) when global SMTP mode is disabled', async () => {
    const { sent, factory } = recordingTransport();
    const disabled: InstanceSettingsStored = { ...withSmtp, formModes: { ...withSmtp.formModes, globalSmtp: false } };
    const mailer = new GlobalSmtpMailer(settings(disabled, 'pw'), factory);
    expect(await mailer.send({ recipient: 'x@y.z', subject: 's', formName: 'f', fields: {} })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('returns false when no SMTP is configured', async () => {
    const { factory } = recordingTransport();
    const noSmtp: InstanceSettingsStored = { formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, thirdParty: false } };
    const mailer = new GlobalSmtpMailer(settings(noSmtp), factory);
    expect(await mailer.send({ recipient: 'x@y.z', subject: 's', formName: 'f', fields: {} })).toBe(false);
  });

  it('returns false (not throw) when the stored password cannot be decrypted', async () => {
    const { sent, factory } = recordingTransport();
    const brokenSettings: MailerSettings = {
      getStored: async () => withSmtp,
      getSmtpPassword: async () => {
        throw new Error('Unsupported state or unable to authenticate data');
      },
    };
    const mailer = new GlobalSmtpMailer(brokenSettings, factory);
    expect(await mailer.send({ recipient: 'x@y.z', subject: 's', formName: 'f', fields: {} })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('omits auth when no user is set (open relay / IP-authed SMTP)', async () => {
    const noAuth: InstanceSettingsStored = {
      formModes: withSmtp.formModes,
      smtp: { host: 'localhost', port: 25, secure: false, fromEmail: 'no-reply@acme.com' },
    };
    let captured: unknown;
    const factory = (config: unknown) => {
      captured = config;
      return { sendMail: async () => ({}) } as MailTransport;
    };
    const mailer = new GlobalSmtpMailer(settings(noAuth), factory);
    expect(await mailer.send({ recipient: 'x@y.z', subject: 's', formName: 'f', fields: {} })).toBe(true);
    expect((captured as { auth?: unknown }).auth).toBeUndefined();
  });
});

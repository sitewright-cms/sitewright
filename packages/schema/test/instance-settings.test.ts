import { describe, it, expect } from 'vitest';
import {
  FormModesSchema,
  DEFAULT_FORM_MODES,
  SmtpInputSchema,
  HcaptchaInputSchema,
  InstanceSettingsInputSchema,
  InstanceSettingsStoredSchema,
  maskInstanceSettings,
  type InstanceSettingsStored,
} from '../src/instance-settings.js';

describe('FormModesSchema', () => {
  it('requires all four booleans', () => {
    expect(() => FormModesSchema.parse({ globalSmtp: true })).toThrow();
    const all = { globalSmtp: true, userSmtp: false, contactPhp: true, thirdParty: false };
    expect(FormModesSchema.parse(all)).toEqual(all);
  });

  it('DEFAULT_FORM_MODES disables every mode', () => {
    expect(DEFAULT_FORM_MODES).toEqual({
      globalSmtp: false,
      userSmtp: false,
      contactPhp: false,
      thirdParty: false,
    });
  });
});

describe('SmtpInputSchema', () => {
  it('accepts a minimal SMTP config (secure defaults to false, password optional)', () => {
    const parsed = SmtpInputSchema.parse({ host: 'smtp.acme.com', port: 587, fromEmail: 'no-reply@acme.com' });
    expect(parsed.secure).toBe(false);
    expect(parsed.password).toBeUndefined();
  });

  it('rejects a bad fromEmail and out-of-range port', () => {
    expect(() => SmtpInputSchema.parse({ host: 'h', port: 587, fromEmail: 'not-an-email' })).toThrow();
    expect(() => SmtpInputSchema.parse({ host: 'h', port: 0, fromEmail: 'a@b.co' })).toThrow();
    expect(() => SmtpInputSchema.parse({ host: 'h', port: 70000, fromEmail: 'a@b.co' })).toThrow();
  });

  it('rejects CRLF / control characters in host and fromName (injection guard)', () => {
    expect(() => SmtpInputSchema.parse({ host: 'smtp.acme.com\r\nEVIL', port: 587, fromEmail: 'a@b.co' })).toThrow();
    expect(() =>
      SmtpInputSchema.parse({ host: 'smtp.acme.com', port: 587, fromEmail: 'a@b.co', fromName: 'Acme\nBcc: x@y.z' }),
    ).toThrow();
  });
});

describe('HcaptchaInputSchema', () => {
  it('requires a site key; secret is optional', () => {
    expect(HcaptchaInputSchema.parse({ siteKey: 'abc' })).toEqual({ siteKey: 'abc' });
    expect(() => HcaptchaInputSchema.parse({})).toThrow();
  });
});

describe('InstanceSettingsInputSchema', () => {
  it('allows null to clear a section and undefined to leave it unchanged', () => {
    expect(InstanceSettingsInputSchema.parse({ smtp: null })).toEqual({ smtp: null });
    expect(InstanceSettingsInputSchema.parse({})).toEqual({});
  });

  it('accepts a partial formModes update', () => {
    expect(InstanceSettingsInputSchema.parse({ formModes: { globalSmtp: true } })).toEqual({
      formModes: { globalSmtp: true },
    });
  });
});

describe('InstanceSettingsStoredSchema', () => {
  it('defaults formModes to all-disabled', () => {
    expect(InstanceSettingsStoredSchema.parse({}).formModes).toEqual(DEFAULT_FORM_MODES);
  });
});

describe('maskInstanceSettings', () => {
  const enc = { iv: 'aXY=', ct: 'Y3Q=', tag: 'dGFn' };

  it('collapses secrets to presence flags and never leaks ciphertext', () => {
    const stored: InstanceSettingsStored = {
      smtp: { host: 'smtp.acme.com', port: 465, secure: true, user: 'mailer', fromEmail: 'no-reply@acme.com', password: enc },
      hcaptcha: { siteKey: 'site-123', secret: enc },
      formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, thirdParty: false },
    };
    const masked = maskInstanceSettings(stored);
    expect(masked.smtp).toEqual({
      host: 'smtp.acme.com',
      port: 465,
      secure: true,
      user: 'mailer',
      fromEmail: 'no-reply@acme.com',
      hasPassword: true,
    });
    expect(masked.hcaptcha).toEqual({ siteKey: 'site-123', hasSecret: true });
    // The encrypted envelope (iv/ct/tag values) must not appear in the output.
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain(enc.ct);
    expect(serialized).not.toContain(enc.iv);
    expect(serialized).not.toContain(enc.tag);
  });

  it('reports hasPassword/hasSecret false when secrets are absent', () => {
    const stored: InstanceSettingsStored = {
      smtp: { host: 'h', port: 25, secure: false, fromEmail: 'a@b.co' },
      hcaptcha: { siteKey: 's' },
      formModes: DEFAULT_FORM_MODES,
    };
    const masked = maskInstanceSettings(stored);
    expect(masked.smtp?.hasPassword).toBe(false);
    expect(masked.hcaptcha?.hasSecret).toBe(false);
  });

  it('omits absent sections', () => {
    const masked = maskInstanceSettings({ formModes: DEFAULT_FORM_MODES });
    expect(masked.smtp).toBeUndefined();
    expect(masked.hcaptcha).toBeUndefined();
    expect(masked.formModes).toEqual(DEFAULT_FORM_MODES);
  });
});

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

  it('accepts the allowSelfRegistration toggle', () => {
    expect(InstanceSettingsInputSchema.parse({ allowSelfRegistration: true })).toEqual({ allowSelfRegistration: true });
    expect(InstanceSettingsInputSchema.parse({ allowSelfRegistration: false })).toEqual({ allowSelfRegistration: false });
  });
});

describe('InstanceSettingsStoredSchema', () => {
  it('defaults formModes to all-disabled', () => {
    expect(InstanceSettingsStoredSchema.parse({}).formModes).toEqual(DEFAULT_FORM_MODES);
  });

  it('leaves allowSelfRegistration absent when unset (distinguishable from an explicit false)', () => {
    expect(InstanceSettingsStoredSchema.parse({}).allowSelfRegistration).toBeUndefined();
    expect(InstanceSettingsStoredSchema.parse({ allowSelfRegistration: false }).allowSelfRegistration).toBe(false);
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
    expect(masked.allowSelfRegistration).toBeUndefined();
  });

  it('passes allowSelfRegistration through (non-secret) only when set', () => {
    expect(maskInstanceSettings({ formModes: DEFAULT_FORM_MODES, allowSelfRegistration: true }).allowSelfRegistration).toBe(true);
    expect(maskInstanceSettings({ formModes: DEFAULT_FORM_MODES, allowSelfRegistration: false }).allowSelfRegistration).toBe(false);
  });
});

describe('branding (platform name / colors / logo)', () => {
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('accepts a valid name, colors, and logo on input', () => {
    const parsed = InstanceSettingsInputSchema.parse({
      platformName: 'Acme CMS',
      brandPrimary: '#ff0066',
      brandSecondary: 'rgb(10, 20, 30)',
      platformLogo: { mime: 'image/png', data: PNG_1PX },
    });
    expect(parsed.platformName).toBe('Acme CMS');
    expect(parsed.brandPrimary).toBe('#ff0066');
    expect(parsed.platformLogo).toEqual({ mime: 'image/png', data: PNG_1PX });
  });

  it('rejects a control-char name, an over-long name, and a CSS-injection color', () => {
    expect(() => InstanceSettingsInputSchema.parse({ platformName: 'badname' })).toThrow();
    expect(() => InstanceSettingsInputSchema.parse({ platformName: 'x'.repeat(61) })).toThrow();
    // CssColorSchema rejects declaration break-out characters.
    expect(() => InstanceSettingsInputSchema.parse({ brandPrimary: 'red;}body{display:none' })).toThrow();
    expect(() => InstanceSettingsInputSchema.parse({ brandSecondary: '#zzzzzz' })).toThrow();
  });

  it('rejects a non-raster (svg/gif) logo mime and an over-cap payload', () => {
    expect(() => InstanceSettingsInputSchema.parse({ platformLogo: { mime: 'image/svg+xml', data: PNG_1PX } })).toThrow();
    expect(() => InstanceSettingsInputSchema.parse({ platformLogo: { mime: 'image/gif', data: PNG_1PX } })).toThrow();
    expect(() => InstanceSettingsInputSchema.parse({ platformLogo: { mime: 'image/png', data: 'A'.repeat(700_001) } })).toThrow();
  });

  it('allows null to clear each branding field and undefined to keep it', () => {
    const cleared = InstanceSettingsInputSchema.parse({ platformName: null, brandPrimary: null, brandSecondary: null, platformLogo: null });
    expect(cleared.platformName).toBeNull();
    expect(cleared.platformLogo).toBeNull();
    const untouched = InstanceSettingsInputSchema.parse({});
    expect(untouched.platformName).toBeUndefined();
  });

  it('masks the logo to a presence flag (hasLogo) and never returns the bytes', () => {
    const masked = maskInstanceSettings({
      formModes: DEFAULT_FORM_MODES,
      platformName: 'Acme',
      brandPrimary: '#123456',
      platformLogo: { mime: 'image/png', data: PNG_1PX },
    });
    expect(masked.platformName).toBe('Acme');
    expect(masked.brandPrimary).toBe('#123456');
    expect(masked.hasLogo).toBe(true);
    expect(JSON.stringify(masked)).not.toContain(PNG_1PX);
    // Absent logo → hasLogo omitted (falsy).
    expect(maskInstanceSettings({ formModes: DEFAULT_FORM_MODES }).hasLogo).toBeUndefined();
  });
});

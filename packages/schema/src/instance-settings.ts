import { z } from 'zod';
import { EncryptedSecretSchema } from './deploy-target.js';

/** True if `value` contains an ASCII control character (mirrors DeployTargetSchema). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// Instance-wide settings, configured by an instance admin (NOT org/project-scoped).
// Houses the global mail transport, the hCaptcha keys, and which web-form mail
// delivery modes projects are permitted to use. Secrets (SMTP password, hCaptcha
// secret) are encrypted at rest; the public/read view masks them to presence flags.

/**
 * Which form mail-delivery modes the instance admin permits. A project can only
 * choose among the modes enabled here.
 *  - globalSmtp:  the platform sends via the instance's global SMTP (Mode A)
 *  - userSmtp:    a project-provided SMTP, sent by the SW mailer (Mode B)
 *  - contactPhp:  an exported `contact.php` that uses PHP `mail()` (Mode B)
 *  - thirdParty:  the form posts to a third-party endpoint URL (Mode C)
 */
export const FormModesSchema = z.object({
  globalSmtp: z.boolean(),
  userSmtp: z.boolean(),
  contactPhp: z.boolean(),
  thirdParty: z.boolean(),
});
export type FormModes = z.infer<typeof FormModesSchema>;

/** All modes disabled — the safe default before an admin opts any in (frozen). */
export const DEFAULT_FORM_MODES: Readonly<FormModes> = Object.freeze({
  globalSmtp: false,
  userSmtp: false,
  contactPhp: false,
  thirdParty: false,
});

// Non-secret SMTP fields shared by the stored and input shapes. host/fromName
// reject control characters: once the Phase 3 mailer consumes them they flow into
// SMTP commands / the From: header, where a CRLF would enable injection. fromEmail
// is already constrained by .email(); user is SASL-encoded by the mailer.
const smtpCommon = {
  host: z
    .string()
    .min(1)
    .max(255)
    .refine((v) => !hasControlChars(v), 'host must not contain control characters'),
  port: z.number().int().min(1).max(65535),
  /** Implicit TLS (e.g. port 465). When false, STARTTLS is used opportunistically. */
  secure: z.boolean(),
  user: z.string().max(255).optional(),
  fromEmail: z.string().email().max(320),
  fromName: z
    .string()
    .max(120)
    .refine((v) => !hasControlChars(v), 'fromName must not contain control characters')
    .optional(),
};

/** Global SMTP as stored: the password is an encrypted envelope (or absent). */
export const SmtpStoredSchema = z.object({
  ...smtpCommon,
  password: EncryptedSecretSchema.optional(),
});
export type SmtpStored = z.infer<typeof SmtpStoredSchema>;

/** hCaptcha as stored: the site key is public, the secret is encrypted (or absent). */
export const HcaptchaStoredSchema = z.object({
  siteKey: z.string().min(1).max(255),
  secret: EncryptedSecretSchema.optional(),
});
export type HcaptchaStored = z.infer<typeof HcaptchaStoredSchema>;

/** Stock-image provider API keys as stored (each an encrypted envelope, or absent). */
export const StockKeysStoredSchema = z.object({
  unsplash: EncryptedSecretSchema.optional(),
  pexels: EncryptedSecretSchema.optional(),
});
export type StockKeysStored = z.infer<typeof StockKeysStoredSchema>;

/** The persisted instance-settings document (secrets encrypted at rest). */
export const InstanceSettingsStoredSchema = z.object({
  smtp: SmtpStoredSchema.optional(),
  hcaptcha: HcaptchaStoredSchema.optional(),
  stock: StockKeysStoredSchema.optional(),
  formModes: FormModesSchema.default(DEFAULT_FORM_MODES),
});
export type InstanceSettingsStored = z.infer<typeof InstanceSettingsStoredSchema>;

// ---- Input (the admin PUT body) ----
// Secrets are plaintext and OPTIONAL: omit the password/secret to keep the one
// already stored (so an admin editing other fields need not re-enter it). A
// `null` smtp/hcaptcha clears that section entirely; an absent (undefined) one
// leaves it unchanged.

export const SmtpInputSchema = z.object({
  ...smtpCommon,
  secure: z.boolean().default(false),
  password: z.string().min(1).max(1024).optional(),
});
export type SmtpInput = z.infer<typeof SmtpInputSchema>;

export const HcaptchaInputSchema = z.object({
  siteKey: z.string().min(1).max(255),
  secret: z.string().min(1).max(255).optional(),
});
export type HcaptchaInput = z.infer<typeof HcaptchaInputSchema>;

/** Stock provider keys (plaintext on input; omit a key to keep the stored one). */
export const StockKeysInputSchema = z.object({
  unsplash: z.string().min(1).max(512).optional(),
  pexels: z.string().min(1).max(512).optional(),
});
export type StockKeysInput = z.infer<typeof StockKeysInputSchema>;

export const InstanceSettingsInputSchema = z.object({
  smtp: SmtpInputSchema.nullable().optional(),
  hcaptcha: HcaptchaInputSchema.nullable().optional(),
  stock: StockKeysInputSchema.nullable().optional(),
  // Merge-only (not nullable): an absent formModes leaves modes unchanged; a
  // partial one merges. To disable every mode, send all four explicitly false —
  // there is no "clear the whole section" semantic for formModes.
  formModes: FormModesSchema.partial().optional(),
});
export type InstanceSettingsInput = z.infer<typeof InstanceSettingsInputSchema>;

// ---- Public (the masked read view) ----
// Secrets are NEVER returned; they collapse to a `has*` presence flag. The
// hCaptcha site key is intentionally public (it ships in client HTML).

export interface SmtpPublic {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  fromEmail: string;
  fromName?: string;
  hasPassword: boolean;
}

export interface HcaptchaPublic {
  siteKey: string;
  hasSecret: boolean;
}

/** Masked stock keys — presence only (keys are secret, never returned). */
export interface StockKeysPublic {
  hasUnsplash: boolean;
  hasPexels: boolean;
}

export interface InstanceSettingsPublic {
  smtp?: SmtpPublic;
  hcaptcha?: HcaptchaPublic;
  stock?: StockKeysPublic;
  formModes: FormModes;
}

/** Masks a stored SMTP config to its public view (password → hasPassword flag). */
export function maskSmtp(smtp: SmtpStored): SmtpPublic {
  const { password, ...rest } = smtp;
  return { ...rest, hasPassword: password !== undefined };
}

/** Projects the persisted document to its masked public view (no secrets). */
export function maskInstanceSettings(stored: InstanceSettingsStored): InstanceSettingsPublic {
  const result: InstanceSettingsPublic = { formModes: stored.formModes };
  if (stored.smtp) result.smtp = maskSmtp(stored.smtp);
  if (stored.hcaptcha) {
    result.hcaptcha = { siteKey: stored.hcaptcha.siteKey, hasSecret: stored.hcaptcha.secret !== undefined };
  }
  if (stored.stock) {
    result.stock = {
      hasUnsplash: stored.stock.unsplash !== undefined,
      hasPexels: stored.stock.pexels !== undefined,
    };
  }
  return result;
}

import { z } from 'zod';
import { EncryptedSecretSchema } from './deploy-target.js';
import { AgentInstructionsSchema } from './agent.js';
import { LocaleSchema } from './project.js';
import { CssColorSchema } from './primitives.js';

// ---- Admin-panel BRANDING (white-label) ----
// Non-secret instance fields that re-skin the admin CHROME (not per-project/site brand): the platform
// name, the primary/secondary gradient stops, and an uploaded logo. All optional → the built-in
// defaults below apply when unset.

/** Built-in platform name shown when the admin hasn't set one. */
export const DEFAULT_PLATFORM_NAME = 'SiteWright';
/** Default gradient stops (indigo-600 → sky-500) — match the historic hardcoded admin theme. */
export const DEFAULT_BRAND_PRIMARY = '#4f46e5';
export const DEFAULT_BRAND_SECONDARY = '#0ea5e9';

/** Accepted raster logo formats (SVG is intentionally excluded — script-in-SVG risk). */
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Max base64 length for an uploaded logo (~512 KB raw) — generous for a 2× logo, trivial for the JSON row. */
export const MAX_LOGO_BASE64_LEN = 700_000;

/** An uploaded platform logo: a raster image, base64-encoded, stored in the settings row (not a secret). */
export const PlatformLogoSchema = z.object({
  mime: z.enum(LOGO_MIME_TYPES),
  data: z.string().base64().max(MAX_LOGO_BASE64_LEN),
});
export type PlatformLogo = z.infer<typeof PlatformLogoSchema>;

/** True if `value` contains an ASCII control character (mirrors DeployTargetSchema). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Platform name on input/stored: 1–60 chars, no control characters (mirrors other label fields). */
const PlatformNameSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((v) => !hasControlChars(v), 'name must not contain control characters');

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

/** A short lowercase slug identifying an OIDC provider (used in `/auth/oidc/<id>/…` routes). */
const OidcProviderIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/, 'id must be a lowercase slug');
const OidcScopesSchema = z.array(z.string().min(1).max(60)).max(20);
const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'] as const;

/** A configured OIDC provider as stored: the client secret is an encrypted envelope (or absent). */
export const OidcProviderStoredSchema = z.object({
  id: OidcProviderIdSchema,
  label: z.string().min(1).max(60).refine((v) => !hasControlChars(v), 'label must not contain control characters'),
  issuer: z.string().url().max(512),
  clientId: z.string().min(1).max(512),
  clientSecret: EncryptedSecretSchema.optional(),
  scopes: OidcScopesSchema.default([...DEFAULT_OIDC_SCOPES]),
  enabled: z.boolean().default(true),
  /**
   * Auto-provision a NEW passwordless account when a verified email from this provider matches no
   * existing account and no pending invite (otherwise such a login is denied). Per-provider trust,
   * independent of the instance `allowSelfRegistration` toggle. Off by default. Defaulted (not optional)
   * so existing stored providers read back as `false`.
   */
  autoRegister: z.boolean().default(false),
  /**
   * Use PKCE (S256) in the authorization-code flow. On by default (the secure norm). Turn off only for
   * an IdP that rejects the `code_challenge` parameter — off relies on state + nonce and is intended for
   * confidential clients (with a client secret). Defaulted so existing stored providers read back `true`.
   */
  usePkce: z.boolean().default(true),
});
export type OidcProviderStored = z.infer<typeof OidcProviderStoredSchema>;

/** The persisted instance-settings document (secrets encrypted at rest). */
export const InstanceSettingsStoredSchema = z.object({
  smtp: SmtpStoredSchema.optional(),
  hcaptcha: HcaptchaStoredSchema.optional(),
  stock: StockKeysStoredSchema.optional(),
  formModes: FormModesSchema.default(DEFAULT_FORM_MODES),
  /**
   * The session-cookie signing key (hex). Auto-generated + persisted on first boot when no
   * `COOKIE_SECRET` env is set, and live-rotatable by an admin. INTERNAL-only: never accepted via the
   * public Input schema, and stripped from the masked public view (`maskInstanceSettings` is a
   * whitelist). Safe to store plaintext — it only signs the cookie WRAPPER (the real session is a hashed
   * token row), so leaking it cannot forge a session.
   */
  cookieSecret: z.string().min(1).max(256).optional(),
  /** Admin override for the agent (MCP) system instructions; unset → the built-in default is served. */
  agentInstructions: AgentInstructionsSchema.optional(),
  /**
   * How long an agent (MCP/OAuth) connection stays valid before re-consent is required — the absolute
   * refresh-token / session cap, in HOURS. Unset → the built-in default (8h). Raise it for connected
   * agents that work across days; lower it to tighten the window. Refresh tokens still rotate + are
   * theft-detected regardless.
   */
  agentSessionHours: z.number().int().min(1).max(720).optional(),
  /**
   * Revision-history tuning. `revisionCoalesceMs`: rapid same-author edits to one entity within this
   * window collapse into a single revision — unset → the built-in default (0 = every save is its own
   * revision). `revisionRetentionDays`: revisions older than this are swept — unset → the 90-day default.
   */
  revisionCoalesceMs: z.number().int().min(0).max(86_400_000).optional(),
  revisionRetentionDays: z.number().int().min(1).max(3650).optional(),
  /**
   * The locale a NEW project starts in (its `defaultLocale` + sole initial `locales` entry).
   * Unset → English (`en`). Changing it does not touch existing projects.
   */
  defaultLocale: LocaleSchema.optional(),
  /** Configured OIDC single-sign-on providers (the client secret of each is encrypted at rest). */
  oidcProviders: z.array(OidcProviderStoredSchema).max(10).optional(),
  /**
   * Whether anyone may create an account from the login screen. Left OPTIONAL on purpose: `undefined`
   * means "the admin has never set this", which the API distinguishes from an explicit `false` so it
   * can fall back to the factory default (the `openRegistration` createApp option — the production
   * entry point passes `false`). Once set, the stored value wins. Invited users register regardless.
   */
  allowSelfRegistration: z.boolean().optional(),
  /** Admin-panel branding (white-label the CHROME): name, gradient stops, logo. Unset → defaults. */
  platformName: PlatformNameSchema.optional(),
  brandPrimary: CssColorSchema.optional(),
  brandSecondary: CssColorSchema.optional(),
  platformLogo: PlatformLogoSchema.optional(),
});
export type InstanceSettingsStored = z.infer<typeof InstanceSettingsStoredSchema>;

/** Built-in default agent session cap when the admin hasn't set one. */
export const DEFAULT_AGENT_SESSION_HOURS = 8;

/** Built-in revision-history defaults when the admin hasn't set them. */
export const DEFAULT_REVISION_COALESCE_MS = 0;
export const DEFAULT_REVISION_RETENTION_DAYS = 90;

/** Built-in default locale for new projects when the admin hasn't set one. */
export const DEFAULT_NEW_PROJECT_LOCALE = 'en';

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

/**
 * An OIDC provider on input (plaintext client secret, OPTIONAL — omit to keep the secret already
 * stored for the same `id`). The provider list is replace-semantics (the array sent becomes the new
 * set), but secrets are preserved per-id when omitted.
 */
export const OidcProviderInputSchema = z.object({
  id: OidcProviderIdSchema,
  label: z.string().min(1).max(60).refine((v) => !hasControlChars(v), 'label must not contain control characters'),
  issuer: z.string().url().max(512),
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(1024).optional(),
  scopes: OidcScopesSchema.optional(),
  enabled: z.boolean().default(true),
  // Defaulted so older clients that omit them get the safe values (auto-register off, PKCE on).
  autoRegister: z.boolean().default(false),
  usePkce: z.boolean().default(true),
});
export type OidcProviderInput = z.infer<typeof OidcProviderInputSchema>;

export const InstanceSettingsInputSchema = z.object({
  smtp: SmtpInputSchema.nullable().optional(),
  hcaptcha: HcaptchaInputSchema.nullable().optional(),
  stock: StockKeysInputSchema.nullable().optional(),
  // Merge-only (not nullable): an absent formModes leaves modes unchanged; a
  // partial one merges. To disable every mode, send all four explicitly false —
  // there is no "clear the whole section" semantic for formModes.
  formModes: FormModesSchema.partial().optional(),
  // Agent instructions override: a string sets it, `null` clears it (revert to the built-in
  // default), and an absent (undefined) value leaves the stored override unchanged.
  agentInstructions: AgentInstructionsSchema.nullable().optional(),
  // Agent session cap (hours): a number sets it, `null` clears it (revert to the 8h default),
  // and an absent value leaves the stored one unchanged.
  agentSessionHours: z.number().int().min(1).max(720).nullable().optional(),
  // Revision coalesce window (ms) / retention (days): a number sets it, `null` reverts to the built-in
  // default (0 / 90), and an absent value leaves the stored one unchanged.
  revisionCoalesceMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
  revisionRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  // Default locale for new projects: a tag sets it, `null` reverts to `en`, undefined leaves it.
  defaultLocale: LocaleSchema.nullable().optional(),
  // OIDC providers: an array REPLACES the whole set (secrets preserved per-id when omitted), `null`
  // clears all providers, and an absent value leaves them unchanged. Provider ids must be unique.
  oidcProviders: z
    .array(OidcProviderInputSchema)
    .max(10)
    .refine((arr) => new Set(arr.map((p) => p.id)).size === arr.length, 'provider ids must be unique')
    .nullable()
    .optional(),
  // Self-registration toggle: a boolean sets it; an absent value leaves the stored one unchanged.
  // (No `null` semantic — `false` already expresses "closed".)
  allowSelfRegistration: z.boolean().optional(),
  // Branding (white-label the admin chrome): a value sets it, `null` clears it (revert to the default
  // name/color/logo), and an absent (undefined) value leaves the stored one unchanged.
  platformName: PlatformNameSchema.nullable().optional(),
  brandPrimary: CssColorSchema.nullable().optional(),
  brandSecondary: CssColorSchema.nullable().optional(),
  platformLogo: PlatformLogoSchema.nullable().optional(),
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

/**
 * A configured OIDC provider, masked: the client secret collapses to a presence flag. Returned only
 * from the admin-gated `GET /admin/settings` (not the unauthenticated `/auth/config`, which exposes
 * just id + label) — `autoRegister`/`usePkce` are admin-config flags, never surfaced to the login screen.
 */
export interface OidcProviderPublic {
  id: string;
  label: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  enabled: boolean;
  hasClientSecret: boolean;
  autoRegister: boolean;
  usePkce: boolean;
}

export interface InstanceSettingsPublic {
  smtp?: SmtpPublic;
  hcaptcha?: HcaptchaPublic;
  stock?: StockKeysPublic;
  formModes: FormModes;
  /** The admin override for agent instructions (NOT a secret), or absent when using the default. */
  agentInstructions?: string;
  /** The agent session cap in hours, or absent when using the 8h default. */
  agentSessionHours?: number;
  /** Revision coalesce window (ms) / retention (days), or absent when using the built-in defaults (0 / 90). */
  revisionCoalesceMs?: number;
  revisionRetentionDays?: number;
  /** The default locale for new projects, or absent when using `en`. */
  defaultLocale?: string;
  /** Configured OIDC providers (client secrets masked to `hasClientSecret`). */
  oidcProviders?: OidcProviderPublic[];
  /** Whether self-registration is open. Absent when the admin has never set it (factory default applies). */
  allowSelfRegistration?: boolean;
  /** Admin-panel branding — name + gradient stops returned as-is; the logo collapses to a presence flag
   *  (`hasLogo`). The bytes are NEVER returned here; they are served by `GET /branding/logo`. */
  platformName?: string;
  brandPrimary?: string;
  brandSecondary?: string;
  hasLogo?: boolean;
}

/** Masks a stored SMTP config to its public view (password → hasPassword flag). */
export function maskSmtp(smtp: SmtpStored): SmtpPublic {
  const { password, ...rest } = smtp;
  return { ...rest, hasPassword: password !== undefined };
}

/** Masks a stored OIDC provider to its public view (clientSecret → hasClientSecret flag). */
export function maskOidcProvider(p: OidcProviderStored): OidcProviderPublic {
  const { clientSecret, ...rest } = p;
  return { ...rest, hasClientSecret: clientSecret !== undefined };
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
  if (stored.agentInstructions !== undefined) result.agentInstructions = stored.agentInstructions;
  if (stored.agentSessionHours !== undefined) result.agentSessionHours = stored.agentSessionHours;
  if (stored.revisionCoalesceMs !== undefined) result.revisionCoalesceMs = stored.revisionCoalesceMs;
  if (stored.revisionRetentionDays !== undefined) result.revisionRetentionDays = stored.revisionRetentionDays;
  if (stored.defaultLocale !== undefined) result.defaultLocale = stored.defaultLocale;
  if (stored.oidcProviders) result.oidcProviders = stored.oidcProviders.map(maskOidcProvider);
  if (stored.allowSelfRegistration !== undefined) result.allowSelfRegistration = stored.allowSelfRegistration;
  if (stored.platformName !== undefined) result.platformName = stored.platformName;
  if (stored.brandPrimary !== undefined) result.brandPrimary = stored.brandPrimary;
  if (stored.brandSecondary !== undefined) result.brandSecondary = stored.brandSecondary;
  if (stored.platformLogo !== undefined) result.hasLogo = true;
  return result;
}

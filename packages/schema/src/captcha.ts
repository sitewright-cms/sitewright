import { z } from 'zod';
import { EncryptedSecretSchema } from './deploy-target.js';

/**
 * CAPTCHA CONFIGURATION — PER PROJECT, not per instance and not per form.
 *
 * ★ WHY THE PROJECT IS THE RIGHT SCOPE. A captcha site key is bound to a DOMAIN ALLOWLIST in the
 * provider's dashboard, and a domain belongs to a SITE. Per-form credentials would mean re-typing the
 * same key for every form on the same site, with more places to mistype it and nothing gained. Instance
 * credentials were worse in the other direction: this platform builds sites that deploy to the CLIENT's
 * own domain, so one shared key meant every client domain had to be added to the agency's single key,
 * every client shared one account's quota, the agency became the data controller for all of their
 * captcha traffic, and "export the site and hand it over" left the client with a key they do not own.
 *
 * The project owns the provider + credentials; a form only opts IN ({@link Form.captcha}).
 *
 * ★ ONE PROVIDER PER PROJECT, deliberately. reCAPTCHA v2 and v3 issue DIFFERENT, non-interchangeable
 * keys, so letting each form choose a provider would mean storing several credential sets per site to
 * serve a case that barely occurs. "This site uses reCAPTCHA v3; these forms are protected" is the
 * honest model. A site that genuinely needs two providers is a future extension, not a default cost.
 */
export const CAPTCHA_PROVIDERS = ['hcaptcha', 'recaptcha-v2', 'recaptcha-v3'] as const;
export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number];

/** Default reCAPTCHA v3 pass mark. Google's own suggested starting point; tunable per project. */
export const DEFAULT_RECAPTCHA_MIN_SCORE = 0.5;

/**
 * Site-key SHAPES, per provider. This is the boundary check that stops a placeholder reaching a
 * published page — an instance was once configured with the literal string `123`, which sailed through
 * a bare `min(1)`, was baked into every published form as `data-sitekey="123"`, and produced the
 * provider's own "the sitekey is incorrect" error for every visitor. The platform knew the value was
 * unusable the moment it was typed and said nothing until a stranger hit the form.
 */
const SITE_KEY_SHAPE: Record<CaptchaProvider, { re: RegExp; hint: string }> = {
  hcaptcha: {
    re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    hint: 'an hCaptcha site key is a UUID, e.g. 10000000-ffff-ffff-ffff-000000000001 (hCaptcha dashboard → Sites)',
  },
  'recaptcha-v2': {
    re: /^6L[0-9A-Za-z_-]{20,60}$/,
    hint: 'a reCAPTCHA site key starts with "6L", e.g. 6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI (Google reCAPTCHA admin console)',
  },
  'recaptcha-v3': {
    re: /^6L[0-9A-Za-z_-]{20,60}$/,
    hint: 'a reCAPTCHA site key starts with "6L", e.g. 6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI (Google reCAPTCHA admin console)',
  },
};

/** True when `siteKey` has the shape this provider issues. Exported for the editor's live hint. */
export function isValidSiteKey(provider: CaptchaProvider, siteKey: string): boolean {
  return SITE_KEY_SHAPE[provider].re.test(siteKey.trim());
}

/**
 * A project's captcha config AS STORED.
 *
 * ★ PERMISSIVE ON READ, deliberately — the strict shape is enforced on INPUT (below). A stored config
 * is parsed on every publish and every submission; tightening it here would not fix a bad key already
 * in the database, it would take the whole project's forms down because of one. Validation belongs at
 * the boundary where a human can still act on the message.
 */
export const CaptchaStoredSchema = z.object({
  provider: z.enum(CAPTCHA_PROVIDERS),
  siteKey: z.string().min(1).max(255),
  secret: EncryptedSecretSchema.optional(),
  /** reCAPTCHA v3 only: the score at or above which a submission passes. */
  minScore: z.number().min(0).max(1).optional(),
});
export type CaptchaStored = z.infer<typeof CaptchaStoredSchema>;

/** What the editor may write. The site key must look like one THIS provider could have issued. */
export const CaptchaInputSchema = z
  .object({
    provider: z.enum(CAPTCHA_PROVIDERS),
    siteKey: z.string().trim().min(1).max(255),
    secret: z.string().min(1).max(255).optional(),
    minScore: z.number().min(0).max(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (!isValidSiteKey(v.provider, v.siteKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['siteKey'], message: SITE_KEY_SHAPE[v.provider].hint });
    }
    // A score threshold on a provider that returns no score is a setting that silently does nothing —
    // refuse it rather than storing a number the verifier will ignore.
    if (v.minScore !== undefined && v.provider !== 'recaptcha-v3') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minScore'], message: 'a score threshold applies to reCAPTCHA v3 only' });
    }
  });
export type CaptchaInput = z.infer<typeof CaptchaInputSchema>;

/** The masked view: the site key is PUBLIC (it ships in the markup); the secret collapses to a flag. */
export interface CaptchaPublic {
  provider: CaptchaProvider;
  siteKey: string;
  hasSecret: boolean;
  minScore?: number;
}

export function maskCaptcha(stored: CaptchaStored): CaptchaPublic {
  const pub: CaptchaPublic = { provider: stored.provider, siteKey: stored.siteKey, hasSecret: stored.secret !== undefined };
  if (stored.minScore !== undefined) pub.minScore = stored.minScore;
  return pub;
}

/**
 * What the RENDERER needs to place a widget: never the secret, and never optional-by-accident. The
 * renderer gets this only when the project has a complete, usable config.
 */
export interface CaptchaRenderConfig {
  provider: CaptchaProvider;
  siteKey: string;
}

/** Hosts each provider's widget loads, frames and calls — the input to the published page's CSP. */
export const CAPTCHA_HOSTS: Record<CaptchaProvider, readonly string[]> = {
  hcaptcha: ['hcaptcha.com', '*.hcaptcha.com'],
  // reCAPTCHA serves its API from www.google.com and its assets from www.gstatic.com, and frames
  // www.google.com. recaptcha.net is Google's own alternate host for regions that block google.com;
  // the widget falls back to it on its own, so both must be allowed or it half-loads.
  'recaptcha-v2': ['www.google.com', 'www.gstatic.com', 'recaptcha.net', '*.recaptcha.net'],
  'recaptcha-v3': ['www.google.com', 'www.gstatic.com', 'recaptcha.net', '*.recaptcha.net'],
};

/** True when this provider hands personal data to a third party that generally requires consent. */
export function needsConsent(provider: CaptchaProvider): boolean {
  // All three are third parties, but Google's are the ones with settled EU guidance behind them —
  // and the editor says so where an author picks one. Proof-of-work is the option with no third party
  // at all, which is why it is offered first.
  return provider === 'recaptcha-v2' || provider === 'recaptcha-v3';
}

import { z } from 'zod';
import { EncryptedSecretSchema } from './deploy-target.js';
import { MAX_IDENTIFIER_LENGTH } from './primitives.js';

/**
 * PAYMENTS — processed payments for the shop, and the gateway definitions that drive them.
 *
 * ★ THE ONE RULE THIS WHOLE MODULE EXISTS TO ENFORCE: the browser never sends an amount. It sends
 * `{sku, qty}`; the server re-prices from a catalog snapshot it produced itself at publish time (see
 * apps/api/src/publish/shop-catalog.ts). Cart prices are author-facing display values and are
 * client-tamperable by design — that is correct for the mini-shop's order INQUIRY and unusable as a
 * charge amount.
 *
 * ★ GATEWAYS LIVE IN THE DATABASE, not in this repo: an instance admin authors one (or an agent
 * does), every project then supplies its own credentials. Two levels, two owners — see
 * {@link PaymentGatewayStoredSchema} (level 1) and {@link PaymentBindingStoredSchema} (level 2).
 *
 * ★ AND THE HOST OWNS EVERYTHING THAT CAN BE LIED ABOUT. A stored gateway describes the SHAPE of a
 * provider request and nothing else: it never receives a credential (it emits `${CRED:key}`
 * placeholders the host substitutes), it never verifies a signature (it NAMES a scheme the host
 * implements — a record allowed to verify would simply return true), and it never chooses where the
 * buyer is sent (the origin allowlist is an admin-only field stored apart from the editable body).
 */

// ---------------------------------------------------------------------------------------------
// Money. Integer minor units, everywhere, always.
// ---------------------------------------------------------------------------------------------

/**
 * ISO-4217 minor-unit exponents that are NOT 2.
 *
 * ★ Deliberately NOT derived from `ShopCurrencySchema.decimals`, which is display formatting clamped
 * to [0,4] and is a per-locale presentation choice. A charge amount has exactly one correct exponent
 * per currency and getting it wrong is a factor-of-100 error in a payment request.
 *
 * Currencies absent from this table are 2-decimal (the overwhelming majority). The list covers the
 * 0- and 3-decimal currencies from ISO-4217; CLF/UYW (4) are omitted deliberately — they are
 * accounting units no payment provider settles in.
 */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
});

/** ISO-4217 alphabetic code — the SETTLEMENT currency, uppercase, exactly three letters. */
export const CurrencyCodeSchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'must be a 3-letter uppercase ISO-4217 code');

/** How many minor units make one major unit of `code` (100 for USD, 1 for JPY, 1000 for BHD). */
export function minorUnitExponent(code: string): number {
  const key = code.trim().toUpperCase();
  // eslint-disable-next-line security/detect-object-injection -- key is a validated 3-char code; the registry is a frozen const (miss → undefined → 2)
  return MINOR_UNIT_EXPONENTS[key] ?? 2;
}

/** Why a decimal string could not become an exact minor-unit integer. Never carries a stack. */
export type MinorUnitsFailure =
  | { ok: false; reason: 'not-a-number' }
  | { ok: false; reason: 'negative' }
  | { ok: false; reason: 'too-large' }
  | { ok: false; reason: 'not-representable'; decimals: number; allowed: number };

/**
 * Parses an authored decimal price into integer minor units for `currency`.
 *
 * ★ REJECTS rather than rounds. `19.999` in a 2-decimal currency is not 20.00 and not 19.99 — it is
 * a price nobody authored, and silently picking one of them means charging an amount that appears
 * nowhere in the project. The caller turns this into a publish error naming the SKU.
 *
 * Parsed as a STRING, not via `Number`: `0.1 + 0.2` arithmetic has no place in a charge amount, and
 * `parseFloat('1e3')`/`'0x10'`/`'  1 '` all accept things a price field must not.
 */
export function toMinorUnits(value: string, currency: string): { ok: true; minor: number } | MinorUnitsFailure {
  const raw = value.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) {
    // Distinguish a legible negative from outright garbage so the publish error can say which.
    return /^-/.test(raw) ? { ok: false, reason: 'negative' } : { ok: false, reason: 'not-a-number' };
  }
  const allowed = minorUnitExponent(currency);
  const frac = m[2] ?? '';
  // Trailing zeros are NOT over-precision: `19.9900` is exactly representable at 2 decimals.
  const significant = frac.replace(/0+$/, '');
  if (significant.length > allowed) {
    return { ok: false, reason: 'not-representable', decimals: significant.length, allowed };
  }
  const padded = (frac + '0'.repeat(allowed)).slice(0, allowed);
  const digits = m[1] + padded;
  // Bound before Number() so a 400-digit price cannot become Infinity (and so the cap is the one
  // below, not whatever float precision happens to do).
  if (digits.replace(/^0+/, '').length > 15) return { ok: false, reason: 'too-large' };
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR_AMOUNT) return { ok: false, reason: 'too-large' };
  return { ok: true, minor };
}

/**
 * Ceiling on any single amount, in minor units — 1e12, i.e. ten billion major units at 2 decimals.
 *
 * Not a business rule: a bound so arithmetic on line totals cannot approach `Number.MAX_SAFE_INTEGER`
 * however many lines a cart holds (50 lines × 99 qty × this is still ~5e15, inside the safe range).
 */
export const MAX_MINOR_AMOUNT = 1_000_000_000_000;

/** Renders minor units back to a plain decimal string for display and for provider payloads. */
export function fromMinorUnits(minor: number, currency: string): string {
  const exp = minorUnitExponent(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(Math.trunc(minor))).padStart(exp + 1, '0');
  const whole = digits.slice(0, digits.length - exp);
  const frac = exp > 0 ? `.${digits.slice(digits.length - exp)}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}

// ---------------------------------------------------------------------------------------------
// Level 1 — the gateway definition. Instance admin only.
// ---------------------------------------------------------------------------------------------

/** A gateway id: an identifier, so it can key a record and appear in a route path unescaped. */
export const GatewayIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'must be lowercase letters, digits, _ or -')
  .refine((k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype', 'disallowed id');

/** Mode of a payment: a provider sandbox, or real money. Stamped on every transaction. */
export const PAYMENT_MODES = ['test', 'live'] as const;
export const PaymentModeSchema = z.enum(PAYMENT_MODES);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

/**
 * Kinds of input a gateway can ask a project for.
 *
 * `secret` is encrypted at rest and never returned; everything else is readable config. A `public`
 * field is the one kind that may reach the published markup (a publishable key), so it is named
 * distinctly rather than being "a secret we happen not to encrypt".
 */
export const CREDENTIAL_FIELD_KINDS = ['secret', 'public', 'choice', 'bool'] as const;
export type CredentialFieldKind = (typeof CREDENTIAL_FIELD_KINDS)[number];

/**
 * ★ ONE DECLARED INPUT VARIABLE — the contract between the two levels.
 *
 * The admin declares what a gateway needs; the editor renders each project's credential form
 * GENERICALLY from these entries. That is what makes "adding a gateway" cost zero UI work: a new
 * gateway immediately produces a correct, labelled, validated form in every project.
 */
export const CredentialFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(MAX_IDENTIFIER_LENGTH)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a valid identifier')
    .refine((k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype', 'disallowed key'),
  label: z.string().min(1).max(120),
  kind: z.enum(CREDENTIAL_FIELD_KINDS).default('secret'),
  required: z.boolean().default(true),
  /**
   * ★ Whether this value DIFFERS between test and live.
   *
   * True for API keys, and the reason bindings store `{test:{…}, live:{…}}` rather than one slot plus
   * a switch: a project holds both keys at once, and the draft preview is FORCED to test mode. One
   * shared slot would transact an author's preview against the live account.
   */
  perMode: z.boolean().default(true),
  hint: z.string().max(400).optional(),
  docsUrl: z.string().url().max(500).optional(),
  /**
   * Maximum length of a value for this field. Shape checking beyond a prefix and a length belongs to
   * the PROVIDER, which rejects a malformed key on the dry run — see the note below on why there is
   * no author-supplied regex here.
   */
  maxLength: z.number().int().min(1).max(4000).optional(),
  /** Required leading literal, per mode — e.g. `{live:'sk_live_', test:'sk_test_'}`. */
  modePrefix: z.partialRecord(PaymentModeSchema, z.string().max(40)).optional(),
  /** Allowed values for `kind: 'choice'`. */
  options: z.array(z.string().min(1).max(120)).max(40).optional(),
});
export type CredentialField = z.infer<typeof CredentialFieldSchema>;

/**
 * ★ WEBHOOK VERIFICATION IS DECLARED, NEVER IMPLEMENTED BY THE RECORD.
 *
 * A gateway that supplied its own verify function would be trusted to say whether a payment is real,
 * and the cheapest possible implementation of that function returns true. So the record picks from
 * schemes the HOST implements and supplies only the parameters (which header, which encoding).
 */
export const GatewayVerificationSchema = z.discriminatedUnion('scheme', [
  z.object({
    /** `HMAC-SHA256(secret, rawBody)` compared against a header. Mollie-style simple signing. */
    scheme: z.literal('hmac-sha256-header'),
    header: z.string().min(1).max(120),
    encoding: z.enum(['hex', 'base64']).default('hex'),
    /** A literal stripped from the header value before comparison (e.g. `sha256=`). */
    valuePrefix: z.string().max(40).optional(),
    /** Which declared credential holds the signing secret. */
    secretField: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  }),
  z.object({
    /** `HMAC-SHA256(secret, "<t>.<rawBody>")` with a timestamp inside the header. Stripe-style. */
    scheme: z.literal('hmac-timestamped'),
    header: z.string().min(1).max(120),
    /** Key of the timestamp element inside the header (Stripe: `t`). */
    timestampKey: z.string().min(1).max(40).default('t'),
    /** Key of the signature element inside the header (Stripe: `v1`). */
    signatureKey: z.string().min(1).max(40).default('v1'),
    /** Accepted clock skew. Bounded: an unbounded tolerance is an unbounded replay window. */
    toleranceSeconds: z.number().int().min(30).max(3600).default(300),
    secretField: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  }),
  z.object({
    /**
     * The provider verifies its own signature over an API call (PayPal). The host performs the call;
     * the record only says which endpoint and which fields carry the envelope.
     */
    scheme: z.literal('remote-verify'),
    path: z.string().min(1).max(500),
    /** Dotted path in the response whose value must equal `successValue`. */
    resultPath: z.string().min(1).max(200),
    successValue: z.string().min(1).max(80),
  }),
]);
export type GatewayVerification = z.infer<typeof GatewayVerificationSchema>;

/** How the host authenticates outbound calls to the provider. */
export const GatewayAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    /** `Authorization: Bearer <credential>`. */
    kind: z.literal('bearer'),
    secretField: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  }),
  z.object({
    /** `Authorization: Basic base64(<user>:<secret>)`. */
    kind: z.literal('basic'),
    userField: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    secretField: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  }),
  z.object({
    /** Client-credentials token exchange, then bearer. PayPal's shape. */
    kind: z.literal('oauth2-client-credentials'),
    tokenPath: z.string().min(1).max(500),
    clientIdField: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    clientSecretField: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    /** Dotted path to the access token in the token response. */
    tokenPathInResponse: z.string().min(1).max(200).default('access_token'),
  }),
]);
export type GatewayAuth = z.infer<typeof GatewayAuthSchema>;

/** Content types a gateway request body may be encoded as. */
export const GATEWAY_BODY_FORMATS = ['json', 'form'] as const;

/**
 * A provider request, as a TEMPLATE.
 *
 * Values are interpolated from a fixed, documented variable set (see
 * apps/api/src/payments/interpolate.ts) — `${CRED:key}`, `${TXN:…}`, `${AMOUNT:…}`, `${URL:…}`.
 * ★ `${CRED:…}` is substituted by the HOST at request time: the stored record never holds, sees or
 * returns a secret, so the editable body is not a credential store.
 */
export const GatewayRequestSchema = z.object({
  method: z.enum(['GET', 'POST']).default('POST'),
  /** Appended to the gateway's mode-specific `apiBase`. Must be a path, never an absolute URL. */
  path: z
    .string()
    .min(1)
    .max(500)
    .refine((p) => p.startsWith('/'), 'path must start with /')
    .refine((p) => !/^\/\//.test(p), 'path must not start with //')
    .refine((p) => !/[\r\n]/.test(p), 'path must not contain newlines'),
  format: z.enum(GATEWAY_BODY_FORMATS).default('json'),
  headers: z.record(z.string().max(120), z.string().max(2000)).default({}),
  /** Arbitrary JSON with `${…}` placeholders in string positions. */
  body: z.unknown().optional(),
});
export type GatewayRequest = z.infer<typeof GatewayRequestSchema>;

/** A dotted/bracketed path into a JSON response. Bounded so extraction cannot be made pathological. */
const ResponsePathSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.[\]-]+$/, 'invalid response path');

/**
 * The verdicts a provider event can map to.
 *
 * ★ `cancelled` is distinct from `failed` on purpose: a buyer who abandons the provider's page has
 * not had a payment declined, and a merchant reading their inbox needs to tell "they changed their
 * mind" from "their card was refused" — the second is worth following up, the first usually is not.
 *
 * ★ `recheck` means "verified, now go and ask". Mollie's webhook body is only an id, so mapping it
 * straight to `paid` would accept an unpaid order on an attacker's say-so.
 */
export const GATEWAY_EVENT_KINDS = ['paid', 'failed', 'expired', 'cancelled', 'refunded', 'recheck'] as const;
export type GatewayEventKind = (typeof GATEWAY_EVENT_KINDS)[number];

/**
 * Mapping a provider webhook onto a verdict.
 *
 * `recheck` is Mollie's shape and the reason it is in scope: the webhook carries only an id, so a
 * verified event means "go and ask", not "this is paid". An interface that cannot express that is
 * generic only by assertion.
 */
export const GatewayEventMapSchema = z.object({
  /** Where the provider's event id lives — the idempotency key. Absent ⇒ the host derives one. */
  eventIdPath: ResponsePathSchema.optional(),
  /** Where the reference tying the event to a transaction lives. */
  refPath: ResponsePathSchema,
  /** Where the event's type string lives. Absent ⇒ every verified event is `defaultKind`. */
  typePath: ResponsePathSchema.optional(),
  /** Provider type string → verdict. Unlisted types map to `unknown` and are acknowledged, not acted on. */
  types: z.record(z.string().min(1).max(120), z.enum(GATEWAY_EVENT_KINDS)).default({}),
  /** Used when `typePath` is absent (a provider whose webhook has no type, only an id). */
  defaultKind: z.enum(GATEWAY_EVENT_KINDS).optional(),
  /** Optional amount echo, cross-checked against the transaction before `paid` is accepted. */
  amountMinorPath: ResponsePathSchema.optional(),
  amountDecimalPath: ResponsePathSchema.optional(),
  currencyPath: ResponsePathSchema.optional(),
});
export type GatewayEventMap = z.infer<typeof GatewayEventMapSchema>;

/**
 * An https origin the buyer may be redirected to, or the host may call.
 *
 * ★ ADMIN-OWNED, and stored apart from the editable body. This is the one lever a malicious or
 * mistaken gateway would pull: pointing `redirectUrl` at a lookalike checkout. The author of a
 * gateway must not be the approver of its destinations, so this field is written only by an instance
 * admin and the redirect the provider returns is checked against it before the buyer ever sees it.
 */
export const GatewayOriginSchema = z
  .string()
  .max(253)
  .regex(/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i, 'must be an https origin with no path');

/** The gateway as STORED. ★ Permissive on purpose — see the note on PaymentGatewayInputSchema. */
export const PaymentGatewayStoredSchema = z.object({
  id: GatewayIdSchema,
  name: z.string().min(1).max(120),
  /** Shown in the project's gateway picker. */
  description: z.string().max(600).optional(),
  /** `declarative` is the default and carries no code. `code` is the Tier-2 escape hatch. */
  kind: z.enum(['declarative', 'code']).default('declarative'),
  /** Provider API base per mode. Absolute https; the request `path` is appended. */
  apiBase: z.partialRecord(PaymentModeSchema, z.string().url().max(500)),
  auth: GatewayAuthSchema.default({ kind: 'none' }),
  credentialFields: z.array(CredentialFieldSchema).max(24).default([]),
  checkout: z.object({
    request: GatewayRequestSchema,
    /** Where the provider's own id for the session lives in the create response. */
    refPath: ResponsePathSchema,
    /** Where the hosted-checkout URL lives in the create response. */
    redirectUrlPath: ResponsePathSchema,
  }),
  /** Re-reading authoritative status: the reconciliation path, and Mollie's `recheck` path. */
  status: z
    .object({
      request: GatewayRequestSchema,
      statePath: ResponsePathSchema,
      states: z.record(z.string().min(1).max(120), z.enum(GATEWAY_EVENT_KINDS)).default({}),
    })
    .optional(),
  verification: GatewayVerificationSchema,
  events: GatewayEventMapSchema,
  refund: z.object({ request: GatewayRequestSchema }).optional(),
  /** ★ Admin-owned. Every redirect and every outbound base must match one of these. */
  allowedOrigins: z.array(GatewayOriginSchema).max(16).default([]),
  currencies: z.array(CurrencyCodeSchema).max(64).optional(),
  /**
   * ★ A gateway cannot take LIVE money until a test-mode checkout has actually succeeded. Flipped
   * only by the dry-run route, cleared by any edit to the definition — an edited gateway is an
   * unproven gateway.
   */
  verified: z.boolean().default(false),
  enabled: z.boolean().default(false),
  /** Built-ins are read-only and can only be FORKED. Never settable through an input schema. */
  builtin: z.boolean().default(false),
  /** Set on a fork, so the Library can offer "a newer platform default is available". */
  forkedFrom: GatewayIdSchema.optional(),
  updatedAt: z.string().optional(),
});
export type PaymentGatewayStored = z.infer<typeof PaymentGatewayStoredSchema>;

/**
 * The gateway as WRITTEN by an admin (or an agent holding `payments:provider:write`).
 *
 * ★ STRICT here, PERMISSIVE in {@link PaymentGatewayStoredSchema}, and the asymmetry is deliberate.
 * Validation belongs where a human can still act on the message: an instance was once configured
 * with the literal hCaptcha site key `123`, which passed a bare `min(1)` and was then baked into
 * every published form. But tightening the STORED schema would be a denial of service on your own
 * operator — stored settings are re-parsed on every read, so one bad row would make the instance
 * unreadable rather than merely un-saveable.
 *
 * `verified`, `builtin` and `updatedAt` are omitted: they are the platform's to set, not the author's.
 */
export const PaymentGatewayInputSchema = PaymentGatewayStoredSchema.omit({
  verified: true,
  builtin: true,
  updatedAt: true,
})
  .extend({
    apiBase: z
      .partialRecord(PaymentModeSchema, z.string().url().max(500))
      .refine((v) => typeof v.test === 'string' && typeof v.live === 'string', 'apiBase needs both a test and a live URL')
      .refine(
        (v) => Object.values(v).every((u) => typeof u === 'string' && /^https:\/\//i.test(u)),
        'every apiBase must be https',
      ),
    allowedOrigins: z.array(GatewayOriginSchema).min(1).max(16),
  })
  .superRefine((gw, ctx) => {
    const keys = new Set<string>();
    for (const f of gw.credentialFields) {
      if (keys.has(f.key)) ctx.addIssue({ code: 'custom', message: `duplicate credential field "${f.key}"`, path: ['credentialFields'] });
      keys.add(f.key);
      if (f.kind === 'choice' && (f.options ?? []).length === 0) {
        ctx.addIssue({ code: 'custom', message: `credential field "${f.key}" is a choice with no options`, path: ['credentialFields'] });
      }
    }
    // Every field a scheme or auth mode NAMES must actually be declared, or the gateway is
    // unusable in a way that would only show up at checkout.
    const need: string[] = [];
    if (gw.verification.scheme !== 'remote-verify') need.push(gw.verification.secretField);
    if (gw.auth.kind === 'bearer') need.push(gw.auth.secretField);
    if (gw.auth.kind === 'basic') need.push(gw.auth.userField, gw.auth.secretField);
    if (gw.auth.kind === 'oauth2-client-credentials') need.push(gw.auth.clientIdField, gw.auth.clientSecretField);
    for (const key of need) {
      if (!keys.has(key)) ctx.addIssue({ code: 'custom', message: `"${key}" is referenced but not declared as a credential field`, path: ['credentialFields'] });
    }
    // The apiBases must themselves be inside the admin-approved origins, or the allowlist is
    // decorative: a request would go somewhere the admin never approved.
    for (const [mode, url] of Object.entries(gw.apiBase)) {
      if (typeof url !== 'string') continue;
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        continue; // already reported by .url()
      }
      if (!gw.allowedOrigins.some((o) => o.toLowerCase().replace(/\/$/, '') === origin.toLowerCase())) {
        ctx.addIssue({ code: 'custom', message: `the ${mode} apiBase origin ${origin} is not in allowedOrigins`, path: ['allowedOrigins'] });
      }
    }
  });
export type PaymentGatewayInput = z.infer<typeof PaymentGatewayInputSchema>;

/**
 * ★★ WHY THERE IS NO AUTHOR-SUPPLIED REGEX HERE.
 *
 * `CredentialField` briefly carried a `pattern` an admin could write, gated by a "safe subset" check
 * that rejected nested quantifiers like `(a+)+`. That gate was unsound, and demonstrably so: a
 * pattern as ordinary-looking as `(a|aa)+` passed it and then took **24 seconds** against a
 * 45-character value. The call site ran it on inputs up to 4000 characters, on the single Node event
 * loop shared by every tenant on the instance — so an admin following the platform's own assurance
 * ("the safety check accepted my pattern") could freeze the whole box.
 *
 * The lesson is not that the subset needed one more rule. Whether an arbitrary regex backtracks
 * catastrophically is not something a handful of syntactic rules can decide, so a check of that
 * shape is always one cleverly-built pattern away from being wrong — and here it was guarding
 * something the feature barely needed.
 *
 * What this field actually has to express is "this is the test key, not the live one", and
 * {@link CredentialField.modePrefix} does that with a literal `startsWith`. Everything beyond it —
 * is this a well-formed Stripe key? — is a question only the PROVIDER can really answer, and it
 * already does: a gateway cannot take live money until a test-mode checkout has succeeded against
 * it, which beats any regex because it exercises the actual credential.
 *
 * So the class is gone rather than narrowed. A future gateway needing richer validation should get a
 * BOUNDED execution (a worker with a timeout, or RE2) — never a bare `new RegExp` on author input.
 */

/** Public view of a gateway — what a PROJECT may read. Never the request templates, never origins. */
export interface PaymentGatewayPublic {
  id: string;
  name: string;
  description?: string;
  credentialFields: CredentialField[];
  currencies?: string[];
  refunds: boolean;
}

/**
 * Projects the public view.
 *
 * ★ Allowlisted field by field, not "the record minus two keys". A gateway record holds request
 * templates, the admin's origin allowlist and the names of credential fields the host substitutes;
 * a blocklist would leak each of those the first time the record grew a field.
 */
export function toPublicGateway(gw: PaymentGatewayStored): PaymentGatewayPublic {
  return {
    id: gw.id,
    name: gw.name,
    ...(gw.description ? { description: gw.description } : {}),
    credentialFields: gw.credentialFields,
    ...(gw.currencies ? { currencies: gw.currencies } : {}),
    refunds: gw.refund !== undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Level 2 — the per-project binding. The project's own keys.
// ---------------------------------------------------------------------------------------------

/** One stored value: an encrypted envelope for a `secret`, plain text for everything else. */
const BindingValueSchema = z.union([EncryptedSecretSchema, z.string().max(4000), z.boolean()]);

/**
 * Values for one mode, keyed by the gateway's declared field keys.
 *
 * ★ PER MODE, not one slot plus a switch. A project normally holds a test key and a live key at the
 * same time, and the draft preview is forced to test mode — with a single slot an author's dry run
 * would transact against the live account.
 */
const BindingModeValuesSchema = z.record(z.string().max(MAX_IDENTIFIER_LENGTH), BindingValueSchema);

/** The project's binding as stored (`project_payment` content kind). Permissive, as for all stored rows. */
export const PaymentBindingStoredSchema = z.object({
  gatewayId: GatewayIdSchema,
  /** Which mode this project transacts in. `test` until someone deliberately goes live. */
  mode: PaymentModeSchema.default('test'),
  values: z.partialRecord(PaymentModeSchema, BindingModeValuesSchema).default({}),
  updatedAt: z.string().optional(),
});
export type PaymentBindingStored = z.infer<typeof PaymentBindingStoredSchema>;

/** What a project POSTs. Plaintext values; an OMITTED key retains what is stored (the SMTP pattern). */
export const PaymentBindingInputSchema = z.object({
  gatewayId: GatewayIdSchema,
  mode: PaymentModeSchema,
  /** Only the mode being edited is sent, so saving test keys cannot wipe live ones. */
  values: z.record(z.string().max(MAX_IDENTIFIER_LENGTH), z.union([z.string().max(4000), z.boolean()])).default({}),
});
export type PaymentBindingInput = z.infer<typeof PaymentBindingInputSchema>;

/** Per-field state of a project's binding, for the editor. Never a value, not even truncated. */
export interface MaskedCredentialField {
  key: string;
  /** Whether a value is stored for this field in this mode. */
  hasValue: boolean;
  /** A shape hint for a stored secret (`••••` + the last 4), or the plain value for a non-secret. */
  display?: string;
}

/** The binding as returned to the editor: structure and presence, never a secret. */
export interface PaymentBindingPublic {
  gatewayId: string;
  mode: PaymentMode;
  fields: Record<PaymentMode, MaskedCredentialField[]>;
  /** Declared-and-required keys with no stored value, for the mode in `mode`. */
  missing: string[];
  /** Stored keys the gateway no longer declares — shown as orphaned, never silently dropped. */
  orphaned: string[];
  /** True when `missing` is empty: the only state in which a checkout can be attempted. */
  complete: boolean;
}

/** Last four characters of a value, for a mask. Short values reveal nothing, so they get no tail. */
function tail4(value: string): string {
  return value.length >= 8 ? value.slice(-4) : '';
}

/**
 * Builds the editor's view of a binding against the gateway's CURRENT declaration.
 *
 * ★ Resolved against the declaration as it is NOW, which is what surfaces declaration drift in the
 * editor instead of at checkout: an admin adding a required field makes every binding `incomplete`
 * immediately, and removing one ORPHANS the stored value rather than deleting it (an admin may be
 * mid-edit, and a value destroyed on a typo is not recoverable).
 */
export function maskBinding(stored: PaymentBindingStored, fields: readonly CredentialField[]): PaymentBindingPublic {
  const declared = new Map(fields.map((f) => [f.key, f]));
  const perMode = {} as Record<PaymentMode, MaskedCredentialField[]>;
  for (const mode of PAYMENT_MODES) {
    const values = stored.values?.[mode] ?? {};
    perMode[mode] = fields.map((f) => {
      const raw = Object.prototype.hasOwnProperty.call(values, f.key) ? values[f.key] : undefined;
      if (raw === undefined) return { key: f.key, hasValue: false };
      if (typeof raw === 'boolean') return { key: f.key, hasValue: true, display: String(raw) };
      if (typeof raw === 'string') {
        return { key: f.key, hasValue: raw !== '', ...(f.kind === 'secret' ? { display: `••••${tail4(raw)}` } : { display: raw }) };
      }
      // An encrypted envelope: presence only. The ciphertext tail is not a hint about the plaintext.
      return { key: f.key, hasValue: true, display: '••••' };
    });
  }
  const active = stored.values?.[stored.mode] ?? {};
  const has = (key: string): boolean => {
    const v = Object.prototype.hasOwnProperty.call(active, key) ? active[key] : undefined;
    if (v === undefined) return false;
    if (typeof v === 'string') return v !== '';
    return true;
  };
  const missing = fields.filter((f) => f.required && !has(f.key)).map((f) => f.key);
  const orphaned = [
    ...new Set(PAYMENT_MODES.flatMap((m) => Object.keys(stored.values?.[m] ?? {})).filter((k) => !declared.has(k))),
  ].sort();
  return { gatewayId: stored.gatewayId, mode: stored.mode, fields: perMode, missing, orphaned, complete: missing.length === 0 };
}

/**
 * Validates one project-supplied credential value against its declaration.
 *
 * ★ Runs at the INPUT boundary — on save, where a human is present and can fix it — never at
 * checkout, where the only available audience is a buyer who cannot act on the message.
 */
export function validateCredentialValue(
  field: CredentialField,
  mode: PaymentMode,
  value: string | boolean,
): string | null {
  if (field.kind === 'bool') return typeof value === 'boolean' ? null : `${field.label} must be true or false`;
  if (typeof value !== 'string') return `${field.label} must be text`;
  // ★ A BLANK IS ALWAYS ALLOWED, even for a required field, because a blank CLEARS the stored value
  // and an operator must be able to remove a leaked credential without deleting the whole binding.
  // "Required" is a statement about COMPLETENESS, not about what may be saved — it is enforced by
  // `maskBinding` (`missing` / `complete`) and by `resolveCredentials`, which refuse a checkout. A
  // save that refused the blank would leave no way to revoke a key from the editor at all.
  if (value === '') return null;
  if (/[\r\n]/.test(value)) return `${field.label} must not contain line breaks`;
  if (field.kind === 'choice') {
    return (field.options ?? []).includes(value) ? null : `${field.label} must be one of: ${(field.options ?? []).join(', ')}`;
  }
  const prefix = field.modePrefix?.[mode];
  if (prefix && !value.startsWith(prefix)) {
    // Naming the expected prefix is the whole value of this check: pasting a live key into test mode
    // is the single most common way to configure a gateway wrongly.
    return `${field.label} for ${mode} mode must start with "${prefix}"`;
  }
  // A literal length bound — no regex. See the note above on why.
  const max = field.maxLength ?? 4000;
  if (value.length > max) return `${field.label} must be at most ${max} characters`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

/**
 * Payment lifecycle.
 *
 * `created` is "we asked the provider for a session"; `pending` is "the provider has told us
 * something is in flight". Both are reconciled, because a webhook that never arrives must not leave
 * a paid order invisible.
 */
export const TRANSACTION_STATUSES = [
  'created',
  'pending',
  'paid',
  'failed',
  'expired',
  'refunded',
  'partially_refunded',
  'cancelled',
] as const;
export const TransactionStatusSchema = z.enum(TRANSACTION_STATUSES);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

/** Operator-moved fulfilment state. Deliberately separate from payment status: different owners. */
export const FULFILMENT_STATES = ['new', 'packed', 'shipped', 'done', 'cancelled'] as const;
export const FulfilmentStateSchema = z.enum(FULFILMENT_STATES);
export type FulfilmentState = z.infer<typeof FulfilmentStateSchema>;

/** Which fulfilment moves an operator may make from a given state. A closed state is terminal. */
export const FULFILMENT_TRANSITIONS: Readonly<Record<FulfilmentState, readonly FulfilmentState[]>> = Object.freeze({
  new: ['packed', 'shipped', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['done', 'cancelled'],
  done: [],
  cancelled: [],
});

/** Statuses that are final: no webhook, reconciliation or operator action may move them again. */
const TERMINAL_STATUSES = new Set<TransactionStatus>(['paid', 'failed', 'expired', 'refunded', 'partially_refunded', 'cancelled']);

/**
 * Whether a payment status may move from `from` to `to`.
 *
 * ★ `paid` → `refunded` / `partially_refunded` is the ONLY move out of a terminal state, because a
 * refund is a real later event. Everything else is one-way out of `created`/`pending`: a provider
 * that re-delivers an old `failed` after a `paid` must not be able to un-pay an order.
 */
export function canTransitionPayment(from: TransactionStatus, to: TransactionStatus): boolean {
  if (from === to) return false;
  if (from === 'paid') return to === 'refunded' || to === 'partially_refunded';
  if (from === 'partially_refunded') return to === 'refunded';
  if (TERMINAL_STATUSES.has(from)) return false;
  return to !== 'created';
}

/** One frozen order line. ★ A COPY: the catalog moves on every publish, an order must not. */
export const TransactionLineSchema = z.object({
  sku: z.string().min(1).max(200),
  name: z.string().max(300),
  unitMinor: z.number().int().min(0).max(MAX_MINOR_AMOUNT),
  qty: z.number().int().min(1).max(99),
  lineMinor: z.number().int().min(0),
});
export type TransactionLine = z.infer<typeof TransactionLineSchema>;

/** The authoritative money breakdown. Every figure server-computed, in minor units. */
export const TransactionAmountsSchema = z.object({
  subtotalMinor: z.number().int().min(0),
  shippingMinor: z.number().int().min(0).default(0),
  taxMinor: z.number().int().min(0).default(0),
  totalMinor: z.number().int().min(0),
});
export type TransactionAmounts = z.infer<typeof TransactionAmountsSchema>;

/** What the thank-you page is allowed to learn. ★ No merchant address, no provider refs, no gateway. */
export interface TransactionPublic {
  status: TransactionStatus;
  fulfilment: FulfilmentState;
  currency: string;
  amounts: TransactionAmounts;
  lines: TransactionLine[];
  /** The buyer's OWN submitted fields, echoed back so the page can greet them. */
  buyer: Record<string, string>;
  createdAt: string;
  paidAt?: string;
}

/** Hard cap on cart lines accepted for pricing. Matches the cart runtime's own MAX_LINES. */
export const MAX_CHECKOUT_LINES = 50;
/** Hard cap on one line's quantity. Matches the cart runtime's MAX_QTY. */
export const MAX_CHECKOUT_QTY = 99;

/** One requested line from the browser. ★ Note what is absent: any price, and any currency. */
export const CheckoutItemSchema = z.object({
  sku: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(MAX_CHECKOUT_QTY),
});
export type CheckoutItem = z.infer<typeof CheckoutItemSchema>;

// ---------------------------------------------------------------------------------------------
// Pricing composition — subtotal, then shipping, then tax.
// ---------------------------------------------------------------------------------------------

/** Shipping: a flat charge, optionally waived once the goods subtotal reaches a threshold. */
export const ShopShippingSchema = z.object({
  flatMinor: z.number().int().min(0).max(MAX_MINOR_AMOUNT),
  /** Subtotal at or above which shipping is free. Absent ⇒ never free. */
  freeOverMinor: z.number().int().min(0).max(MAX_MINOR_AMOUNT).optional(),
});
export type ShopShipping = z.infer<typeof ShopShippingSchema>;

/**
 * A single tax rate, for DISPLAY and for the charged total.
 *
 * ★ Not tax DETERMINATION. There are no per-country rates, no OSS thresholds and no reverse charge —
 * this is the one-rate case a single-country merchant actually has, and calling it anything grander
 * would be a promise the platform cannot keep.
 *
 * `inclusive` (the European norm) means the authored prices already contain the tax, so the total
 * does not change and the tax figure is informational. `exclusive` adds it on top.
 */
export const ShopTaxSchema = z.object({
  /** Basis points: 1900 = 19%. An integer, so a rate can never be a repeating binary fraction. */
  rateBp: z.number().int().min(0).max(10_000),
  mode: z.enum(['inclusive', 'exclusive']).default('inclusive'),
});
export type ShopTax = z.infer<typeof ShopTaxSchema>;

/** Non-text pricing STRUCTURE for the shop. Labels live in the translation catalog, as ever. */
export const ShopPricingSchema = z.object({
  shipping: ShopShippingSchema.optional(),
  tax: ShopTaxSchema.optional(),
});
export type ShopPricing = z.infer<typeof ShopPricingSchema>;

/**
 * Composes the authoritative total from already-re-priced lines.
 *
 * ★ The ONLY place a total is computed, so the drawer, the review step, the provider request, the
 * receipt and the transaction row cannot disagree. Order is fixed: goods, then shipping, then tax on
 * (goods + shipping) — shipping is a taxable supply in every jurisdiction this targets.
 *
 * Rounding is half-up at the final step only, on integers, so the result is reproducible rather than
 * dependent on float order.
 */
export function composeAmounts(lines: readonly TransactionLine[], pricing: ShopPricing | undefined): TransactionAmounts {
  const subtotalMinor = lines.reduce((n, l) => n + l.lineMinor, 0);
  const ship = pricing?.shipping;
  const free = ship?.freeOverMinor !== undefined && subtotalMinor >= ship.freeOverMinor;
  // A zero-line cart must not be charged shipping; it is refused upstream, but a defaulted 0 here
  // means this function never invents a charge out of an empty order.
  const shippingMinor = !ship || free || lines.length === 0 ? 0 : ship.flatMinor;
  const taxable = subtotalMinor + shippingMinor;
  const tax = pricing?.tax;
  let taxMinor = 0;
  let totalMinor = taxable;
  if (tax && tax.rateBp > 0) {
    if (tax.mode === 'exclusive') {
      taxMinor = Math.round((taxable * tax.rateBp) / 10_000);
      totalMinor = taxable + taxMinor;
    } else {
      // Inclusive: back out the tax already contained in the price. The total is unchanged.
      taxMinor = Math.round((taxable * tax.rateBp) / (10_000 + tax.rateBp));
      totalMinor = taxable;
    }
  }
  return { subtotalMinor, shippingMinor, taxMinor, totalMinor };
}

import { z } from 'zod';
import { IdSchema, KeyNameSchema, targetsPrivateHost } from './primitives.js';

/** True if `value` contains an ASCII control character (mirrors DeployTargetSchema). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// Web forms (contact / lead capture). A form is a content kind authored per
// project; its definition holds the PUBLIC presentation (fields, labels, inline
// messages) AND the server-side delivery config (recipient, mode, subject). The
// renderer emits only the public parts — the recipient never reaches exported
// HTML. Submissions are stored TEXT-ONLY: there is no file/attachment field type.

/** A single input in a form. No `file` type — attachments are never accepted. `radio` is a
 *  single-select option group; `checkbox` WITH options is a multi-select group (its values submit
 *  joined with ", "), WITHOUT options it is one boolean checkbox. */
export const FormFieldTypeSchema = z.enum(['text', 'email', 'tel', 'url', 'number', 'textarea', 'select', 'radio', 'checkbox']);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

export const FormFieldSchema = z
  .object({
    /** HTML input `name` (also the submission key). Reserved prototype identifiers are refused so a field
     *  name can never collide with the submission map's prototype (defence-in-depth; the endpoint also skips
     *  them). */
    name: KeyNameSchema.refine((n) => n !== '__proto__' && n !== 'constructor' && n !== 'prototype', {
      message: 'reserved identifier; choose a different field name',
    }),
    label: z.string().min(1).max(200),
    type: FormFieldTypeSchema.default('text'),
    required: z.boolean().default(false),
    placeholder: z.string().max(200).optional(),
    /** Options for `select` / `radio`, and a `checkbox` GROUP (a checkbox WITH options renders a
     *  multi-select group; without options it's a single boolean). Ignored for other types. */
    options: z.array(z.string().min(1).max(200)).max(100).optional(),
  })
  // A `radio` is an option-driven single-select — a radio group with no options renders nothing.
  // (A 0-option `select` still renders its placeholder, so it stays lenient for backward-compat.)
  .refine((f) => f.type !== 'radio' || (f.options?.length ?? 0) >= 1, {
    message: 'a radio field needs at least one option',
    path: ['options'],
  });
export type FormField = z.infer<typeof FormFieldSchema>;

/**
 * Which mail-delivery mode a form uses. Must be one of the modes the instance
 * admin enabled (see FormModes). Phase 3 implements `globalSmtp` (Mode A); the
 * others are accepted here and wired in later phases.
 *
 * `contactPhp` and `contactPhpSmtp` share ONE exported handler (`contact.php`,
 * dispatched by the hidden `_form` field) and differ only in how that handler
 * delivers: the host's `mail()` vs an authenticated SMTP session using the
 * project's own credentials. Use {@link isContactPhpMode} rather than testing
 * `=== 'contactPhp'` anywhere the question is "does this form post to
 * contact.php?" — the two answers diverge only inside the generated PHP.
 */
export const FormModeSchema = z.enum(['globalSmtp', 'userSmtp', 'contactPhp', 'contactPhpSmtp', 'thirdParty']);
export type FormMode = z.infer<typeof FormModeSchema>;

/** True for a mode whose form posts to the exported `contact.php` (either delivery flavour). */
export function isContactPhpMode(mode: FormMode): boolean {
  return mode === 'contactPhp' || mode === 'contactPhpSmtp';
}

/** True for a mode the PLATFORM routes + stores (`/f/<projectId>/<formId>`): inbox + hCaptcha apply. */
export function isPlatformRoutedMode(mode: FormMode): boolean {
  return mode === 'globalSmtp' || mode === 'userSmtp';
}

/** A form definition (content kind `form`). */
export const FormSchema = z.object({
  id: IdSchema,
  /** Admin-facing name; also feeds the default email subject — reject control chars. */
  name: z
    .string()
    .min(1)
    .max(200)
    .refine((v) => !hasControlChars(v), 'name must not contain control characters'),
  fields: z.array(FormFieldSchema).min(1).max(50),
  submitLabel: z.string().min(1).max(120).default('Send'),
  /** Inline confirmation shown on success (unless `redirectUrl` is set). */
  successMessage: z.string().min(1).max(2000).default('Thank you — your message has been sent.'),
  /** Inline error shown on failure. */
  errorMessage: z.string().min(1).max(2000).default('Sorry, something went wrong. Please try again.'),
  /**
   * Optional custom thank-you redirect (a root-relative path or an explicit http(s)
   * URL); overrides the inline success message. Off-site (`https://…`) targets are
   * allowed by design — a form author (owner/admin, content:write) may legitimately
   * redirect to an external thank-you/checkout page. The value is baked into the
   * published form's `data-sw-redirect` and followed via `window.location.assign`.
   *
   * The path branch is `/` followed by a NON-slash/backslash char (or nothing), so a
   * PROTOCOL-RELATIVE `//evil.com` (and the `/\evil.com` variant browsers also treat
   * as protocol-relative) is rejected — those navigate cross-origin while looking
   * like a local path. An explicit scheme is the only way to leave the site.
   */
  redirectUrl: z
    .string()
    .max(2048)
    .regex(/^(\/(?![/\\])[^\s]*|https?:\/\/[^\s]+)$/i, 'redirectUrl must be a root-relative path or http(s) URL')
    .optional(),
  /**
   * Where submissions are emailed. SERVER-SIDE ONLY — never rendered into the
   * exported HTML. Resolved by the submission endpoint from the form's id.
   */
  recipient: z.string().email().max(320),
  /** Optional email subject; a default is derived from the form name when unset.
   * Reject control chars (CR/LF) — it lands in a mail Subject header. */
  subject: z
    .string()
    .max(200)
    .refine((v) => !hasControlChars(v), 'subject must not contain control characters')
    .optional(),
  mode: FormModeSchema.default('globalSmtp'),
  /** Require an hCaptcha solve (only enforced for platform-routed modes). */
  hcaptcha: z.boolean().default(false),
  /**
   * Require a proof-of-work solve (platform-routed modes only). OPT-IN: it puts a few hundred
   * milliseconds of CPU on every visitor, which is not worth spending on a form that has no spam
   * problem — and most do not. Turn it on when the filtered counter says otherwise.
   */
  pow: z.boolean().default(false),
  /**
   * Third-party submission endpoint (Mode C). The exported form posts directly here
   * (cross-origin) — Sitewright is not involved. Must be https; required when
   * `mode === 'thirdParty'`.
   */
  thirdPartyUrl: z
    .string()
    .max(2048)
    .url()
    .refine((u) => /^https:\/\//i.test(u), 'thirdPartyUrl must be an https URL')
    // `.url()` trims leading/trailing C0/space before validating, so guard the raw value.
    .refine((u) => !/\s/.test(u), 'thirdPartyUrl must not contain whitespace')
    // Reject embedded credentials — they'd be published in the exported HTML.
    .refine((u) => {
      try {
        return !new URL(u).username && !new URL(u).password;
      } catch {
        return false;
      }
    }, 'thirdPartyUrl must not contain credentials')
    // Must be a public host (not localhost / link-local / private) — it's an external endpoint.
    .refine((u) => !targetsPrivateHost(u), 'thirdPartyUrl must be a public host')
    .optional(),
}).refine((f) => f.mode !== 'thirdParty' || !!f.thirdPartyUrl, {
  message: 'thirdPartyUrl is required when mode is "thirdParty"',
  path: ['thirdPartyUrl'],
});
export type Form = z.infer<typeof FormSchema>;

/**
 * The PUBLIC projection of a form — everything the renderer/exported HTML may
 * contain. Excludes `recipient` and `subject` (server-side delivery). `mode` is
 * included because the renderer needs it to choose the submission endpoint
 * (platform vs the exported `contact.php`) — it is not sensitive.
 */
export interface FormPublic {
  id: string;
  fields: FormField[];
  submitLabel: string;
  successMessage: string;
  errorMessage: string;
  redirectUrl?: string;
  hcaptcha: boolean;
  /** Require a proof-of-work solve — the runtime fetches a challenge and solves it before posting. */
  pow: boolean;
  mode: FormMode;
  /** Third-party endpoint (Mode C) — the exported form posts here directly. */
  thirdPartyUrl?: string;
}

/** Strips the server-side delivery fields, leaving only what may be rendered. */
export function toPublicForm(form: Form): FormPublic {
  const pub: FormPublic = {
    id: form.id,
    fields: form.fields,
    submitLabel: form.submitLabel,
    successMessage: form.successMessage,
    errorMessage: form.errorMessage,
    hcaptcha: form.hcaptcha,
    pow: form.pow,
    mode: form.mode,
  };
  if (form.redirectUrl !== undefined) pub.redirectUrl = form.redirectUrl;
  if (form.thirdPartyUrl !== undefined) pub.thirdPartyUrl = form.thirdPartyUrl;
  return pub;
}

// Reused per call (zod's string().email()/url() would otherwise rebuild a schema each time).
const emailFormat = z.string().email();
const urlFormat = z.string().url();
/** A `url` field must be a web address — require http(s) so `javascript:`/`data:`/`mailto:` are rejected
 *  (bare `.url()` is scheme-agnostic; mirrors the `thirdPartyUrl` https-only guard above). */
const HTTP_URL_SCHEME = /^https?:\/\//i;
/** A native `<input type="number">` never submits a hex/octal/binary literal, but `Number()` would coerce
 *  one ("0x1F" → 31, "0b101" → 5); reject those prefixes so the number check mirrors the client. Kept as a
 *  trivial anchored prefix (no nested quantifiers) — a decimal/exponent literal is validated via Number(). */
const NON_DECIMAL_PREFIX = /^0[xob]/i;

/**
 * Validates a submitted values map against a form's field definitions — the SERVER backstop for the
 * browser's native validation (a direct or scripted POST bypasses the client, so required/format are
 * re-checked here). Returns the names of the fields that failed (empty array = valid).
 *
 * `values` is the flat, already-normalized submission map — a checkbox GROUP arrives as one joined
 * "A, B" string — so this checks presence, scalar format (email / http(s) url / numeric literal), and
 * SINGLE-select option membership (select/radio), NOT per-option membership of a checkbox group.
 */
export function validateFormSubmission(fields: FormField[], values: Record<string, string>): string[] {
  const invalid: string[] = [];
  for (const field of fields) {
    // Own-property only: a field could legitimately be named `toString` etc. (only __proto__/constructor/
    // prototype are refused), so never read an inherited prototype member off the plain submission object.
    const raw = Object.prototype.hasOwnProperty.call(values, field.name) ? values[field.name] : '';
    const value = String(raw ?? '').trim();

    if (value === '') {
      if (field.required) invalid.push(field.name);
      continue; // an optional, empty field skips the format checks below
    }
    if (field.type === 'email') {
      if (!emailFormat.safeParse(value).success) invalid.push(field.name);
    } else if (field.type === 'url') {
      if (!HTTP_URL_SCHEME.test(value) || !urlFormat.safeParse(value).success) invalid.push(field.name);
    } else if (field.type === 'number') {
      if (NON_DECIMAL_PREFIX.test(value) || !Number.isFinite(Number(value))) invalid.push(field.name);
    } else if ((field.type === 'select' || field.type === 'radio') && (field.options?.length ?? 0) > 0) {
      // Compare against trimmed options: an option authored with incidental surrounding whitespace must
      // still match its own submitted value (the submitted `value` is already trimmed above).
      if (!field.options!.some((opt) => opt.trim() === value)) invalid.push(field.name);
    }
  }
  return invalid;
}

// ---- Submissions (stored text-only) ----

/** The honeypot + time-trap field names the renderer emits and the endpoint strips. */
export const HONEYPOT_FIELD = '_hpt';
export const TIMETRAP_FIELD = '_elapsed';
/**
 * Interaction evidence: how many TRUSTED input events the visitor produced while filling the form, and
 * how many distinct fields they touched. `<pointer>.<key>.<field-count>` — three small integers, no
 * timings, nothing identifying, nothing that leaves the page except these counts.
 *
 * It exists to catch what the time-trap cannot: a script that POSTs straight to the endpoint with a
 * plausible `_elapsed`, having never rendered the form. Such a client sends no interaction at all.
 *
 * Deliberately COARSE. Requiring a particular mix would punish real people — a keyboard-only visitor
 * produces no pointer events, a screen-reader user produces an unusual pattern, and browser autofill
 * fills several fields with no keystrokes at all. So the server asks only whether SOME trusted input
 * happened, never what shape it had.
 */
export const INTERACTION_FIELD = '_ix';
/** The encoded proof-of-work solution (ALTCHA wire format) — verified server-side, never stored. */
export const POW_FIELD = '_pow';
/** The hCaptcha response token field (injected by the hCaptcha widget); verified + not stored. */
export const HCAPTCHA_RESPONSE_FIELD = 'h-captcha-response';
/** Hidden field carrying the form id — emitted only for `contactPhp` forms so the
 * generated `contact.php` can dispatch to the right recipient. */
export const FORM_ID_FIELD = '_form';
/** Minimum elapsed time (ms) before a submission is plausibly human (bot time-trap).
 * Shared by the platform endpoint AND the generated contact.php so they agree. */
export const MIN_SUBMIT_ELAPSED_MS = 1200;
/** Hard cap on stored submissions per form (storage-exhaustion bound); over this,
 * submissions are silently dropped. */
export const MAX_SUBMISSIONS_PER_FORM = 10_000;

/** A stored form submission — text fields only (no binaries). */
export const FormSubmissionSchema = z.object({
  id: IdSchema,
  formId: IdSchema,
  /** Submitted text values, keyed by field name. */
  fields: z.record(z.string().max(100), z.string().max(10_000)),
  createdAt: z.string().datetime(),
  /**
   * Whether the notification email for this submission has gone out. The submission itself is never
   * at risk — it is stored before any delivery is attempted — so this describes the NOTIFICATION.
   *
   * `na` a form the platform does not route (contact.php / third-party post elsewhere)
   * `pending` still owed, and being retried
   * `failed` retries exhausted; waiting for a human
   * `sent` delivered
   * `abandoned` no longer owed — the form was deleted or switched to a non-platform mode
   *
   * Defaulted rather than required so a row written before this existed still parses.
   */
  deliveryState: z.enum(['na', 'pending', 'failed', 'sent', 'abandoned']).default('na'),
});
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

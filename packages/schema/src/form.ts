import { z } from 'zod';
import { IdSchema, KeyNameSchema } from './primitives.js';

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

/** A single input in a form. No `file` type — attachments are never accepted. */
export const FormFieldTypeSchema = z.enum(['text', 'email', 'tel', 'url', 'number', 'textarea', 'select']);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

export const FormFieldSchema = z.object({
  /** HTML input `name` (also the submission key). */
  name: KeyNameSchema,
  label: z.string().min(1).max(200),
  type: FormFieldTypeSchema.default('text'),
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  /** Options for `select` (ignored otherwise). */
  options: z.array(z.string().min(1).max(200)).max(100).optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

/**
 * Which mail-delivery mode a form uses. Must be one of the modes the instance
 * admin enabled (see FormModes). Phase 3 implements `globalSmtp` (Mode A); the
 * others are accepted here and wired in later phases.
 */
export const FormModeSchema = z.enum(['globalSmtp', 'userSmtp', 'contactPhp', 'thirdParty']);
export type FormMode = z.infer<typeof FormModeSchema>;

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
   * Optional custom thank-you redirect (path or http(s) URL); overrides the inline
   * success message. Off-site (`https://…`) targets are allowed by design — a form
   * author (owner/admin, content:write) may legitimately redirect to an external
   * thank-you/checkout page. Authors are trusted; this is not an open redirect for
   * arbitrary users. The value is JS-validated here and re-validated server-side.
   */
  redirectUrl: z
    .string()
    .max(2048)
    .regex(/^(\/[^\s]*|https?:\/\/[^\s]+)$/i, 'redirectUrl must be a path or http(s) URL')
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
  /** Require an hCaptcha solve (verification wired in Phase 4). */
  hcaptcha: z.boolean().default(false),
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
  mode: FormMode;
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
    mode: form.mode,
  };
  if (form.redirectUrl !== undefined) pub.redirectUrl = form.redirectUrl;
  return pub;
}

// ---- Submissions (stored text-only) ----

/** The honeypot + time-trap field names the renderer emits and the endpoint strips. */
export const HONEYPOT_FIELD = '_hpt';
export const TIMETRAP_FIELD = '_elapsed';
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
});
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

import { z } from 'zod';
import { IdSchema, KeyNameSchema } from './primitives.js';

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
  /** Admin-facing name (not rendered). */
  name: z.string().min(1).max(200),
  fields: z.array(FormFieldSchema).min(1).max(50),
  submitLabel: z.string().min(1).max(120).default('Send'),
  /** Inline confirmation shown on success (unless `redirectUrl` is set). */
  successMessage: z.string().min(1).max(2000).default('Thank you — your message has been sent.'),
  /** Inline error shown on failure. */
  errorMessage: z.string().min(1).max(2000).default('Sorry, something went wrong. Please try again.'),
  /** Optional custom thank-you redirect (path or http(s) URL); overrides the inline success message. */
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
  /** Optional email subject; a default is derived from the form name when unset. */
  subject: z.string().max(200).optional(),
  mode: FormModeSchema.default('globalSmtp'),
  /** Require an hCaptcha solve (verification wired in Phase 4). */
  hcaptcha: z.boolean().default(false),
});
export type Form = z.infer<typeof FormSchema>;

/**
 * The PUBLIC projection of a form — everything the renderer/exported HTML may
 * contain. Excludes `recipient`, `subject`, and `mode` (server-side delivery).
 */
export interface FormPublic {
  id: string;
  fields: FormField[];
  submitLabel: string;
  successMessage: string;
  errorMessage: string;
  redirectUrl?: string;
  hcaptcha: boolean;
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
  };
  if (form.redirectUrl !== undefined) pub.redirectUrl = form.redirectUrl;
  return pub;
}

// ---- Submissions (stored text-only) ----

/** The honeypot + time-trap field names the renderer emits and the endpoint strips. */
export const HONEYPOT_FIELD = '_hpt';
export const TIMETRAP_FIELD = '_elapsed';

/** A stored form submission — text fields only (no binaries). */
export const FormSubmissionSchema = z.object({
  id: IdSchema,
  formId: IdSchema,
  /** Submitted text values, keyed by field name. */
  fields: z.record(z.string().max(100), z.string().max(10_000)),
  createdAt: z.string().datetime(),
});
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

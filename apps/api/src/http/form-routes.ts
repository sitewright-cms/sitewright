import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import {
  FormSchema,
  IdSchema,
  HONEYPOT_FIELD,
  INTERACTION_FIELD,
  TIMETRAP_FIELD,
  HCAPTCHA_RESPONSE_FIELD,
  MIN_SUBMIT_ELAPSED_MS,
  MAX_SUBMISSIONS_PER_FORM,
  validateFormSubmission,
  isPlatformRoutedMode,
  type Form,
  type FormModes,
} from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { content } from '../db/schema.js';
import type { SubmissionRepository } from '../repo/submissions.js';
import { describeDeliveryFailure, submissionLabels, type SubmissionMailer, type ProjectMailer } from '../mail/mailer.js';
import { nextAttemptAt } from '../mail/delivery-policy.js';
import type { HcaptchaVerifier } from '../mail/hcaptcha.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

// Submission limits (defense-in-depth alongside the per-route rate limit).
const MAX_FIELDS = 60;
const MAX_KEY_LEN = 100;
const MAX_VALUE_LEN = 10_000;
const MAX_TOTAL_BYTES = 64 * 1024;
/** Hard cap on the raw request body (rejected by Fastify pre-parse). Headroom over
 *  MAX_TOTAL_BYTES for the captcha token + JSON overhead, but bounds memory. */
const MAX_BODY_BYTES = 96 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface FormRoutesDeps {
  db: Database;
  submissions: SubmissionRepository;
  mailer: SubmissionMailer;
  /** Per-project SMTP mailer for `userSmtp` forms (Mode B). */
  projectMailer: ProjectMailer;
  hcaptcha: HcaptchaVerifier;
  /** Returns the decrypted instance hCaptcha secret, or null when unconfigured. */
  getHcaptchaSecret: () => Promise<string | null>;
  /** Returns the instance-admin-enabled form mail modes (so authors pick among them). */
  getFormModes: () => Promise<FormModes>;
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/** Loads a project's form definition (server-side, no tenant context). */
async function loadForm(db: Database, projectId: string, formId: string): Promise<Form | null> {
  // Fail fast on malformed ids (e.g. a multi-KB formId) before touching the DB.
  if (projectId.length > 64 || !IdSchema.safeParse(formId).success) return null;
  const [row] = await db
    .select()
    .from(content)
    .where(and(eq(content.projectId, projectId), eq(content.kind, 'form'), eq(content.entityId, formId)));
  if (!row) return null;
  const parsed = FormSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

/**
 * Every form definition in a project, keyed by id — the inbox lists submissions across forms, so it
 * needs them all rather than one at a time. A row whose stored data no longer parses is skipped: a
 * definition that has drifted is a reason to show raw keys for THAT form, not to fail the inbox.
 */
async function loadForms(db: Database, projectId: string): Promise<Form[]> {
  if (projectId.length > 64) return [];
  const rows = await db
    .select()
    .from(content)
    .where(and(eq(content.projectId, projectId), eq(content.kind, 'form')));
  return rows.flatMap((row) => {
    const parsed = FormSchema.safeParse(row.data);
    return parsed.success ? [parsed.data] : [];
  });
}

interface ParsedSubmission {
  fields: Record<string, string>;
  honeypotFilled: boolean;
  /** Trusted-input evidence from the form runtime, or undefined when none arrived. */
  interaction?: { pointer: number; key: number; fields: number };
  elapsed: number | undefined;
  captchaToken: string | undefined;
}

/** Why a body was rejected — plain text an author can act on. Never carries a submitted VALUE. */
interface ParseFailure {
  reason: string;
}
const rejected = (r: ParsedSubmission | ParseFailure): r is ParseFailure => 'reason' in r;

/**
 * Validates the public submission body: a flat map of text values only.
 *
 * Every rejection now NAMES its cap. All of them used to collapse into one `invalid submission`, which
 * is unhelpful for the one an author actually meets: a big order form sits close to MAX_FIELDS (a real
 * one measured 44 of 60), and the first time a menu grows past it every order 400s with a message that
 * says nothing about which limit, or that there is a limit at all. Naming the cap is not a disclosure —
 * these are fixed constants, identical on every instance, documented in the form guide.
 */
function parseSubmission(raw: unknown): ParsedSubmission | ParseFailure {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: 'the body must be a flat object of text values' };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_FIELDS) {
    return { reason: `too many fields (${entries.length}; the maximum is ${MAX_FIELDS})` };
  }
  const fields: Record<string, string> = {};
  let honeypotFilled = false;
  let elapsed: number | undefined;
  let captchaToken: string | undefined;
  let interaction: { pointer: number; key: number; fields: number } | undefined;
  let total = 0;
  for (const [key, rawValue] of entries) {
    if (key.length > MAX_KEY_LEN) return { reason: `a field name is longer than ${MAX_KEY_LEN} characters` };
    // The control fields (honeypot / time-trap / captcha) are ALWAYS single scalars — an array for any of
    // them is malformed (and must not be silently normalized into a value that could weaken the check).
    if ((key === HONEYPOT_FIELD || key === TIMETRAP_FIELD || key === INTERACTION_FIELD || key === HCAPTCHA_RESPONSE_FIELD) && Array.isArray(rawValue)) {
      return { reason: `"${key}" must be a single value` };
    }
    // A checkbox GROUP submits several checked values under one name → a string ARRAY; join them into a
    // single readable text value ("A, B, C"). Any non-string element (or nesting) is rejected — still no
    // attachments/objects. The MAX_VALUE_LEN / MAX_TOTAL_BYTES caps below bound the joined size.
    let value: unknown = rawValue;
    if (Array.isArray(rawValue)) {
      if (rawValue.length > 100) return { reason: `"${key}" sent more than 100 values` };
      if (!rawValue.every((v) => typeof v === 'string')) return { reason: `"${key}" contains a value that is not text` };
      value = (rawValue as string[]).join(', ');
    }
    // Text fields ONLY — reject objects/null/binary (no attachments).
    if (typeof value !== 'string') return { reason: `"${key}" is not text (no objects, nulls or attachments)` };
    // The captcha token is large; pull it out before the per-field length cap
    // (verified server-side, never stored). Real hCaptcha tokens are < 2 KB —
    // ignore an implausibly large value (it would fail verification anyway).
    if (key === HCAPTCHA_RESPONSE_FIELD) {
      captchaToken = value.length <= 8192 ? value : undefined;
      continue;
    }
    if (value.length > MAX_VALUE_LEN) return { reason: `"${key}" is longer than ${MAX_VALUE_LEN} characters` };
    if (key === HONEYPOT_FIELD) {
      honeypotFilled = value.trim() !== '';
      continue;
    }
    if (key === TIMETRAP_FIELD) {
      const n = Number(value);
      if (Number.isFinite(n)) elapsed = n;
      continue;
    }
    if (key === INTERACTION_FIELD) {
      // `<pointer>.<key>.<fields>`, three small non-negative integers. A malformed value is treated as
      // ABSENT rather than rejected: it is evidence, not a credential, and a browser quirk that garbles
      // it must cost a lead nothing more than the trap it then falls to.
      const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,4})$/.exec(value.trim());
      if (m) interaction = { pointer: Number(m[1]), key: Number(m[2]), fields: Number(m[3]) };
      continue;
    }
    // Skip dangerous prototype keys defensively before the dynamic assignment.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    // Count only the fields that will actually be stored (the trap fields are skipped),
    // so the cap is a tight bound on the persisted payload.
    total += key.length + value.length;
    if (total > MAX_TOTAL_BYTES) return { reason: `the submission exceeds ${MAX_TOTAL_BYTES} bytes in total` };
    // eslint-disable-next-line security/detect-object-injection -- value is a string (checked) and prototype keys are excluded above
    fields[key] = value;
  }
  return { fields, honeypotFilled, elapsed, captchaToken, interaction };
}

/** Picks a safe Reply-To from a submitted `email` field, if present and valid. */
function pickReplyTo(fields: Record<string, string>): string | undefined {
  const candidate = fields.email;
  if (candidate && EMAIL_RE.test(candidate) && !/[\r\n]/.test(candidate)) return candidate;
  return undefined;
}

/** Permissive CORS for the public submission endpoint (no credentials, public POST). */
function setSubmissionCors(reply: FastifyReply): void {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-methods', 'POST, OPTIONS');
  reply.header('access-control-allow-headers', 'content-type');
  reply.header('access-control-max-age', '600');
}

/**
 * Registers the PUBLIC submission endpoint (`/f/:projectId/:formId`) and the
 * authenticated submissions inbox. Submissions are stored text-only and emailed
 * via Mode A (global SMTP); spam is filtered by honeypot + time-trap + rate limit.
 */
export function registerFormRoutes(app: FastifyInstance, deps: FormRoutesDeps): void {
  const { db, submissions, mailer, projectMailer, hcaptcha, getHcaptchaSecret, resolveProject, isWriter, rl } = deps;

  // CORS preflight for cross-origin submissions from exported sites (rate-limited
  // like the POST so it can't be used to burn a shared global budget).
  app.options('/f/:projectId/:formId', { config: rl(20) }, async (_req, reply) => {
    setSubmissionCors(reply);
    return reply.code(204).send();
  });

  // ---- DRY RUN, for the previews -----------------------------------------------------------------
  //
  // The draft preview is served `sandbox allow-scripts` WITHOUT `allow-same-origin`, and used to omit
  // `allow-forms` too, on the reasoning that a shared draft must not fire real leads at the merchant.
  // The reasoning is right; the result was not — with no `allow-forms` the browser refuses the submit
  // outright ("Blocked form submission … the form's frame is sandboxed"), so the button did NOTHING,
  // said nothing, and the one feature you cannot exercise on the surface the whole review workflow runs
  // on was forms. Testing one meant publishing the site.
  //
  // So: the previews now allow the submit, and their forms post HERE instead. Same parse, same bot
  // filters, same definition-aware validation as the real endpoint — an author sees their required
  // fields and typed formats enforced exactly as a visitor would — and then it stops. Nothing is
  // stored, nothing is emailed, no state is touched anywhere.
  //
  // Public and unsigned, like the endpoint it shadows: it is a validator with no side effects, so
  // there is nothing to protect beyond the same rate limit. It deliberately returns NO detail about
  // the form (recipient, subject) — a preview must not become a way to read a merchant's address.
  app.options('/f/:projectId/:formId/preview', { config: rl(20) }, async (_req, reply) => {
    setSubmissionCors(reply);
    return reply.code(204).send();
  });

  app.post<{ Params: { projectId: string; formId: string } }>(
    '/f/:projectId/:formId/preview',
    { config: rl(20), bodyLimit: MAX_BODY_BYTES },
    async (req, reply) => {
      setSubmissionCors(reply);
      const form = await loadForm(db, req.params.projectId, req.params.formId);
      if (!form) return reply.code(404).send({ error: 'form not found' });

      const parsed = parseSubmission(req.body);
      if (rejected(parsed)) return reply.code(400).send({ error: 'invalid submission', reason: parsed.reason });

      // Mirror production's VISIBLE behaviour exactly (a filtered post still answers 200, so the
      // visitor sees the same thank-you) but name the reason in the body, so an author who opens
      // devtools can tell a silent drop from a real delivery. Nothing here is a secret from a bot:
      // this endpoint stores and sends nothing whatever the answer.
      const elapsed = parsed.elapsed ?? 0;
      if (parsed.honeypotFilled) return reply.send({ ok: true, preview: true, filtered: 'honeypot' });
      if (elapsed < MIN_SUBMIT_ELAPSED_MS) return reply.send({ ok: true, preview: true, filtered: 'too-fast' });

      const invalidFields = validateFormSubmission(form.fields, parsed.fields);
      if (invalidFields.length > 0) return reply.code(400).send({ error: 'invalid fields', fields: invalidFields });

      // A captcha is NOT verified here: the token is single-use, so spending it on a dry run would
      // make the next real submission fail. The widget still renders, so its placement is previewable.
      return reply.send({ ok: true, preview: true, fields: Object.keys(parsed.fields).length });
    },
  );

  app.post<{ Params: { projectId: string; formId: string } }>(
    '/f/:projectId/:formId',
    { config: rl(20), bodyLimit: MAX_BODY_BYTES },
    async (req, reply) => {
      setSubmissionCors(reply);
      const { projectId, formId } = req.params;
      const form = await loadForm(db, projectId, formId);
      // 404 for an unknown form gates the endpoint: submissions are only accepted
      // for forms that actually exist (no spraying arbitrary project ids).
      if (!form) return reply.code(404).send({ error: 'form not found' });

      const parsed = parseSubmission(req.body);
      if (rejected(parsed)) return reply.code(400).send({ error: 'invalid submission', reason: parsed.reason });

      // Cheap bot filters first (silent 200 drop, no network): honeypot filled or
      // submitted implausibly fast. Don't tip off bots that they were filtered. The
      // platform form JS always sends `_elapsed`; an absent value means the post
      // didn't come through the form (a headless bot), so treat it as instant.
      const elapsed = parsed.elapsed ?? 0;
      if (parsed.honeypotFilled || elapsed < MIN_SUBMIT_ELAPSED_MS) {
        // The VISITOR still learns nothing — same `{ok:true}` a real submission gets, so a bot cannot
        // tell it was filtered. The OPERATOR now does. Every other branch of this route logs; these two
        // returned 200 and vanished, which made "we blocked 40 spam attempts" and "we lost 40 real
        // enquiries" indistinguishable, and a client reporting "I filled in your form and never heard
        // back" impossible to check.
        const reason = parsed.honeypotFilled ? 'honeypot' : 'too-fast';
        app.log.info({ projectId, formId, reason, elapsed }, 'submission filtered by a bot trap');
        // Best effort: a counter failure must not change what the visitor sees. A lost count is a
        // reporting gap; a failed request would be a lost lead.
        await submissions.recordFiltered(projectId, formId, reason).catch((err: unknown) => {
          app.log.warn({ projectId, formId, reason, err }, 'could not count a filtered submission');
        });
        return reply.send({ ok: true });
      }

      // INTERACTION GATE — catches what the time-trap cannot: a script that POSTs straight to the
      // endpoint with a plausible `_elapsed`, having never rendered the form. Such a client produces no
      // trusted input events, so it sends no evidence at all.
      //
      // Deliberately the weakest possible test: SOME trusted input, of any kind. Not a pattern, not a
      // ratio, not a minimum count. A keyboard-only visitor produces no pointer events; a screen-reader
      // user produces an unusual shape; browser autofill fills several fields with no keystrokes. Any
      // rule sharper than "did a human touch this at all" starts costing real leads, and a lost lead is
      // far more expensive than a spam message that gets through.
      //
      // Being honest about the ceiling: a bot that actually drives a browser produces trusted events and
      // sails through, and one that reads the runtime can forge the field. It stops the generic spam
      // script that never loads the page, which is the overwhelming majority of what arrives.
      const ix = parsed.interaction;
      const touchedAnything = ix !== undefined && ix.pointer + ix.key > 0;
      if (Object.keys(parsed.fields).length > 0 && !touchedAnything) {
        app.log.info({ projectId, formId, reason: 'no-interaction', ix }, 'submission filtered by a bot trap');
        await submissions.recordFiltered(projectId, formId, 'no-interaction').catch((err: unknown) => {
          app.log.warn({ projectId, formId, err }, 'could not count a filtered submission');
        });
        return reply.send({ ok: true });
      }

      // Definition-aware validation — the SERVER backstop for the browser's native validation. A direct or
      // scripted POST bypasses the client, so re-check required fields + typed formats (email/url/number) +
      // single-select option membership here and REJECT an incomplete/malformed lead rather than storing +
      // emailing it. Runs after the bot traps (a honeypot bot still gets the silent drop) and before the
      // network hCaptcha verify (don't spend a verify on an already-invalid submission).
      const invalidFields = validateFormSubmission(form.fields, parsed.fields);
      if (invalidFields.length > 0) {
        // Distinct from the structural `invalid submission` 400 above so a consumer can react to a
        // definition-validation failure (the offending field names are in `fields`) specifically.
        return reply.code(400).send({ error: 'invalid fields', fields: invalidFields });
      }

      // hCaptcha: enforced when the form requires it. Fail-CLOSED — if the instance
      // secret is not configured we cannot verify, so reject rather than silently
      // accept an UNPROTECTED submission (the admin explicitly opted into a captcha).
      // A failed/absent token is rejected so the visitor can retry.
      if (form.hcaptcha) {
        let secret: string | null;
        try {
          secret = await getHcaptchaSecret();
        } catch {
          // Decryption failed (e.g. SW_ENCRYPTION_KEY removed/rotated after the secret
          // was stored) — cannot verify, so reject rather than 500 or wave through.
          app.log.error({ projectId, formId }, 'hCaptcha secret decryption failed; rejecting submission');
          return reply.code(503).send({ error: 'captcha verification is unavailable' });
        }
        if (!secret) {
          app.log.warn({ projectId, formId }, 'form requires hCaptcha but no instance secret is configured');
          return reply.code(503).send({ error: 'captcha verification is unavailable' });
        }
        const verified = await hcaptcha.verify(secret, parsed.captchaToken, req.ip);
        if (!verified) return reply.code(400).send({ error: 'captcha verification failed' });
      }

      // Storage-exhaustion bound: cap stored submissions per form. Over the cap,
      // silently accept-and-drop (don't store or email, don't signal the limit).
      if ((await submissions.countForForm(projectId, formId)) >= MAX_SUBMISSIONS_PER_FORM) {
        app.log.warn({ projectId, formId }, 'submission dropped: per-form storage cap reached');
        return reply.send({ ok: true });
      }

      // First failure schedules the first retry. The runner owns every attempt after this one; the
      // request path only has to make sure the row does not sit `pending` with no due time, which
      // would leave it invisible to the runner's query.
      const scheduleRetry = async (id: string, error: string): Promise<void> => {
        const next = nextAttemptAt(1, Date.now());
        if (next === null) return;
        await submissions.recordDelivery(id, { state: 'pending', attempts: 1, nextAt: new Date(next), error });
      };

      // Store first — the inbox is the source of truth even if email is unconfigured. A
      // platform-routed form is stored as `pending`: the row now RECORDS that someone is still owed
      // an email, so a failure below leaves something the retry runner can pick up and the operator
      // can see, rather than one line in a log nobody reads.
      const routed = isPlatformRoutedMode(form.mode);
      const stored = await submissions.create(projectId, formId, parsed.fields, { owesEmail: routed });

      // Delivery (best-effort): never fail the visitor's request on a mail error.
      // globalSmtp → instance SMTP; userSmtp → the project's own SMTP. (contactPhp,
      // contactPhpSmtp and thirdParty forms post elsewhere and never reach this endpoint.)
      const replyTo = pickReplyTo(parsed.fields);
      const mail = {
        recipient: form.recipient,
        subject: form.subject || `New "${form.name}" submission`,
        formName: form.name,
        fields: parsed.fields,
        labels: submissionLabels(form.fields),
        ...(replyTo ? { replyTo } : {}),
      };
      // ★ The TRANSPORT call is the only thing inside this try. Recording the outcome used to sit in
      // here too, which meant a transient database error while writing "sent" was caught as though
      // the MAIL had failed — scheduling a retry for a message that had already gone, and emailing
      // the customer twice on the next pass. What failed and what is being recorded are now separate
      // questions.
      let sent = false;
      let failure: string | null = null;
      try {
        if (form.mode === 'globalSmtp') sent = await mailer.send(mail);
        else if (form.mode === 'userSmtp') sent = await projectMailer.send(projectId, mail);
        else app.log.warn({ projectId, formId, mode: form.mode }, 'submission stored; this mode is not server-routed');
        if (!sent && routed) {
          app.log.warn({ projectId, formId, mode: form.mode }, 'submission stored but not emailed (SMTP not configured/enabled)');
          failure = 'Mail is not configured for this form’s delivery mode, or the mode is disabled instance-wide.';
        }
      } catch (err) {
        // Log only the message — a nodemailer error can carry the SMTP banner / resolved
        // IP, which we don't want in structured logs (esp. for project/user SMTP hosts).
        app.log.error(
          { projectId, formId, errMsg: err instanceof Error ? err.message : String(err) },
          'form submission email failed',
        );
        failure = describeDeliveryFailure(err);
      }
      if (routed) {
        // Recording is best-effort in its own right: if THIS fails, the row keeps the hold `create`
        // put on it and the runner retries — the wrong outcome recorded is worse than none.
        try {
          if (sent) await submissions.recordDelivery(stored.id, { state: 'sent' });
          else if (failure) await scheduleRetry(stored.id, failure);
        } catch (err) {
          app.log.error(
            { projectId, formId, errMsg: err instanceof Error ? err.message : String(err) },
            'could not record the delivery outcome for a submission',
          );
        }
      }

      return reply.send({ ok: true });
    },
  );

  // Which mail-delivery modes the instance admin permits — so a project author can
  // pick among them when authoring a form. Any project member may read this.
  //
  // NOTE: formModes is an editor affordance + an email-delivery gate (the global/
  // project mailers only send when the mode is enabled), NOT a hard write-time ACL.
  // It is deliberately not enforced on the form PUT: modes default to all-off and
  // forms still function (store-always), so a fresh instance must be able to save a
  // (globalSmtp) form. Form writes are already restricted to owner/admin (a trusted
  // role). A hard per-mode publish/store ACL would be a cross-phase design change.
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/form-modes',
    { config: rl(30) },
    async (req, reply) => {
      await resolveProject(req, 'content:read');
      // Changes rarely; let the editor cache it across tab switches.
      reply.header('cache-control', 'private, max-age=60');
      return reply.send({ formModes: await deps.getFormModes() });
    },
  );

  // ---- Submissions inbox (authenticated) ----
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/submissions',
    { config: rl(60) },
    async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      const q = req.query as { formId?: string; limit?: string; offset?: string };
      const result = await submissions.list(project.id, {
        formId: q.formId,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      });
      // A submission is stored keyed by input `name`, which is wiring. The inbox is the other place a
      // person READS a lead — the email already resolves these — so send what each form calls its
      // fields alongside, resolved from the definition as it is NOW rather than frozen into the row:
      // renaming a label should fix every lead already sitting here, not only the next one.
      // Keyed by form id, so a cross-form list carries each set once instead of per row.
      const defs = await loadForms(db, project.id);
      const forms = Object.fromEntries(
        defs
          .filter((f) => !q.formId || f.id === q.formId)
          .map((f) => [f.id, { name: f.name, labels: submissionLabels(f.fields) }]),
      );
      return reply.send({ ...result, forms });
    },
  );

  app.get<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/submissions/:id',
    { config: rl(60) },
    async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      const item = await submissions.get(project.id, req.params.id);
      if (!item) return reply.code(404).send({ error: 'submission not found' });
      return reply.send({ item });
    },
  );

  // How many submissions are still owed an email, and why the last one failed. The editor polls
  // this to show a banner: emailing someone about broken email is circular, so the alert has to be
  // somewhere they already look.
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/submissions/undelivered',
    { config: rl(60) },
    async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      // Scope to one form when asked: the inbox is rendered per-form on the Forms tab, and a
      // project-wide count there would announce another form's failure over this one's rows.
      const q = req.query as { formId?: string };
      return reply.send(await submissions.undeliveredSummary(project.id, q.formId));
    },
  );

  // What the bot traps have filtered, per form and reason. The inbox can only ever show what got
  // THROUGH; without this the traps are invisible, and an operator cannot tell a quiet form (nobody is
  // writing) from a filtered one (everybody is, and something is eating it).
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/submissions/filtered',
    { config: rl(60) },
    async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      const q = req.query as { formId?: string };
      const items = await submissions.filteredSummary(project.id, q.formId);
      return reply.send({ items, total: items.reduce((n, i) => n + i.count, 0) });
    },
  );

  // Puts one back in the queue — what an operator clicks after fixing SMTP. Without it, `failed`
  // would be terminal and a backlog built up during an outage could never be cleared.
  app.post<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/submissions/:id/resend',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const queued = await submissions.requeue(project.id, req.params.id);
      if (!queued) return reply.code(404).send({ error: 'submission not found, or it was never owed an email' });
      return reply.send({ queued: true });
    },
  );

  app.delete<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/submissions/:id',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:delete');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const removed = await submissions.remove(project.id, req.params.id);
      if (!removed) return reply.code(404).send({ error: 'submission not found' });
      return reply.code(204).send();
    },
  );
}

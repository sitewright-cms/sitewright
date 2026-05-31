import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { FormSchema, IdSchema, HONEYPOT_FIELD, TIMETRAP_FIELD, type Form } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { content } from '../db/schema.js';
import type { SubmissionRepository } from '../repo/submissions.js';
import type { SubmissionMailer } from '../mail/mailer.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

// Submission limits (defense-in-depth alongside the per-route rate limit).
const MAX_FIELDS = 60;
const MAX_KEY_LEN = 100;
const MAX_VALUE_LEN = 10_000;
const MAX_TOTAL_BYTES = 64 * 1024;
/** Reject submissions completed faster than a human plausibly could (bot trap). */
const MIN_ELAPSED_MS = 1200;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ProjectReq = FastifyRequest<{ Params: { orgId: string; projectId: string } }>;

export interface FormRoutesDeps {
  db: Database;
  submissions: SubmissionRepository;
  mailer: SubmissionMailer;
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

interface ParsedSubmission {
  fields: Record<string, string>;
  honeypotFilled: boolean;
  elapsed: number | undefined;
}

/** Validates the public submission body: a flat map of text values only. */
function parseSubmission(raw: unknown): ParsedSubmission | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_FIELDS) return null;
  const fields: Record<string, string> = {};
  let honeypotFilled = false;
  let elapsed: number | undefined;
  let total = 0;
  for (const [key, value] of entries) {
    if (key.length > MAX_KEY_LEN) return null;
    // Text fields ONLY — reject arrays/objects/null/binary (no attachments).
    if (typeof value !== 'string') return null;
    if (value.length > MAX_VALUE_LEN) return null;
    if (key === HONEYPOT_FIELD) {
      honeypotFilled = value.trim() !== '';
      continue;
    }
    if (key === TIMETRAP_FIELD) {
      const n = Number(value);
      if (Number.isFinite(n)) elapsed = n;
      continue;
    }
    // Skip dangerous prototype keys defensively before the dynamic assignment.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    // Count only the fields that will actually be stored (the trap fields are skipped),
    // so the cap is a tight bound on the persisted payload.
    total += key.length + value.length;
    if (total > MAX_TOTAL_BYTES) return null;
    // eslint-disable-next-line security/detect-object-injection -- value is a string (checked) and prototype keys are excluded above
    fields[key] = value;
  }
  return { fields, honeypotFilled, elapsed };
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
  const { db, submissions, mailer, resolveProject, isWriter, rl } = deps;

  // CORS preflight for cross-origin submissions from exported sites (rate-limited
  // like the POST so it can't be used to burn a shared global budget).
  app.options('/f/:projectId/:formId', { config: rl(20) }, async (_req, reply) => {
    setSubmissionCors(reply);
    return reply.code(204).send();
  });

  app.post<{ Params: { projectId: string; formId: string } }>(
    '/f/:projectId/:formId',
    { config: rl(20) },
    async (req, reply) => {
      setSubmissionCors(reply);
      const { projectId, formId } = req.params;
      const form = await loadForm(db, projectId, formId);
      // 404 for an unknown form gates the endpoint: submissions are only accepted
      // for forms that actually exist (no spraying arbitrary project ids).
      if (!form) return reply.code(404).send({ error: 'form not found' });

      if (form.hcaptcha) {
        // TODO(Phase 4): verify the submitted hCaptcha token here. Until then the
        // per-form flag is a no-op — log it so an operator who enables hCaptcha knows
        // it is not yet enforced (rather than assuming protection that isn't there).
        app.log.warn({ projectId, formId }, 'hcaptcha is enabled on this form but verification is not yet implemented (Phase 4)');
      }

      const parsed = parseSubmission(req.body);
      if (!parsed) return reply.code(400).send({ error: 'invalid submission' });

      // Honeypot filled or submitted implausibly fast → accept silently but DROP
      // (don't tip off bots that they were filtered). The platform form JS always
      // sends `_elapsed`; an absent value means the post didn't come through the
      // form (a headless bot), so treat it as instant.
      const elapsed = parsed.elapsed ?? 0;
      if (parsed.honeypotFilled || elapsed < MIN_ELAPSED_MS) {
        return reply.send({ ok: true });
      }

      // Store first — the inbox is the source of truth even if email is unconfigured.
      await submissions.create(projectId, formId, parsed.fields);

      // Mode A delivery (best-effort): never fail the visitor's request on a mail error.
      if (form.mode === 'globalSmtp') {
        try {
          const replyTo = pickReplyTo(parsed.fields);
          const sent = await mailer.send({
            recipient: form.recipient,
            subject: form.subject || `New "${form.name}" submission`,
            formName: form.name,
            fields: parsed.fields,
            ...(replyTo ? { replyTo } : {}),
          });
          if (!sent) {
            app.log.warn({ projectId, formId }, 'submission stored but global SMTP is not configured/enabled');
          }
        } catch (err) {
          app.log.error({ projectId, formId, err }, 'form submission email failed');
        }
      } else {
        app.log.warn({ projectId, formId, mode: form.mode }, 'submission stored; this mode is not yet server-routed');
      }

      return reply.send({ ok: true });
    },
  );

  // ---- Submissions inbox (authenticated) ----
  app.get<{ Params: { orgId: string; projectId: string } }>(
    '/orgs/:orgId/projects/:projectId/submissions',
    { config: rl(60) },
    async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      const q = req.query as { formId?: string; limit?: string; offset?: string };
      const result = await submissions.list(project.id, {
        formId: q.formId,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.send(result);
    },
  );

  app.get<{ Params: { orgId: string; projectId: string; id: string } }>(
    '/orgs/:orgId/projects/:projectId/submissions/:id',
    async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      const item = await submissions.get(project.id, req.params.id);
      if (!item) return reply.code(404).send({ error: 'submission not found' });
      return reply.send({ item });
    },
  );

  app.delete<{ Params: { orgId: string; projectId: string; id: string } }>(
    '/orgs/:orgId/projects/:projectId/submissions/:id',
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const removed = await submissions.remove(project.id, req.params.id);
      if (!removed) return reply.code(404).send({ error: 'submission not found' });
      return reply.code(204).send();
    },
  );
}

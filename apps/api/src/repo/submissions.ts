import { newId } from '../id.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import { FormSubmissionSchema, type FormSubmission } from '@sitewright/schema';
// (FormSubmissionSchema is also used to validate rows on read — see toSubmission.)
import type { Database } from '../db/client.js';
import { formSubmissions } from '../db/schema.js';

export interface SubmissionListResult {
  items: FormSubmission[];
  total: number;
}

const MAX_LIMIT = 200;

/**
 * Stores and reads form submissions (text fields only). Writes come from the
 * PUBLIC submission endpoint (no tenant context — the caller validates the form
 * exists first); reads/deletes are scoped to a project the caller is authorized
 * for (the route resolves the tenant before calling here).
 */
export class SubmissionRepository {
  constructor(private readonly db: Database) {}

  /** Records a submission. `fields` must already be sanitized to a flat text map. */
  async create(projectId: string, formId: string, fields: Record<string, string>): Promise<FormSubmission> {
    const id = newId();
    const now = new Date();
    const submission = FormSubmissionSchema.parse({
      id,
      formId,
      fields,
      createdAt: now.toISOString(),
    });
    await this.db
      .insert(formSubmissions)
      .values({ id, projectId, formId, data: submission.fields, createdAt: now });
    return submission;
  }

  /** Number of stored submissions for a form (for the per-form storage cap). */
  async countForForm(projectId: string, formId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(formSubmissions)
      .where(and(eq(formSubmissions.projectId, projectId), eq(formSubmissions.formId, formId)));
    return row?.total ?? 0;
  }

  /** Newest-first page of a project's submissions, optionally filtered by form. */
  async list(
    projectId: string,
    opts: { formId?: string; limit?: number; offset?: number } = {},
  ): Promise<SubmissionListResult> {
    // Guard against NaN (e.g. Number('abc')): a NaN comparison is always false, so
    // it would slip past clamp and reach .limit()/.offset() as an unbounded query.
    const rawLimit = Number.isFinite(opts.limit) ? (opts.limit as number) : 50;
    const rawOffset = Number.isFinite(opts.offset) ? (opts.offset as number) : 0;
    const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
    const offset = Math.max(rawOffset, 0);
    const where = opts.formId
      ? and(eq(formSubmissions.projectId, projectId), eq(formSubmissions.formId, opts.formId))
      : eq(formSubmissions.projectId, projectId);
    const rows = await this.db
      .select()
      .from(formSubmissions)
      .where(where)
      .orderBy(desc(formSubmissions.createdAt))
      .limit(limit)
      .offset(offset);
    const [counted] = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(formSubmissions)
      .where(where);
    return { items: rows.map(toSubmission), total: counted?.total ?? 0 };
  }

  /** One submission within a project, or null. */
  async get(projectId: string, id: string): Promise<FormSubmission | null> {
    const [row] = await this.db
      .select()
      .from(formSubmissions)
      .where(and(eq(formSubmissions.projectId, projectId), eq(formSubmissions.id, id)));
    return row ? toSubmission(row) : null;
  }

  /** Deletes a submission; returns whether a row was removed. */
  async remove(projectId: string, id: string): Promise<boolean> {
    const existing = await this.get(projectId, id);
    if (!existing) return false;
    await this.db
      .delete(formSubmissions)
      .where(and(eq(formSubmissions.projectId, projectId), eq(formSubmissions.id, id)));
    return true;
  }
}

interface SubmissionRow {
  id: string;
  formId: string;
  data: unknown;
  createdAt: Date;
}

function toSubmission(row: SubmissionRow): FormSubmission {
  // Validate on read too — enforces the text-only guarantee regardless of how the
  // row was written (a malformed row yields empty fields rather than leaking raw data).
  const candidate = {
    id: row.id,
    formId: row.formId,
    fields: row.data ?? {},
    createdAt: row.createdAt.toISOString(),
  };
  const parsed = FormSubmissionSchema.safeParse(candidate);
  return parsed.success
    ? parsed.data
    : { id: row.id, formId: row.formId, fields: {}, createdAt: row.createdAt.toISOString() };
}

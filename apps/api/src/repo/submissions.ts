import { newId } from '../id.js';
import { and, asc, desc, eq, inArray, lte, or, isNull, sql } from 'drizzle-orm';
import { FormSubmissionSchema, type FormSubmission } from '@sitewright/schema';
// (FormSubmissionSchema is also used to validate rows on read — see toSubmission.)
import type { Database } from '../db/client.js';
import { formSubmissions } from '../db/schema.js';
import { DELIVERY_LEASE_MS } from '../mail/delivery-policy.js';

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

  /**
   * Records a submission. `fields` must already be sanitized to a flat text map.
   *
   * `owesEmail` marks the row as one the platform must still notify someone about. It is false for
   * a form the platform does not route (contact.php / third-party post elsewhere), so `pending`
   * always means a real outstanding obligation rather than "we have no idea".
   */
  async create(
    projectId: string,
    formId: string,
    fields: Record<string, string>,
    opts: { owesEmail?: boolean } = {},
  ): Promise<FormSubmission> {
    const id = newId();
    const now = new Date();
    const submission = FormSubmissionSchema.parse({
      id,
      formId,
      fields,
      createdAt: now.toISOString(),
    });
    await this.db.insert(formSubmissions).values({
      id,
      projectId,
      formId,
      data: submission.fields,
      createdAt: now,
      deliveryState: opts.owesEmail ? 'pending' : 'na',
      // ★ NOT due immediately. The request handler is about to attempt this send itself, and it does
      // so WITHOUT taking a lease — it is not a claimant, it just calls the transport. A row that is
      // `pending` with no next-attempt time is due the instant it exists, so a background pass
      // landing during that window would claim and send the SAME submission, and a customer would
      // get the notification twice. Holding it back by one lease covers the transport's own worst
      // case (10s connect + 10s greeting + 15s socket) and still self-heals: if the process dies
      // mid-request, the row simply becomes due when the lease expires.
      ...(opts.owesEmail ? { deliveryNextAt: new Date(now.getTime() + DELIVERY_LEASE_MS) } : {}),
    });
    return submission;
  }

  /** Records the outcome of a delivery attempt. */
  async recordDelivery(
    id: string,
    outcome:
      | { state: 'sent' }
      | { state: 'abandoned' }
      | { state: 'pending'; attempts: number; nextAt: Date; error: string }
      | { state: 'failed'; attempts: number; error: string },
  ): Promise<void> {
    const values =
      outcome.state === 'sent' || outcome.state === 'abandoned'
        ? { deliveryState: outcome.state, deliveryNextAt: null, deliveryError: null }
        : outcome.state === 'pending'
          ? {
              deliveryState: 'pending' as const,
              deliveryAttempts: outcome.attempts,
              deliveryNextAt: outcome.nextAt,
              deliveryError: outcome.error,
            }
          : {
              deliveryState: 'failed' as const,
              deliveryAttempts: outcome.attempts,
              deliveryNextAt: null,
              deliveryError: outcome.error,
            };
    await this.db.update(formSubmissions).set(values).where(eq(formSubmissions.id, id));
  }

  /**
   * Claims up to `limit` submissions whose next attempt is due, oldest first.
   *
   * Claiming means pushing `deliveryNextAt` past the lease BEFORE returning them, so a process
   * killed mid-send leaves rows that become due again on their own rather than ones stuck in a
   * state nothing will ever revisit. Reads then writes rather than a single UPDATE..RETURNING
   * because libsql/SQLite support for RETURNING varies by driver version and this must not depend
   * on it.
   */
  async claimDue(now: Date, leaseMs: number, limit: number): Promise<DueDelivery[]> {
    const rows = await this.db
      .select({
        id: formSubmissions.id,
        projectId: formSubmissions.projectId,
        formId: formSubmissions.formId,
        data: formSubmissions.data,
        createdAt: formSubmissions.createdAt,
        attempts: formSubmissions.deliveryAttempts,
      })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.deliveryState, 'pending'),
          or(isNull(formSubmissions.deliveryNextAt), lte(formSubmissions.deliveryNextAt, now)),
        ),
      )
      .orderBy(asc(formSubmissions.createdAt))
      .limit(limit);
    if (rows.length === 0) return [];
    await this.db
      .update(formSubmissions)
      .set({ deliveryNextAt: new Date(now.getTime() + leaseMs) })
      .where(inArray(formSubmissions.id, rows.map((r) => r.id)));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      formId: r.formId,
      fields: (r.data ?? {}) as Record<string, string>,
      attempts: r.attempts,
      createdAt: r.createdAt,
    }));
  }

  /**
   * How many submissions are still owed an email, and a reason one of them failed.
   *
   * The reason comes from the newest-SUBMITTED row that has one, which is not necessarily the most
   * recent failure — `deliveryError` is overwritten in place on each retry and there is no
   * per-attempt timestamp to order by. It is a representative example for the banner, not a log.
   */
  async undeliveredSummary(projectId?: string, formId?: string): Promise<{ count: number; lastError: string | null }> {
    const undelivered = inArray(formSubmissions.deliveryState, ['pending', 'failed']);
    const scoped = projectId ? and(eq(formSubmissions.projectId, projectId), undelivered) : undelivered;
    const where = formId ? and(scoped, eq(formSubmissions.formId, formId)) : scoped;
    const [counted] = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(formSubmissions)
      .where(where);
    const [latest] = await this.db
      .select({ error: formSubmissions.deliveryError })
      .from(formSubmissions)
      .where(and(where, sql`${formSubmissions.deliveryError} is not null`))
      .orderBy(desc(formSubmissions.createdAt))
      .limit(1);
    return { count: counted?.total ?? 0, lastError: latest?.error ?? null };
  }

  /**
   * Puts a submission back in the queue for immediate retry — what an operator clicks after fixing
   * the SMTP settings. Without it `failed` would be terminal and the backlog unrecoverable.
   * Returns false when the row does not exist or was never owed an email in the first place.
   */
  async requeue(projectId: string, id: string): Promise<boolean> {
    const [row] = await this.db
      .select({
        state: formSubmissions.deliveryState,
        attempts: formSubmissions.deliveryAttempts,
        error: formSubmissions.deliveryError,
      })
      .from(formSubmissions)
      .where(and(eq(formSubmissions.projectId, projectId), eq(formSubmissions.id, id)));
    if (!row) return false;
    // Accepting `sent` would let one click re-email a lead that already arrived. `na` was never owed.
    if (row.state === 'sent' || row.state === 'na') return false;
    // ★ AND: refuse a row whose FIRST attempt has not resolved yet.
    //
    // A brand-new submission is `pending` from the moment it is stored, while the request handler is
    // still performing its own inline send — that attempt holds no lease, so `create()` holds the row
    // back by one instead. Requeueing clears that hold, and the next pass then sends a message the
    // request is in the middle of sending: the customer gets it twice. `pending` alone cannot tell
    // "in flight" from "failed and backing off"; a recorded attempt or a recorded error can, because
    // both are written only after an attempt has concluded.
    //
    // `abandoned` is deliberately requeueable: it is settled, not delivered, so an operator who has
    // just switched a form's mode back has a way to recover the notification. If it is still not
    // platform-routed the next pass simply abandons it again.
    if (row.state === 'pending' && row.attempts === 0 && row.error === null) return false;
    await this.db
      .update(formSubmissions)
      .set({ deliveryState: 'pending', deliveryAttempts: 0, deliveryNextAt: null, deliveryError: null })
      .where(and(eq(formSubmissions.projectId, projectId), eq(formSubmissions.id, id)));
    return true;
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

/** A submission the platform still owes an email for, as handed to the delivery runner. */
export interface DueDelivery {
  id: string;
  projectId: string;
  formId: string;
  fields: Record<string, string>;
  attempts: number;
  createdAt: Date;
}

interface SubmissionRow {
  id: string;
  formId: string;
  data: unknown;
  createdAt: Date;
  deliveryState?: string | null;
}

function toSubmission(row: SubmissionRow): FormSubmission {
  // Validate on read too — enforces the text-only guarantee regardless of how the
  // row was written (a malformed row yields empty fields rather than leaking raw data).
  const candidate = {
    id: row.id,
    formId: row.formId,
    fields: row.data ?? {},
    createdAt: row.createdAt.toISOString(),
    // Per-row, so the inbox can offer Resend on the rows that are actually owed rather than on
    // every row whenever the project-wide count is non-zero.
    deliveryState: row.deliveryState ?? 'na',
  };
  const parsed = FormSubmissionSchema.safeParse(candidate);
  return parsed.success
    ? parsed.data
    : {
        id: row.id,
        formId: row.formId,
        fields: {},
        createdAt: row.createdAt.toISOString(),
        deliveryState: (row.deliveryState ?? 'na') as FormSubmission['deliveryState'],
      };
}

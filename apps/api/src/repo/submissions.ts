import { newId } from '../id.js';
import { and, asc, desc, eq, inArray, notInArray, lt, lte, or, isNull, sql } from 'drizzle-orm';
import { FormSubmissionSchema, type FormSubmission } from '@sitewright/schema';
// (FormSubmissionSchema is also used to validate rows on read — see toSubmission.)
import type { Database } from '../db/client.js';
import { formFiltered, formSubmissions } from '../db/schema.js';
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
      ...(opts.owesEmail
        ? {
            deliveryNextAt: new Date(now.getTime() + DELIVERY_LEASE_MS),
            // The request handler sends inline, so it holds the claim until it records an outcome.
            deliveryClaimedAt: now,
          }
        : {}),
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
        ? { deliveryState: outcome.state, deliveryNextAt: null, deliveryError: null, deliveryClaimedAt: null }
        : outcome.state === 'pending'
          ? {
              deliveryState: 'pending' as const,
              deliveryAttempts: outcome.attempts,
              deliveryNextAt: outcome.nextAt,
              deliveryError: outcome.error,
              deliveryClaimedAt: null, // the attempt concluded; nothing holds it now
            }
          : {
              deliveryState: 'failed' as const,
              deliveryAttempts: outcome.attempts,
              deliveryNextAt: null,
              deliveryError: outcome.error,
              deliveryClaimedAt: null,
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
    // Claim each candidate with the same conditions in the WHERE, and keep only the ones this call
    // actually won. The SELECT above is just a candidate list — treating it as a claim would let two
    // callers both "claim" a row and both send it. Belt and braces today (one scheduler, guarded by
    // a re-entrancy flag), but the invariant should be the database's, not a convention's.
    const won: typeof rows = [];
    for (const candidate of rows) {
      const res = await this.db
        .update(formSubmissions)
        .set({ deliveryNextAt: new Date(now.getTime() + leaseMs), deliveryClaimedAt: now })
        .where(
          and(
            eq(formSubmissions.id, candidate.id),
            eq(formSubmissions.deliveryState, 'pending'),
            or(isNull(formSubmissions.deliveryNextAt), lte(formSubmissions.deliveryNextAt, now)),
          ),
        );
      if ((res as { rowsAffected?: number }).rowsAffected === 1) won.push(candidate);
    }
    if (won.length === 0) return [];
    // ★ Re-read AFTER winning. The candidate list was captured before the UPDATE that decided the
    // claim, and a `requeue` can commit in that gap — it resets attempts to 0 and the next-attempt
    // time to null, which still satisfies this claim's WHERE, so the claim wins immediately after
    // and would hand the caller the PRE-RESET count. The runner would then treat the next failure as
    // exhausting the ladder and mark the row terminally failed, silently defeating the Resend the
    // operator had just been told succeeded.
    //
    // Safe to re-read now rather than racy in turn: this row is claimed, so `requeue` refuses it
    // until the lease lapses. Nothing else can change it underneath this read.
    const fresh = await this.db
      .select({
        id: formSubmissions.id,
        projectId: formSubmissions.projectId,
        formId: formSubmissions.formId,
        data: formSubmissions.data,
        createdAt: formSubmissions.createdAt,
        attempts: formSubmissions.deliveryAttempts,
      })
      .from(formSubmissions)
      .where(inArray(formSubmissions.id, won.map((r) => r.id)));
    return fresh.map((r) => ({
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
    // ★ ONE conditional statement, not read-then-write.
    //
    // The guard used to be a SELECT, a decision, and then an unconditional UPDATE. A claim landing
    // in that gap — the retry pass works the same backlog an operator is clicking Resend on, and
    // that is precisely the situation during an outage — meant the decision was made on a pre-claim
    // snapshot while the write blindly erased the live claim. The next pass then sent a message a
    // sender still had open. Putting every condition in the WHERE makes the check and the act the
    // same statement, so a claim that lands first simply causes zero rows to match.
    //
    // Refused: `sent` (already delivered), `na` (never owed), and anything a sender currently holds.
    // A claim older than the lease is stale — the holder died — and must not block recovery.
    const staleBefore = new Date(Date.now() - DELIVERY_LEASE_MS);
    const res = await this.db
      .update(formSubmissions)
      .set({
        deliveryState: 'pending',
        deliveryAttempts: 0,
        deliveryNextAt: null,
        deliveryError: null,
        deliveryClaimedAt: null,
      })
      .where(
        and(
          eq(formSubmissions.projectId, projectId),
          eq(formSubmissions.id, id),
          notInArray(formSubmissions.deliveryState, ['sent', 'na']),
          or(isNull(formSubmissions.deliveryClaimedAt), lt(formSubmissions.deliveryClaimedAt, staleBefore)),
        ),
      );
    return (res as { rowsAffected?: number }).rowsAffected === 1;
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

  /**
   * Count one FILTERED submission. The traps answer `{ok:true}` and keep nothing — a bot must learn
   * nothing from the response — so this is the only trace they leave. Counted per (form, reason) and
   * upserted, never one row per drop: a spam run would otherwise write unbounded rows, which is the
   * very problem the traps exist to prevent.
   *
   * Best-effort by contract: a counter failure must never change what the VISITOR sees, so the caller
   * swallows its errors. Losing a count is a reporting gap; failing the request would be a lost lead.
   */
  async recordFiltered(projectId: string, formId: string, reason: string, now: Date = new Date()): Promise<void> {
    await this.db
      .insert(formFiltered)
      .values({ projectId, formId, reason, count: 1, lastAt: now })
      .onConflictDoUpdate({
        target: [formFiltered.projectId, formFiltered.formId, formFiltered.reason],
        set: { count: sql`${formFiltered.count} + 1`, lastAt: now },
      });
  }

  /** What each trap has filtered for a project (optionally one form), most recent activity first. */
  async filteredSummary(
    projectId: string,
    formId?: string,
  ): Promise<Array<{ formId: string; reason: string; count: number; lastAt: number }>> {
    const scoped = eq(formFiltered.projectId, projectId);
    const where = formId ? and(scoped, eq(formFiltered.formId, formId)) : scoped;
    const rows = await this.db
      .select({ formId: formFiltered.formId, reason: formFiltered.reason, count: formFiltered.count, lastAt: formFiltered.lastAt })
      .from(formFiltered)
      .where(where)
      .orderBy(desc(formFiltered.lastAt));
    return rows.map((r) => ({ formId: r.formId, reason: r.reason, count: r.count, lastAt: r.lastAt.getTime() }));
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

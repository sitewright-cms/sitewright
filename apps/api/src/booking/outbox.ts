import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, lt, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { bookingMails } from '../db/schema.js';
import { DELIVERY_LEASE_MS, nextAttemptAt } from '../mail/delivery-policy.js';
import { describeDeliveryFailure, PROJECT_MAIL_UNAVAILABLE, type ProjectMailSender } from '../mail/mailer.js';
import type { QueuedBookingMail } from './mails.js';

/**
 * THE BOOKING MAIL OUTBOX — the confirmations, requests and cancellations on their way.
 *
 * Same shape as the order mails and the form deliveries: claim with a lease, attempt, record the outcome in one
 * write, back off. A sent mail's row is deleted at once; one that keeps failing is kept as `failed` for a week
 * so an operator can see it, then swept with the customer's details in it.
 */

export const BOOKING_MAIL_LIMITS = {
  /** Mails waiting per project. A project takes at most 60 bookings an hour, each sending a few. */
  queuedPerProject: 500,
  /** How long a mail that could not be delivered is kept. */
  failedRetentionMs: 7 * 24 * 60 * 60 * 1000,
  /** Mails one pass sends. Bounded so a backlog drains steadily rather than in a spike. */
  batch: 20,
} as const;

export interface BookingMailRow {
  id: string;
  projectId: string;
  recipient: string;
  subject: string;
  replyTo: string | null;
  body: QueuedBookingMail['rendered'];
  attempts: number;
  nextAt: Date;
}

export class BookingMailRepository {
  constructor(private readonly db: Database) {}

  /**
   * Queues one booking event's mails. Past the per-project cap the rest are dropped, and the number dropped is
   * returned for the caller to log: the booking itself stands either way.
   */
  async enqueue(projectId: string, mails: readonly QueuedBookingMail[], now = new Date()): Promise<{ queued: number; dropped: number }> {
    if (mails.length === 0) return { queued: 0, dropped: 0 };
    const [row] = await this.db.select({ n: count() }).from(bookingMails).where(eq(bookingMails.projectId, projectId));
    const room = Math.max(0, BOOKING_MAIL_LIMITS.queuedPerProject - (row?.n ?? 0));
    const kept = mails.slice(0, room);
    if (kept.length) {
      await this.db.insert(bookingMails).values(
        kept.map((m) => ({
          id: randomUUID(),
          projectId,
          recipient: m.recipient,
          subject: m.subject,
          replyTo: m.replyTo ?? null,
          body: m.rendered,
          state: 'pending' as const,
          attempts: 0,
          nextAt: now,
          createdAt: now,
        })),
      );
    }
    return { queued: kept.length, dropped: mails.length - kept.length };
  }

  /**
   * Due mails, each leased: its `next_at` is moved past the lease before it is handed out, by a conditional
   * write, so two passes never send the same mail and one killed mid-send is due again when the lease runs out.
   */
  async claimDue(now: Date, limit: number = BOOKING_MAIL_LIMITS.batch): Promise<BookingMailRow[]> {
    const due = await this.db
      .select()
      .from(bookingMails)
      .where(and(eq(bookingMails.state, 'pending'), lte(bookingMails.nextAt, now)))
      .orderBy(asc(bookingMails.nextAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    const leased = new Date(now.getTime() + DELIVERY_LEASE_MS);
    const claimed: BookingMailRow[] = [];
    for (const r of due) {
      const res = await this.db
        .update(bookingMails)
        .set({ nextAt: leased })
        .where(and(eq(bookingMails.id, r.id), eq(bookingMails.state, 'pending'), eq(bookingMails.nextAt, r.nextAt)));
      if ((res.rowsAffected ?? 0) === 0) continue; // another pass took it
      claimed.push({ id: r.id, projectId: r.projectId, recipient: r.recipient, subject: r.subject, replyTo: r.replyTo, body: r.body, attempts: r.attempts, nextAt: leased });
    }
    return claimed;
  }

  /** Sent: the row goes, and the customer's details with it. */
  async sent(id: string): Promise<void> {
    await this.db.delete(bookingMails).where(eq(bookingMails.id, id));
  }

  /** Not sent: due again at `nextAt`, or `failed` for good when there is no next attempt. */
  async notSent(id: string, attempts: number, nextAt: Date | null, error: string): Promise<void> {
    await this.db
      .update(bookingMails)
      .set(nextAt ? { attempts, nextAt, lastError: error } : { attempts, state: 'failed', lastError: error })
      .where(eq(bookingMails.id, id));
  }

  /** Mails that failed for good, a week on. */
  async sweep(now: number): Promise<number> {
    const res = await this.db
      .delete(bookingMails)
      .where(and(eq(bookingMails.state, 'failed'), lt(bookingMails.createdAt, new Date(now - BOOKING_MAIL_LIMITS.failedRetentionMs))));
    return res.rowsAffected ?? 0;
  }
}

export interface BookingMailRunnerDeps {
  mails: BookingMailRepository;
  /** The project's own SMTP when it has one, else global SMTP (`makeProjectMailSender`). */
  sendForProject: ProjectMailSender;
  log?: { warn: (o: unknown, m: string) => void };
  /** The clock, read for EACH mail: a lease and a backoff run from when that mail is tried, not from the pass. */
  now?: () => number;
}

/**
 * One pass over the mails that are due, one mail at a time.
 *
 * ★ Each mail is leased just before it is tried. Leasing a whole batch up front let the lease of the fifth mail
 * run out while a slow server held up the first four, and another pass could then send it a second time.
 * ★ A failure to record one mail's outcome is logged and the pass goes on: the mail's lease brings it back.
 * `more` says a full batch went, so the caller may run another pass rather than wait for the next tick.
 */
export async function runBookingMail(deps: BookingMailRunnerDeps): Promise<{ sent: number; failed: number; more: boolean }> {
  const clock = deps.now ?? Date.now;
  let sent = 0;
  let failed = 0;
  let tried = 0;
  for (; tried < BOOKING_MAIL_LIMITS.batch; tried += 1) {
    const [row] = await deps.mails.claimDue(new Date(clock()), 1);
    if (!row) break;
    try {
      const outcome = await attempt(deps, row, clock);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'failed') failed += 1;
    } catch (err) {
      deps.log?.warn({ err, projectId: row.projectId, mailId: row.id }, 'booking mail outcome not recorded; it is tried again when its lease runs out');
    }
  }
  return { sent, failed, more: tried === BOOKING_MAIL_LIMITS.batch };
}

async function attempt(deps: BookingMailRunnerDeps, row: BookingMailRow, clock: () => number): Promise<'sent' | 'retry' | 'failed'> {
  let ok = false;
  let error = 'delivery failed';
  try {
    ok = await deps.sendForProject(row.projectId, {
      recipient: row.recipient,
      subject: row.subject,
      formName: 'booking',
      fields: {},
      rendered: row.body,
      ...(row.replyTo ? { replyTo: row.replyTo } : {}),
    });
    if (!ok) error = PROJECT_MAIL_UNAVAILABLE;
  } catch (err) {
    // Only the sanitized description is kept: a transport error carries the SMTP banner and the server's address.
    error = describeDeliveryFailure(err);
  }
  if (ok) {
    await deps.mails.sent(row.id);
    return 'sent';
  }
  const attempts = row.attempts + 1;
  const next = nextAttemptAt(attempts, clock());
  await deps.mails.notSent(row.id, attempts, next === null ? null : new Date(next), error);
  if (next !== null) return 'retry';
  deps.log?.warn({ projectId: row.projectId, mailId: row.id, attempts }, 'booking mail abandoned after the final attempt');
  return 'failed';
}

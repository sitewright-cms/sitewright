import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { projects, bookingMails } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import { BOOKING_MAIL_LIMITS, BookingMailRepository, runBookingMail } from '../src/booking/outbox.js';
import { MAX_DELIVERY_ATTEMPTS, RETRY_BACKOFF_MS } from '../src/mail/delivery-policy.js';
import type { SubmissionMail } from '../src/mail/mailer.js';
import type { QueuedBookingMail } from '../src/booking/mails.js';

/**
 * The booking mail outbox: a sent mail's row is gone, a failing one backs off and is kept a week as failed, two
 * passes never send the same mail, and a project cannot queue without bound.
 */

let db: Database;
let repo: BookingMailRepository;
let projectId: string;
let sent: SubmissionMail[];

const MAIL = (to = 'ada@example.com'): QueuedBookingMail => ({
  role: 'customer',
  recipient: to,
  subject: 'Booking confirmed: Massage',
  replyTo: 'hello@studio.example',
  rendered: { text: 'You are booked.', html: '<p>You are booked.</p>', attachments: [{ filename: 'booking.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }] },
});
const rows = () => db.select().from(bookingMails);
const deps = (send: (m: SubmissionMail) => Promise<boolean>, at?: Date) => ({
  mails: repo,
  sendForProject: async (_p: string, m: SubmissionMail) => send(m),
  ...(at ? { now: () => at.getTime() } : {}),
});

beforeEach(async () => {
  db = await makeTestDb();
  repo = new BookingMailRepository(db);
  projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, name: 'P', slug: `p-${projectId.slice(0, 8)}`, createdAt: new Date() });
  sent = [];
});

describe('sending', () => {
  it('sends a queued mail as it was rendered, then forgets it', async () => {
    await repo.enqueue(projectId, [MAIL(), MAIL('hello@studio.example')]);
    const result = await runBookingMail(deps(async (m) => (sent.push(m), true)));
    expect(result).toEqual({ sent: 2, failed: 0, more: false });
    expect(sent[0]).toMatchObject({
      recipient: 'ada@example.com',
      subject: 'Booking confirmed: Massage',
      replyTo: 'hello@studio.example',
      rendered: { text: 'You are booked.', html: '<p>You are booked.</p>' },
    });
    expect(sent[0]!.rendered?.attachments?.[0]?.filename).toBe('booking.ics');
    // The row goes, and the customer's details with it.
    expect(await rows()).toEqual([]);
  });

  it('backs off a mail that could not go, and keeps trying on the form deliveries’ schedule', async () => {
    const t0 = new Date('2026-10-27T10:00:00Z');
    await repo.enqueue(projectId, [MAIL()], t0);
    await runBookingMail(deps(async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:587'), { code: 'ECONNREFUSED' }); }, t0));
    const [row] = await rows();
    expect(row).toMatchObject({ state: 'pending', attempts: 1 });
    expect(row!.nextAt.getTime()).toBe(t0.getTime() + RETRY_BACKOFF_MS[0]!);
    // The server's address stays out of what is kept.
    expect(row!.lastError).not.toContain('10.0.0.5');
    // Not due yet: nothing is sent.
    await runBookingMail(deps(async (m) => (sent.push(m), true), new Date(t0.getTime() + 1000)));
    expect(sent).toHaveLength(0);
    // Due: it goes.
    await runBookingMail(deps(async (m) => (sent.push(m), true), new Date(t0.getTime() + RETRY_BACKOFF_MS[0]!)));
    expect(sent).toHaveLength(1);
    expect(await rows()).toEqual([]);
  });

  it('gives up after the last attempt, says so, and keeps it as failed for a week', async () => {
    let now = new Date('2026-10-27T10:00:00Z').getTime();
    await repo.enqueue(projectId, [MAIL()], new Date(now));
    let result = { sent: 0, failed: 0, more: false };
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
      result = await runBookingMail(deps(async () => false, new Date(now)));
      now += 2 * 24 * 60 * 60 * 1000;
    }
    expect(result.failed).toBe(1);
    const [row] = await rows();
    expect(row).toMatchObject({ state: 'failed', attempts: MAX_DELIVERY_ATTEMPTS });
    expect(row!.lastError).toMatch(/No mail server could send this/);
    // A failed mail is never tried again…
    await runBookingMail(deps(async (m) => (sent.push(m), true), new Date(now + 10 * 24 * 60 * 60 * 1000)));
    expect(sent).toHaveLength(0);
    // …and is swept a week after it was queued, not before.
    const created = row!.createdAt.getTime();
    expect(await repo.sweep(created + BOOKING_MAIL_LIMITS.failedRetentionMs - 1)).toBe(0);
    expect(await repo.sweep(created + BOOKING_MAIL_LIMITS.failedRetentionMs + 1)).toBe(1);
    expect(await rows()).toEqual([]);
  });

  it('never sweeps a mail still on its way', async () => {
    await repo.enqueue(projectId, [MAIL()], new Date('2026-01-01T00:00:00Z'));
    expect(await repo.sweep(Date.now())).toBe(0);
    expect(await rows()).toHaveLength(1);
  });
});

describe('a pass', () => {
  it('goes on past a mail whose outcome cannot be recorded, and that mail comes back with its lease', async () => {
    await repo.enqueue(projectId, [MAIL('a@example.com'), MAIL('b@example.com')]);
    const realSent = repo.sent.bind(repo);
    let broken = true;
    repo.sent = async (id: string) => {
      if (broken) {
        broken = false;
        throw new Error('database is locked');
      }
      return realSent(id);
    };
    const warned: unknown[] = [];
    const result = await runBookingMail({ ...deps(async (m) => (sent.push(m), true)), log: { warn: (o) => warned.push(o) } });
    expect(sent.map((m) => m.recipient).sort()).toEqual(['a@example.com', 'b@example.com']);
    expect(result.sent).toBe(1);
    expect(warned).toHaveLength(1);
    // One row is left, leased: it is not due again until the lease runs out.
    expect(await rows()).toHaveLength(1);
    expect(await repo.claimDue(new Date())).toHaveLength(0);
  });

  it('sends at most a batch, and says when there may be more', async () => {
    await repo.enqueue(projectId, Array.from({ length: BOOKING_MAIL_LIMITS.batch + 3 }, (_, i) => MAIL(`p${i}@example.com`)));
    const first = await runBookingMail(deps(async (m) => (sent.push(m), true)));
    expect(first).toEqual({ sent: BOOKING_MAIL_LIMITS.batch, failed: 0, more: true });
    const second = await runBookingMail(deps(async (m) => (sent.push(m), true)));
    expect(second).toEqual({ sent: 3, failed: 0, more: false });
    expect(await rows()).toEqual([]);
  });

  it('leases each mail from when it is tried, not from when the pass began', async () => {
    await repo.enqueue(projectId, [MAIL('a@example.com'), MAIL('b@example.com')], new Date(0));
    let clock = Date.UTC(2026, 9, 27, 10);
    const leases: number[] = [];
    const claim = repo.claimDue.bind(repo);
    repo.claimDue = async (now, limit) => {
      const got = await claim(now, limit);
      leases.push(...got.map((r) => r.nextAt.getTime() - now.getTime()));
      return got;
    };
    // Each send takes a minute of the clock.
    await runBookingMail({ mails: repo, sendForProject: async () => ((clock += 60_000), false), now: () => clock });
    const kept = await rows();
    // Both backed off from their own failure, a minute apart, not from the pass's start.
    const next = kept.map((r) => r.nextAt.getTime()).sort();
    expect(next[1]! - next[0]!).toBe(60_000);
    expect(leases.every((l) => l > 0)).toBe(true);
  });
});

describe('leases', () => {
  it('hands a mail to one pass only, and to the next once a crashed attempt’s lease runs out', async () => {
    await repo.enqueue(projectId, [MAIL()]);
    const now = new Date();
    const first = await repo.claimDue(now);
    expect(first).toHaveLength(1);
    // A second pass at the same moment finds it leased.
    expect(await repo.claimDue(now)).toHaveLength(0);
    // The first attempt died without a word: after the lease it is due again.
    const later = new Date(first[0]!.nextAt.getTime());
    expect(await repo.claimDue(later)).toHaveLength(1);
  });
});

describe('bounds', () => {
  it('queues at most the per-project cap, and says how many it dropped', async () => {
    const many = Array.from({ length: BOOKING_MAIL_LIMITS.queuedPerProject - 1 }, () => MAIL());
    expect(await repo.enqueue(projectId, many)).toEqual({ queued: many.length, dropped: 0 });
    expect(await repo.enqueue(projectId, [MAIL(), MAIL(), MAIL()])).toEqual({ queued: 1, dropped: 2 });
    // Another project is not affected.
    const other = randomUUID();
    await db.insert(projects).values({ id: other, name: 'Q', slug: `q-${other.slice(0, 8)}`, createdAt: new Date() });
    expect(await repo.enqueue(other, [MAIL()])).toEqual({ queued: 1, dropped: 0 });
    expect((await db.select().from(bookingMails).where(eq(bookingMails.projectId, projectId))).length).toBe(BOOKING_MAIL_LIMITS.queuedPerProject);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { SubmissionRepository } from '../src/repo/submissions.js';
import { runDueDeliveries } from '../src/mail/delivery-runner.js';
import { RETRY_BACKOFF_MS, MAX_DELIVERY_ATTEMPTS, DELIVERY_LEASE_MS } from '../src/mail/delivery-policy.js';
import { projects, formSubmissions } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import type { SubmissionMail } from '../src/mail/mailer.js';

// The retry loop, driven against a real database but no timers: the runner does ONE pass and takes
// `now` as an argument, so every scheduling assertion here is a plain comparison rather than a fake
// clock. That is the whole reason the pass and the schedule are separate things.

const NOW = 1_800_000_000_000;

let db: Database;
let repo: SubmissionRepository;
let projectId: string;

async function pending(fields: Record<string, string> = { email: 'v@example.com' }): Promise<string> {
  const s = await repo.create(projectId, 'contact', fields, { owesEmail: true });
  return s.id;
}

async function row(id: string) {
  const [r] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, id));
  return r!;
}

/** A resolver that always resolves, with a send outcome the test dictates. */
function resolver(send: (mail: SubmissionMail) => Promise<boolean>) {
  return async () => ({ mail: { recipient: 'a@b.co', subject: 's', formName: 'Contact', fields: {} }, send, explain: () => 'explained' });
}

beforeEach(async () => {
  db = await makeTestDb();
  repo = new SubmissionRepository(db);
  projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, name: 'P', slug: 'p', createdAt: new Date() });
});

describe('runDueDeliveries', () => {
  it('★ delivers a pending submission and marks it sent', async () => {
    const id = await pending();
    const result = await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW });
    expect(result).toMatchObject({ attempted: 1, sent: 1, retrying: 0, failed: 0 });
    expect((await row(id)).deliveryState).toBe('sent');
    expect((await row(id)).deliveryError).toBeNull();
  });

  it('★ schedules the next attempt with the operator-facing reason on failure', async () => {
    const id = await pending();
    const result = await runDueDeliveries({
      submissions: repo,
      resolveMail: resolver(async () => { throw new Error('boom'); }),
      now: () => NOW,
    });
    expect(result).toMatchObject({ retrying: 1, sent: 0 });
    const r = await row(id);
    expect(r.deliveryState).toBe('pending');
    expect(r.deliveryAttempts).toBe(1);
    expect(r.deliveryError).toBe('explained'); // the RESOLVER's wording, not a raw driver string
    expect(r.deliveryNextAt?.getTime()).toBe(NOW + RETRY_BACKOFF_MS[0]!);
  });

  it('★ gives up after the last attempt, leaving a row a human can see and resend', async () => {
    const id = await pending();
    let now = NOW;
    // Drive the full ladder: each pass fails, each schedules the next until the attempts run out.
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await runDueDeliveries({
        submissions: repo,
        resolveMail: resolver(async () => { throw new Error('still down'); }),
        now: () => now,
      });
      now += 48 * 60 * 60_000; // well past whatever was scheduled
    }
    const r = await row(id);
    expect(r.deliveryState).toBe('failed');
    expect(r.deliveryAttempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(r.deliveryError).toBeTruthy();
  });

  it('does not pick up a row before its next attempt is due', async () => {
    await pending();
    await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => { throw new Error('x'); }), now: () => NOW });
    // One second later nothing is due — the backoff has not elapsed.
    const second = await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW + 1000 });
    expect(second.attempted).toBe(0);
  });

  it('★ leases a claimed row, so a process killed mid-send retries instead of sticking', async () => {
    const id = await pending();
    // A resolver that never returns: the pass is abandoned exactly as a SIGKILL would.
    const hung = runDueDeliveries({
      submissions: repo,
      resolveMail: () => new Promise(() => {}),
      now: () => NOW,
    });
    void hung;
    await new Promise((r) => setTimeout(r, 50));
    const claimed = await row(id);
    expect(claimed.deliveryState).toBe('pending');
    expect(claimed.deliveryNextAt?.getTime()).toBe(NOW + DELIVERY_LEASE_MS); // pushed out, not lost
    // Nothing else touches it inside the lease…
    expect((await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW + 1000 })).attempted).toBe(0);
    // …and it becomes due again once the lease expires.
    expect((await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW + DELIVERY_LEASE_MS + 1 })).sent).toBe(1);
  });

  it('★ settles a row whose form no longer wants an email, rather than nagging forever', async () => {
    // The form was deleted, or switched to contact.php. Nothing is owed; leaving it pending would
    // keep an un-actionable item in the operator's inbox permanently.
    const id = await pending();
    const result = await runDueDeliveries({ submissions: repo, resolveMail: async () => null, now: () => NOW });
    expect(result).toMatchObject({ abandoned: 1, failed: 0, retrying: 0 });
    // `abandoned`, NOT `sent` — nothing was delivered, and conflating the two would make a
    // never-emailed row indistinguishable from a delivered one for anything that reads this later.
    expect((await row(id)).deliveryState).toBe('abandoned');
  });

  it('retries a "not configured" outcome — the admin may be about to configure it', async () => {
    const id = await pending();
    const result = await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => false), now: () => NOW });
    expect(result.retrying).toBe(1);
    expect((await row(id)).deliveryError).toMatch(/not configured/i);
  });

  it('never touches a submission that was never owed an email', async () => {
    await repo.create(projectId, 'contact', { email: 'v@example.com' }, { owesEmail: false });
    const result = await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW });
    expect(result.attempted).toBe(0);
  });

  it('bounds a backlog per pass rather than opening every session at once', async () => {
    for (let i = 0; i < 5; i++) await pending();
    const result = await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW, limit: 2 });
    expect(result.attempted).toBe(2);
  });

  it('a resolver that throws is recorded without leaking the raw error', async () => {
    const id = await pending();
    await runDueDeliveries({
      submissions: repo,
      resolveMail: async () => { throw new Error('SQLITE_BUSY: database is locked'); },
      now: () => NOW,
    });
    const r = await row(id);
    expect(r.deliveryState).toBe('pending');
    expect(r.deliveryError).not.toMatch(/SQLITE_BUSY/);
    expect(r.deliveryError).toMatch(/could not be read/i);
  });
});

describe('undelivered summary and resend', () => {
  it('scopes the count to one form when asked, so one form’s failure is not another’s banner', async () => {
    const a = await repo.create(projectId, 'contact', { email: 'a@x.co' }, { owesEmail: true });
    await repo.create(projectId, 'newsletter', { email: 'b@x.co' }, { owesEmail: true });
    await repo.recordDelivery(a.id, { state: 'failed', attempts: 7, error: 'contact form is broken' });

    expect((await repo.undeliveredSummary(projectId)).count).toBe(2); // project-wide
    expect((await repo.undeliveredSummary(projectId, 'contact')).count).toBe(1);
    expect((await repo.undeliveredSummary(projectId, 'newsletter')).count).toBe(1);
    expect((await repo.undeliveredSummary(projectId, 'contact')).lastError).toBe('contact form is broken');
  });

  it('counts what is still owed and reports the most recent reason', async () => {
    const id = await pending();
    await pending();
    await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => { throw new Error('x'); }), now: () => NOW });
    const summary = await repo.undeliveredSummary(projectId);
    expect(summary.count).toBe(2);
    expect(summary.lastError).toBe('explained');
    void id;
  });

  it('excludes rows that were delivered, and rows never owed an email', async () => {
    const id = await pending();
    await repo.create(projectId, 'contact', { email: 'x@y.z' }, { owesEmail: false });
    await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW });
    expect((await repo.undeliveredSummary(projectId)).count).toBe(0);
    void id;
  });

  it('★ resend puts a failed row back in the queue, so a backlog is recoverable', async () => {
    const id = await pending();
    let now = NOW;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => { throw new Error('down'); }), now: () => now });
      now += 48 * 60 * 60_000;
    }
    expect((await row(id)).deliveryState).toBe('failed');

    expect(await repo.requeue(projectId, id)).toBe(true);
    const requeued = await row(id);
    expect(requeued.deliveryState).toBe('pending');
    expect(requeued.deliveryAttempts).toBe(0); // a fresh ladder, not one attempt from the end
    expect(requeued.deliveryError).toBeNull();

    // …and the next pass delivers it now that the operator has fixed SMTP.
    expect((await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => now })).sent).toBe(1);
  });

  it('★ refuses to requeue a row that was already DELIVERED', async () => {
    // The click that would email a lead its recipient has already received. The inbox no longer
    // offers the button on a delivered row, but presentation is not a rule.
    const id = await pending();
    await runDueDeliveries({ submissions: repo, resolveMail: resolver(async () => true), now: () => NOW });
    expect((await row(id)).deliveryState).toBe('sent');
    expect(await repo.requeue(projectId, id)).toBe(false);
    expect((await row(id)).deliveryState).toBe('sent'); // and it stays settled
  });

  it('★ refuses to requeue an ABANDONED row — nothing is owed for a deleted form', async () => {
    const id = await pending();
    await runDueDeliveries({ submissions: repo, resolveMail: async () => null, now: () => NOW });
    expect((await row(id)).deliveryState).toBe('abandoned');
    expect(await repo.requeue(projectId, id)).toBe(false);
  });

  it('refuses to requeue a submission that was never owed an email', async () => {
    const s = await repo.create(projectId, 'contact', { email: 'x@y.z' }, { owesEmail: false });
    expect(await repo.requeue(projectId, s.id)).toBe(false);
  });

  it('refuses to requeue across projects', async () => {
    const id = await pending();
    expect(await repo.requeue(randomUUID(), id)).toBe(false);
  });
});

describe('claimDue — the predicate that actually governs what gets retried', () => {
  // Tested directly rather than only through the runner. A pure `isDeliveryDue()` helper used to sit
  // beside this with confident-looking tests and was called by NOTHING: the real decision has always
  // been this SQL. Well-named tests over unused code are worse than no tests, because they read as
  // coverage of the thing they do not touch.
  it('claims a pending row that is due, and leases it forward', async () => {
    const id = await pending();
    const [claimed] = await repo.claimDue(new Date(NOW), 60_000, 10);
    expect(claimed?.id).toBe(id);
    expect((await row(id)).deliveryNextAt?.getTime()).toBe(NOW + 60_000);
  });

  it('does not claim a row whose next attempt is still in the future', async () => {
    const id = await pending();
    await repo.recordDelivery(id, { state: 'pending', attempts: 1, nextAt: new Date(NOW + 5_000), error: 'x' });
    expect(await repo.claimDue(new Date(NOW), 60_000, 10)).toEqual([]);
    expect((await repo.claimDue(new Date(NOW + 5_000), 60_000, 10)).length).toBe(1);
  });

  it('★ never claims a settled row, whatever its next-attempt time says', async () => {
    for (const state of ['sent', 'abandoned'] as const) {
      const id = await pending();
      await repo.recordDelivery(id, { state });
      expect(await repo.claimDue(new Date(NOW + 10_000_000), 60_000, 10)).toEqual([]);
    }
    // …and a row that was never owed an email is invisible to it too.
    await repo.create(projectId, 'contact', { email: 'x@y.z' }, { owesEmail: false });
    expect(await repo.claimDue(new Date(NOW + 10_000_000), 60_000, 10)).toEqual([]);
  });

  it('★ a brand-new submission is NOT due immediately — the request path is still sending it', async () => {
    // Without this the background pass could claim a row the request handler had not finished
    // sending, and the recipient would get the same notification twice.
    await pending();
    expect(await repo.claimDue(new Date(Date.now()), 60_000, 10)).toEqual([]);
  });

  it('takes the oldest first, so a backlog drains in the order it arrived', async () => {
    // createdAt is stamped by the repo from the wall clock, so two rows made in the same millisecond
    // tie and the order is arbitrary. Age one explicitly — the assertion is about ORDERING, and a
    // tie would make it pass or fail by luck.
    const older = await pending();
    const newer = await pending();
    await db.update(formSubmissions).set({ createdAt: new Date(NOW - 60_000) }).where(eq(formSubmissions.id, older));
    await db.update(formSubmissions).set({ createdAt: new Date(NOW - 1_000) }).where(eq(formSubmissions.id, newer));
    const [claimed] = await repo.claimDue(new Date(NOW), 60_000, 1);
    expect(claimed?.id).toBe(older);
  });
});


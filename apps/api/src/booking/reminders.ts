import type { BookingConfig, BookingOffering } from '@sitewright/schema';
import type { BookingClaimsRepository, ClaimRow } from './claims.js';
import type { BookingEvent } from './notify.js';

/**
 * BOOKING REMINDERS: a customer is emailed about their booking the set-up's `remindBeforeMin` before it starts.
 *
 * ★ Nothing is stored but one timestamp per booking (`reminded_at`), which is ALSO set when a reminder is decided
 * against (the set-up has none, or the booking became one inside the window: its confirmation just went out), so a
 * booking is looked at until it is decided, then never again. ★ AT MOST ONCE: marked BEFORE the mail is queued,
 * conditionally, so of two passes one sends; a mail the queue then refuses (a project with too many waiting) is lost,
 * not sent twice. So a set-up that switches reminders on later reminds only bookings not yet decided against.
 *
 * ★ Read in pages across projects, past bookings not due yet (a short window's bookings would otherwise fill every
 * page, and another project's due reminders never be read), up to the longest window ahead and a few pages a pass.
 */

export const BOOKING_REMINDER_LIMITS = {
  /** How far ahead the pass looks: the longest reminder window a set-up may have. */
  horizonMs: 7 * 24 * 60 * 60_000,
  /**
   * Bookings read per page, and pages read per pass (what is left, the next pass reads). 10 000 bookings not due yet
   * in the coming week, ahead of another's due one, would still hold it back: far past any instance's booking volume.
   */
  page: 500,
  pagesPerPass: 20,
} as const;

export interface ReminderDeps {
  claims: Pick<BookingClaimsRepository, 'dueForReminder' | 'markReminded'>;
  readConfig: (projectId: string) => Promise<BookingConfig | null>;
  notify: (event: BookingEvent) => Promise<void>;
  /** The booking's signed reference, for the link to its own page. */
  reference: (projectId: string, claimId: string) => string;
  log: { warn: (o: unknown, m: string) => void };
}

/** One pass: reminds what is due, decides against what never will be. Returns how many reminders it queued. */
export async function runReminders(deps: ReminderDeps, now: number): Promise<number> {
  const configs = new Map<string, Promise<BookingConfig | null>>();
  // A project whose set-up could not be read is skipped for the rest of the pass, and said once.
  const unreadable = new Set<string>();
  let sent = 0;
  let after: { startAt: Date; id: string } | undefined;
  for (let page = 0; page < BOOKING_REMINDER_LIMITS.pagesPerPass; page++) {
    const rows = await deps.claims.dueForReminder(now, BOOKING_REMINDER_LIMITS.horizonMs, BOOKING_REMINDER_LIMITS.page, after);
    for (const claim of rows) {
      if (unreadable.has(claim.projectId)) continue;
      let set: BookingConfig | null;
      try {
        let config = configs.get(claim.projectId);
        if (!config) {
          config = deps.readConfig(claim.projectId);
          configs.set(claim.projectId, config);
        }
        set = await config;
      } catch (err) {
        unreadable.add(claim.projectId);
        deps.log.warn({ err, projectId: claim.projectId }, 'booking reminders skipped this pass: the set-up could not be read');
        continue;
      }
      try {
        if (await remind(deps, claim, set, now)) sent += 1;
      } catch (err) {
        deps.log.warn({ err, projectId: claim.projectId }, 'booking reminder not sent this pass');
      }
    }
    if (rows.length < BOOKING_REMINDER_LIMITS.page) break;
    const last = rows[rows.length - 1]!;
    after = { startAt: last.startAt, id: last.id };
  }
  return sent;
}

/** Decides one booking, and reminds it when due. True when a reminder was queued. */
async function remind(deps: ReminderDeps, claim: ClaimRow, set: BookingConfig | null, now: number): Promise<boolean> {
  const verdict = decide(claim, set, now);
  if (verdict === 'later') return false;
  if (!(await deps.claims.markReminded(claim.projectId, claim.id, now))) return false;
  if (verdict === 'never') return false;
  await deps.notify({
    kind: 'reminder',
    projectId: claim.projectId,
    claim,
    offering: verdict.offering,
    config: verdict.config,
    reference: deps.reference(claim.projectId, claim.id),
    ...(claim.locale ? { locale: claim.locale } : {}),
  });
  return true;
}

/**
 * Whether a booking's reminder is due now (with what it is written from), not yet, or never: no reminders, its
 * offering gone, or it became a booking inside the window (`updatedAt`: when a request accepted or a payment made it
 * one, which is when its confirmation went out).
 * ★ Nothing touches a booked claim's `updatedAt` today. Whatever comes to (a reschedule, an edit of its details) must
 * clear `reminded_at` and think about this rule, or it silences the booking's reminder.
 */
export function decide(
  claim: Pick<ClaimRow, 'offeringId' | 'startAt' | 'updatedAt'>,
  config: BookingConfig | null,
  now: number,
): { config: BookingConfig; offering: BookingOffering } | 'later' | 'never' {
  const window = config?.remindBeforeMin;
  const offering = config?.offerings.find((o) => o.id === claim.offeringId);
  if (!config || window === undefined || !offering) return 'never';
  const remindAt = claim.startAt.getTime() - window * 60_000;
  if (claim.updatedAt.getTime() >= remindAt) return 'never';
  return now >= remindAt ? { config, offering } : 'later';
}

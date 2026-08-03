import type { SubmissionRepository, DueDelivery } from '../repo/submissions.js';
import { DELIVERY_LEASE_MS, MAX_DELIVERY_ATTEMPTS, nextAttemptAt } from './delivery-policy.js';
import type { SubmissionMail } from './mailer.js';

/**
 * Retries form notifications that did not go out on the first attempt.
 *
 * WHY THIS EXISTS: delivery is best-effort by design — the submission is stored and the visitor is
 * thanked whether or not the mail leaves, which is right for the visitor and used to be the end of
 * it. A transient SMTP failure meant the notification simply never happened; the lead survived in
 * the inbox, but nobody was told it had arrived, and the only trace was one line in the server log.
 *
 * ONE PASS, NO SCHEDULING. The interval lives in `server.ts` and nowhere else: `createApp` is
 * constructed by roughly two hundred test files, and a background timer in every one of them is a
 * flakiness generator. Keeping the pass a plain function also means the retry behaviour is tested
 * by calling it, not by advancing a fake clock.
 */

/** What the runner needs to deliver one submission — the same mailers the request path uses. */
export interface DeliveryRunnerDeps {
  submissions: SubmissionRepository;
  /**
   * Resolves how to deliver one submission, or null when the form/mode no longer wants an email.
   *
   * `explain` turns a thrown error into the sentence an operator will read in the inbox. It belongs
   * to the resolver rather than the runner because only the caller knows WHICH server was being
   * talked to — a generic explainer here would render "The server at the mail server:0…".
   */
  resolveMail: (row: DueDelivery) => Promise<{
    mail: SubmissionMail;
    send: (mail: SubmissionMail) => Promise<boolean>;
    explain: (err: unknown) => string;
  } | null>;
  /** Injected so tests need no fake timers and the scheduler stays the only thing that knows "now". */
  now?: () => number;
  /** Rows per pass. A bound, not a target: a large backlog drains over several ticks rather than
   *  opening hundreds of SMTP sessions at once. */
  limit?: number;
  log?: (message: string, detail: Record<string, unknown>) => void;
}

export interface DeliveryRunResult {
  attempted: number;
  sent: number;
  retrying: number;
  failed: number;
  /** Rows whose form or mode no longer wants an email — resolved without sending. */
  abandoned: number;
}

export async function runDueDeliveries(deps: DeliveryRunnerDeps): Promise<DeliveryRunResult> {
  // No pass-level clock: every row reads the time when its own work starts (see the loop).
  const limit = deps.limit ?? 25;
  const result: DeliveryRunResult = { attempted: 0, sent: 0, retrying: 0, failed: 0, abandoned: 0 };

  // ★ ONE ROW PER CLAIM, not one batch. A batch is leased at the moment it is claimed, but the pass
  // works through it sequentially and a single attempt can take the transport's full worst case —
  // so with a batch the later rows' leases could expire while the pass was still walking towards
  // them, and a second pass could reclaim and send them underneath it. Claiming each row as it is
  // reached means every lease starts when the work does.
  for (let i = 0; i < limit; i++) {
    // Each row gets the CURRENT clock, not the pass-start one: a pass working through a backlog can
    // run for minutes, and a "back off one minute" computed from when the pass started would already
    // be in the past by the time it is written — collapsing the backoff for exactly the rows in a
    // struggling queue that most need it.
    const rowNow = deps.now?.() ?? Date.now();
    const [row] = await deps.submissions.claimDue(new Date(rowNow), DELIVERY_LEASE_MS, 1);
    if (!row) break;
    result.attempted += 1;
    const attempts = row.attempts + 1;

    let resolved: Awaited<ReturnType<DeliveryRunnerDeps['resolveMail']>>;
    try {
      resolved = await deps.resolveMail(row);
    } catch (err) {
      // Could not even work out how to send (settings unreadable, project gone). No explainer is
      // available, so say the plainest true thing.
      await recordFailure(deps, row, attempts, rowNow, describeFallback(err), result);
      continue;
    }

    // The form was deleted, or its mode changed to one the platform does not route. There is
    // nothing left to owe, and leaving it pending would keep it in the operator's face forever.
    if (!resolved) {
      // `abandoned`, not `sent`: nothing was ever delivered here, and recording otherwise would make
      // a never-emailed row indistinguishable from a delivered one for anything that later reads
      // this column — an audit, a report, or the per-row Resend gate in the inbox.
      await deps.submissions.recordDelivery(row.id, { state: 'abandoned' });
      result.abandoned += 1;
      continue;
    }

    // Same separation as the request path: a database error while recording "sent" must not be
    // mistaken for the mail having failed, or the next pass re-sends what already went.
    let sent = false;
    try {
      sent = await resolved.send(resolved.mail);
    } catch (err) {
      await recordFailure(deps, row, attempts, rowNow, resolved.explain(err), result);
      continue;
    }
    try {
      if (sent) {
        await deps.submissions.recordDelivery(row.id, { state: 'sent' });
        result.sent += 1;
      } else {
        // `false` means "not configured / not enabled" rather than a transport error. Retrying is
        // still right: an admin who has just been told mail is broken may be about to configure it.
        await recordFailure(
          deps,
          row,
          attempts,
          rowNow,
          'Mail is not configured for this form’s delivery mode, or the mode is disabled instance-wide.',
          result,
        );
      }
    } catch (err) {
      // The SEND succeeded (or was cleanly "not configured"); only the bookkeeping failed. Leave the
      // row leased — it becomes due again on its own — rather than recording an outcome we no longer
      // know to be true.
      deps.log?.('could not record a delivery outcome', { id: row.id, err: String(err) });
    }
  }

  if (result.attempted > 0) {
    deps.log?.('form notification retry pass', { ...result });
  }
  return result;
}

/** Last resort when no resolver-supplied explainer exists: never leak a raw driver message. */
function describeFallback(err: unknown): string {
  return `The mail settings for this form could not be read (${err instanceof Error ? err.name : 'error'}).`;
}


async function recordFailure(
  deps: DeliveryRunnerDeps,
  row: DueDelivery,
  attempts: number,
  now: number,
  error: string,
  result: DeliveryRunResult,
): Promise<void> {
  const next = nextAttemptAt(attempts, now);
  if (next === null || attempts >= MAX_DELIVERY_ATTEMPTS) {
    await deps.submissions.recordDelivery(row.id, { state: 'failed', attempts, error });
    result.failed += 1;
    return;
  }
  await deps.submissions.recordDelivery(row.id, { state: 'pending', attempts, nextAt: new Date(next), error });
  result.retrying += 1;
}

import { nextAttemptAt, DELIVERY_LEASE_MS } from '../mail/delivery-policy.js';
import { describeDeliveryFailure } from '../mail/mailer.js';
import type { ShopTransactionRepository, TransactionRow } from '../repo/shop-transactions.js';
import { orderMailContext, renderAdminMail, renderCustomerMail, sendOrderMail, type OrderMailerDeps } from './notify.js';

/**
 * THE ORDER-MAIL RUNNER.
 *
 * Deliberately the same shape as the submission delivery runner: claim with a lease, attempt, record
 * the outcome in ONE write, back off. A second mechanism for the same job is a second mechanism to
 * get wrong, and this one carries the more expensive failure — a customer who paid and heard nothing.
 */

export interface NotifyRunnerDeps extends OrderMailerDeps {
  transactions: ShopTransactionRepository;
  /** The shop's notification address and mail mode for a project, or null when it has none. */
  resolveChannel: (projectId: string, channelKey: string) => Promise<{ email: string; subject?: string; mode: 'globalSmtp' | 'userSmtp'; shopName: string } | null>;
  log?: { warn: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void };
}

/** How many of each kind one pass handles. Bounded so a backlog drains steadily rather than in a spike. */
const BATCH = 20;

/**
 * One pass over everything owed a mail.
 *
 * ★ The two kinds are claimed and recorded SEPARATELY, end to end. A merchant address that bounces
 * must not stop the buyer's receipt, and a retry of one must never re-send the other.
 */
export async function runOrderMail(deps: NotifyRunnerDeps, now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const kind of ['notify', 'receipt'] as const) {
    const due = await deps.transactions.claimDueMail(kind, now, DELIVERY_LEASE_MS, BATCH);
    for (const txn of due) {
      const outcome = await deliverOne(deps, txn, kind, now);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'failed') failed += 1;
    }
  }
  return { sent, failed };
}

async function deliverOne(
  deps: NotifyRunnerDeps,
  txn: TransactionRow,
  kind: 'notify' | 'receipt',
  now: Date,
): Promise<'sent' | 'retry' | 'failed' | 'skipped'> {
  const channel = await deps.resolveChannel(txn.projectId, txn.channelKey);
  if (!channel) {
    // The channel has been deleted since the order was placed. There is nobody to tell and no amount
    // of retrying will produce one, so stop rather than retrying for ever.
    await deps.transactions.recordMail(txn.id, kind, { state: 'failed', attempts: 0, error: 'the shop channel this order came from no longer exists' });
    deps.log?.warn({ projectId: txn.projectId, txnId: txn.id, kind }, 'order mail abandoned: the channel is gone');
    return 'failed';
  }
  const recipient = kind === 'notify' ? channel.email : txn.customerEmail;
  if (!recipient) {
    // ★ A receipt with no address is recorded as such, not retried. "No customer address" is a fact
    // about the order, and an operator looking at the inbox is owed it rather than a silent gap.
    await deps.transactions.recordMail(txn.id, kind, { state: 'failed', attempts: 0, error: 'no customer address was captured for this order' });
    return 'failed';
  }

  const ctx = orderMailContext(txn, channel.shopName);
  const rendered = kind === 'notify' ? renderAdminMail(ctx, channel.subject) : renderCustomerMail(ctx);
  // ★ Reply-To on the MERCHANT's copy only, and only to the buyer: it is the one that gets replied to.
  const replyTo = kind === 'notify' ? (txn.customerEmail ?? undefined) : undefined;

  let ok = false;
  let error: string | null = null;
  try {
    ok = await sendOrderMail(deps, txn.projectId, channel.mode, recipient, rendered, replyTo ?? undefined);
    if (!ok) error = 'Mail is not configured for this delivery mode, or the mode is disabled instance-wide.';
  } catch (err) {
    // ★ Only the sanitized description escapes. A nodemailer error carries the SMTP banner and the
    // resolved IP, and for a project's own SMTP that is the tenant's infrastructure.
    error = describeDeliveryFailure(err);
  }

  if (ok) {
    await deps.transactions.recordMail(txn.id, kind, { state: 'sent' });
    return 'sent';
  }
  const attempts = (kind === 'notify' ? txn.notifyAttempts : txn.receiptAttempts) + 1;
  const next = nextAttemptAt(attempts, now.getTime());
  if (next === null) {
    await deps.transactions.recordMail(txn.id, kind, { state: 'failed', attempts, error: error ?? 'delivery failed' });
    deps.log?.warn({ projectId: txn.projectId, txnId: txn.id, kind, attempts }, 'order mail abandoned after the final attempt');
    return 'failed';
  }
  await deps.transactions.recordMail(txn.id, kind, { state: 'pending', attempts, nextAt: new Date(next), error: error ?? 'delivery failed' });
  return 'retry';
}

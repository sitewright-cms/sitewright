import { and, eq } from 'drizzle-orm';
import { FormSchema, isPlatformRoutedMode } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { content } from '../db/schema.js';
import type { DueDelivery } from '../repo/submissions.js';
import { describeDeliveryFailure, type SubmissionMailer, type ProjectMailer, type SubmissionMail } from './mailer.js';

/**
 * Works out how to deliver one overdue submission, using the form AS IT IS NOW.
 *
 * Re-reading the form each time is the whole point of a retry: between the failed attempt and this
 * one the recipient may have been corrected, the SMTP settings fixed, or the form deleted. Replaying
 * a snapshot taken at submission time would mean fixing the misconfiguration did not fix the
 * backlog, which is the one thing an operator expects retrying to do.
 *
 * Returns null when nothing is owed any more — the form is gone, unparseable, or no longer
 * platform-routed. The runner treats that as settled rather than failed, so a deleted form cannot
 * leave a row nagging in the inbox forever.
 */
export function makeDeliveryResolver(deps: {
  db: Database;
  mailer: SubmissionMailer;
  projectMailer: ProjectMailer;
}) {
  return async (row: DueDelivery): Promise<{
    mail: SubmissionMail;
    send: (mail: SubmissionMail) => Promise<boolean>;
    explain: (err: unknown) => string;
  } | null> => {
    const [formRow] = await deps.db
      .select()
      .from(content)
      .where(and(eq(content.projectId, row.projectId), eq(content.kind, 'form'), eq(content.entityId, row.formId)));
    if (!formRow) return null;
    const parsed = FormSchema.safeParse(formRow.data);
    if (!parsed.success) return null;
    const form = parsed.data;
    if (!isPlatformRoutedMode(form.mode)) return null;
    // NOT checked here: whether the mode is enabled instance-wide. Both mailers already return
    // false for a disabled mode, and `false` is RETRYABLE — an admin who has just been told mail is
    // broken may be about to switch it back on. Duplicating the check here would instead settle the
    // row as "nothing owed", quietly discarding the backlog the moment someone toggled a setting.

    // Same Reply-To rule as the request path: the submitter's address, when they gave one.
    const replyTo = typeof row.fields.email === 'string' && row.fields.email ? row.fields.email : undefined;
    return {
      mail: {
        recipient: form.recipient,
        subject: form.subject || `New "${form.name}" submission`,
        formName: form.name,
        fields: row.fields,
        ...(replyTo ? { replyTo } : {}),
      },
      send: (mail) =>
        form.mode === 'globalSmtp' ? deps.mailer.send(mail) : deps.projectMailer.send(row.projectId, mail),
      explain: describeDeliveryFailure,
    };
  };
}
